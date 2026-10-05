import type {
  LongRunningProcessCancellationReceipt,
  LongRunningProcessResult,
  LongRunningProcessSnapshot,
} from "../../application/longRunningProcessBoundary";
import type {
  ExecutionAttempt,
  ExecutionFailureEvidence,
  ExecutionRoutingDecisionReference,
} from "../domain/executionAttempt";
import type { GenerationTask } from "../domain/generationTask";
import type { ProductionRun } from "../domain/productionRun";
import type { RunPlanRevision } from "../domain/runPlan";
import type { RuntimeRequest, RuntimeResult } from "../runtime/runtimeAdapter";
import {
  productionRunExecutionPort,
  type ProductionRunExecutionPort,
  type ScheduleProductionRunExecutionInput,
} from "../application/productionRunExecutionPort";

export interface SchedulerScheduleRequest {
  readonly run: ProductionRun;
  readonly attempt: ExecutionAttempt;
  readonly timeoutMs: number;
}

export interface ScheduledWorkOrder extends SchedulerScheduleRequest {
  readonly workId: string;
}

export interface SchedulerCancellationReceipt {
  readonly workId: string;
  readonly disposition: "cancelled" | "already-cancelled";
  readonly cancellationRequested: true;
}

export interface SchedulerAdapter {
  schedule(request: SchedulerScheduleRequest): Promise<ScheduledWorkOrder>;
  cancel(workId: string, reason: string): Promise<SchedulerCancellationReceipt>;
}

export interface WorkerExecutionControl {
  readonly signal: AbortSignal;
}

export interface WorkerExecutionError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type WorkerExecutionResult =
  | { readonly status: "succeeded"; readonly runtimeResult: RuntimeResult }
  | { readonly status: "failed"; readonly error: WorkerExecutionError }
  | { readonly status: "cancelled"; readonly reason: string };

export interface WorkerAdapter {
  execute(
    order: ScheduledWorkOrder,
    control: WorkerExecutionControl,
  ): Promise<WorkerExecutionResult>;
}

export interface SchedulerProcessBoundary {
  markRunning(id: string): Promise<unknown>;
  complete(
    id: string,
    result: LongRunningProcessResult<RuntimeResult>,
  ): Promise<unknown>;
  requestCancellation(
    id: string,
  ): Promise<LongRunningProcessCancellationReceipt>;
  observe(id: string): Promise<LongRunningProcessSnapshot<RuntimeResult>>;
}

export interface SchedulerWorkerExecutionPolicy {
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly fallbackEnabled?: boolean;
}

export interface SchedulerProcessReference {
  readonly id: string;
}

export interface SchedulerExecutionRequest {
  readonly run: ProductionRun;
  readonly runPlanRevision: RunPlanRevision;
  readonly generationTask: GenerationTask;
  readonly stepId: string;
  readonly executionKey: string;
  readonly routingDecision: ExecutionRoutingDecisionReference;
  readonly fallbackRoutingDecision?: ExecutionRoutingDecisionReference;
  readonly runtimeRequest: RuntimeRequest;
  readonly policy: SchedulerWorkerExecutionPolicy;
  readonly process: SchedulerProcessReference;
}

export type SchedulerWorkerExecutionResult =
  | {
      readonly status: "succeeded";
      readonly runtimeResult: RuntimeResult;
      readonly run: ProductionRun;
      readonly attempts: readonly ExecutionAttempt[];
      readonly finalRelation: ExecutionAttempt["relation"];
    }
  | {
      readonly status: "failed";
      readonly error: WorkerExecutionError;
      readonly run: ProductionRun;
      readonly attempts: readonly ExecutionAttempt[];
      readonly finalRelation: ExecutionAttempt["relation"];
    }
  | {
      readonly status: "cancelled";
      readonly reason: string;
      readonly run: ProductionRun;
      readonly attempts: readonly ExecutionAttempt[];
      readonly finalRelation: ExecutionAttempt["relation"];
    };

export interface SchedulerWorkerExecutionCancellationReceipt {
  readonly executionKey: string;
  readonly disposition: LongRunningProcessCancellationReceipt["disposition"];
  readonly status: LongRunningProcessSnapshot<RuntimeResult>["status"];
  readonly cancellationRequested: boolean;
  readonly process: LongRunningProcessSnapshot<RuntimeResult>;
}

