import { describe, expect, it } from "vitest";
import {
  buildRunAuditEvents,
  projectRunAudit,
  replayRunAuditEvents,
  type RunAuditInput,
  type RunCostRecord,
} from "../../src/production/application/runAuditProjection";
import {
  compensateRunCommit,
  evaluateRunCompensationEligibility,
  runCompensationCommitId,
  runCompensationIdempotencyKey,
  type RunCompensationRecord,
  type RunCompensationRequest,
} from "../../src/production/application/runCompensationService";
import { InMemoryRepository } from "../../src/app/inMemoryRepositories";
import { InMemoryCommitTransaction } from "../../src/app/inMemoryCommitTransaction";
import {
  createProductionRun,
  planProductionRun,
  startProductionRun,
  approveProductionRun,
} from "../../src/production/domain/productionRun";
import {
  createRunPlanApproval,
  createRunPlanRevision,
} from "../../src/production/domain/runPlan";
import {
  createGenerationTask,
} from "../../src/production/domain/generationTask";
import {
  completeExecutionAttempt,
  createExecutionAttempt,
  createFallbackExecutionAttempt,
  createRetryExecutionAttempt,
  failExecutionAttempt,
  startExecutionAttempt,
} from "../../src/production/domain/executionAttempt";
import {
  createCandidate,
  type Candidate,
} from "../../src/production/domain/candidate";
import {
  createChange,
  type Change,
  type TargetAddress,
} from "../../src/production/domain/change";
import {
  createChangeSetRevision,
  createInitialChangeSetRevision,
  type ChangeSetRevision,
} from "../../src/production/domain/changeSetRevision";
import {
  createValidationRun,
  type ValidationRun,
} from "../../src/production/domain/validationRun";
import {
  createReviewDecision,
  type ReviewDecision,
} from "../../src/production/domain/reviewDecision";
import {
  createNarrativeCommit,
  markNarrativeCommitCommitted,
  markNarrativeCommitFailed,
  type NarrativeCommit,
} from "../../src/safety/domain/narrativeCommit";
import {
  CommitGateBlockedError,
  commitChangeSetRevision,
  type CommitChangeSetRevisionInput,
} from "../../src/safety/application/commitChangeSetRevision";
import { commitSceneText, createScene } from "../../src/manuscript/domain/scene";
import {
  createBudgetThresholdActionDecision,
  evaluateRunBudgetPolicy,
  runPolicyProvenanceFromReviewDecision,
  type BudgetThresholdActionDecision,
  type RunBudgetPolicy,
} from "../../src/production/domain/runBudgetPolicy";
import {
  createVersionReference,
  createVersionSet,
  type VersionSet,
} from "../../src/shared/domain/versioning";

const now = new Date("2026-10-04T13:00:00.000Z");
const later = new Date("2026-10-04T13:05:00.000Z");

function routing(id: string) {
  return {
    routingDecisionId: id,
    resolverVersion: "resolver-1",
    routingPolicyVersion: "routing-policy:v1",
    provider: "test",
    model: "deterministic",
    reason: "run audit fixture",
  };
}

function generationTask(id: string) {
  return createGenerationTask({
    id,
    novelId: "novel-audit",
    operation: "scene_generation",
    targetSceneId: "scene-1",
    intent: "Generate scene",
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
    }),
    createdAt: now,
  });
}

function candidate(id: string, taskId: string): Candidate {
  return createCandidate({
    id,
    taskId,
    novelId: "novel-audit",
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
    }),
    change: { type: "text", sceneId: "scene-1", text: "Run text" },
    createdAt: now,
  });
}

function validation(id: string, revisionId: string, outcome: ValidationRun["outcome"] = "pass"): ValidationRun {
  return createValidationRun({
    id,
    changeSetRevisionId: revisionId,
    planVersionId: "validation-plan:v1",
    validatorId: "validator-1",
    entryResults: [],
    executionState: "completed",
    outcome,
    createdAt: now,
  });
}

