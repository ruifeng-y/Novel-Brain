import { describe, expect, it } from "vitest";
import { createReviewDecision } from "../../src/production/domain/reviewDecision";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("ReviewDecision", () => {
  it("records an explicit author approval bound to one candidate revision", () => {
    const decision = createReviewDecision({
      id: "review-1",
      candidateId: "candidate-1",
      candidateRevisionId: "candidate-rev-1",
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "Preferred the stronger ending.",
      createdAt: now,
    });

    expect(decision).toMatchObject({
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
    });
  });

  it("requires a reason for rejection", () => {
    expect(() =>
      createReviewDecision({
        id: "review-1",
        candidateId: "candidate-1",
        candidateRevisionId: "candidate-rev-1",
        decision: "reject",
        decidedBy: "human",
        actorId: "author-1",
        reason: "",
        createdAt: now,
      }),
    ).toThrow("A rejection requires a reason");
  });

  it("requires policy decisions to identify their policy", () => {
    expect(() =>
      createReviewDecision({
        id: "review-1",
        candidateId: "candidate-1",
        candidateRevisionId: "candidate-rev-1",
        decision: "approve",
        decidedBy: "policy",
        actorId: "low-risk-polish",
        reason: "",
        createdAt: now,
      }),
    ).not.toThrow();
  });
});
