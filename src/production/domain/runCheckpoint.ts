import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";
import type { DomainId, RevisionId } from "../../shared/domain/ids";
import {
  createImmutableTimestamp,
  createObservation,
  createSourceReference,
  isImmutableTimestamp,
  type EvidenceReference,
  type ImmutableTimestamp,
  type Observation,
  type SourceReference,
} from "../../shared/domain/observationSource";

export type CheckpointTriggerCategory =
  | "schedule"
  | "risk"
  | "budget"
  | "uncertainty"
  | "failure"
  | "human"
  | "policy";

export type CheckpointStatus = "paused" | "inspecting" | "decided" | "resumed" | "aborted";
export type CheckpointAction = "resume" | "retry" | "fallback" | "abort";
export type CheckpointControl =
  | { readonly kind: "human"; readonly actorId: string }
  | {
      readonly kind: "policy";
      readonly actorId: string;
      readonly policyVersion: string;
      readonly policyRule: string;
    };

export interface CheckpointDecision {
  readonly action: CheckpointAction;
  readonly reason: string;
  readonly control: CheckpointControl;
  readonly narrativeReviewDecisionReference?: SourceReference;
  readonly decidedAt: ImmutableTimestamp;
}

export interface CheckpointEvidenceData {
  readonly checkpointId: DomainId;
  readonly runId: DomainId;
  readonly phase: "pause" | "inspect" | "decide" | "resume" | "abort";
  readonly triggerCategory: CheckpointTriggerCategory;
  readonly triggerReason: string;
  readonly control: CheckpointControl;
  readonly evidenceReferences: readonly EvidenceReference[];
  readonly explanation?: string;
  readonly impact?: string;
  readonly action?: CheckpointAction;
  readonly reason?: string;
  readonly narrativeReviewDecisionReference?: SourceReference;
  readonly occurredAt: Date;
}

export interface RunCheckpoint {
  readonly id: DomainId;
  readonly runId: DomainId;
  readonly novelId: DomainId;
  readonly triggerCategory: CheckpointTriggerCategory;
  readonly triggerReason: string;
  readonly status: CheckpointStatus;
  readonly revisionNumber: number;
  readonly currentRevisionId: RevisionId;
  readonly decision?: CheckpointDecision;
  readonly evidence: readonly Observation<CheckpointEvidenceData>[];
  readonly auditReferences: readonly EvidenceReference[];
  readonly createdAt: ImmutableTimestamp;
  readonly updatedAt: ImmutableTimestamp;
}

function requireText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function timestamp(value: Date | ImmutableTimestamp, name: string): ImmutableTimestamp {
  const result = value instanceof Date
    ? createImmutableTimestamp({ iso: value.toISOString(), epochMilliseconds: value.getTime() })
    : createImmutableTimestamp(value);
  if (Number.isNaN(result.epochMilliseconds)) throw new Error(`${name} must be a valid Date`);
  return result;
}

function control(value: CheckpointControl): CheckpointControl {
  requireText(value.actorId, "control actorId");
  if (value.kind === "human") return deepFreeze({ kind: "human", actorId: value.actorId });
  if (value.kind === "policy") {
    return deepFreeze({
      kind: "policy",
      actorId: value.actorId,
      policyVersion: requireText(value.policyVersion, "policyVersion"),
      policyRule: requireText(value.policyRule, "policyRule"),
    });
  }
  throw new Error("control kind must be human or policy");
}

function assertNotMovingBackward(
  next: Date | ImmutableTimestamp,
  previous: ImmutableTimestamp,
  name: string,
): ImmutableTimestamp {
  const value = timestamp(next, name);
  if (value.epochMilliseconds < previous.epochMilliseconds) {
    throw new Error(`${name} cannot move backward`);
  }
  return value;
}

function revisionId(
  id: string,
  revisionNumber: number,
  status: CheckpointStatus,
  evidence: readonly Observation<CheckpointEvidenceData>[],
): RevisionId {
  return `${id}:${revisionNumber}:${status}:${hashContent(canonicalJson(evidence))}`;
}

