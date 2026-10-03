import { describe, expect, it } from "vitest";
import {
  createNarrativeCommit,
  markNarrativeCommitCommitted,
  markNarrativeCommitFailed,
  markNarrativeCommitStale,
} from "../../src/safety/domain/narrativeCommit";
import { createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import { createValidationRun } from "../../src/production/domain/validationRun";
import { createReviewDecision } from "../../src/production/domain/reviewDecision";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-03T00:00:00.000Z");

function revision() {
  return createInitialChangeSetRevision({
    revisionId: "cs-1-r1",
    changeSetId: "cs-1",
    novelId: "novel-1",
    createdAt: now,
  });
}

function validationRun(
  outcome: "pass" | "fail" | "needs_review" = "pass",
  id: string = "validation-1",
) {
  return createValidationRun({
    id,
    changeSetRevisionId: "cs-1-r1",
    planVersionId: "cs-1-r1-plan-1",
    validatorId: "core-validator",
    entryResults: [
      {
        entryReference: "rule:core",
        executionMode: "full_reexecution",
        verdict: outcome,
        findings: [],
        evidence: [],
      },
    ],
    executionState: "completed",
    outcome,
    createdAt: now,
  });
}

function reviewDecision(
  decision: "approve" | "reject" = "approve",
  id: string = "review-1",
  changeSetRevisionId: string = "cs-1-r1",
) {
  return createReviewDecision({
    id,
    changeSetRevisionId,
    approvalScope: {
      requirementDomain: "manuscript",
      targetType: "manuscript",
      objectId: "scene-1",
    },
    decision,
    decidedBy: "human",
    actorId: "author-1",
    reason: decision === "reject" ? "Not preferred" : "",
    evidenceReferences: ["validation-1"],
    createdAt: now,
  });
}

function pendingCommit() {
  return createNarrativeCommit({
    id: "commit-1",
    novelId: "novel-1",
    changeSetRevision: revision(),
    validationRuns: [validationRun()],
    reviewDecisions: [reviewDecision()],
    createdAt: now,
  });
}

function resultingVersionSet() {
  return createVersionSet({
    scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
  });
}

function terminalCommit(status: "committed" | "stale" | "failed") {
  const pending = pendingCommit();
  if (status === "committed") {
    return markNarrativeCommitCommitted({
      commit: pending,
      resultingVersionSet: resultingVersionSet(),
      committedAt: now,
    });
  }
  if (status === "stale") return markNarrativeCommitStale(pending, now);
  return markNarrativeCommitFailed({ commit: pending, reason: "Write failed", failedAt: now });
}
describe("NarrativeCommit", () => {
  it("binds to a change set revision", () => {
    const commit = createNarrativeCommit({
      id: "commit-1",
      novelId: "novel-1",
      changeSetRevision: revision(),
      validationRuns: [validationRun()],
      reviewDecisions: [reviewDecision()],
      createdAt: now,
    });
    expect(commit.changeSetRevisionId).toBe("cs-1-r1");
    expect(Object.prototype.hasOwnProperty.call(commit, "candidateId")).toBe(false);
  });

  it("rejects a revision from another novel", () => {
    expect(() =>
      createNarrativeCommit({
        id: "commit-1",
        novelId: "novel-2",
        changeSetRevision: revision(),
        validationRuns: [validationRun()],
        reviewDecisions: [reviewDecision()],
        createdAt: now,
      }),
    ).toThrow("Change set revision novel does not match commit novel");
  });

  it("rejects validation runs bound to another revision", () => {
    const foreign = createValidationRun({
      id: "validation-foreign",
      changeSetRevisionId: "cs-9-r9",
      planVersionId: "plan-9",
      validatorId: "validator",
      entryResults: [],
      executionState: "completed",
      outcome: "pass",
      createdAt: now,
    });
    expect(() =>
      createNarrativeCommit({
        id: "commit-1",
        novelId: "novel-1",
        changeSetRevision: revision(),
        validationRuns: [foreign],
        reviewDecisions: [reviewDecision()],
        createdAt: now,
      }),
    ).toThrow("Validation run does not match change set revision");
  });

  it("rejects a failed validation outcome", () => {
    expect(() =>
      createNarrativeCommit({
        id: "commit-1",
        novelId: "novel-1",
        changeSetRevision: revision(),
        validationRuns: [validationRun("fail")],
        reviewDecisions: [reviewDecision()],
        createdAt: now,
      }),
    ).toThrow("A failed validation cannot be committed");
  });

  it("requires at least one approving review decision", () => {
    expect(() =>
      createNarrativeCommit({
        id: "commit-1",
        novelId: "novel-1",
        changeSetRevision: revision(),
        validationRuns: [validationRun()],
        reviewDecisions: [reviewDecision("reject")],
        createdAt: now,
      }),
    ).toThrow("At least one approving review decision is required");
  });

  it("marks the commit complete only with resulting revisions", () => {
    const pending = createNarrativeCommit({
      id: "commit-1",
      novelId: "novel-1",
      changeSetRevision: revision(),
      validationRuns: [validationRun()],
      reviewDecisions: [reviewDecision()],
      createdAt: now,
    });
    const committed = markNarrativeCommitCommitted({
      commit: pending,
      resultingVersionSet: createVersionSet({
        scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
      }),
      committedAt: now,
    });
    expect(pending.status).toBe("pending");
    expect(committed.status).toBe("committed");
  });

  it("supports stale and failed terminal states", () => {
    const pending = createNarrativeCommit({
      id: "commit-1",
      novelId: "novel-1",
      changeSetRevision: revision(),
      validationRuns: [validationRun()],
      reviewDecisions: [reviewDecision()],
      createdAt: now,
    });
    expect(markNarrativeCommitStale(pending, now).status).toBe("stale");
    const failed = markNarrativeCommitFailed({ commit: pending, reason: "Write failed", failedAt: now });
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("Write failed");
  });
  it("rejects empty validation runs when creating a commit", () => {
    expect(() =>
      createNarrativeCommit({
        id: "commit-1",
        novelId: "novel-1",
        changeSetRevision: revision(),
        validationRuns: [],
        reviewDecisions: [reviewDecision()],
        createdAt: now,
      }),
    ).toThrow("At least one validation run is required");
  });

  it("rejects empty review decisions when creating a commit", () => {
    expect(() =>
      createNarrativeCommit({
        id: "commit-1",
        novelId: "novel-1",
        changeSetRevision: revision(),
        validationRuns: [validationRun()],
        reviewDecisions: [],
        createdAt: now,
      }),
    ).toThrow("At least one approving review decision is required");
  });

  it("freezes an empty based-on version set when omitted", () => {
    const commit = createNarrativeCommit({
      id: "commit-1",
      novelId: "novel-1",
      changeSetRevision: revision(),
      validationRuns: [validationRun()],
      reviewDecisions: [reviewDecision()],
      createdAt: now,
    });
    expect(commit.basedOnVersionSet).toEqual({});
    expect(Object.isFrozen(commit.basedOnVersionSet)).toBe(true);
  });

  it("rejects a review decision bound to another revision", () => {
    expect(() =>
      createNarrativeCommit({
        id: "commit-1",
        novelId: "novel-1",
        changeSetRevision: revision(),
        validationRuns: [validationRun()],
        reviewDecisions: [reviewDecision("approve", "review-mismatch", "cs-9-r9")],
        createdAt: now,
      }),
    ).toThrow("Review decision does not match change set revision");
  });

  it("exposes exact evidence ids and omits legacy candidate fields", () => {
    const commit = createNarrativeCommit({
      id: "commit-1",
      novelId: "novel-1",
      changeSetRevision: revision(),
      validationRuns: [validationRun("pass", "validation-1"), validationRun("needs_review", "validation-2")],
      reviewDecisions: [reviewDecision("approve", "review-1"), reviewDecision("reject", "review-2")],
      createdAt: now,
    });
    expect(commit.validationRunIds).toEqual(["validation-1", "validation-2"]);
    expect(commit.reviewDecisionIds).toEqual(["review-1", "review-2"]);
    for (const legacyField of ["candidateId", "candidateRevisionId", "reviewDecisionId"]) {
      expect(legacyField in commit).toBe(false);
    }
  });

  it("rejects an empty resulting version set on commit", () => {
    expect(() =>
      markNarrativeCommitCommitted({
        commit: pendingCommit(),
        resultingVersionSet: createVersionSet({}),
        committedAt: now,
      }),
    ).toThrow("A committed transition requires resulting revisions");
  });

  it("rejects a blank failure reason", () => {
    expect(() =>
      markNarrativeCommitFailed({ commit: pendingCommit(), reason: " \t ", failedAt: now }),
    ).toThrow("failure reason is required");
  });

  for (const status of ["committed", "stale", "failed"] as const) {
    it(`rejects every further transition from ${status}`, () => {
      const terminal = terminalCommit(status);
      expect(() =>
        markNarrativeCommitCommitted({
          commit: terminal,
          resultingVersionSet: resultingVersionSet(),
          committedAt: now,
        }),
      ).toThrow("Only a pending commit can be completed");
      expect(() => markNarrativeCommitStale(terminal, now)).toThrow(
        "Only a pending commit can become stale",
      );
      expect(() =>
        markNarrativeCommitFailed({ commit: terminal, reason: "Another failure", failedAt: now }),
      ).toThrow("Only a pending commit can fail");
    });
  }
});