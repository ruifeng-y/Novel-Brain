import { describe, expect, it } from "vitest";
import { createCommitGateQuery, type EvaluateCommitGateInput } from "../../src/app/commitGateQuery";
import {
  createInMemoryReviewDecisionStore,
  createReviewDecisionService,
} from "../../src/app/reviewDecisionService";
import { createInMemoryValidationRunStore, ValidationBindingError } from "../../src/app/validationRunService";
import { createInMemoryChangeSetPersistence } from "../../src/production/application/changeSetPersistence";
import { createChangeSetRevisionService } from "../../src/app/changeSetRevisionService";
import { InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import { createCandidate, type Candidate } from "../../src/production/domain/candidate";
import { createValidationRun } from "../../src/production/domain/validationRun";
import type { ApprovalScope } from "../../src/production/domain/reviewDecision";
import type { CommitChangeSetRevisionApprovalRequirement } from "../../src/safety/application/commitChangeSetRevision";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const AT = new Date("2026-10-06T00:00:00.000Z");
const CHANGE_SET = "cs-1";
const REVISION = "cs-1:r1";

const manuscriptScope: ApprovalScope = {
  requirementDomain: "manuscript",
  targetType: "manuscript",
  objectId: "scene-1",
};

function candidateFixture(id = "candidate-1"): Candidate {
  return createCandidate({
    id,
    taskId: `task-${id}`,
    novelId: "novel-1",
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-1:rev-1"),
    }),
    change: { type: "text", sceneId: "scene-1", text: "新文本。" },
    createdAt: AT,
  });
}

function runFixture(input: { id: string; revisionId?: string; outcome: "pass" | "fail" | "needs_review" }) {
  return createValidationRun({
    id: input.id,
    changeSetRevisionId: input.revisionId ?? REVISION,
    planVersionId: "plan-v1",
    validatorId: "validator-1",
    entryResults: [],
    executionState: "completed",
    outcome: input.outcome,
    createdAt: AT,
  });
}

async function harness() {
  const persistence = createInMemoryChangeSetPersistence();
  const changeSetRevisions = createChangeSetRevisionService({
    changeSets: persistence.changeSets,
  });
  const candidates = new InMemoryRevisionedRepository<Candidate>();
  await candidates.save(candidateFixture());
  await changeSetRevisions.adoptCandidate({
    candidate: candidateFixture(),
    changeSetId: CHANGE_SET,
    revisionId: REVISION,
    createdAt: AT,
  });
  const firstRevision = await changeSetRevisions.getRevision({
    changeSetId: CHANGE_SET,
    revisionId: REVISION,
  });
  await changeSetRevisions.adoptCandidate({
    candidate: candidateFixture("candidate-2"),
    changeSetId: CHANGE_SET,
    revisionId: "cs-1:r2",
    parentRevision: firstRevision,
    createdAt: AT,
  });

  const validations = createInMemoryValidationRunStore();
  const reviews = createInMemoryReviewDecisionStore();
  const query = createCommitGateQuery({
    changeSets: persistence.changeSets,
    validations,
    reviews,
  });
  const decisions = createReviewDecisionService({
    reviews,
    changeSets: persistence.changeSets,
  });
  return { query, validations, reviews, decisions };
}

function gateInput(overrides: Partial<EvaluateCommitGateInput> = {}): EvaluateCommitGateInput {
  return {
    changeSetId: CHANGE_SET,
    revisionId: REVISION,
    currentRevisionFacts: { unresolvedConflict: false, stale: false },
    targetInvariantViolations: [],
    ...overrides,
  };
}

const humanRequirement: CommitChangeSetRevisionApprovalRequirement = {
  approvalScope: manuscriptScope,
  requirement: "human sign-off",
  requirementLevel: "human",
};