function review(id: string, revisionId: string): ReviewDecision {
  return createReviewDecision({
    id,
    changeSetRevisionId: revisionId,
    approvalScope: {
      requirementDomain: "manuscript",
      targetType: "manuscript",
      objectId: "scene-1",
    },
    decision: "approve",
    decidedBy: "human",
    actorId: "author-1",
    reason: "Accept run output",
    evidenceReferences: [`${id}:evidence`],
    createdAt: now,
  });
}

function sourceChange(id: string, candidateId: string, target: TargetAddress = {
  targetType: "manuscript",
  objectId: "scene-1",
}): Change {
  return createChange({
    id,
    sourceType: "candidate",
    sourceReference: { identity: candidateId, version: "candidate-rev-1", hash: `${candidateId}:hash` },
    targetAddress: target,
    payload: { text: "Run text" },
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", target.objectId, "scene-rev-1"),
    }),
  });
}

function revision(
  revisionId: string,
  changes: readonly Change[],
  parent?: ChangeSetRevision,
): ChangeSetRevision {
  return parent
    ? createChangeSetRevision({
        parent,
        revisionId,
        trigger: { type: "edit", references: ["run-audit"] },
        changes,
        createdAt: now,
      })
    : Object.freeze({
        ...createInitialChangeSetRevision({
          revisionId,
          changeSetId: revisionId.split(":")[0] ?? revisionId,
          novelId: "novel-audit",
          createdAt: now,
        }),
        changes: Object.freeze([...changes]),
      });
}

function committed(id: string, changeSetRevision: ChangeSetRevision, resultingVersionSet: VersionSet): NarrativeCommit {
  return markNarrativeCommitCommitted({
    commit: createNarrativeCommit({
      id,
      novelId: "novel-audit",
      changeSetRevision,
      validationRuns: [validation(`${id}:validation`, changeSetRevision.revisionId)],
      reviewDecisions: [review(`${id}:review`, changeSetRevision.revisionId)],
      createdAt: now,
    }),
    resultingVersionSet,
    committedAt: now,
  });
}

function runChain() {
  const planRevision = createRunPlanRevision({
    id: "audit-plan:r1",
    planId: "audit-plan",
    novelId: "novel-audit",
    revisionNumber: 1,
    goal: "Audit and compensate",
    steps: [
      { id: "step-a", ordinal: 1, generationTaskId: "task-a", dependsOn: [] },
      { id: "step-b", ordinal: 2, generationTaskId: "task-b", dependsOn: [] },
    ],
    createdAt: now,
  });
  const planApproval = createRunPlanApproval({
    id: "audit-approval:r1",
    revision: planRevision,
    approvedBy: "author-1",
    approvedAt: now,
  });
  const draft = createProductionRun({
    id: "run-audit",
    novelId: "novel-audit",
    runPlanRevision: planRevision,
    createdAt: now,
  });
  let run = startProductionRun(
    approveProductionRun(planProductionRun(draft, now), planApproval, now),
    now,
  );
  const taskA = generationTask("task-a");
  const taskB = generationTask("task-b");
  const candidateA = candidate("candidate-a", taskA.id);

  const attemptA = completeExecutionAttempt({
    attempt: startExecutionAttempt(
      createExecutionAttempt({
        executionKey: "execution-a",
        relation: "initial",
        generationTask: taskA,
        routingDecision: routing("routing-a"),
        createdAt: now,
      }),
      now,
    ),
    runtimeRequest: {
      taskId: taskA.id,
      agentRole: "writer",
      modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 100 },
      basedOnVersionSet: taskA.basedOnVersionSet,
      context: {},
      requestedChange: candidateA.change,
    },
    runtimeResult: {
      taskId: taskA.id,
      agentRole: "writer",
      modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 100 },
      change: candidateA.change,
      basedOnVersionSet: taskA.basedOnVersionSet,
    },
    completedAt: now,
    candidate: candidateA,
  });

  const attemptB = failExecutionAttempt({
    attempt: startExecutionAttempt(
      createExecutionAttempt({
        executionKey: "execution-b",
        relation: "initial",
        generationTask: taskB,
        routingDecision: routing("routing-b"),
        createdAt: now,
      }),
      now,
    ),
    failure: {
      code: "runtime_failed",
      message: "Generation failed",
      retryable: true,
    },
    failedAt: later,
  });

  run = {
    ...run,
    stepStates: run.stepStates.map((state, index) => ({
      ...state,
      status: index === 0 ? "succeeded" : "failed",
      attemptIds: [index === 0 ? attemptA.id : attemptB.id],
    })),
  };

  return { run, planRevision, taskA, taskB, candidateA, attemptA, attemptB };
}