export interface ProductionSchedulerWorkerBoundaryOptions {
  readonly scheduler: SchedulerAdapter;
  readonly worker: WorkerAdapter;
  readonly fallbackWorker?: WorkerAdapter;
  readonly processBoundary: SchedulerProcessBoundary;
  readonly executionPort?: ProductionRunExecutionPort;
  readonly now?: () => Date;
}

export const schedulerWorkerExecutionContract = Object.freeze({
  scheduling: Object.freeze({
    identitySource: "ExecutionAttempt.id",
    relationSource: "ExecutionAttempt.relation",
    timeoutSource: "SchedulerScheduleRequest.timeoutMs",
  }),
  timeout: Object.freeze({
    enforcedBy: "scheduler",
    failureCode: "timeout",
    cancelsScheduledWork: true,
    retryAfterCancel: true,
  }),
  cancellation: Object.freeze({
    source: "P2.2",
    method: "requestCancellation",
    terminalDisposition: "observe",
    idempotent: true,
  }),
  retry: Object.freeze({
    relationSource: "ExecutionAttempt",
    predecessorSource: "ExecutionAttempt.predecessorAttemptReference",
  }),
  fallback: Object.freeze({
    relationSource: "ExecutionAttempt",
    trigger: "retry-exhausted",
  }),
  processBoundary: Object.freeze({
    source: "P2.2",
    resultChannel: "process-result",
  }),
});

interface ExecutionState {
  readonly controller: AbortController;
  readonly processId: string;
  readonly attempts: ExecutionAttempt[];
  run: ProductionRun;
  execution?: Promise<SchedulerWorkerExecutionResult>;
  activeWork?: ScheduledWorkOrder;
  readonly cancelledWorkIds: Set<string>;
  cancellationRequested: boolean;
  cancellationReason?: string;
}

type AttemptControl =
  | { readonly kind: "timeout" }
  | { readonly kind: "cancelled"; readonly reason: string };

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function requireNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) throw new Error(`${name} is required`);
}

