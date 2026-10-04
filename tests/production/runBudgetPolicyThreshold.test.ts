import { describe, expect, it } from "vitest";
import {
  applyBudgetThresholdAction,
  createBudgetThresholdActionDecision,
  evaluateRunBudgetPolicy,
  runPolicyProvenanceFromReviewDecision,
  type BudgetThresholdActionDecision,
  type RunBudgetPolicy,
  type RunPolicyProvenance,
} from "../../src/production/domain/runBudgetPolicy";
import {
  approveProductionRun,
  createProductionRun,
  planProductionRun,
  startProductionRun,
} from "../../src/production/domain/productionRun";
import {
  createRunPlanApproval,
  createRunPlanRevision,
} from "../../src/production/domain/runPlan";
import {
  createReviewDecision,
  type ReviewDecision,
} from "../../src/production/domain/reviewDecision";
import { createChange } from "../../src/production/domain/change";
import { createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import { createValidationRun } from "../../src/production/domain/validationRun";
import {
  CommitGateBlockedError,
  commitChangeSetRevision,
} from "../../src/safety/application/commitChangeSetRevision";
import { InMemoryCommitTransaction } from "../../src/app/inMemoryCommitTransaction";
import { commitSceneText, createScene } from "../../src/manuscript/domain/scene";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-04T12:00:00.000Z");

const policy: RunBudgetPolicy = {
  id: "budget-policy-1",
  version: "budget-policy:v1",
  limits: {
    run: { cost: 100, attempts: 3 },
    task: { cost: 50 },
    attempt: { cost: 20 },
  },
  thresholds: [
    { id: "pause-50", scope: "run", metric: "cost", atPercent: 50, action: "pause" },
    { id: "checkpoint-75", scope: "run", metric: "cost", atPercent: 75, action: "checkpoint" },
    { id: "ask-90", scope: "run", metric: "cost", atPercent: 90, action: "ask" },
    { id: "abort-100", scope: "run", metric: "cost", atPercent: 100, action: "abort" },
  ],
};

function runningRun() {
  const revision = createRunPlanRevision({
    id: "budget-plan:r1",
    planId: "budget-plan",
    novelId: "novel-budget",
    revisionNumber: 1,
    goal: "Budget controlled run",
    steps: [{ id: "step-1", ordinal: 1, generationTaskId: "task-1", dependsOn: [] }],
    createdAt: now,
  });
  const approval = createRunPlanApproval({
    id: "budget-approval:r1",
    revision,
    approvedBy: "author-1",
    approvedAt: now,
  });
  const draft = createProductionRun({
    id: "run-budget",
    novelId: revision.novelId,
    runPlanRevision: revision,
    createdAt: now,
  });
  return startProductionRun(approveProductionRun(planProductionRun(draft, now), approval, now), now);
}

function reviewDecision(decidedBy: "human" | "policy"): ReviewDecision {
  return createReviewDecision({
    id: `review-${decidedBy}`,
    changeSetRevisionId: "cs-budget:r1",
    approvalScope: {
      requirementDomain: "manuscript",
      targetType: "manuscript",
      objectId: "scene-1",
    },
    decision: "approve",
    decidedBy,
    actorId: decidedBy === "policy" ? "budget-policy" : "author-1",
    reason: "Budget threshold authority",
    evidenceReferences: ["budget-evidence-1"],
    ...(decidedBy === "policy"
      ? { policyVersion: "budget-policy:v1", decisionRule: "ask-90" }
      : {}),
    createdAt: now,
  });
}

function decision(
  action: BudgetThresholdActionDecision["action"],
  provenance: RunPolicyProvenance,
): BudgetThresholdActionDecision {
  return createBudgetThresholdActionDecision({
    id: `budget-decision-${action}`,
    runId: "run-budget",
    action,
    thresholdId: `threshold-${action}`,
    reason: `${action} threshold`,
    provenance,
    decidedAt: now,
  });
}

describe("[task:4.5-4.6] [domain] Budget policy thresholds", () => {
  it("maps Run, Task, and Attempt thresholds to Pause, Checkpoint, Ask, and Abort", () => {
    const cases = [
      { used: 50, action: "pause" },
      { used: 75, action: "checkpoint" },
      { used: 95, action: "ask" },
      { used: 100, action: "abort" },
    ] as const;

    for (const testCase of cases) {
      const result = evaluateRunBudgetPolicy({
        policy,
        usage: {
          run: { scope: "run", subjectId: "run-budget", used: { cost: testCase.used } },
          task: { scope: "task", subjectId: "task-1", used: { cost: 10 } },
          attempt: { scope: "attempt", subjectId: "attempt-1", used: { cost: 1 } },
        },
      });
      expect(result.action).toBe(testCase.action);
      expect(result.triggered.some(entry => entry.scope === "run" && entry.metric === "cost")).toBe(true);
    }

    const scoped = evaluateRunBudgetPolicy({
      policy: {
        ...policy,
        thresholds: [
          { id: "task-ask", scope: "task", metric: "cost", atPercent: 90, action: "ask" },
          { id: "attempt-abort", scope: "attempt", metric: "cost", atPercent: 100, action: "abort" },
        ],
      },
      usage: {
        run: { scope: "run", subjectId: "run-budget", used: { cost: 1 } },
        task: { scope: "task", subjectId: "task-1", used: { cost: 46 } },
        attempt: { scope: "attempt", subjectId: "attempt-1", used: { cost: 21 } },
      },
    });
    expect(scoped.action).toBe("abort");
    expect(scoped.triggered.map(entry => entry.scope)).toEqual(["attempt", "task"]);
  });

  it("reuses ReviewDecision policy provenance and rejects incomplete policy authority", () => {
    const source = reviewDecision("policy");
    const provenance = runPolicyProvenanceFromReviewDecision(source);

    expect(provenance).toEqual({
      decidedBy: "policy",
      actorId: "budget-policy",
      reason: "Budget threshold authority",
      policyVersion: "budget-policy:v1",
      decisionRule: "ask-90",
      evidenceReferences: ["budget-evidence-1"],
    });
    expect(decision("ask", provenance).provenance).toEqual(provenance);
    expect(() =>
      decision("abort", {
        ...provenance,
        decidedBy: "policy",
        decisionRule: undefined,
      }),
    ).toThrow("decisionRule is required for policy provenance");
    expect(decision("pause", runPolicyProvenanceFromReviewDecision(reviewDecision("human"))).provenance.decidedBy)
      .toBe("human");
  });
});

describe("[task:4.5-4.6] [integration] Budget threshold actions", () => {
  it("applies Pause, Checkpoint, Ask, and Abort without creating narrative authority", () => {
    const provenance = runPolicyProvenanceFromReviewDecision(reviewDecision("policy"));
    const paused = applyBudgetThresholdAction({
      run: runningRun(),
      decision: decision("pause", provenance),
      occurredAt: now,
    });
    expect(paused.run.status).toBe("paused");
    expect(paused.checkpoint).toBeUndefined();

    const checkpointed = applyBudgetThresholdAction({
      run: runningRun(),
      decision: decision("checkpoint", provenance),
      occurredAt: now,
      checkpointId: "budget-checkpoint-1",
    });
    expect(checkpointed.run.status).toBe("paused");
    expect(checkpointed.checkpoint?.triggerCategory).toBe("budget");
    expect(checkpointed.checkpoint?.status).toBe("paused");
    expect(checkpointed.checkpoint?.decision).toBeUndefined();

    const asked = applyBudgetThresholdAction({
      run: runningRun(),
      decision: decision("ask", provenance),
      occurredAt: now,
    });
    expect(asked.run.status).toBe("waiting_for_human");

    const aborted = applyBudgetThresholdAction({
      run: runningRun(),
      decision: decision("abort", provenance),
      occurredAt: now,
    });
    expect(aborted.run.status).toBe("cancelled");
    expect(aborted.run.statusReason).toBe("abort threshold");
  });
});

describe("[task:4.5-4.6] [cross-system] Budget non-bypass invariant", () => {
  it("cannot use a budget decision to skip Validation, Approval, or Commit Gate", async () => {
    const action = applyBudgetThresholdAction({
      run: runningRun(),
      decision: decision(
        "ask",
        runPolicyProvenanceFromReviewDecision(reviewDecision("policy")),
      ),
      occurredAt: now,
    });
    expect(action.run.status).toBe("waiting_for_human");

    const revision = createInitialChangeSetRevision({
      revisionId: "budget-core:r1",
      changeSetId: "budget-core",
      novelId: "novel-budget",
      createdAt: now,
    });
    const guarded = {
      ...revision,
      changes: [
        createChange({
          id: "budget-change-1",
          sourceType: "candidate",
          sourceReference: { identity: "candidate-1", version: "r1", hash: "candidate-hash" },
          targetAddress: { targetType: "manuscript", objectId: "scene-1" },
          payload: { text: "Run text" },
          basedOnVersionSet: createVersionSet({
            scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
          }),
        }),
      ],
    };

    const transaction = new InMemoryCommitTransaction();
    const scene = commitSceneText({
      scene: createScene({
        id: "scene-1",
        novelId: "novel-budget",
        chapterId: "chapter-1",
        title: "Budget scene",
        revisionId: "scene-rev-0",
        commitId: "initial",
        createdAt: now,
      }),
      text: "Old text",
      revisionId: "scene-rev-1",
      commitId: "initial",
      updatedAt: now,
    });
    await transaction.scenes.save(scene);

    let caught: unknown;
    try {
      await commitChangeSetRevision({
        transaction,
        input: {
          commitId: "budget-blocked-commit",
          changeSetRevision: guarded,
          validationRuns: [
            createValidationRun({
              id: "budget-validation-fail",
              changeSetRevisionId: "budget-core:r1",
              planVersionId: "validation-plan:v1",
              validatorId: "validator-1",
              entryResults: [],
              executionState: "completed",
              outcome: "fail",
              createdAt: now,
            }),
          ],
          reviewDecisions: [],
          currentRevisionFacts: { unresolvedConflict: false, stale: false },
          targetInvariantViolations: [],
          requiredApproval: true,
          approvalScopeRequirements: [
            {
              approvalScope: {
                requirementDomain: "manuscript",
                targetType: "manuscript",
                objectId: "scene-1",
              },
              requirement: "budget-human-approval",
              requirementLevel: "human",
            },
          ],
          now,
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CommitGateBlockedError);
    const blockerTypes = caught instanceof CommitGateBlockedError
      ? caught.gate.blockers.map(blocker => blocker.type)
      : [];
    expect(blockerTypes).toContain("mandatory_validation_failed");
    expect(blockerTypes).toContain("missing_required_approval");
  });
});

describe("[task:4.5-4.6] P1 acceptance: hard budget limit", () => {
  it("[negative] triggers the hard-limit action and still requires the normal core gates", async () => {
    const hardPolicy: RunBudgetPolicy = {
      id: "hard-budget-policy",
      version: "budget-hard:v1",
      limits: {
        run: { cost: 10 },
        task: { cost: 10 },
        attempt: { cost: 10 },
      },
      thresholds: [
        { id: "hard-abort", scope: "run", metric: "cost", atPercent: 100, action: "abort" },
      ],
    };
    const evaluation = evaluateRunBudgetPolicy({
      policy: hardPolicy,
      usage: {
        run: { scope: "run", subjectId: "run-budget", used: { cost: 10.01 } },
        task: { scope: "task", subjectId: "task-1", used: { cost: 1 } },
        attempt: { scope: "attempt", subjectId: "attempt-1", used: { cost: 1 } },
      },
    });
    expect(evaluation.action).toBe("abort");
    expect(evaluation.withinBudget).toBe(false);

    const action = applyBudgetThresholdAction({
      run: runningRun(),
      decision: createBudgetThresholdActionDecision({
        id: "hard-budget-decision",
        runId: "run-budget",
        action: "abort",
        thresholdId: "hard-abort",
        reason: "Hard run budget exceeded",
        provenance: runPolicyProvenanceFromReviewDecision(reviewDecision("policy")),
        decidedAt: now,
      }),
      occurredAt: now,
    });
    expect(action.run.status).toBe("cancelled");

    const transaction = new InMemoryCommitTransaction();
    await transaction.scenes.save(commitSceneText({
      scene: createScene({
        id: "scene-1",
        novelId: "novel-budget",
        chapterId: "chapter-1",
        title: "Hard budget scene",
        revisionId: "scene-rev-0",
        commitId: "initial",
        createdAt: now,
      }),
      text: "Old text",
      revisionId: "scene-rev-1",
      commitId: "initial",
      updatedAt: now,
    }));
    const guardedRevision = {
      ...createInitialChangeSetRevision({
        revisionId: "hard-budget-core:r1",
        changeSetId: "hard-budget-core",
        novelId: "novel-budget",
        createdAt: now,
      }),
      changes: [
        createChange({
          id: "hard-budget-change",
          sourceType: "candidate",
          sourceReference: { identity: "candidate-hard", version: "r1", hash: "hard-hash" },
          targetAddress: { targetType: "manuscript", objectId: "scene-1" },
          payload: { text: "Must pass gates" },
          basedOnVersionSet: createVersionSet({
            scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
          }),
        }),
      ],
    };
    let caught: unknown;
    try {
      await commitChangeSetRevision({
        transaction,
        input: {
          commitId: "hard-budget-commit",
          changeSetRevision: guardedRevision,
          validationRuns: [
            createValidationRun({
              id: "hard-budget-validation-fail",
              changeSetRevisionId: "hard-budget-core:r1",
              planVersionId: "validation-plan:v1",
              validatorId: "validator-1",
              entryResults: [],
              executionState: "completed",
              outcome: "fail",
              createdAt: now,
            }),
          ],
          reviewDecisions: [],
          currentRevisionFacts: { unresolvedConflict: false, stale: false },
          targetInvariantViolations: [],
          requiredApproval: true,
          approvalScopeRequirements: [
            {
              approvalScope: {
                requirementDomain: "manuscript",
                targetType: "manuscript",
                objectId: "scene-1",
              },
              requirement: "hard-budget-approval",
              requirementLevel: "human",
            },
          ],
          now,
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CommitGateBlockedError);
    const blockerTypes = caught instanceof CommitGateBlockedError
      ? caught.gate.blockers.map(blocker => blocker.type)
      : [];

    expect(blockerTypes).toContain("missing_required_approval");
  });
});