function budgetDecision(): BudgetThresholdActionDecision {
  const policy: RunBudgetPolicy = {
    id: "audit-budget-policy",
    version: "budget:v1",
    limits: { run: { cost: 10 }, task: { cost: 10 }, attempt: { cost: 10 } },
    thresholds: [
      { id: "audit-ask", scope: "run", metric: "cost", atPercent: 90, action: "ask" },
    ],
  };
  const evaluation = evaluateRunBudgetPolicy({
    policy,
    usage: {
      run: { scope: "run", subjectId: "run-audit", used: { cost: 9 } },
      task: { scope: "task", subjectId: "task-a", used: { cost: 1 } },
      attempt: { scope: "attempt", subjectId: attemptIdForBudget(), used: { cost: 1 } },
    },
  });
  return createBudgetThresholdActionDecision({
    id: "budget-decision-audit",
    runId: "run-audit",
    action: evaluation.action ?? "ask",
    thresholdId: "audit-ask",
    reason: "Cost threshold reached",
    provenance: runPolicyProvenanceFromReviewDecision(
      createReviewDecision({
        id: "budget-review-audit",
        changeSetRevisionId: "audit-source:r1",
        approvalScope: { requirementDomain: "manuscript", targetType: "manuscript", objectId: "scene-1" },
        decision: "approve",
        decidedBy: "policy",
        actorId: "budget-policy",
        reason: "Threshold authority",
        policyVersion: "budget:v1",
        decisionRule: "audit-ask",
        evidenceReferences: ["budget-evidence"],
        createdAt: now,
      }),
    ),
    decidedAt: now,
  });
}

function attemptIdForBudget(): string {
  return "attempt-cost-subject";
}

function auditFixture() {
  const chain = runChain();
  const sourceRevision = revision("audit-source:r1", [sourceChange("source-change", chain.candidateA.id)]);
  const resultingVersionSet = createVersionSet({
    scene: createVersionReference("Scene", "scene-1", "scene-rev-run"),
  });
  const sourceCommit = committed("audit-source-commit", sourceRevision, resultingVersionSet);
  const failedRevision = revision("audit-failed:r1", [sourceChange("failed-change", chain.candidateA.id)]);
  const failedCommit = markNarrativeCommitFailed({
    commit: createNarrativeCommit({
      id: "audit-failed-commit",
      novelId: "novel-audit",
      changeSetRevision: failedRevision,
      validationRuns: [validation("audit-failed-validation", failedRevision.revisionId)],
      reviewDecisions: [review("audit-failed-review", failedRevision.revisionId)],
      createdAt: later,
    }),
    reason: "Post-commit audit failure",
    failedAt: later,
  });
  const thresholdDecision = budgetDecision();
  const cost: RunCostRecord = {
    id: "cost-a",
    runId: "run-audit",
    scope: "attempt",
    subjectId: chain.attemptA.id,
    amount: 2.5,
    currency: "USD",
    occurredAt: now,
  };
  const input: RunAuditInput = {
    run: chain.run,
    generationTasks: [chain.taskA, chain.taskB],
    attempts: [chain.attemptA, chain.attemptB],
    candidates: [chain.candidateA],
    changeSetRevisions: [sourceRevision, failedRevision],
    validationRuns: [
      validation("audit-source-commit:validation", sourceRevision.revisionId),
      validation("audit-failed-validation", failedRevision.revisionId),
    ],
    reviewDecisions: [
      review("audit-source-commit:review", sourceRevision.revisionId),
      review("audit-failed-review", failedRevision.revisionId),
    ],
    narrativeCommits: [sourceCommit, failedCommit],
    thresholdDecisions: [thresholdDecision],
    checkpoints: [],
    costs: [cost],
  };
  return {
    ...chain,
    input,
    sourceRevision,
    sourceCommit,
    failedRevision,
    failedCommit,
    resultingVersionSet,
    thresholdDecision,
    cost,
  };
}

