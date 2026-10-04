import { deepFreeze } from "../../shared/domain/immutable";
import { createImmutableTimestamp } from "../../shared/domain/observationSource";
import type { GenerationTask } from "../domain/generationTask";
import {
  createExecutionAttempt,
  createFallbackExecutionAttempt,
  createRetryExecutionAttempt,
  type ExecutionAttempt,
  type ExecutionRoutingDecisionReference,
} from "../domain/executionAttempt";
import {
  runPlanRevisionSourceReference,
  type RunPlanRevision,
} from "../domain/runPlan";
import {
  productionRunRevisionId,
  type ProductionRun,
  type ProductionRunStepState,
} from "../domain/productionRun";

export type ScheduledAttemptRelation = "initial" | "retry" | "fallback";

export interface ScheduleProductionRunAttemptInput {
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

export interface ScheduledProductionRunAttempt {
  readonly run: ProductionRun;
  readonly attempt: ExecutionAttempt;
  readonly generationTask: GenerationTask;
}

export function scheduleProductionRunAttempt(
  input: ScheduleProductionRunAttemptInput,
): ScheduledProductionRunAttempt {
  if (input.run.status !== "running") throw new Error("run must be running");
  const expectedPlanReference = runPlanRevisionSourceReference(input.runPlanRevision);
  const actualPlanReference = input.run.planRevisionReference;
  if (
    input.run.runPlanRevisionId !== input.runPlanRevision.id ||
    actualPlanReference.identity !== expectedPlanReference.identity ||
    actualPlanReference.version !== expectedPlanReference.version ||
    actualPlanReference.hash !== expectedPlanReference.hash
  ) {
    throw new Error("Run Plan Revision does not match Production Run");
  }
  if (
    input.run.novelId !== input.runPlanRevision.novelId ||
    input.generationTask.novelId !== input.run.novelId ||
    input.generationTask.novelId !== input.runPlanRevision.novelId
  ) {
    throw new Error("GenerationTask novelId must match Run and Run Plan");
  }
  const planStep = input.runPlanRevision.steps.find((step) => step.id === input.stepId);
  const state = input.run.stepStates.find((candidate) => candidate.stepId === input.stepId);
  if (!planStep || !state) throw new Error("unknown run step");
  if (planStep.generationTaskId !== input.generationTask.id) {
    throw new Error("GenerationTask does not match the plan step");
  }
  const relation = input.relation ?? "initial";
  const completed = new Set(
    input.run.stepStates
      .filter((candidate) => candidate.status === "succeeded")
      .map((candidate) => candidate.stepId),
  );
  if (
    (relation === "initial" && state.status !== "pending") ||
    (relation !== "initial" && state.status !== "pending" && state.status !== "running") ||
    !state.dependsOn.every((dependencyId) => completed.has(dependencyId))
  ) {
    throw new Error("step is not runnable");
  }

  const attemptOrdinal = state.attemptIds.length + 1;
  let attempt: ExecutionAttempt;
  if (relation === "initial") {
    if (input.previousAttempt) throw new Error("initial attempt cannot have a predecessor");
    attempt = createExecutionAttempt({
      executionKey: input.executionKey,
      attemptOrdinal,
      relation,
      generationTask: input.generationTask,
      routingDecision: input.routingDecision,
      createdAt: input.createdAt,
    });
  } else {
    if (!input.previousAttempt) throw new Error(`${relation} attempt requires a predecessor`);
    if (input.previousAttempt.generationTaskId !== input.generationTask.id) {
      throw new Error("previous attempt must reference the same GenerationTask");
    }
    attempt = relation === "retry"
      ? createRetryExecutionAttempt({
          previousAttempt: input.previousAttempt,
          executionKey: input.executionKey,
          attemptOrdinal,
          routingDecision: input.routingDecision,
          createdAt: input.createdAt,
        })
      : createFallbackExecutionAttempt({
          previousAttempt: input.previousAttempt,
          executionKey: input.executionKey,
          attemptOrdinal,
          routingDecision: input.routingDecision,
          createdAt: input.createdAt,
        });
  }

  const stepStates: readonly ProductionRunStepState[] = input.run.stepStates.map((candidate) =>
    candidate.stepId === state.stepId
      ? {
          ...candidate,
          status: "running",
          attemptIds: [...candidate.attemptIds, attempt.id],
        }
      : candidate,
  );
  const revisionNumber = input.run.revisionNumber + 1;
  const run: ProductionRun = deepFreeze({
    ...input.run,
    status: "running",
    revisionNumber,
    currentRevisionId: productionRunRevisionId({
      ...input.run,
      status: "running",
      revisionNumber,
      stepStates,
    }),
    stepStates: Object.freeze(stepStates),
    updatedAt: createImmutableTimestamp({
      iso: input.createdAt.toISOString(),
      epochMilliseconds: input.createdAt.getTime(),
    }),
  });

  return { run, attempt, generationTask: input.generationTask };
}




export interface RecordProductionRunAttemptOutcomeInput {
  readonly run: ProductionRun;
  readonly stepId: string;
  readonly attempt: ExecutionAttempt;
  readonly at: Date;
}

export function recordProductionRunAttemptOutcome(
  input: RecordProductionRunAttemptOutcomeInput,
): ProductionRun {
  if (input.run.status !== "running") throw new Error("run must be running");
  const state = input.run.stepStates.find((candidate) => candidate.stepId === input.stepId);
  if (!state) throw new Error("unknown run step");
  if (!state.attemptIds.includes(input.attempt.id)) {
    throw new Error("attempt is not scheduled for the run step");
  }
  if (
    input.attempt.generationTaskId !== state.generationTaskId ||
    input.attempt.status === "created" ||
    input.attempt.status === "running"
  ) {
    throw new Error("attempt must be terminal for the scheduled GenerationTask");
  }

  const stepStates = input.run.stepStates.map((candidate) =>
    candidate.stepId === input.stepId
      ? {
          ...candidate,
          status: input.attempt.status === "succeeded"
            ? ("succeeded" as const)
            : ("failed" as const),
        }
      : candidate,
  );
  const revisionNumber = input.run.revisionNumber + 1;
  return deepFreeze({
    ...input.run,
    revisionNumber,
    stepStates,
    currentRevisionId: productionRunRevisionId({
      ...input.run,
      revisionNumber,
      stepStates,
    }),
    updatedAt: createImmutableTimestamp({
      iso: input.at.toISOString(),
      epochMilliseconds: input.at.getTime(),
    }),
  });
}
