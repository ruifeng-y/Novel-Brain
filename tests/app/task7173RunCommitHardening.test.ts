import { describe, expect, it } from "vitest";
import { InMemoryCommitTransaction } from "../../src/app/inMemoryCommitTransaction";
import {
  commitChangeSetRevision,
  type CommitChangeSetRevisionInput,
  type CommitChangeSetRevisionTransaction,
  type CommitChangeSetRevisionTransactionWork,
} from "../../src/safety/application/commitChangeSetRevision";
import { commitSceneText, createScene } from "../../src/manuscript/domain/scene";
import { createChange } from "../../src/production/domain/change";
import { createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import { createValidationRun } from "../../src/production/domain/validationRun";
import { createReviewDecision } from "../../src/production/domain/reviewDecision";
import {
  createProductionRun,
} from "../../src/production/domain/productionRun";
import { saveProductionRun } from "../../src/production/application/runPlanService";
import { createInMemoryRunOrchestrationPersistence } from "../../src/production/application/runPlanPersistence";
import {
  createInMemoryExecutionRecoveryPersistence,
  failScheduledExecution,
  retryFailedExecution,
  type ExecutionRecoveryPersistence,
} from "../../src/production/application/executionRecoveryService";
import type { ExecutionRecoveryWork } from "../../src/production/application/executionRecoveryPersistence";
import {
  approveProductionRun,
  planProductionRun,
  startProductionRun,
} from "../../src/production/domain/productionRun";
import {
  approveRunPlanRevision,
  createRunPlanApproval,
  createRunPlanRevision,
} from "../../src/production/domain/runPlan";
import { createGenerationTask } from "../../src/production/domain/generationTask";
import { scheduleProductionRunAttempt } from "../../src/production/application/productionRunScheduler";
import { replayRunAuditEvents, type RunAuditEvent } from "../../src/production/application/runAuditProjection";
import {
  createVersionReference,
  createVersionSet,
} from "../../src/shared/domain/versioning";
import { hashContent } from "../../src/shared/domain/contentHash";
import { describeVerificationGate } from "../support/capabilityVerificationContract";

const now = new Date("2026-10-05T08:00:00.000Z");
const later = new Date("2026-10-05T08:01:00.000Z");
const latest = new Date("2026-10-05T08:02:00.000Z");

function baseScene() {
  return commitSceneText({
    scene: createScene({
      id: "scene-7173",
      novelId: "novel-7173-core",
      chapterId: "chapter-7173",
      title: "Hardening scene",
      revisionId: "scene-7173:r1",
      commitId: "initial-7173",
      createdAt: now,
    }),
    text: "Before hardening.",
    revisionId: "scene-7173:r2",
    commitId: "initial-7173",
    updatedAt: now,
  });
}

function commitInput(commitId: string): CommitChangeSetRevisionInput {
  const change = createChange({
    id: "change-7173",
    sourceType: "candidate",
    sourceReference: {
      identity: "candidate-7173",
      version: "candidate-7173:r1",
      hash: hashContent("candidate-7173"),
    },
    targetAddress: { targetType: "manuscript", objectId: "scene-7173" },
    payload: { text: "After hardening." },
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-7173", "scene-7173:r2"),
    }),
  });
  const revision = createInitialChangeSetRevision({
    revisionId: "change-set-7173:r1",
    changeSetId: "change-set-7173",
    novelId: "novel-7173-core",
    createdAt: now,
  });
  const changeSetRevision = Object.freeze({
    ...revision,
    changes: Object.freeze([change]),
  });
  return {
    commitId,
    changeSetRevision,
    validationRuns: [
      createValidationRun({
        id: "validation-7173",
        changeSetRevisionId: revision.revisionId,
        planVersionId: "plan-7173",
        validatorId: "basic-validator",
        entryResults: [],
        executionState: "completed",
        outcome: "pass",
        createdAt: now,
      }),
    ],
    reviewDecisions: [
      createReviewDecision({
        id: "review-7173",
        changeSetRevisionId: revision.revisionId,
        approvalScope: {
          requirementDomain: "manuscript",
          targetType: "manuscript",
          objectId: "scene-7173",
        },
        decision: "approve",
        decidedBy: "human",
        actorId: "author-7173",
        reason: "Approve hardening transition",
        evidenceReferences: ["validation-7173"],
        createdAt: now,
      }),
    ],
    currentRevisionFacts: { unresolvedConflict: false, stale: false },
    targetInvariantViolations: [],
    requiredApproval: false,
    now,
  };
}

async function commitFixture() {
  const transaction = new InMemoryCommitTransaction();
  await transaction.scenes.save(baseScene());
  return transaction;
}

function injectEventFailure(
  transaction: CommitChangeSetRevisionTransaction,
): CommitChangeSetRevisionTransaction {
  return {
    run<T>(
      operation: (work: CommitChangeSetRevisionTransactionWork) => Promise<T>,
    ): Promise<T> {
      return transaction.run(async (work) =>
        operation({
          ...work,
          eventStore: {
            listByNovel: (novelId) => work.eventStore.listByNovel(novelId),
            appendEventsIfAbsent: async (events) => {
              await work.eventStore.appendEventsIfAbsent(events);
              throw new Error("7173 event append interrupted");
            },
          },
        }),
      );
    },
  };
}