describe("[task:4.5-4.6] [persistence] Run Audit Projection", () => {
  it("projects complete run, attempt, candidate, decision, commit, cost, and failure audit", () => {
    const fixture = auditFixture();
    const projection = projectRunAudit(fixture.input);

    expect(projection.run.id).toBe("run-audit");
    expect(projection.tasks.map(task => task.id)).toEqual(["task-a", "task-b"]);
    expect(projection.attempts.map(entry => entry.attemptId).sort()).toEqual(
      [fixture.attemptA.id, fixture.attemptB.id].sort(),
    );
    expect(projection.attempts.find(entry => entry.attemptId === fixture.attemptA.id)?.candidateIds)
      .toEqual(["candidate-a"]);
    expect(projection.candidates.map(item => item.id)).toEqual(["candidate-a"]);
    expect(projection.decisions.map(item => item.kind).sort()).toEqual([
      "budget_threshold",
      "review",
      "review",
    ]);
    expect(projection.commits.map(item => item.commitId).sort()).toEqual([
      "audit-failed-commit",
      "audit-source-commit",
    ]);
    expect(projection.commits.find(item => item.commitId === "audit-source-commit")?.candidateIds)
      .toEqual(["candidate-a"]);
    expect(projection.costs).toEqual([fixture.cost]);
    expect(projection.failures.map(item => item.sourceKind).sort()).toEqual(["attempt", "commit"]);
    expect(projection.events.length).toBeGreaterThan(10);
    expect(projection.hash).toMatch(/^[a-f0-9]+$/);
    expect(buildRunAuditEvents(fixture.input)).toEqual(projection.events);
  });
});

describe("[task:4.5-4.6] [replay] Run Audit replay", () => {
  it("replays deterministically and deduplicates repeated audit events", () => {
    const projection = projectRunAudit(auditFixture().input);
    const replayed = replayRunAuditEvents([...projection.events, ...projection.events]);
    expect(replayed.events).toEqual(projection.events);
    expect(replayed.hash).toBe(projection.hash);
    expect(replayRunAuditEvents(projection.events).hash).toBe(projection.hash);
  });
});

