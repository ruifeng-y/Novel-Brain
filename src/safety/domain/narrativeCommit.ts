import type { DomainId, RevisionId } from "../../shared/domain/ids";
import type { VersionSet } from "../../shared/domain/versioning";
import type { ChangeSetRevision } from "../../production/domain/changeSetRevision";
import type { ValidationRun } from "../../production/domain/validationRun";
import type { ReviewDecision } from "../../production/domain/reviewDecision";

export type NarrativeCommitStatus = "pending" | "committed" | "stale" | "failed";

export interface NarrativeCommit {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly changeSetRevisionId: RevisionId;
  readonly validationRunIds: readonly DomainId[];
  readonly reviewDecisionIds: readonly DomainId[];
  readonly basedOnVersionSet: VersionSet;
  readonly resultingVersionSet?: VersionSet;
  readonly status: NarrativeCommitStatus;
  readonly failureReason?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function createNarrativeCommit(input: {
  id: DomainId;
  novelId: DomainId;
  changeSetRevision: ChangeSetRevision;
  validationRuns: readonly ValidationRun[];
  reviewDecisions: readonly ReviewDecision[];
  basedOnVersionSet?: VersionSet;
  createdAt: Date;
}): NarrativeCommit {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (input.changeSetRevision.novelId !== input.novelId) {
    throw new Error("Change set revision novel does not match commit novel");
  }
  if (input.validationRuns.length === 0) throw new Error("At least one validation run is required");

  for (const run of input.validationRuns) {
    if (run.changeSetRevisionId !== input.changeSetRevision.revisionId) {
      throw new Error("Validation run does not match change set revision");
    }
  }
  if (input.validationRuns.some(run => run.outcome === "fail")) {
    throw new Error("A failed validation cannot be committed");
  }

  for (const decision of input.reviewDecisions) {
    if (decision.changeSetRevisionId !== input.changeSetRevision.revisionId) {
      throw new Error("Review decision does not match change set revision");
    }
  }
  if (!input.reviewDecisions.some(decision => decision.decision === "approve")) {
    throw new Error("At least one approving review decision is required");
  }

  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    changeSetRevisionId: input.changeSetRevision.revisionId,
    validationRunIds: Object.freeze(input.validationRuns.map(run => run.id)),
    reviewDecisionIds: Object.freeze(input.reviewDecisions.map(decision => decision.id)),
    basedOnVersionSet: input.basedOnVersionSet ?? Object.freeze({}),
    status: "pending",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function markNarrativeCommitCommitted(input: {
  commit: NarrativeCommit;
  resultingVersionSet: VersionSet;
  committedAt: Date;
}): NarrativeCommit {
  if (input.commit.status !== "pending") throw new Error("Only a pending commit can be completed");
  if (Object.keys(input.resultingVersionSet).length === 0) {
    throw new Error("A committed transition requires resulting revisions");
  }
  return Object.freeze({
    ...input.commit,
    resultingVersionSet: input.resultingVersionSet,
    status: "committed",
    updatedAt: input.committedAt,
  });
}

export function markNarrativeCommitStale(commit: NarrativeCommit, updatedAt: Date): NarrativeCommit {
  if (commit.status !== "pending") throw new Error("Only a pending commit can become stale");
  return Object.freeze({ ...commit, status: "stale", updatedAt });
}

export function markNarrativeCommitFailed(input: {
  commit: NarrativeCommit;
  reason: string;
  failedAt: Date;
}): NarrativeCommit {
  if (input.commit.status !== "pending") throw new Error("Only a pending commit can fail");
  if (!input.reason.trim()) throw new Error("failure reason is required");
  return Object.freeze({
    ...input.commit,
    status: "failed",
    failureReason: input.reason.trim(),
    updatedAt: input.failedAt,
  });
}