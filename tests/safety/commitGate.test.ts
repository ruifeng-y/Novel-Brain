import { describe, expect, it } from "vitest";
import {
  evaluateCommitGate,
  type CommitGateInput,
  type CommitGateReviewFact,
} from "../../src/safety/domain/commitGate";

function input(overrides: Partial<CommitGateInput> = {}): CommitGateInput {
  return {
    unresolvedConflict: false,
    stale: false,
    occConflict: false,
    invariantViolations: [],
    validationOutcome: "pass",
    requiredApproval: true,
    approvalState: "approved",
    ...overrides,
  };
}

describe("commit gate", () => {
  it("allows a clean revision and freezes its output", () => {
    const result = evaluateCommitGate(input());

    expect(result.allowed).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.requiredActions).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.blockers)).toBe(true);
    expect(Object.isFrozen(result.requiredActions)).toBe(true);
  });

  it("reports every blocker at once instead of failing fast", () => {
    const result = evaluateCommitGate(
      input({
        unresolvedConflict: true,
        stale: true,
        occConflict: true,
        invariantViolations: ["target span must be preserved"],
        validationOutcome: "fail",
        approvalState: "pending",
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.blockers.map(blocker => blocker.type).sort()).toEqual(
      [
        "invalid_revision",
        "stale_revision",
        "occ_conflict",
        "invariant_violation",
        "mandatory_validation_failed",
        "missing_required_approval",
      ].sort(),
    );
  });

  it("requires approval when mandatory validation needs review", () => {
    const result = evaluateCommitGate(
      input({ validationOutcome: "needs_review", approvalState: "pending" }),
    );

    expect(result.allowed).toBe(false);
    expect(result.blockers.map(blocker => blocker.type)).toEqual([
      "mandatory_needs_review",
      "missing_required_approval",
    ]);
    expect(result.requiredActions).toEqual(["obtain_review_decision"]);
  });

  it("blocks needs_review for a policy approval", () => {
    const result = evaluateCommitGate(
      input({
        validationOutcome: "needs_review",
        approvalState: "approved",
        approvalStateProvenance: {
          kind: "policy",
          actorId: "policy-engine",
          policyVersion: "policy-1",
          decisionRule: "auto-approve",
        },
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.blockers.map(blocker => blocker.type)).toEqual(["mandatory_needs_review"]);
    expect(result.requiredActions).toEqual(["obtain_review_decision"]);
  });

  it("blocks needs_review for a bare approved state without provenance", () => {
    const result = evaluateCommitGate(
      input({ validationOutcome: "needs_review", approvalState: "approved" }),
    );

    expect(result.allowed).toBe(false);
    expect(result.blockers.map(blocker => blocker.type)).toEqual(["mandatory_needs_review"]);
    expect(result.requiredActions).toEqual(["obtain_review_decision"]);
  });

  it("blocks needs_review for a bare scope approved state without provenance", () => {
    const result = evaluateCommitGate(
      input({
        validationOutcome: "needs_review",
        approvalState: "pending",
        approvalScopes: [
          {
            key: "plan:manuscript:scene-1",
            requiredApproval: true,
            state: "approved",
            decisions: [],
          },
        ],
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.blockers.map(blocker => blocker.type)).toEqual(["mandatory_needs_review"]);
    expect(result.requiredActions).toEqual(["obtain_review_decision"]);
  });

  it("does not block needs_review after a human provenance approval", () => {
    const result = evaluateCommitGate(
      input({
        validationOutcome: "needs_review",
        approvalState: "approved",
        approvalStateProvenance: { kind: "human", actorId: "reviewer-1" },
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("blocks a rejected review decision", () => {
    const result = evaluateCommitGate(input({ approvalState: "rejected" }));

    expect(result.blockers.map(blocker => blocker.type)).toEqual(["review_rejected"]);
    expect(result.requiredActions).toEqual(["revise_revision"]);
  });

  it("keeps regeneration requests distinct from rejections", () => {
    const result = evaluateCommitGate(input({ approvalState: "regeneration_requested" }));

    expect(result.allowed).toBe(false);
    expect(result.blockers.map(blocker => blocker.type)).toEqual(["regeneration_requested"]);
    expect(result.blockers[0]?.reason).toContain("regeneration");
    expect(result.requiredActions).toEqual(["regenerate"]);
  });

  it("does not require approval when the policy does not", () => {
    const result = evaluateCommitGate(
      input({ requiredApproval: false, approvalState: "not_required" }),
    );

    expect(result.allowed).toBe(true);
  });

  it("keeps conflict, stale, OCC, invariant, and mandatory failures independent", () => {
    const result = evaluateCommitGate(
      input({
        unresolvedConflict: true,
        stale: true,
        occConflict: true,
        invariantViolations: ["scene-1 novel mismatch"],
        validationOutcome: "fail",
        approvalState: "approved",
      }),
    );

    expect(result.blockers.map(blocker => blocker.type).sort()).toEqual([
      "invalid_revision",
      "invariant_violation",
      "mandatory_validation_failed",
      "occ_conflict",
      "stale_revision",
    ]);
    expect(result.blockers.find(blocker => blocker.type === "invariant_violation")?.facts).toEqual([
      "targetInvariantViolation=scene-1 novel mismatch",
    ]);
  });

  it("aggregates review decisions by scope with blocked first", () => {
    const result = evaluateCommitGate(
      input({
        approvalState: "pending",
        approvalScopes: [
          {
            key: "manuscript:manuscript:scene-1",
            decisions: [
              simpleReviewFact("approve"),
              simpleReviewFact("request_regeneration"),
              simpleReviewFact("blocked"),
            ],
          },
          {
            key: "canon:canonical_fact:fact-1",
            decisions: [simpleReviewFact("approve"), simpleReviewFact("reject")],
          },
          { key: "story_state:story_state:state-1", decisions: [simpleReviewFact("approve")] },
        ],
      }),
    );

    expect(result.blockers.map(blocker => blocker.type)).toEqual([
      "review_blocked",
      "review_rejected",
    ]);
    expect(result.blockers.map(blocker => blocker.approvalScope)).toEqual([
      "manuscript:manuscript:scene-1",
      "canon:canonical_fact:fact-1",
    ]);
    expect(result.requiredActions).toEqual(["revise_revision"]);
  });

  it("aggregates regeneration before pending and approved per scope", () => {
    const result = evaluateCommitGate(
      input({
        approvalState: "approved",
        approvalScopes: [
          {
            key: "manuscript:manuscript:scene-1",
            decisions: [
              simpleReviewFact("approve"),
              simpleReviewFact("request_regeneration"),
            ],
          },
          { key: "canon:canonical_fact:fact-1", decisions: [] },
          {
            key: "story_state:story_state:state-1",
            decisions: [simpleReviewFact("approve")],
          },
        ],
      }),
    );

    expect(result.blockers.map(blocker => blocker.type)).toEqual([
      "regeneration_requested",
      "missing_required_approval",
    ]);
    expect(result.requiredActions).toEqual(["regenerate", "obtain_review_decision"]);
  });
  it("keeps effective rejection and regeneration blockers when approval is not required", () => {
    const rejected = evaluateCommitGate(
      input({
        requiredApproval: false,
        approvalState: "not_required",
        approvalScopes: [
          {
            key: "canon:canonical_fact:fact-1",
            requiredApproval: false,
            decisions: [reviewFact("reject-fact", "reject", "human", "2026-10-03T00:00:00.000Z", ["review-reject-evidence"])],
          },
        ],
      }),
    );
    const regeneration = evaluateCommitGate(
      input({
        requiredApproval: false,
        approvalState: "not_required",
        approvalScopes: [
          {
            key: "manuscript:manuscript:scene-1#summary",
            requiredApproval: false,
            decisions: [reviewFact("regenerate-scene", "request_regeneration", "human", "2026-10-03T00:00:00.000Z", [])],
          },
        ],
      }),
    );

    expect(rejected.allowed).toBe(false);
    expect(rejected.blockers.map(blocker => blocker.type)).toEqual(["review_rejected"]);
    expect(regeneration.allowed).toBe(false);
    expect(regeneration.blockers.map(blocker => blocker.type)).toEqual(["regeneration_requested"]);
  });

  it("enforces the mandatory needs review human floor even when approval is not required", () => {
    const result = evaluateCommitGate(
      input({
        validationOutcome: "needs_review",
        requiredApproval: false,
        approvalState: "not_required",
        approvalScopes: [
          {
            key: "plan:manuscript:scene-1",
            requiredApproval: false,
            decisions: [reviewFact("policy-approve", "approve", "policy", "2026-10-03T00:00:00.000Z", ["policy-evidence"])],
          },
        ],
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.blockers.map(blocker => blocker.type)).toContain("mandatory_needs_review");
    expect(result.requiredActions).toContain("obtain_review_decision");
  });

  it("requires an action for mandatory needs review even without a missing approval blocker", () => {
    const result = evaluateCommitGate(
      input({
        validationOutcome: "needs_review",
        requiredApproval: false,
        approvalState: "not_required",
      }),
    );

    expect(result.blockers.map(blocker => blocker.type)).toEqual(["mandatory_needs_review"]);
    expect(result.requiredActions).toEqual(["obtain_review_decision"]);
  });

  it("supersedes decisions within one scope requirement by decidedAt then stable id", () => {
    const result = evaluateCommitGate(
      input({
        approvalState: "pending",
        approvalScopes: [
          {
            key: "canon:canonical_fact:fact-1",
            requirement: "canon-approval",
            decisions: [
              reviewFact("z-earlier-approve", "approve", "human", "2026-10-03T00:00:00.000Z", []),
              reviewFact("a-later-reject", "reject", "human", "2026-10-03T01:00:00.000Z", ["later-rejection"]),
              reviewFact("m-middle-approve", "approve", "human", "2026-10-03T00:30:00.000Z", []),
            ],
          },
          {
            key: "plan:manuscript:scene-1",
            requirement: "manuscript-approval",
            decisions: [
              reviewFact("b-later-approve", "approve", "human", "2026-10-03T01:00:00.000Z", ["later-approval"]),
              reviewFact("a-same-time-reject", "reject", "human", "2026-10-03T01:00:00.000Z", []),
            ],
          },
        ],
      }),
    );

    expect(result.blockers.map(blocker => blocker.type)).toEqual(["review_rejected"]);
    expect(result.blockers[0]?.approvalScope).toBe("canon:canonical_fact:fact-1");
    expect(result.blockers[0]?.evidenceReferences).toEqual(["a-later-reject", "later-rejection"]);
  });

  it("preserves decision provenance and source evidence instead of fact self-references", () => {
    const result = evaluateCommitGate(
      input({
        requiredApproval: false,
        approvalState: "not_required",
        approvalScopes: [
          {
            key: "story_state:story_state:state-1#character_state:john",
            requiredApproval: false,
            decisions: [
              reviewFact(
                "decision-17",
                "reject",
                "human",
                "2026-10-03T02:00:00.000Z",
                ["review-evidence-9"],
                { policyVersion: "policy-3", decisionRule: "story-state-approval" },
              ),
            ],
          },
        ],
      }),
    );

    expect(result.blockers[0]?.evidenceReferences).toEqual(["decision-17", "review-evidence-9"]);
    expect(result.blockers[0]?.evidenceReferences.some(reference => reference.startsWith("fact:"))).toBe(false);
    expect(result.blockers[0]?.facts[0]).toBe(
      "approval:story_state:story_state:state-1#character_state:john=rejected",
    );
    expect(result.blockers[0]?.facts).toContain("decisionId=decision-17");
    expect(result.blockers[0]?.facts).toContain("decidedBy=human");
    expect(result.blockers[0]?.facts).toContain("policyVersion=policy-3");
    expect(result.blockers[0]?.facts).toContain("decisionRule=story-state-approval");
  });
});

function simpleReviewFact(decision: CommitGateReviewFact["decision"]): CommitGateReviewFact {
  const decidedAt = {
    approve: "2026-10-03T00:00:00.000Z",
    request_regeneration: "2026-10-03T01:00:00.000Z",
    reject: "2026-10-03T02:00:00.000Z",
    blocked: "2026-10-03T03:00:00.000Z",
  }[decision];
  return reviewFact(`legacy-${decision}`, decision, "human", decidedAt, []);
}
function reviewFact(
  id: string,
  decision: CommitGateReviewFact["decision"],
  decidedBy: CommitGateReviewFact["decidedBy"],
  decidedAt: string,
  evidenceReferences: readonly string[],
  provenance: Partial<Pick<CommitGateReviewFact, "policyVersion" | "decisionRule" | "requirement">> = {},
): CommitGateReviewFact {
  return {
    id,
    decision,
    decidedBy,
    decidedAt: new Date(decidedAt),
    evidenceReferences,
    ...provenance,
  };
}
