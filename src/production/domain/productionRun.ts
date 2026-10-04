import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";
import type { DomainId } from "../../shared/domain/ids";
import {
  createImmutableTimestamp,
  type ImmutableTimestamp,
  type SourceReference,
} from "../../shared/domain/observationSource";
import {
  isValidRunPlanApproval,
  runPlanRevisionSourceReference,
  type RunPlanApproval,
  type RunPlanRevision,
  type RunPlanStep,
} from "./runPlan";

export type ProductionRunStatus =
  | "draft"
  | "planned"
  | "approved"
  | "running"
  | "paused"
  | "waiting_for_human"
  | "completed"
  | "failed"
  | "cancelled";

export type ProductionRunStepStatus =
  | "pending"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export interface ProductionRunStepState {
  readonly stepId: DomainId;
  readonly generationTaskId: DomainId;
  readonly ordinal: number;
  readonly dependsOn: readonly DomainId[];
  readonly status: ProductionRunStepStatus;
  readonly attemptIds: readonly DomainId[];
}

export interface ProductionRun {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly runPlanRevisionId: DomainId;
  readonly planRevisionReference: SourceReference;
  readonly status: ProductionRunStatus;
  readonly revisionNumber: number;
  readonly currentRevisionId: string;
  readonly stepStates: readonly ProductionRunStepState[];
  readonly statusReason?: string;
  readonly createdAt: ImmutableTimestamp;
  readonly updatedAt: ImmutableTimestamp;
}

const terminalStatuses = new Set<ProductionRunStatus>(["completed", "failed", "cancelled"]);

function requireText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function timestamp(value: Date | ImmutableTimestamp, name: string): ImmutableTimestamp {
  return value instanceof Date
    ? createImmutableTimestamp({ iso: value.toISOString(), epochMilliseconds: value.getTime() })
    : createImmutableTimestamp(value);
}

export function productionRunRevisionId(
  run: Pick<ProductionRun, "id" | "revisionNumber" | "status" | "statusReason" | "stepStates">,
): string {
  return `${run.id}:${run.revisionNumber}:${run.status}:${hashContent(canonicalJson({
    status: run.status,
    statusReason: run.statusReason ?? null,
    stepStates: run.stepStates,
  }))}`;
}



function initialStepStates(revision: RunPlanRevision): readonly ProductionRunStepState[] {
  return deepFreeze(revision.steps.map((step: RunPlanStep) => ({
    stepId: step.id,
    generationTaskId: step.generationTaskId,
    ordinal: step.ordinal,
    dependsOn: step.dependsOn,
    status: "pending" as const,
    attemptIds: [] as readonly DomainId[],
  })));
}

export function createProductionRun(input: {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly runPlanRevision: RunPlanRevision;
  readonly createdAt: Date | ImmutableTimestamp;
}): ProductionRun {
  const id = requireText(input.id, "run id");
  const novelId = requireText(input.novelId, "novelId");
  if (novelId !== input.runPlanRevision.novelId) {
    throw new Error("Run Plan novelId must match Production Run");
  }
  const createdAt = timestamp(input.createdAt, "createdAt");
  return deepFreeze({
    id,
    novelId,
    runPlanRevisionId: input.runPlanRevision.id,
    planRevisionReference: runPlanRevisionSourceReference(input.runPlanRevision),
    status: "draft" as const,
    revisionNumber: 1,
    currentRevisionId: productionRunRevisionId({ id, revisionNumber: 1, status: "draft", stepStates: initialStepStates(input.runPlanRevision) }),
    stepStates: initialStepStates(input.runPlanRevision),
    createdAt,
    updatedAt: createdAt,
  });
}

function assertNonterminal(run: ProductionRun): void {
  if (terminalStatuses.has(run.status)) throw new Error("terminal run cannot transition");
}

