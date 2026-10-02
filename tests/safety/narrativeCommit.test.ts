import { describe, expect, it } from "vitest";
import { createCandidate } from "../../src/production/domain/candidate";
import { createReviewDecision } from "../../src/production/domain/reviewDecision";
import { createValidationRun } from "../../src/production/domain/validationRun";
import {
  createNarrativeCommit,
  markNarrativeCommitCommitted,
  markNarrativeCommitFailed,
  markNarrativeCommitStale,
} from "../../src/safety/domain/narrativeCommit";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");
const sceneVersion = createVersionReference("Scene", "scene-1", "scene-rev-1");
const basedOnVersionSet = createVersionSet({ scene: sceneVersion });

function candidate() {
  return createCandidate({
    id: "candidate-1",
    taskId: "task-1",
    novelId: "novel-1",
    basedOnVersionSet,
    change: { type: "text", sceneId: "scene-1", text: "Committed text" },
    createdAt: now,
  });
}

function commitInput(validationOutcome: "pass" | "fail" | "needs_review" = "pass") {
  const currentCandidate = candidate();
  return {
    id: "commit-1",
    novelId: "novel-1",
    candidate: currentCandidate,
    validationRuns: [
      createValidationRun({
        id: "validation-1",
        candidateId: currentCandidate.id,
        candidateRevisionId: currentCandidate.currentRevisionId,
        validatorId: "core-validator",
        outcome: validationOutcome,
        findings: [],
        createdAt: now,
      }),
    ],
    reviewDecision: createReviewDecision({
      id: "review-1",
      candidateId: currentCandidate.id,
      candidateRevisionId: currentCandidate.currentRevisionId,
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "",
      createdAt: now,
    }),
    createdAt: now,
  };
}

describe("NarrativeCommit", () => {
  it("requires approval and a non-failing validation summary", () => {
    expect(() => createNarrativeCommit(commitInput("fail"))).toThrow(
      "A failed validation cannot be committed",
    );
  });

  it("records a pending coherent transition without owning canonical objects", () => {
    const commit = createNarrativeCommit(commitInput());
    expect(commit).toMatchObject({
      id: "commit-1",
      novelId: "novel-1",
      candidateId: "candidate-1",
      status: "pending",
    });
    expect(commit.basedOnVersionSet).toEqual(basedOnVersionSet);
  });

  it("marks the commit complete only with resulting revisions", () => {
    const pending = createNarrativeCommit(commitInput());
    const committed = markNarrativeCommitCommitted({
      commit: pending,
      resultingVersionSet: createVersionSet({
        scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
      }),
      committedAt: new Date("2026-10-03T00:00:00.000Z"),
    });

    expect(pending.status).toBe("pending");
    expect(committed.status).toBe("committed");
    expect(committed.resultingVersionSet?.scene?.revisionId).toBe("scene-rev-2");
  });

  it("supports stale and failed terminal states", () => {
    const pending = createNarrativeCommit(commitInput());
    const stale = markNarrativeCommitStale(pending, new Date("2026-10-03T00:00:00.000Z"));
    const failed = markNarrativeCommitFailed({
      commit: pending,
      reason: "Database unavailable",
      failedAt: new Date("2026-10-03T00:00:00.000Z"),
    });
    expect(stale.status).toBe("stale");
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("Database unavailable");
  });
});