function appendEvidence(
  checkpoint: RunCheckpoint,
  status: CheckpointStatus,
  phase: CheckpointEvidenceData["phase"],
  occurredAtName: string,
  input: {
    readonly control: CheckpointControl;
    readonly evidenceReferences: readonly EvidenceReference[];
    readonly explanation?: string;
    readonly impact?: string;
    readonly action?: CheckpointAction;
    readonly reason?: string;
    readonly narrativeReviewDecisionReference?: SourceReference;
    readonly occurredAt: Date | ImmutableTimestamp;
  },
  decision?: CheckpointDecision,
): RunCheckpoint {
  const occurredAt = assertNotMovingBackward(input.occurredAt, checkpoint.updatedAt, occurredAtName);
  const data: CheckpointEvidenceData = {
    checkpointId: checkpoint.id,
    runId: checkpoint.runId,
    phase,
    triggerCategory: checkpoint.triggerCategory,
    triggerReason: checkpoint.triggerReason,
    control: control(input.control),
    evidenceReferences: deepFreeze([...input.evidenceReferences]),
    ...(input.explanation === undefined ? {} : { explanation: requireText(input.explanation, "explanation") }),
    ...(input.impact === undefined ? {} : { impact: requireText(input.impact, "impact") }),
    ...(input.action === undefined ? {} : { action: input.action }),
    ...(input.reason === undefined ? {} : { reason: requireText(input.reason, "reason") }),
    ...(input.narrativeReviewDecisionReference === undefined
      ? {}
      : { narrativeReviewDecisionReference: createSourceReference(input.narrativeReviewDecisionReference) }),
    occurredAt: new Date(occurredAt.epochMilliseconds),
  };
  const observation = createObservation<CheckpointEvidenceData>({
    evidenceReference: `${checkpoint.id}:${phase}:${checkpoint.revisionNumber + 1}`,
    sourceReference: createSourceReference({
      identity: checkpoint.id,
      version: `${phase}:${checkpoint.revisionNumber + 1}`,
      hash: hashContent(canonicalJson(data)),
    }),
    ordinal: checkpoint.evidence.length + 1,
    data,
  });
  const evidence = deepFreeze([...checkpoint.evidence, observation]);
  const revisionNumber = checkpoint.revisionNumber + 1;
  const next = {
    ...checkpoint,
    status,
    revisionNumber,
    ...(decision === undefined ? {} : { decision }),
    evidence,
    auditReferences: deepFreeze(evidence.map((entry) => entry.evidenceReference)),
    updatedAt: occurredAt,
  };
  return deepFreeze({
    ...next,
    currentRevisionId: revisionId(checkpoint.id, revisionNumber, status, evidence),
  });
}

export function pauseRunCheckpoint(input: {
  readonly id: DomainId;
  readonly runId: DomainId;
  readonly novelId: DomainId;
  readonly triggerCategory: CheckpointTriggerCategory;
  readonly triggerReason: string;
  readonly evidenceReferences: readonly EvidenceReference[];
  readonly control: CheckpointControl;
  readonly pausedAt: Date | ImmutableTimestamp;
}): RunCheckpoint {
  const categories = new Set<CheckpointTriggerCategory>([
    "schedule",
    "risk",
    "budget",
    "uncertainty",
    "failure",
    "human",
    "policy",
  ]);
  if (!categories.has(input.triggerCategory)) throw new Error("invalid checkpoint trigger category");
  const id = requireText(input.id, "checkpoint id");
  const runId = requireText(input.runId, "runId");
  const novelId = requireText(input.novelId, "novelId");
  const pausedAt = timestamp(input.pausedAt, "pausedAt");
  const base = {
    id,
    runId,
    novelId,
    triggerCategory: input.triggerCategory,
    triggerReason: requireText(input.triggerReason, "triggerReason"),
    status: "paused" as const,
    revisionNumber: 0,
    currentRevisionId: "",
    evidence: [] as readonly Observation<CheckpointEvidenceData>[],
    auditReferences: [] as readonly EvidenceReference[],
    createdAt: pausedAt,
    updatedAt: pausedAt,
  };
  return appendEvidence(base as RunCheckpoint, "paused", "pause", "pausedAt", {
    control: input.control,
    evidenceReferences: input.evidenceReferences,
    occurredAt: pausedAt,
  });
}