async function compensationFixture(options: { readonly validationOutcome?: ValidationRun["outcome"] } = {}) {
  const fixture = auditFixture();
  const transaction = new InMemoryCommitTransaction();
  const initialScene = commitSceneText({
    scene: createScene({
      id: "scene-1",
      novelId: "novel-audit",
      chapterId: "chapter-1",
      title: "Audit scene",
      revisionId: "scene-rev-0",
      commitId: "initial",
      createdAt: now,
    }),
    text: "Old text",
    revisionId: "scene-rev-1",
    commitId: "initial",
    updatedAt: now,
  });
  await transaction.scenes.save(initialScene);

  const sourceChangeValue = sourceChange("core-source-change", fixture.candidateA.id);
  const sourceRevision = revision("core-source:r1", [sourceChangeValue]);
  const coreSourceCommit = await commitChangeSetRevision({
    transaction,
    input: {
      commitId: "core-source-commit",
      changeSetRevision: sourceRevision,
      validationRuns: [validation("core-source-validation", sourceRevision.revisionId)],
      reviewDecisions: [review("core-source-review", sourceRevision.revisionId)],
      currentRevisionFacts: { unresolvedConflict: false, stale: false },
      targetInvariantViolations: [],
      requiredApproval: false,
      now,
    },
  });

  const inverseChange = createChange({
    id: "core-compensation-change",
    sourceType: "conflict_resolution",
    sourceReference: {
      identity: "run-compensation:run-audit",
      version: "forward-compensation:v1",
      hash: "compensation-hash",
    },
    targetAddress: sourceChangeValue.targetAddress,
    payload: { text: "Old text" },
    basedOnVersionSet: coreSourceCommit.resultingVersionSet ?? {},
  });
  const compensationRevision = createChangeSetRevision({
    parent: sourceRevision,
    revisionId: "core-compensation:r1",
    trigger: { type: "conflict_resolution", references: ["forward-compensation"] },
    changes: [inverseChange],
    createdAt: later,
  });
  const request: RunCompensationRequest = {
    sourceCommitId: coreSourceCommit.id,
    sourceChangeSetRevision: sourceRevision,
    reversible: true,
    commit: {
      changeSetRevision: compensationRevision,
      validationRuns: [
        validation(
          "core-compensation-validation",
          compensationRevision.revisionId,
          options.validationOutcome ?? "pass",
        ),
      ],
      reviewDecisions: [review("core-compensation-review", compensationRevision.revisionId)],
      currentRevisionFacts: { unresolvedConflict: false, stale: false },
      targetInvariantViolations: [],
      requiredApproval: false,
    },
  };
  const audit: RunAuditInput = {
    ...fixture.input,
    changeSetRevisions: [sourceRevision],
    validationRuns: [validation("core-source-validation", sourceRevision.revisionId)],
    reviewDecisions: [review("core-source-review", sourceRevision.revisionId)],
    narrativeCommits: [coreSourceCommit],
    attempts: [fixture.attemptA],
    generationTasks: [fixture.taskA],
    costs: [],
  };
  return {
    fixture,
    transaction,
    sourceRevision,
    sourceChange: sourceChangeValue,
    coreSourceCommit,
    compensationRevision,
    request,
    audit,
    history: {
      narrativeCommits: [coreSourceCommit],
      changeSetRevisions: [sourceRevision],
    },
  };
}

describe("[task:4.5-4.6] [integration] Run forward compensation", () => {
  it("compensates only reversible run-produced commits through the existing core commit path", async () => {
    const setup = await compensationFixture();
    const records = new InMemoryRepository<RunCompensationRecord>();
    const result = await compensateRunCommit({
      audit: projectRunAudit(setup.audit),
      history: setup.history,
      request: setup.request,
      transaction: setup.transaction,
      records,
      now: later,
    });

    expect(result.status).toBe("compensated");
    expect(result.compensationCommitId).toBe(
      runCompensationCommitId("run-audit", "core-source-commit"),
    );
    expect((await setup.transaction.scenes.findById("scene-1"))?.text).toBe("Old text");
    expect((await setup.transaction.narrativeCommits.findById("core-source-commit"))?.status).toBe("committed");
    expect((await setup.transaction.narrativeCommits.findById(result.compensationCommitId))?.status).toBe("committed");
    expect(await records.findById(runCompensationIdempotencyKey("run-audit", "core-source-commit"))).toBeDefined();
  });
});