describe("[task:W3] [domain] commit gate query", () => {
  it("reports the five conditions independently", async () => {
    const { query, validations } = await harness();
    await validations.saveIfAbsent(runFixture({ id: "run-fail", outcome: "fail" }));

    const gate = await query.evaluate(gateInput({ validationRunIds: ["run-fail"] }));

    expect(gate?.validation.ok).toBe(false);
    expect(gate?.approval.ok).toBe(true);
    expect(gate?.revisionValidity.ok).toBe(true);
    expect(gate?.concurrency.ok).toBe(true);
    expect(gate?.invariant.ok).toBe(true);
    expect(gate?.allowed).toBe(false);
    expect(gate?.requiredActions).toContain("fix_validation");
    expect(gate?.blockers.map(blocker => blocker.type)).toEqual(["mandatory_validation_failed"]);
  });

  it("allows a clean revision and reports every condition as satisfied", async () => {
    const { query, validations } = await harness();
    await validations.saveIfAbsent(runFixture({ id: "run-pass", outcome: "pass" }));

    const gate = await query.evaluate(gateInput({ validationRunIds: ["run-pass"] }));

    expect(gate?.allowed).toBe(true);
    expect(gate?.requiredActions).toEqual([]);
    expect([
      gate?.revisionValidity.ok,
      gate?.concurrency.ok,
      gate?.invariant.ok,
      gate?.validation.ok,
      gate?.approval.ok,
    ]).toEqual([true, true, true, true, true]);
  });

  it("reports each blocking group on its own condition", async () => {
    const { query } = await harness();

    const gate = await query.evaluate(
      gateInput({
        currentRevisionFacts: { unresolvedConflict: true, stale: true },
        occConflict: true,
        targetInvariantViolations: ["预算超限"],
      }),
    );

    expect(gate?.revisionValidity.ok).toBe(false);
    expect(gate?.concurrency.ok).toBe(false);
    expect(gate?.invariant.ok).toBe(false);
    expect(gate?.validation.ok).toBe(true);
    expect(gate?.approval.ok).toBe(true);
    expect(gate?.requiredActions).toEqual(["resolve_conflict", "rebase", "reconcile_version", "fix_invariant"]);
  });

  it("reports a required approval with no decision as not satisfied", async () => {
    const { query } = await harness();

    const gate = await query.evaluate(gateInput({ approvalRequirements: [humanRequirement] }));

    expect(gate?.approval.ok).toBe(false);
    expect(gate?.blockers.map(blocker => blocker.type)).toEqual(["missing_required_approval"]);
    expect(gate?.requiredActions).toContain("obtain_review_decision");
  });

  it("reports a recorded approval decision as satisfied", async () => {
    const { query, decisions } = await harness();
    await decisions.recordReview({
      reviewDecisionId: "review-1",
      changeSetId: CHANGE_SET,
      revisionId: REVISION,
      approvalScope: manuscriptScope,
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "可以提交。",
      evidenceReferences: [],
      createdAt: AT,
    });

    const gate = await query.evaluate(gateInput({ approvalRequirements: [humanRequirement] }));

    expect(gate?.approval.ok).toBe(true);
    expect(gate?.allowed).toBe(true);
  });

  it("does not treat another revision's decision as this revision's approval", async () => {
    const { query, decisions } = await harness();
    await decisions.recordReview({
      reviewDecisionId: "review-other",
      changeSetId: CHANGE_SET,
      revisionId: "cs-1:r2",
      approvalScope: manuscriptScope,
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "可以提交。",
      evidenceReferences: [],
      createdAt: AT,
    });

    const gate = await query.evaluate(gateInput({ approvalRequirements: [humanRequirement] }));

    expect(gate?.approval.ok).toBe(false);
  });

  it("returns undefined for a revision that does not exist", async () => {
    const { query } = await harness();
    expect(await query.evaluate(gateInput({ revisionId: "cs-1:missing" }))).toBeUndefined();
  });

  it("refuses a validation run that belongs to another revision", async () => {
    const { query, validations } = await harness();
    await validations.saveIfAbsent(
      runFixture({ id: "run-other", revisionId: "cs-1:r2", outcome: "pass" }),
    );

    await expect(
      query.evaluate(gateInput({ validationRunIds: ["run-other"] })),
    ).rejects.toBeInstanceOf(ValidationBindingError);
  });

  it("agrees with the commit's own gate evaluation over the same artefacts", async () => {
    const { query, validations } = await harness();
    await validations.saveIfAbsent(runFixture({ id: "run-fail", outcome: "fail" }));

    const gate = await query.evaluate(
      gateInput({ validationRunIds: ["run-fail"], approvalRequirements: [humanRequirement] }),
    );

    // The commit evaluates the same facts through the same single function.
    const { evaluateCommitGate } = await import("../../src/safety/domain/commitGate");
    const direct = evaluateCommitGate({
      unresolvedConflict: false,
      stale: false,
      occConflict: false,
      invariantViolations: [],
      validationOutcome: "fail",
      validationEvidenceReferences: ["run-fail"],
      requiredApproval: true,
      approvalState: "pending",
      approvalScopes: [
        {
          key: "manuscript:manuscript:scene-1",
          requirement: "human sign-off",
          requirementLevel: "human",
          requirements: [{ requirement: "human sign-off", requirementLevel: "human" }],
          requiredApproval: true,
          decisions: [],
        },
      ],
    });

    expect(gate?.allowed).toBe(direct.allowed);
    expect(gate?.blockers.map(blocker => blocker.type)).toEqual(
      direct.blockers.map(blocker => blocker.type),
    );
    expect(gate?.requiredActions).toEqual(direct.requiredActions);
  });
});
