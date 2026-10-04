import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";
import type { DomainId } from "../../shared/domain/ids";
import {
  createImmutableTimestamp,
  createSourceReference,
  type ImmutableTimestamp,
  type SourceReference,
} from "../../shared/domain/observationSource";

export interface RunPlanStep {
  readonly id: DomainId;
  readonly ordinal: number;
  readonly generationTaskId: DomainId;
  readonly dependsOn: readonly DomainId[];
}

export interface RunPlanRevision {
  readonly id: DomainId;
  readonly planId: DomainId;
  readonly novelId: DomainId;
  readonly revisionNumber: number;
  readonly parentRevisionId?: DomainId;
  readonly goal: string;
  readonly steps: readonly RunPlanStep[];
  readonly contentHash: string;
  readonly createdAt: ImmutableTimestamp;
}

export interface RunPlanApproval {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly planRevisionReference: SourceReference;
  readonly approvedBy: string;
  readonly approvedAt: ImmutableTimestamp;
  readonly approvalHash: string;
}

function requireText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function timestamp(value: Date | ImmutableTimestamp, name: string): ImmutableTimestamp {
  return value instanceof Date
    ? createImmutableTimestamp({ iso: value.toISOString(), epochMilliseconds: value.getTime() })
    : createImmutableTimestamp(value);
}

function normalizeStep(input: RunPlanStep): RunPlanStep {
  return deepFreeze({
    id: requireText(input.id, "step id"),
    ordinal: requirePositiveInteger(input.ordinal, "step ordinal"),
    generationTaskId: requireText(input.generationTaskId, "generationTaskId"),
    dependsOn: Object.freeze([...new Set(input.dependsOn.map((id) => requireText(id, "dependency id")))]),
  });
}

function validateSteps(input: readonly RunPlanStep[]): readonly RunPlanStep[] {
  if (input.length === 0) throw new Error("Run Plan requires at least one step");
  const normalized = input.map(normalizeStep);
  const stepIds = new Set<string>();
  const taskIds = new Set<string>();
  let previousOrdinal = 0;
  for (const step of normalized) {
    if (step.ordinal <= previousOrdinal) {
      throw new Error("step ordinals must be strictly increasing");
    }
    previousOrdinal = step.ordinal;
    if (stepIds.has(step.id)) throw new Error(`duplicate step id: ${step.id}`);
    if (taskIds.has(step.generationTaskId)) {
      throw new Error(`duplicate GenerationTask id: ${step.generationTaskId}`);
    }
    for (const dependencyId of step.dependsOn) {
      if (!stepIds.has(dependencyId)) {
        throw new Error(`unknown dependency: ${dependencyId}`);
      }
    }
    stepIds.add(step.id);
    taskIds.add(step.generationTaskId);
  }
  return deepFreeze(normalized);
}

function contentFor(revision: Pick<RunPlanRevision, "goal" | "steps">): string {
  return hashContent(canonicalJson({ goal: revision.goal, steps: revision.steps }));
}

export function createRunPlanRevision(input: {
  readonly id: DomainId;
  readonly planId: DomainId;
  readonly novelId: DomainId;
  readonly revisionNumber: number;
  readonly parentRevisionId?: DomainId;
  readonly goal: string;
  readonly steps: readonly RunPlanStep[];
  readonly createdAt: Date | ImmutableTimestamp;
}): RunPlanRevision {
  const goal = requireText(input.goal, "goal");
  const steps = validateSteps(input.steps);
  return deepFreeze({
    id: requireText(input.id, "revision id"),
    planId: requireText(input.planId, "planId"),
    novelId: requireText(input.novelId, "novelId"),
    revisionNumber: requirePositiveInteger(input.revisionNumber, "revisionNumber"),
    ...(input.parentRevisionId === undefined
      ? {}
      : { parentRevisionId: requireText(input.parentRevisionId, "parentRevisionId") }),
    goal,
    steps,
    contentHash: contentFor({ goal, steps }),
    createdAt: timestamp(input.createdAt, "createdAt"),
  });
}

export function reviseRunPlanRevision(input: {
  readonly sourceRevision: RunPlanRevision;
  readonly revisionId: DomainId;
  readonly revisionNumber: number;
  readonly goal: string;
  readonly steps: readonly RunPlanStep[];
  readonly revisedAt: Date | ImmutableTimestamp;
}): RunPlanRevision {
  if (input.revisionNumber !== input.sourceRevision.revisionNumber + 1) {
    throw new Error("revisionNumber must increment by one");
  }
  return createRunPlanRevision({
    id: input.revisionId,
    planId: input.sourceRevision.planId,
    novelId: input.sourceRevision.novelId,
    revisionNumber: input.revisionNumber,
    parentRevisionId: input.sourceRevision.id,
    goal: input.goal,
    steps: input.steps,
    createdAt: input.revisedAt,
  });
}

export function runPlanRevisionSourceReference(revision: RunPlanRevision): SourceReference {
  return createSourceReference({
    identity: revision.planId,
    version: revision.id,
    hash: revision.contentHash,
  });
}

export function createRunPlanApproval(input: {
  readonly id: DomainId;
  readonly revision: RunPlanRevision;
  readonly approvedBy: string;
  readonly approvedAt: Date | ImmutableTimestamp;
}): RunPlanApproval {
  const planRevisionReference = runPlanRevisionSourceReference(input.revision);
  const approvedBy = requireText(input.approvedBy, "approvedBy");
  const approvedAt = timestamp(input.approvedAt, "approvedAt");
  return deepFreeze({
    id: requireText(input.id, "approval id"),
    novelId: input.revision.novelId,
    planRevisionReference,
    approvedBy,
    approvedAt,
    approvalHash: hashContent(canonicalJson({
      planRevisionReference,
      approvedBy,
      approvedAt,
    })),
  });
}

export function isValidRunPlanApproval(approval: RunPlanApproval): boolean {
  return approval.approvalHash === hashContent(canonicalJson({
    planRevisionReference: approval.planRevisionReference,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
  }));
}

export function approveRunPlanRevision(
  approval: RunPlanApproval,
  revision: RunPlanRevision,
): boolean {
  const expected = runPlanRevisionSourceReference(revision);
  return (
    isValidRunPlanApproval(approval) &&
    approval.planRevisionReference.identity === expected.identity &&
    approval.planRevisionReference.version === expected.version &&
    approval.planRevisionReference.hash === expected.hash
  );
}

export function nextRunnableRunPlanStep(
  revision: RunPlanRevision,
  completedStepIds: readonly DomainId[],
): RunPlanStep | undefined {
  const completed = new Set(completedStepIds);
  for (const stepId of completed) {
    const step = revision.steps.find((candidate) => candidate.id === stepId);
    if (!step) throw new Error(`unknown completed step: ${stepId}`);
    if (!step.dependsOn.every((dependencyId) => completed.has(dependencyId))) {
      throw new Error("completed steps must satisfy dependencies");
    }
  }
  return revision.steps.find(
    (step) => !completed.has(step.id) && step.dependsOn.every((dependencyId) => completed.has(dependencyId)),
  );
}