describe("[task:4.5-4.6] [cross-system] Compensation eligibility", () => {
  it("protects later author commits and rejects foreign or irreversible commits", async () => {
    const setup = await compensationFixture();
    const sourceAudit = projectRunAudit(setup.audit);
    const laterChange = createChange({
      id: "later-author-change",
      sourceType: "author_edit",
      sourceReference: { identity: "author-1", version: "later", hash: "author-hash" },
      targetAddress: setup.sourceChange.targetAddress,
      payload: { text: "Author text" },
      basedOnVersionSet: setup.coreSourceCommit.resultingVersionSet ?? {},
    });
    const laterRevision = createChangeSetRevision({
      parent: setup.sourceRevision,
      revisionId: "later-author:r1",
      trigger: { type: "edit", references: ["author"] },
      changes: [laterChange],
      createdAt: later,
    });
    const laterCommit = committed("later-author-commit", laterRevision, {
      scene: createVersionReference("Scene", "scene-1", "scene-rev-author"),
    });
    const history = {
      narrativeCommits: [setup.coreSourceCommit, laterCommit],
      changeSetRevisions: [setup.sourceRevision, laterRevision],
    };

    const blocked = evaluateRunCompensationEligibility({
      audit: sourceAudit,
      history,
      request: setup.request,
    });
    expect(blocked.eligible).toBe(false);
    expect(blocked.blockers).toContain("later_commit_touches_same_target");

    const foreign = evaluateRunCompensationEligibility({
      audit: sourceAudit,
      history: {
        narrativeCommits: [setup.coreSourceCommit, { ...laterCommit, id: "foreign-commit" }],
        changeSetRevisions: [setup.sourceRevision],
      },
      request: { ...setup.request, sourceCommitId: "foreign-commit" },
    });
    expect(foreign.blockers).toContain("not_run_produced");

    const irreversible = evaluateRunCompensationEligibility({
      audit: sourceAudit,
      history: setup.history,
      request: { ...setup.request, reversible: false },
    });
    expect(irreversible.blockers).toContain("not_reversible");
  });
});

describe("[task:4.5-4.6] [concurrency] Compensation idempotency", () => {
  it("replays concurrent requests into one forward compensation commit", async () => {
    const setup = await compensationFixture();
    const records = new InMemoryRepository<RunCompensationRecord>();
    const input = {
      audit: projectRunAudit(setup.audit),
      history: setup.history,
      request: setup.request,
      transaction: setup.transaction,
      records,
      now: later,
    };
    const [first, second] = await Promise.all([
      compensateRunCommit(input),
      compensateRunCommit(input),
    ]);

    expect(first.compensationCommitId).toBe(second.compensationCommitId);
    expect([first.status, second.status].sort()).toEqual(["compensated", "replayed"]);
    expect((await setup.transaction.narrativeCommits.listByNovel("novel-audit")).filter(
      commit => commit.id !== "core-source-commit",
    )).toHaveLength(1);
  });
});

describe("[task:4.5-4.6] [recovery] Compensation replay", () => {
  it("adopts an existing core compensation commit when the audit record is missing", async () => {
    const setup = await compensationFixture();
    const records = new InMemoryRepository<RunCompensationRecord>();
    const first = await compensateRunCommit({
      audit: projectRunAudit(setup.audit),
      history: setup.history,
      request: setup.request,
      transaction: setup.transaction,
      records,
      now: later,
    });
    expect(first.status).toBe("compensated");

    const replay = await compensateRunCommit({
      audit: projectRunAudit(setup.audit),
      history: setup.history,
      request: setup.request,
      transaction: setup.transaction,
      records: new InMemoryRepository<RunCompensationRecord>(),
      now: later,
    });
    expect(replay.status).toBe("replayed");
    expect(replay.compensationCommitId).toBe(first.compensationCommitId);
    expect((await setup.transaction.narrativeCommits.listByNovel("novel-audit")).filter(
      commit => commit.id !== "core-source-commit",
    )).toHaveLength(1);
  });
});

