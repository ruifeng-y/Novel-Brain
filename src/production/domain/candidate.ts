import type { DomainId, RevisionId } from "../../shared/domain/ids";
import type { VersionSet } from "../../shared/domain/versioning";
import type { TargetSpan } from "../../manuscript/domain/targetSpan";

export type CandidateStatus =
  | "generated"
  | "validating"
  | "validated"
  | "under_review"
  | "selected"
  | "rejected"
  | "outdated"
  | "archived";

export type CandidateChange =
  | { readonly type: "text"; readonly sceneId: DomainId; readonly text: string }
  | {
      readonly type: "structured_state";
      readonly stateRecordId: DomainId;
      readonly content: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "canonical_fact";
      readonly canonicalFactId: DomainId;
      readonly content: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "local_text";
      readonly sceneId: DomainId;
      readonly targetSpan: TargetSpan;
      readonly replacement: string;
    };

export interface Candidate {
  readonly id: DomainId;
  readonly taskId: DomainId;
  readonly novelId: DomainId;
  readonly change: CandidateChange;
  readonly basedOnVersionSet: VersionSet;
  readonly currentRevisionId: RevisionId;
  readonly status: CandidateStatus;
  readonly rejectionReason?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function createCandidate(input: {
  id: DomainId;
  taskId: DomainId;
  novelId: DomainId;
  basedOnVersionSet: VersionSet;
  change: CandidateChange;
  createdAt: Date;
}): Candidate {
  if (!input.id) throw new Error("id is required");
  if (!input.taskId) throw new Error("taskId is required");
  if (!input.novelId) throw new Error("novelId is required");

  return Object.freeze({
    id: input.id,
    taskId: input.taskId,
    novelId: input.novelId,
    change: input.change,
    basedOnVersionSet: input.basedOnVersionSet,
    currentRevisionId: `${input.id}-rev-1`,
    status: "generated",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function editCandidate(input: {
  candidate: Candidate;
  change: CandidateChange;
  revisionId: RevisionId;
  updatedAt: Date;
}): Candidate {
  if (!input.revisionId) throw new Error("revisionId is required");
  if (input.updatedAt < input.candidate.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({
    ...input.candidate,
    change: input.change,
    currentRevisionId: input.revisionId,
    updatedAt: input.updatedAt,
  });
}

export function selectCandidate(candidate: Candidate, updatedAt: Date): Candidate {
  if (candidate.status !== "validated" && candidate.status !== "under_review") {
    throw new Error("Only a validated or under-review candidate can be selected");
  }
  return Object.freeze({ ...candidate, status: "selected", updatedAt });
}

export function markCandidateValidated(candidate: Candidate, updatedAt: Date): Candidate {
  if (candidate.status !== "generated" && candidate.status !== "validating") {
    throw new Error("Only a generated or validating candidate can become validated");
  }
  return Object.freeze({ ...candidate, status: "validated", updatedAt });
}

export function rejectCandidate(candidate: Candidate, reason: string): Candidate {
  if (candidate.status === "selected") throw new Error("A selected candidate cannot be rejected");
  if (!reason.trim()) throw new Error("rejection reason is required");
  return Object.freeze({ ...candidate, status: "rejected", rejectionReason: reason.trim() });
}

export function markCandidateOutdated(candidate: Candidate, updatedAt: Date): Candidate {
  return Object.freeze({ ...candidate, status: "outdated", updatedAt });
}
