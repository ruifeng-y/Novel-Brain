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
  schedule(input: ScheduleProductionRunExecutionInput): ScheduledProductionRunAttempt;
  succeed(input: CompleteProductionRunExecutionInput): ProductionRunExecutionTransition;
  fail(input: FailProductionRunExecutionInput): ProductionRunExecutionTransition;
  cancel(input: CancelProductionRunExecutionInput): ProductionRunExecutionTransition;
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
  succeed: input => {
    const started = startExecutionAttempt(input.attempt, input.at);
    const terminal = completeExecutionAttempt({
      attempt: started,
      runtimeRequest: input.runtimeRequest,
      runtimeResult: input.runtimeResult,
      completedAt: input.at,
    });
    return record(input.run, input.stepId, terminal, input.at);
  },
  fail: input => {
    const started = startExecutionAttempt(input.attempt, input.at);
    const terminal = failExecutionAttempt({
      attempt: started,
      failure: input.failure,
      failedAt: input.at,
      ...(input.retryReason === undefined ? {} : { retryReason: input.retryReason }),
    });
    return record(input.run, input.stepId, terminal, input.at);
  },
  cancel: input => {
    const started = startExecutionAttempt(input.attempt, input.at);
    const terminal = cancelExecutionAttempt({
      attempt: started,
      reason: input.reason,
      cancelledAt: input.at,
    });
    return record(input.run, input.stepId, terminal, input.at);
  },
};