describe("[task:4.5-4.6] [transaction] Compensation gate and rollback", () => {
  it("does not persist compensation records when the core Commit Gate rejects the inverse commit", async () => {
    const setup = await compensationFixture({ validationOutcome: "fail" });
    const records = new InMemoryRepository<RunCompensationRecord>();
    const key = runCompensationIdempotencyKey("run-audit", "core-source-commit");

    await expect(compensateRunCommit({
      audit: projectRunAudit(setup.audit),
      history: setup.history,
      request: setup.request,
      transaction: setup.transaction,
      records,
      now: later,
    })).rejects.toBeInstanceOf(CommitGateBlockedError);

    expect(await records.findById(key)).toBeUndefined();
    expect((await setup.transaction.narrativeCommits.listByNovel("novel-audit")).map(commit => commit.id))
      .toEqual(["core-source-commit"]);
    expect((await setup.transaction.scenes.findById("scene-1"))?.text).toBe("Run text");
  });
});

describe("[task:4.5-4.6] [regression] Compensation history preservation", () => {
  it("keeps source and later history append-only while adding a new compensation commit", async () => {
    const setup = await compensationFixture();
    const result = await compensateRunCommit({
      audit: projectRunAudit(setup.audit),
      history: setup.history,
      request: setup.request,
      transaction: setup.transaction,
      records: new InMemoryRepository<RunCompensationRecord>(),
      now: later,
    });

    const ids = (await setup.transaction.narrativeCommits.listByNovel("novel-audit"))
      .map(commit => commit.id)
      .sort();
    expect(ids).toEqual(["core-source-commit", result.compensationCommitId].sort());
  });
});

describe("[task:4.5-4.6] P1 acceptance: run/attempt lineage evidence", () => {
  it("[replay] exposes retry and fallback chain evidence and replays every attempt event", () => {
    const fixture = auditFixture();
    const retry = createRetryExecutionAttempt({
      previousAttempt: fixture.attemptB,
      executionKey: "execution-b",
      attemptOrdinal: 2,
      routingDecision: routing("routing-b"),
      createdAt: later,
    });
    const failedRetry = failExecutionAttempt({
      attempt: startExecutionAttempt(retry, later),
      failure: { code: "retry_failed", message: "Retry failed", retryable: true },
      failedAt: later,
    });
    const fallback = createFallbackExecutionAttempt({
      previousAttempt: failedRetry,
      executionKey: "execution-b",
      attemptOrdinal: 3,
      routingDecision: routing("routing-b-fallback"),
      createdAt: later,
    });
    const run = {
      ...fixture.run,
      stepStates: fixture.run.stepStates.map(state =>
        state.stepId === "step-b"
          ? {
              ...state,
              attemptIds: [fixture.attemptB.id, failedRetry.id, fallback.id],
            }
          : state,
      ),
    };
    const projection = projectRunAudit({
      ...fixture.input,
      run,
      attempts: [fixture.attemptA, fixture.attemptB, failedRetry, fallback],
    });

    const chain = projection.attemptChains.find(entry => entry.executionKey === "execution-b");
    expect(chain?.attemptIds).toEqual([fixture.attemptB.id, failedRetry.id, fallback.id]);
    expect(chain?.relations).toEqual(["initial", "retry", "fallback"]);
    expect(chain?.routingDecisionIds).toEqual([
      "routing-b",
      "routing-b",
      "routing-b-fallback",
    ]);
    expect(chain?.predecessorAttemptIds).toEqual([
      null,
      fixture.attemptB.id,
      failedRetry.id,
    ]);
    expect(projection.events.filter(event => event.kind === "attempt").map(event => event.subjectId))
      .toEqual(expect.arrayContaining([
        fixture.attemptB.id,
        failedRetry.id,
        fallback.id,
      ]));
    expect(replayRunAuditEvents(projection.events).events).toEqual(projection.events);
  });
});

