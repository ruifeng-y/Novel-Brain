import type { DomainId } from "../../shared/domain/ids";
import type { VersionSet } from "../../shared/domain/versioning";
import type { Candidate } from "../../production/domain/candidate";
import type { ValidationRun } from "../../production/domain/validationRun";
import type { ReviewDecision } from "../../production/domain/reviewDecision";

export type NarrativeCommitStatus = "pending" | "committed" | "stale" | "failed";

export interface NarrativeCommit {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly candidateId: DomainId;
  readonly candidateRevisionId: string;
  readonly validationRunIds: readonly DomainId[];
  readonly reviewDecisionId: DomainId;
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
  candidate: Candidate;
  validationRuns: readonly ValidationRun[];
  reviewDecision: ReviewDecision;
  createdAt: Date;
}): NarrativeCommit {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (input.candidate.novelId !== input.novelId) throw new Error("Candidate novel does not match commit novel");
  if (input.validationRuns.length === 0) throw new Error("At least one validation run is required");

  const hasFailedValidation = input.validationRuns.some((run) => run.outcome === "fail");
  if (hasFailedValidation) throw new Error("A failed validation cannot be committed");

  for (const run of input.validationRuns) {
    if (run.candidateId !== input.candidate.id) throw new Error("Validation run does not match candidate");
    if (run.candidateRevisionId !== input.candidate.currentRevisionId) {
      throw new Error("Validation run does not match candidate revision");
    }
  }

  if (input.reviewDecision.candidateId !== input.candidate.id) {
    throw new Error("Review decision does not match candidate");
  }
  if (input.reviewDecision.candidateRevisionId !== input.candidate.currentRevisionId) {
    throw new Error("Review decision does not match candidate revision");
  }
  if (input.reviewDecision.decision !== "approve") {
    throw new Error("Only an approved candidate can be committed");
  }

  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    candidateId: input.candidate.id,
    candidateRevisionId: input.candidate.currentRevisionId,
    validationRunIds: Object.freeze(input.validationRuns.map((run) => run.id)),
    reviewDecisionId: input.reviewDecision.id,
    basedOnVersionSet: input.candidate.basedOnVersionSet,
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