function workerFailure(error: unknown): WorkerExecutionError {
  return {
    code: "worker-error",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

export class ProductionSchedulerWorkerBoundary {
  private readonly states = new Map<string, ExecutionState>();
  private readonly executionPort: ProductionRunExecutionPort;

  constructor(private readonly options: ProductionSchedulerWorkerBoundaryOptions) {
    this.executionPort = options.executionPort ?? productionRunExecutionPort;
  }

  execute(request: SchedulerExecutionRequest): Promise<SchedulerWorkerExecutionResult> {
    requireNonEmpty(request.stepId, "stepId");
    requireNonEmpty(request.executionKey, "executionKey");
    requireNonEmpty(request.process.id, "process.id");
    requirePositiveInteger(request.policy.timeoutMs, "timeoutMs");
    requirePositiveInteger(request.policy.maxAttempts, "maxAttempts");
    if (this.states.has(request.executionKey)) {
      throw new Error(
        `execution identity ${request.executionKey} is already active`,
      );
    }

    const processReady = this.options.processBoundary.markRunning(request.process.id);
    const state: ExecutionState = {
      controller: new AbortController(),
      processId: request.process.id,
      attempts: [],
      run: request.run,
      cancelledWorkIds: new Set(),
      cancellationRequested: false,
    };
    this.states.set(request.executionKey, state);
    const execution = this.run(request, state, processReady).finally(() => {
      state.activeWork = undefined;
    });
    state.execution = execution;
    return execution;
  }

  async cancel(
    executionKey: string,
    reason: string,
  ): Promise<SchedulerWorkerExecutionCancellationReceipt> {
    requireNonEmpty(executionKey, "executionKey");
    requireNonEmpty(reason, "reason");
    const state = this.states.get(executionKey);
    if (!state) throw new Error(`unknown execution: ${executionKey}`);

    const requestReceipt = await this.options.processBoundary.requestCancellation(state.processId);
    state.cancellationRequested = true;
    state.cancellationReason = reason;
    state.controller.abort();
    if (state.activeWork) {
      await this.cancelScheduledWork(state, state.activeWork, reason);
    }
    await state.execution?.catch(() => undefined);
    const process = await this.options.processBoundary.observe(state.processId);
    if (process.phase !== "terminal") {
      throw new Error(`process ${state.processId} is still ${process.phase}`);
    }
    return {
      executionKey,
      disposition: requestReceipt.disposition,
      status: process.status,
      cancellationRequested: requestReceipt.cancellationRequested,
      process,
    };
  }

  private async run(
    request: SchedulerExecutionRequest,
    state: ExecutionState,
    processReady: Promise<unknown>,
  ): Promise<SchedulerWorkerExecutionResult> {
    await processReady;
    const executionPort = this.executionPort;
    let relation: ScheduleProductionRunExecutionInput["relation"] = "initial";
    let previousAttempt: ExecutionAttempt | undefined;
    let lastError: WorkerExecutionError = {
      code: "worker-not-executed",
      message: "worker did not execute",
      retryable: false,
    };

    for (let primaryAttempt = 0; primaryAttempt < request.policy.maxAttempts; primaryAttempt += 1) {
      relation = primaryAttempt === 0 ? "initial" : "retry";
      const scheduled = await executionPort.schedule({
        run: state.run,
        runPlanRevision: request.runPlanRevision,
        generationTask: request.generationTask,
        stepId: request.stepId,
        executionKey: request.executionKey,
        routingDecision: request.routingDecision,
        createdAt: this.options.now?.() ?? new Date(),
        relation,
        ...(previousAttempt ? { previousAttempt } : {}),
      });
      state.run = scheduled.run;
      state.attempts.push(scheduled.attempt);
      previousAttempt = scheduled.attempt;

      const order = await this.options.scheduler.schedule({
        run: state.run,
        attempt: scheduled.attempt,
        timeoutMs: request.policy.timeoutMs,
      });
      state.activeWork = order;
      const outcome = await this.executeAttempt(order, state, this.options.worker);

      if (outcome.status === "cancelled") {
        const transition = await this.recordCancellation(request, state, outcome.reason);
        return this.cancelledResult(transition, state, outcome.reason);
      }
      if (outcome.status === "succeeded") {
        const transition = executionPort.succeed({
          run: state.run,
          stepId: request.stepId,
          attempt: state.attempts.at(-1) ?? scheduled.attempt,
          runtimeRequest: request.runtimeRequest,
          runtimeResult: outcome.runtimeResult,
          at: this.options.now?.() ?? new Date(),
        });
        state.run = transition.run;
        state.attempts[state.attempts.length - 1] = transition.attempt;
        await this.options.processBoundary.complete(request.process.id, {
          status: "succeeded",
          value: outcome.runtimeResult,
        });
        return {
          status: "succeeded",
          runtimeResult: outcome.runtimeResult,
          run: transition.run,
          attempts: state.attempts,
          finalRelation: transition.attempt.relation,
        };
      }

      lastError = outcome.error;
      const transition = executionPort.fail({
        run: state.run,
        stepId: request.stepId,
        attempt: state.attempts.at(-1) ?? scheduled.attempt,
        failure: {
          code: outcome.error.code,
          message: outcome.error.message,
          retryable: outcome.error.retryable,
        },
        at: this.options.now?.() ?? new Date(),
      });
      state.run = transition.run;
      state.attempts[state.attempts.length - 1] = transition.attempt;
      previousAttempt = transition.attempt;
      if (!outcome.error.retryable || primaryAttempt === request.policy.maxAttempts - 1) break;
    }

    if (
      request.policy.fallbackEnabled &&
      this.options.fallbackWorker &&
      lastError.retryable
    ) {
      relation = "fallback";
      const scheduled = await executionPort.schedule({
        run: state.run,
        runPlanRevision: request.runPlanRevision,
        generationTask: request.generationTask,
        stepId: request.stepId,
        executionKey: request.executionKey,
        routingDecision: request.fallbackRoutingDecision ?? request.routingDecision,
        createdAt: this.options.now?.() ?? new Date(),
        relation,
        ...(previousAttempt ? { previousAttempt } : {}),
      });
      state.run = scheduled.run;
      state.attempts.push(scheduled.attempt);
      previousAttempt = scheduled.attempt;
      const order = await this.options.scheduler.schedule({
        run: state.run,
        attempt: scheduled.attempt,
        timeoutMs: request.policy.timeoutMs,
      });
      state.activeWork = order;
      const outcome = await this.executeAttempt(order, state, this.options.fallbackWorker);

      if (outcome.status === "cancelled") {
        const transition = await this.recordCancellation(request, state, outcome.reason);
        return this.cancelledResult(transition, state, outcome.reason);
      }
      if (outcome.status === "succeeded") {
        const transition = executionPort.succeed({
          run: state.run,
          stepId: request.stepId,
          attempt: state.attempts.at(-1) ?? scheduled.attempt,
          runtimeRequest: request.runtimeRequest,
          runtimeResult: outcome.runtimeResult,
          at: this.options.now?.() ?? new Date(),
        });
        state.run = transition.run;
        state.attempts[state.attempts.length - 1] = transition.attempt;
        await this.options.processBoundary.complete(request.process.id, {
          status: "succeeded",
          value: outcome.runtimeResult,
        });
        return {
          status: "succeeded",
          runtimeResult: outcome.runtimeResult,
          run: transition.run,
          attempts: state.attempts,
          finalRelation: transition.attempt.relation,
        };
      }

      lastError = outcome.error;
      const transition = executionPort.fail({
        run: state.run,
        stepId: request.stepId,
        attempt: state.attempts.at(-1) ?? scheduled.attempt,
        failure: {
          code: outcome.error.code,
          message: outcome.error.message,
          retryable: outcome.error.retryable,
        },
        at: this.options.now?.() ?? new Date(),
      });
      state.run = transition.run;
      state.attempts[state.attempts.length - 1] = transition.attempt;
      previousAttempt = transition.attempt;
    }

    await this.options.processBoundary.complete(request.process.id, {
      status: "failed",
      error: lastError.message,
    });
    return {
      status: "failed",
      error: lastError,
      run: state.run,
      attempts: state.attempts,
      finalRelation: state.attempts.at(-1)?.relation ?? "initial",
    };
  }

  private async executeAttempt(
    order: ScheduledWorkOrder,
    state: ExecutionState,
    selectedWorker: WorkerAdapter,
  ): Promise<WorkerExecutionResult> {
    const controller = new AbortController();
    const forwardCancellation = () => controller.abort();
    if (state.controller.signal.aborted) forwardCancellation();
    state.controller.signal.addEventListener("abort", forwardCancellation, { once: true });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<AttemptControl>(resolve => {
      timeoutHandle = setTimeout(() => resolve({ kind: "timeout" }), order.timeoutMs);
    });
    const cancellation = new Promise<AttemptControl>(resolve => {
      const resolveCancellation = () =>
        resolve({ kind: "cancelled", reason: state.cancellationReason ?? "cancelled" });
      if (state.controller.signal.aborted) resolveCancellation();
      state.controller.signal.addEventListener("abort", resolveCancellation, { once: true });
    });
    const workerPromise = Promise.resolve().then(() =>
      selectedWorker.execute(order, { signal: controller.signal }),
    );

    try {
      const outcome = await Promise.race([
        workerPromise.then(value => ({ kind: "worker" as const, value })),
        timeout,
        cancellation,
      ]);
      if (outcome.kind === "worker") return outcome.value;

      const reason = outcome.kind === "timeout" ? "timeout" : outcome.reason;
      await this.cancelScheduledWork(state, order, reason);
      await workerPromise.catch(() => undefined);
      return outcome.kind === "timeout"
        ? {
            status: "failed",
            error: {
              code: "timeout",
              message: "worker execution timed out",
              retryable: true,
            },
          }
        : { status: "cancelled", reason };
    } catch (error) {
      return { status: "failed", error: workerFailure(error) };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      state.controller.signal.removeEventListener("abort", forwardCancellation);
    }
  }

  private async cancelScheduledWork(
    state: ExecutionState,
    order: ScheduledWorkOrder,
    reason: string,
  ): Promise<void> {
    if (state.cancelledWorkIds.has(order.workId)) return;
    state.cancelledWorkIds.add(order.workId);
    await this.options.scheduler.cancel(order.workId, reason);
  }

  private async recordCancellation(
    request: SchedulerExecutionRequest,
    state: ExecutionState,
    reason: string,
  ): Promise<{ run: ProductionRun; attempt: ExecutionAttempt }> {
    const executionPort = this.executionPort;
    const transition = executionPort.cancel({
      run: state.run,
      stepId: request.stepId,
      attempt: state.attempts.at(-1) as ExecutionAttempt,
      reason,
      at: this.options.now?.() ?? new Date(),
    });
    state.run = transition.run;
    state.attempts[state.attempts.length - 1] = transition.attempt;
    await this.options.processBoundary.complete(request.process.id, { status: "cancelled" });
    return transition;
  }

  private cancelledResult(
    transition: { run: ProductionRun; attempt: ExecutionAttempt },
    state: ExecutionState,
    reason: string,
  ): SchedulerWorkerExecutionResult {
    return {
      status: "cancelled",
      reason,
      run: transition.run,
      attempts: state.attempts,
      finalRelation: transition.attempt.relation,
    };
  }
}
