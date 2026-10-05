import type {
  ExecutionAttempt,
  ExecutionFailureEvidence,
  ExecutionRoutingDecisionReference,
} from "../domain/executionAttempt";
import {
  cancelExecutionAttempt,
  completeExecutionAttempt,
  failExecutionAttempt,
  startExecutionAttempt,
} from "../domain/executionAttempt";
import type { GenerationTask } from "../domain/generationTask";
import type { ProductionRun } from "../domain/productionRun";
import type { RunPlanRevision } from "../domain/runPlan";
import type { RuntimeRequest, RuntimeResult } from "../runtime/runtimeAdapter";
import {
  recordProductionRunAttemptOutcome,
  scheduleProductionRunAttempt,
  type ScheduledAttemptRelation,
  type ScheduledProductionRunAttempt,
} from "./productionRunScheduler";

export type MaybePromise<T> = T | Promise<T>;

export interface ScheduleProductionRunExecutionInput {
  readonly run: ProductionRun;
  readonly runPlanRevision: RunPlanRevision;
  readonly generationTask: GenerationTask;
  readonly stepId: string;
  readonly executionKey: string;
  readonly routingDecision: ExecutionRoutingDecisionReference;
  readonly createdAt: Date;
  readonly relation?: ScheduledAttemptRelation;
  readonly previousAttempt?: ExecutionAttempt;
}

export interface ProductionRunExecutionTransition {
  readonly run: ProductionRun;
  readonly attempt: ExecutionAttempt;
}

export interface StartProductionRunExecutionInput {
  readonly run: ProductionRun;
  readonly stepId: string;
  readonly attempt: ExecutionAttempt;
  readonly at: Date;
}

export interface CompleteProductionRunExecutionInput {
  readonly run: ProductionRun;
  readonly stepId: string;
  readonly attempt: ExecutionAttempt;
  readonly runtimeRequest: RuntimeRequest;
  readonly runtimeResult: RuntimeResult;
  readonly at: Date;
}

export interface FailProductionRunExecutionInput {
  readonly run: ProductionRun;
  readonly stepId: string;
  readonly attempt: ExecutionAttempt;
  readonly failure: ExecutionFailureEvidence;
  readonly at: Date;
  readonly retryReason?: string;
}

export interface CancelProductionRunExecutionInput {
  readonly run: ProductionRun;
  readonly stepId: string;
  readonly attempt: ExecutionAttempt;
  readonly reason: string;
  readonly at: Date;
}

export interface ProductionRunExecutionPort {
  schedule(input: ScheduleProductionRunExecutionInput): MaybePromise<ScheduledProductionRunAttempt>;
  start(input: StartProductionRunExecutionInput): MaybePromise<ProductionRunExecutionTransition>;
  succeed(input: CompleteProductionRunExecutionInput): MaybePromise<ProductionRunExecutionTransition>;
  fail(input: FailProductionRunExecutionInput): MaybePromise<ProductionRunExecutionTransition>;
  cancel(input: CancelProductionRunExecutionInput): MaybePromise<ProductionRunExecutionTransition>;
}

function record(
  run: ProductionRun,
  stepId: string,
  attempt: ExecutionAttempt,
  at: Date,
): ProductionRunExecutionTransition {
  return {
    attempt,
    run: recordProductionRunAttemptOutcome({ run, stepId, attempt, at }),
  };
}

export const productionRunExecutionPort: ProductionRunExecutionPort = {
  schedule: input => scheduleProductionRunAttempt(input),
  start: input => ({
    run: input.run,
    attempt: startExecutionAttempt(input.attempt, input.at),
  }),
  succeed: input => {
    const terminal = completeExecutionAttempt({
      attempt: input.attempt,
      runtimeRequest: input.runtimeRequest,
      runtimeResult: input.runtimeResult,
      completedAt: input.at,
    });
    return record(input.run, input.stepId, terminal, input.at);
  },
  fail: input => {
    const terminal = failExecutionAttempt({
      attempt: input.attempt,
      failure: input.failure,
      failedAt: input.at,
      ...(input.retryReason === undefined ? {} : { retryReason: input.retryReason }),
    });
    return record(input.run, input.stepId, terminal, input.at);
  },
  cancel: input => {
    const terminal = cancelExecutionAttempt({
      attempt: input.attempt,
      reason: input.reason,
      cancelledAt: input.at,
    });
    return record(input.run, input.stepId, terminal, input.at);
  },
};