function recoveryFixture() {
  const persistence = createInMemoryExecutionRecoveryPersistence();
  const revision = createRunPlanRevision({
    id: "run-plan-7173:r1",
    planId: "run-plan-7173",
    novelId: "novel-7173-run",
    revisionNumber: 1,
    goal: "Recover hardening run",
    steps: [{ id: "step-7173", ordinal: 1, generationTaskId: "task-7173", dependsOn: [] }],
    createdAt: now,
  });
  const approval = createRunPlanApproval({
    id: "approval-7173",
    revision,
    approvedBy: "author-7173",
    approvedAt: now,
  });
  expect(approveRunPlanRevision(approval, revision)).toBe(true);
  const run = startProductionRun(
    approveProductionRun(
      planProductionRun(
        createProductionRun({
          id: "run-7173",
          novelId: revision.novelId,
          runPlanRevision: revision,
          createdAt: now,
        }),
        now,
      ),
      approval,
      now,
    ),
    now,
  );
  const generationTask = createGenerationTask({
    id: "task-7173",
    novelId: revision.novelId,
    operation: "rewrite",
    targetSceneId: "scene-7173",
    intent: "Rewrite hardening scene",
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-7173", "scene-7173:r1"),
    }),
    createdAt: now,
  });
  const scheduled = scheduleProductionRunAttempt({
    run,
    runPlanRevision: revision,
    generationTask,
    stepId: "step-7173",
    executionKey: "execution-7173",
    routingDecision: {
      routingDecisionId: "routing-7173",
      resolverVersion: "resolver-7173",
      routingPolicyVersion: "policy-7173",
      provider: "test",
      model: "deterministic",
      reason: "hardening recovery",
    },
    createdAt: now,
  });
  return { persistence, revision, generationTask, scheduled };
}

