import {
  ProductionSchedulerWorkerBoundary,
  type SchedulerAdapter,
  type SchedulerExecutionRequest,
  type SchedulerProcessBoundary,
  type SchedulerWorkerExecutionResult,
  type WorkerAdapter,
} from "../runtime/schedulerWorkerBoundary";
import type { RuntimeResult } from "../runtime/runtimeAdapter";
import type { ExecutionAttempt } from "../domain/executionAttempt";
import type { ProductionRun } from "../domain/productionRun";
import type { ExecutionRecoveryPersistence } from "./executionRecoveryPersistence";
import { createDurableProductionRunExecutionPort } from "./durableProductionRunExecutionPort";

export type ProductionRunRecoveryDisposition = "executed" | "resumed" | "replayed";

export type ProductionRunRecoveryResult = SchedulerWorkerExecutionResult & {
  readonly disposition: ProductionRunRecoveryDisposition;
};

export interface ProductionRunRecoveryOptions {
  readonly persistence: ExecutionRecoveryPersistence;
  readonly scheduler: SchedulerAdapter;
  readonly worker: WorkerAdapter;
  readonly fallbackWorker?: WorkerAdapter;
  readonly processBoundary: SchedulerProcessBoundary;
  readonly now?: () => Date;
}

interface PersistedExecutionState {
  readonly run: ProductionRun;
  readonly attempts: readonly ExecutionAttempt[];
}

export const productionRunRecoveryContract = Object.freeze({
  crash: Object.freeze({
    resumeIdentity: "ExecutionAttempt.id",
    schedulerReplay: "same-work-id",
    workerIdempotencyKey: "ExecutionAttempt.id",
  }),
  duplicatePrevention: Object.freeze({
    attemptIdentity: "deterministic-ExecutionAttempt-id",
    scheduleDisposition: "return-existing-attempt",
  }),
  atomicity: Object.freeze({
    unit: Object.freeze(["ExecutionAttempt", "ProductionRun"]),
  }),
  replay: Object.freeze({
    terminalDisposition: "return-persisted-result",
    processResult: "idempotent",
  }),
  compensation: Object.freeze({
    owner: "runCompensationService",
    idempotencyKeySource: "runId+sourceCommitId",
    commitIdSource: "runId+sourceCommitId",
  }),
  narrativeTruth: Object.freeze({
    owned: false,
  }),
});

export class ProductionRunRecoveryBoundary {
  private readonly runtime: ProductionSchedulerWorkerBoundary;
  private readonly active = new Map<string, Promise<ProductionRunRecoveryResult>>();

  constructor(private readonly options: ProductionRunRecoveryOptions) {
    this.runtime = new ProductionSchedulerWorkerBoundary({
      scheduler: options.scheduler,
      worker: options.worker,
      ...(options.fallbackWorker === undefined
        ? {}
        : { fallbackWorker: options.fallbackWorker }),
      processBoundary: options.processBoundary,
      executionPort: createDurableProductionRunExecutionPort(options.persistence),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  execute(request: SchedulerExecutionRequest): Promise<ProductionRunRecoveryResult> {
    const existing = this.active.get(request.executionKey);
    if (existing) return existing;
    const execution = this.executeOnce(request).finally(() => {
      this.active.delete(request.executionKey);
    });
    this.active.set(request.executionKey, execution);
    return execution;
  }

  private async executeOnce(
    request: SchedulerExecutionRequest,
  ): Promise<ProductionRunRecoveryResult> {
    const persisted = await this.readPersistedState(request);
    if (!persisted || persisted.attempts.length === 0) {
      const result = await this.runtime.execute(request);
      return { ...result, disposition: "executed" };
    }

    const before = persisted.attempts.length;
    const last = persisted.attempts.at(-1)!;
    const result = await this.runtime.resume(request, persisted);
    const resumed =
      last.status === "created" ||
      last.status === "running" ||
      result.attempts.length > before;
    return {
      ...result,
      disposition: resumed ? "resumed" : "replayed",
    };
  }

  private async readPersistedState(
    request: SchedulerExecutionRequest,
  ): Promise<PersistedExecutionState | undefined> {
    const run = await this.options.persistence.runs.findById(request.run.id);
    if (!run) return undefined;
    const state = run.stepStates.find(candidate => candidate.stepId === request.stepId);
    if (!state) throw new Error("unknown run step");
    const attempts: ExecutionAttempt[] = [];
    for (const attemptId of state.attemptIds) {
      const attempt = await this.options.persistence.attempts.findById(attemptId);
      if (!attempt) throw new Error(`scheduled Attempt is missing: ${attemptId}`);
      attempts.push(attempt);
    }
    return { run, attempts };
  }
}

export function createProductionRunRecoveryBoundary(
  options: ProductionRunRecoveryOptions,
): ProductionRunRecoveryBoundary {
  return new ProductionRunRecoveryBoundary(options);
}

export type { RuntimeResult };