export function inspectRunCheckpoint(input: {
  readonly checkpoint: RunCheckpoint;
  readonly control: CheckpointControl;
  readonly evidenceReferences: readonly EvidenceReference[];
  readonly explanation: string;
  readonly impact: string;
  readonly inspectedAt: Date | ImmutableTimestamp;
}): RunCheckpoint {
  if (input.checkpoint.status !== "paused") throw new Error("only a paused checkpoint can be inspected");
  return appendEvidence(input.checkpoint, "inspecting", "inspect", "inspectedAt", {
    control: input.control,
    evidenceReferences: input.evidenceReferences,
    explanation: input.explanation,
    impact: input.impact,
    occurredAt: input.inspectedAt,
  });
}

export function decideRunCheckpoint(input: {
  readonly checkpoint: RunCheckpoint;
  readonly control: CheckpointControl;
  readonly action: CheckpointAction;
  readonly reason: string;
  readonly narrativeReviewDecisionReference?: SourceReference;
  readonly decidedAt: Date | ImmutableTimestamp;
}): RunCheckpoint {
  if (input.checkpoint.status !== "inspecting") {
    throw new Error("only an inspecting checkpoint can be decided");
  }
  if (!["resume", "retry", "fallback", "abort"].includes(input.action)) {
    throw new Error("checkpoint action must be resume, retry, fallback, or abort");
  }
  const reason = requireText(input.reason, "reason");
  const decidedAt = assertNotMovingBackward(input.decidedAt, input.checkpoint.updatedAt, "decidedAt");
  const nextControl = control(input.control);
  const decision: CheckpointDecision = deepFreeze({
    action: input.action,
    reason,
    control: nextControl,
    ...(input.narrativeReviewDecisionReference === undefined
      ? {}
      : { narrativeReviewDecisionReference: createSourceReference(input.narrativeReviewDecisionReference) }),
    decidedAt,
  });
  return appendEvidence(
    input.checkpoint,
    "decided",
    "decide",
    "decidedAt",
    {
      control: input.control,
      evidenceReferences: input.checkpoint.auditReferences,
      action: input.action,
      reason,
      narrativeReviewDecisionReference: input.narrativeReviewDecisionReference,
      occurredAt: decidedAt,
    },
    decision,
  );
}

export function resumeRunCheckpoint(input: {
  readonly checkpoint: RunCheckpoint;
  readonly control: CheckpointControl;
  readonly resumedAt: Date | ImmutableTimestamp;
}): RunCheckpoint {
  if (input.checkpoint.status !== "decided") {
    throw new Error("only a decided checkpoint can resume");
  }
  if (input.checkpoint.decision?.action === "abort") {
    throw new Error("an abort decision cannot resume");
  }
  return appendEvidence(input.checkpoint, "resumed", "resume", "resumedAt", {
    control: input.control,
    evidenceReferences: input.checkpoint.auditReferences,
    action: input.checkpoint.decision?.action,
    reason: input.checkpoint.decision?.reason,
    occurredAt: input.resumedAt,
  });
}

export function checkpointAuditProjection(checkpoint: RunCheckpoint): Readonly<{
  readonly checkpointId: DomainId;
  readonly runId: DomainId;
  readonly status: CheckpointStatus;
  readonly decisionKind: "run_coordination";
  readonly triggerCategory: CheckpointTriggerCategory;
  readonly decision?: CheckpointDecision;
  readonly narrativeReviewDecisionReference?: SourceReference;
  readonly auditReferences: readonly EvidenceReference[];
}> {
  return deepFreeze({
    checkpointId: checkpoint.id,
    runId: checkpoint.runId,
    status: checkpoint.status,
    decisionKind: "run_coordination" as const,
    triggerCategory: checkpoint.triggerCategory,
    ...(checkpoint.decision === undefined ? {} : { decision: checkpoint.decision }),
    ...(checkpoint.decision?.narrativeReviewDecisionReference === undefined
      ? {}
      : { narrativeReviewDecisionReference: checkpoint.decision.narrativeReviewDecisionReference }),
    auditReferences: checkpoint.auditReferences,
  });
}