function injectRetryFailure(
  persistence: ExecutionRecoveryPersistence,
): ExecutionRecoveryPersistence {
  return {
    ...persistence,
    transaction: {
      run<T>(operation: (work: ExecutionRecoveryWork) => Promise<T>): Promise<T> {
        return persistence.transaction.run(async (work) =>
          operation({
            ...work,
            runs: {
              saveRevisionIfAbsent: async (run) => {
                await work.runs.saveRevisionIfAbsent(run);
                throw new Error("7173 retry transition interrupted");
              },
              saveIfCurrent: (expectedRevisionId, run) =>
                work.runs.saveIfCurrent(expectedRevisionId, run),
              findById: (id) => work.runs.findById(id),
              getRevision: (id, revisionId) => work.runs.getRevision(id, revisionId),
              listByNovel: (novelId) => work.runs.listByNovel(novelId),
            },
          }),
        );
      },
    },
  };
}
describe("[task:7.1-7.3] Run and Commit hardening", () => {
  describeVerificationGate("concurrency", "replays concurrent Run and Commit identities without duplicates", async () => {
    const runPersistence = createInMemoryRunOrchestrationPersistence();
    const run = createProductionRun({
      id: "run-7173-reservation",
      novelId: "novel-7173-run",
      runPlanRevision: recoveryFixture().revision,
      createdAt: now,
    });
    const runResults = await Promise.all(
      Array.from({ length: 8 }, () => saveProductionRun(runPersistence, run)),
    );
    expect(new Set(runResults.map((result) => result.currentRevisionId)).size).toBe(1);
    expect(await runPersistence.runs.getRevision(run.id, run.currentRevisionId)).toEqual(run);

    const transaction = await commitFixture();
    const input = commitInput("commit-7173-idempotent");
    const commitResults = await Promise.all(
      Array.from({ length: 8 }, () =>
        commitChangeSetRevision({ transaction, input }),
      ),
    );
    expect(new Set(commitResults.map((result) => result.id))).toEqual(
      new Set(["commit-7173-idempotent"]),
    );
    expect(
      (await transaction.narrativeCommits.listByNovel("novel-7173-core")).filter(
        (commit) => commit.status === "committed",
      ),
    ).toHaveLength(1);
    const eventIds = (await transaction.eventStore.listByNovel("novel-7173-core")).map(
      (event) => event.eventId,
    );
    expect(new Set(eventIds).size).toBe(eventIds.length);
    expect(
      eventIds.filter((eventId) => eventId.startsWith("event:commit-7173-idempotent:")),
    ).toHaveLength(2);
  });

  describeVerificationGate("transaction", "rolls back interrupted Commit state and evidence", async () => {
    const transaction = await commitFixture();
    await expect(
      commitChangeSetRevision({
        transaction: injectEventFailure(transaction),
        input: commitInput("commit-7173-interrupted"),
      }),
    ).rejects.toThrow("7173 event append interrupted");

    expect((await transaction.scenes.findById("scene-7173"))?.currentRevisionId).toBe(
      "scene-7173:r2",
    );
    expect(
      await transaction.scenes.getRevision("scene-7173", "scene-7173:r2:commit-7173-interrupted"),
    ).toBeUndefined();
    expect(await transaction.eventStore.listByNovel("novel-7173-core")).toEqual([]);
    expect(
      (await transaction.narrativeCommits.listByNovel("novel-7173-core")).filter(
        (commit) => commit.status === "committed",
      ),
    ).toEqual([]);
  });

  describeVerificationGate("recovery", "recovers an interrupted retry after a failed Attempt without half state", async () => {
    const fixture = recoveryFixture();
    const failed = await failScheduledExecution({
      persistence: fixture.persistence,
      run: fixture.scheduled.run,
      stepId: "step-7173",
      createdAttempt: fixture.scheduled.attempt,
      startedAt: now,
      failure: { code: "provider_error", message: "interrupted", retryable: true },
      failedAt: later,
      retryReason: "retry after interruption",
    });

    await expect(
      retryFailedExecution({
        persistence: injectRetryFailure(fixture.persistence),
        run: failed.run,
        runPlanRevision: fixture.revision,
        generationTask: fixture.generationTask,
        stepId: "step-7173",
        previousAttempt: failed.attempt,
        executionKey: "execution-7173-retry",
        routingDecision: {
          routingDecisionId: "routing-7173-retry",
          resolverVersion: "resolver-7173",
          routingPolicyVersion: "policy-7173",
          provider: "test",
          model: "deterministic",
          reason: "retry",
          fallbackFromAttemptId: failed.attempt.id,
        },
        createdAt: latest,
      }),
    ).rejects.toThrow("7173 retry transition interrupted");

    expect((await fixture.persistence.runs.findById(failed.run.id))?.currentRevisionId).toBe(
      failed.run.currentRevisionId,
    );
    expect(
      await fixture.persistence.attempts.getRevision(
        failed.attempt.id,
        failed.attempt.currentRevisionId,
      ),
    ).toEqual(failed.attempt);

    const recovered = await retryFailedExecution({
      persistence: fixture.persistence,
      run: failed.run,
      runPlanRevision: fixture.revision,
      generationTask: fixture.generationTask,
      stepId: "step-7173",
      previousAttempt: failed.attempt,
      executionKey: "execution-7173-retry",
      routingDecision: {
        routingDecisionId: "routing-7173-retry",
        resolverVersion: "resolver-7173",
        routingPolicyVersion: "policy-7173",
        provider: "test",
        model: "deterministic",
        reason: "retry",
        fallbackFromAttemptId: failed.attempt.id,
      },
      createdAt: latest,
    });
    const state = recovered.run.stepStates.find((candidate) => candidate.stepId === "step-7173");
    expect(state?.attemptIds).toEqual([failed.attempt.id, recovered.attempt.id]);
    expect(recovered.attempt.relation).toBe("retry");
  });

  describeVerificationGate("replay", "replays duplicated and reordered projection events deterministically", () => {
    const events: readonly RunAuditEvent[] = [
      {
        eventId: "audit-7173-run",
        sequence: 1,
        kind: "run",
        runId: "run-7173",
        novelId: "novel-7173-run",
        subjectId: "run-7173",
        occurredAt: now,
        payload: { status: "running" },
      },
      {
        eventId: "audit-7173-attempt",
        sequence: 2,
        kind: "attempt",
        runId: "run-7173",
        novelId: "novel-7173-run",
        subjectId: "attempt-7173",
        occurredAt: later,
        payload: { status: "failed" },
      },
    ];
    const first = replayRunAuditEvents(events);
    const replay = replayRunAuditEvents([
      events[1]!,
      events[0]!,
      { ...events[1]!, sequence: 9 },
      events[0]!,
    ]);

    expect(replay.events).toEqual(first.events);
    expect(replay.hash).toBe(first.hash);
  });

  describeVerificationGate("regression", "keeps unique Run/Commit identities and evidence under replay", async () => {
    const runPersistence = createInMemoryRunOrchestrationPersistence();
    const run = createProductionRun({
      id: "run-7173-regression",
      novelId: "novel-7173-run",
      runPlanRevision: recoveryFixture().revision,
      createdAt: now,
    });
    const firstRun = await saveProductionRun(runPersistence, run);
    const replayedRun = await saveProductionRun(runPersistence, firstRun);
    expect(replayedRun).toEqual(firstRun);

    const transaction = await commitFixture();
    const input = commitInput("commit-7173-regression");
    const firstCommit = await commitChangeSetRevision({ transaction, input });
    const replayedCommit = await commitChangeSetRevision({ transaction, input });
    expect(replayedCommit).toEqual(firstCommit);
    expect(
      (await transaction.eventStore.listByNovel("novel-7173-core")).filter(
        (event) => event.name === "NarrativeCommitRecorded",
      ),
    ).toHaveLength(1);
  });
});
