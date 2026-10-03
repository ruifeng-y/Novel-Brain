import { describe, expect, it } from "vitest";
import {
  approvalScopeKey,
  createReviewDecision,
  type ApprovalScope,
} from "../../src/production/domain/reviewDecision";

const now = new Date("2026-10-03T00:00:00.000Z");

function scope(overrides: Partial<ApprovalScope> = {}): ApprovalScope {
  return {
    requirementDomain: "canon",
    targetType: "canonical_fact",
    objectId: "fact-1",
    ...overrides,
  };
}

describe("ReviewDecision", () => {
  it("binds to a change set revision and an approval scope", () => {
    const decision = createReviewDecision({
      id: "review-1",
      changeSetRevisionId: "cs-1-r3",
      approvalScope: scope(),
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "",
      evidenceReferences: ["validation-1"],
      createdAt: now,
    });

    expect(decision.changeSetRevisionId).toBe("cs-1-r3");
    expect(decision.approvalScope.requirementDomain).toBe("canon");
    expect(decision.evidenceReferences).toEqual(["validation-1"]);
    expect(Object.prototype.hasOwnProperty.call(decision, "candidateId")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(decision, "candidateRevisionId")).toBe(false);
  });

  it("keeps the decision event independent of mutable input aliases", () => {
    const createdAt = new Date("2026-10-03T00:00:00.000Z");
    const approvalScope = scope();
    const evidenceReferences = ["validation-1"];
    const decision = createReviewDecision({
      id: "review-1",
      changeSetRevisionId: "cs-1-r3",
      approvalScope,
      decision: "request_regeneration",
      decidedBy: "human",
      actorId: "author-1",
      reason: "Regenerate from stronger context.",
      evidenceReferences,
      createdAt,
    });

    (approvalScope as { objectId: string }).objectId = "fact-2";
    evidenceReferences.push("validation-2");
    (createdAt as Date).setUTCFullYear(2027);

    expect(decision.decision).toBe("request_regeneration");
    expect(decision.approvalScope.objectId).toBe("fact-1");
    expect(decision.evidenceReferences).toEqual(["validation-1"]);
    expect(decision.createdAt.toISOString()).toBe("2026-10-03T00:00:00.000Z");
  });

  it("requires a reason for rejection", () => {
    expect(() =>
      createReviewDecision({
        id: "review-1",
        changeSetRevisionId: "cs-1-r3",
        approvalScope: scope(),
        decision: "reject",
        decidedBy: "human",
        actorId: "author-1",
        reason: "",
        evidenceReferences: [],
        createdAt: now,
      }),
    ).toThrow("A rejection requires a reason");
  });

  it("rejects a pure whitespace rejection reason and trims a valid reason", () => {
    expect(() =>
      createReviewDecision({
        id: "review-1",
        changeSetRevisionId: "cs-1-r3",
        approvalScope: scope(),
        decision: "reject",
        decidedBy: "human",
        actorId: "author-1",
        reason: " \t\n ",
        evidenceReferences: [],
        createdAt: now,
      }),
    ).toThrow("A rejection requires a reason");

    const decision = createReviewDecision({
      id: "review-1",
      changeSetRevisionId: "cs-1-r3",
      approvalScope: scope(),
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "  Needs stronger evidence.  ",
      evidenceReferences: ["validation-1"],
      createdAt: now,
    });
    expect(decision.reason).toBe("Needs stronger evidence.");
  });

  it("requires policy version and decision rule for policy decisions", () => {
    expect(() =>
      createReviewDecision({
        id: "review-1",
        changeSetRevisionId: "cs-1-r3",
        approvalScope: scope(),
        decision: "approve",
        decidedBy: "policy",
        actorId: "low-risk-policy",
        reason: "",
        evidenceReferences: [],
        createdAt: now,
      }),
    ).toThrow("A policy decision requires policyVersion");

    const decision = createReviewDecision({
      id: "review-1",
      changeSetRevisionId: "cs-1-r3",
      approvalScope: scope(),
      decision: "approve",
      decidedBy: "policy",
      actorId: "low-risk-policy",
      reason: "",
      evidenceReferences: ["policy-evidence-1", "policy-evidence-2"],
      policyVersion: "policy-1",
      decisionRule: "low-risk-auto-approve",
      createdAt: now,
    });
    expect(decision.policyVersion).toBe("policy-1");
    expect(decision.decisionRule).toBe("low-risk-auto-approve");
    expect(decision.evidenceReferences).toEqual([
      "policy-evidence-1",
      "policy-evidence-2",
    ]);
  });

  it("requires a decision rule when only decisionRule is missing", () => {
    expect(() =>
      createReviewDecision({
        id: "review-1",
        changeSetRevisionId: "cs-1-r3",
        approvalScope: scope(),
        decision: "approve",
        decidedBy: "policy",
        actorId: "low-risk-policy",
        reason: "",
        evidenceReferences: ["policy-evidence-1"],
        policyVersion: "policy-1",
        createdAt: now,
      }),
    ).toThrow("A policy decision requires decisionRule");
  });

  it("builds a stable approval scope key", () => {
    expect(approvalScopeKey(scope())).toBe("canon:canonical_fact:fact-1");
    expect(approvalScopeKey(scope({ subAddress: "goal" }))).toBe(
      "canon:canonical_fact:fact-1#goal",
    );
  });

  it("rejects an empty subAddress while preserving undefined as absent", () => {
    expect(approvalScopeKey(scope())).toBe("canon:canonical_fact:fact-1");
    expect(() => approvalScopeKey(scope({ subAddress: "" }))).toThrow(
      "approvalScope.subAddress must not be empty",
    );
    expect(() =>
      createReviewDecision({
        id: "review-1",
        changeSetRevisionId: "cs-1-r3",
        approvalScope: scope({ subAddress: "" }),
        decision: "approve",
        decidedBy: "human",
        actorId: "author-1",
        reason: "",
        evidenceReferences: [],
        createdAt: now,
      }),
    ).toThrow("approvalScope.subAddress must not be empty");
  });

  it("rejects an object id containing the approval scope key separator", () => {
    const invalidScope = scope({ objectId: "fact-1#goal" });

    expect(() => approvalScopeKey(invalidScope)).toThrow(
      "approvalScope.objectId must not contain '#'",
    );
    expect(() =>
      createReviewDecision({
        id: "review-1",
        changeSetRevisionId: "cs-1-r3",
        approvalScope: invalidScope,
        decision: "approve",
        decidedBy: "human",
        actorId: "author-1",
        reason: "",
        evidenceReferences: [],
        createdAt: now,
      }),
    ).toThrow("approvalScope.objectId must not contain '#'");
  });

  it("rejects a sub-address containing the approval scope key separator", () => {
    const invalidScope = scope({ subAddress: "goal#target" });

    expect(() => approvalScopeKey(invalidScope)).toThrow(
      "approvalScope.subAddress must not contain '#'",
    );
    expect(() =>
      createReviewDecision({
        id: "review-1",
        changeSetRevisionId: "cs-1-r3",
        approvalScope: invalidScope,
        decision: "approve",
        decidedBy: "human",
        actorId: "author-1",
        reason: "",
        evidenceReferences: [],
        createdAt: now,
      }),
    ).toThrow("approvalScope.subAddress must not contain '#'");
  });
});