function transition(
  run: ProductionRun,
  status: ProductionRunStatus,
  updatedAt: Date | ImmutableTimestamp,
  reason?: string,
  stepStates = run.stepStates,
): ProductionRun {
  assertNonterminal(run);
  const nextUpdatedAt = timestamp(updatedAt, "updatedAt");
  if (nextUpdatedAt.epochMilliseconds < run.updatedAt.epochMilliseconds) {
    throw new Error("updatedAt cannot move backward");
  }
  const revisionNumber = run.revisionNumber + 1;
  const next = {
    ...run,
    status,
    revisionNumber,
    stepStates: deepFreeze(stepStates),
    ...(reason === undefined ? {} : { statusReason: requireText(reason, "statusReason") }),
    updatedAt: nextUpdatedAt,
  };
  return deepFreeze({
    ...next,
    currentRevisionId: productionRunRevisionId(next),
  });
}

export function planProductionRun(run: ProductionRun, plannedAt: Date | ImmutableTimestamp): ProductionRun {
  if (run.status !== "draft") throw new Error("Only a draft run can be planned");
  return transition(run, "planned", plannedAt);
}

export function approveProductionRun(
  run: ProductionRun,
  approval: RunPlanApproval,
  approvedAt: Date | ImmutableTimestamp,
): ProductionRun {
  if (run.status !== "planned") throw new Error("Only a planned run can be approved");
  if (
    approval.planRevisionReference.identity !== run.planRevisionReference.identity ||
    approval.planRevisionReference.version !== run.planRevisionReference.version ||
    approval.planRevisionReference.hash !== run.planRevisionReference.hash ||
    !isValidRunPlanApproval(approval)
  ) {
    throw new Error("Run Plan approval does not match the referenced revision");
  }
  return transition(run, "approved", approvedAt);
}

export function startProductionRun(run: ProductionRun, startedAt: Date | ImmutableTimestamp): ProductionRun {
  if (run.status !== "approved") throw new Error("Only an approved run can start");
  return transition(run, "running", startedAt);
}

export function pauseProductionRun(
  run: ProductionRun,
  pausedAt: Date | ImmutableTimestamp,
  reason: string,
): ProductionRun {
  if (run.status !== "running") throw new Error("Only a running run can pause");
  return transition(run, "paused", pausedAt, reason);
}

export function waitForHumanProductionRun(
  run: ProductionRun,
  waitingAt: Date | ImmutableTimestamp,
  reason: string,
): ProductionRun {
  if (run.status !== "running") throw new Error("Only a running run can wait for human");
  return transition(run, "waiting_for_human", waitingAt, reason);
}

export function resumeProductionRun(
  run: ProductionRun,
  resumedAt: Date | ImmutableTimestamp,
): ProductionRun {
  if (run.status !== "paused" && run.status !== "waiting_for_human") {
    throw new Error("Only a paused or waiting run can resume");
  }
  return transition(run, "running", resumedAt);
}

export function completeProductionRun(
  run: ProductionRun,
  completedAt: Date | ImmutableTimestamp,
): ProductionRun {
  if (run.status !== "running") throw new Error("Only a running run can complete");
  if (run.stepStates.some((state) => state.status !== "succeeded")) {
    throw new Error("all plan steps must succeed before completion");
  }
  return transition(run, "completed", completedAt);
}

export function failProductionRun(
  run: ProductionRun,
  failedAt: Date | ImmutableTimestamp,
  reason: string,
): ProductionRun {
  if (run.status !== "running" && run.status !== "paused" && run.status !== "waiting_for_human") {
    throw new Error("Only an active run can fail");
  }
  return transition(run, "failed", failedAt, reason);
}

export function cancelProductionRun(
  run: ProductionRun,
  cancelledAt: Date | ImmutableTimestamp,
  reason: string,
): ProductionRun {
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    throw new Error("terminal run cannot transition");
  }
  return transition(run, "cancelled", cancelledAt, reason);
}

export function nextRunnableProductionRunStep(
  run: ProductionRun,
): ProductionRunStepState | undefined {
  const completed = new Set(
    run.stepStates.filter((state) => state.status === "succeeded").map((state) => state.stepId),
  );
  for (const state of run.stepStates) {
    if (state.status !== "succeeded") continue;
    if (!state.dependsOn.every((dependencyId) => completed.has(dependencyId))) {
      throw new Error("step states must satisfy dependencies");
    }
  }
  return run.stepStates.find(
    (state) =>
      (state.status === "pending" || state.status === "ready") &&
      state.dependsOn.every((dependencyId) => completed.has(dependencyId)),
  );
}