describe("[task:4.5-4.6] P1 acceptance: real run-produced commit provenance", () => {
  it("[integration] accepts core commit provenance and rejects a forged run audit entry", async () => {
    const setup = await compensationFixture();
    const audit = projectRunAudit(setup.audit);
    const source = audit.commits.find(entry => entry.commitId === "core-source-commit");
    expect(source?.candidateIds).toEqual([setup.fixture.candidateA.id]);
    expect(source?.attemptIds).toEqual([setup.fixture.attemptA.id]);
    expect(evaluateRunCompensationEligibility({
      audit,
      history: setup.history,
      request: setup.request,
    }).eligible).toBe(true);

    const forged = {
      ...audit,
      commits: audit.commits.map(entry =>
        entry.commitId === "core-source-commit"
          ? { ...entry, candidateIds: [], attemptIds: [], taskIds: [] }
          : entry,
      ),
    };
    const eligibility = evaluateRunCompensationEligibility({
      audit: forged,
      history: setup.history,
      request: setup.request,
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blockers).toContain("not_run_produced");
  });
});

describe("[task:4.5-4.6] P1 acceptance: later irreversible author commit", () => {
  it("[negative] rejects compensation after a later author change without creating events or commits", async () => {
    const setup = await compensationFixture();
    const laterChange = createChange({
      id: "later-irreversible-author-change",
      sourceType: "author_edit",
      sourceReference: { identity: "author-1", version: "irreversible", hash: "author-irreversible" },
      targetAddress: setup.sourceChange.targetAddress,
      payload: { text: "Author kept this text" },
      basedOnVersionSet: setup.coreSourceCommit.resultingVersionSet ?? {},
    });
    const laterRevision = createChangeSetRevision({
      parent: setup.sourceRevision,
      revisionId: "later-irreversible-author:r1",
      trigger: { type: "edit", references: ["author-irreversible"] },
      changes: [laterChange],
      createdAt: later,
    });
    const laterCommit = committed(
      "later-irreversible-author-commit",
      laterRevision,
      { scene: createVersionReference("Scene", "scene-1", "scene-rev-author") },
    );
    const eventsBefore = await setup.transaction.eventStore.listByNovel("novel-audit");
    const commitsBefore = await setup.transaction.narrativeCommits.listByNovel("novel-audit");

    await expect(compensateRunCommit({
      audit: projectRunAudit(setup.audit),
      history: {
        narrativeCommits: [setup.coreSourceCommit, laterCommit],
        changeSetRevisions: [setup.sourceRevision, laterRevision],
      },
      request: setup.request,
      transaction: setup.transaction,
      records: new InMemoryRepository<RunCompensationRecord>(),
      now: later,
    })).rejects.toThrow("later_commit_touches_same_target");

    expect(await setup.transaction.eventStore.listByNovel("novel-audit")).toHaveLength(eventsBefore.length);
    expect(await setup.transaction.narrativeCommits.listByNovel("novel-audit")).toHaveLength(commitsBefore.length);
  });
});

describe("[task:4.5-4.6] P1 acceptance: real-history idempotent replay", () => {
  it("[integration] makes the second replay a no-op with no duplicate events or commits", async () => {
    const setup = await compensationFixture();
    const records = new InMemoryRepository<RunCompensationRecord>();
    const first = await compensateRunCommit({
      audit: projectRunAudit(setup.audit),
      history: setup.history,
      request: setup.request,
      transaction: setup.transaction,
      records,
      now: later,
    });
    const eventsAfterFirst = await setup.transaction.eventStore.listByNovel("novel-audit");
    const commitsAfterFirst = await setup.transaction.narrativeCommits.listByNovel("novel-audit");

    const second = await compensateRunCommit({
      audit: projectRunAudit(setup.audit),
      history: setup.history,
      request: setup.request,
      transaction: setup.transaction,
      records,
      now: later,
    });

    expect(first.status).toBe("compensated");
    expect(second.status).toBe("replayed");
    expect(second.compensationCommitId).toBe(first.compensationCommitId);
    expect(await setup.transaction.eventStore.listByNovel("novel-audit")).toEqual(eventsAfterFirst);
    expect(await setup.transaction.narrativeCommits.listByNovel("novel-audit")).toEqual(commitsAfterFirst);
  });
});
