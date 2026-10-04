import { describe, expect, it } from "vitest";
import {
  createInMemoryExecutionRecoveryPersistence,
  fallbackFailedExecution,
  failScheduledExecution,
  recoverProductionRunExecution,
  retryFailedExecution,
  type ExecutionRecoveryPersistence,
} from "../../src/production/application/executionRecoveryService";
import {
  createProductionRun,
  planProductionRun,
  approveProductionRun,
  startProductionRun,
} from "../../src/production/domain/productionRun";
import {
  approveRunPlanRevision,
  createRunPlanApproval,
  createRunPlanRevision,
} from "../../src/production/domain/runPlan";
import { createGenerationTask } from "../../src/production/domain/generationTask";
import { scheduleProductionRunAttempt } from "../../src/production/application/productionRunScheduler";
import {
  failExecutionAttempt,
  startExecutionAttempt,
  type ExecutionRoutingDecisionReference,
} from "../../src/production/domain/executionAttempt";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-04T12:00:00.000Z");
const later = new Date("2026-10-04T12:01:00.000Z");
const latest = new Date("2026-10-04T12:02:00.000Z");
const final = new Date("2026-10-04T12:03:00.000Z");

function routing(id: string, fallbackFromAttemptId?: string): ExecutionRoutingDecisionReference {
  return {
    routingDecisionId: id,
    resolverVersion: "resolver-1",
    routingPolicyVersion: "policy-1",
    provider: "test",
    model: "deterministic",
    reason: "recovery",
    ...(fallbackFromAttemptId === undefined ? {} : { fallbackFromAttemptId }),
  };
}

function task() {
  return createGenerationTask({
    id: "task-recovery",
    novelId: "novel-recovery",
    operation: "scene_generation",
    targetSceneId: "scene-1",
    intent: "Generate scene",
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-1:r1"),
    }),
    createdAt: now,
  });
}

function setup() {
  const persistence = createInMemoryExecutionRecoveryPersistence();
  const revision = createRunPlanRevision({
    id: "run-plan-recovery:r1",
    planId: "run-plan-recovery",
    novelId: "novel-recovery",
    revisionNumber: 1,
    goal: "Recover execution",
    steps: [{ id: "step-a", ordinal: 1, generationTaskId: "task-recovery", dependsOn: [] }],
    createdAt: now,
  });
  const approval = createRunPlanApproval({
    id: "approval-recovery:r1",
    revision,
    approvedBy: "author-1",
    approvedAt: now,
  });
  expect(approveRunPlanRevision(approval, revision)).toBe(true);
  const run = startProductionRun(
    approveProductionRun(planProductionRun(createProductionRun({
      id: "run-recovery",
      novelId: revision.novelId,
      runPlanRevision: revision,
      createdAt: now,
    }), now), approval, now),
    now,
  );
  const scheduled = scheduleProductionRunAttempt({
    run,
    runPlanRevision: revision,
    generationTask: task(),
    stepId: "step-a",
    executionKey: "execution-recovery",
    routingDecision: routing("routing-initial"),
    createdAt: now,
  });
  return { persistence, revision, run, scheduled };
}

async function persistFailedAttemptHistory(
  persistence: ExecutionRecoveryPersistence,
  scheduledAttempt: ReturnType<typeof scheduleProductionRunAttempt>["attempt"],
) {
  const startedAttempt = startExecutionAttempt(scheduledAttempt, now);
  const failedAttempt = failExecutionAttempt({
    attempt: startedAttempt,
    failure: { code: "provider_error", message: "unavailable", retryable: true },
    failedAt: later,
  });
  await persistence.transaction.run(async (work) => {
    await work.attempts.saveRevisionIfAbsent(scheduledAttempt);
    await work.attempts.saveRevisionIfAbsent(startedAttempt);
    await work.attempts.saveIfCurrent(scheduledAttempt.currentRevisionId, startedAttempt);
    await work.attempts.saveRevisionIfAbsent(failedAttempt);
    await work.attempts.saveIfCurrent(startedAttempt.currentRevisionId, failedAttempt);
  });
  return failedAttempt;
}

describe("[task:4.3-4.4] Execution failure, retry, fallback, and recovery", () => {
  it("[domain] same-task retry creates a new Attempt while retaining predecessor history", async () => {
    const { persistence, revision, run, scheduled } = setup();
    const failed = await failScheduledExecution({
      persistence,
      run: scheduled.run,
      stepId: "step-a",
      createdAttempt: scheduled.attempt,
      startedAt: now,
      failure: { code: "provider_error", message: "unavailable", retryable: true },
      failedAt: later,
    });
    const retried = await retryFailedExecution({
      persistence,
      run: failed.run,
      runPlanRevision: revision,
      generationTask: task(),
      stepId: "step-a",
      previousAttempt: failed.attempt,
      executionKey: "execution-retry",
      routingDecision: routing("routing-retry"),
      createdAt: latest,
    });

    expect(retried.attempt.id).not.toBe(failed.attempt.id);
    expect(retried.attempt.relation).toBe("retry");
    expect(retried.attempt.generationTaskId).toBe("task-recovery");
    expect(retried.attempt.predecessorAttemptReference?.identity).toBe(failed.attempt.id);
    expect((await persistence.attempts.findById(failed.attempt.id))?.status).toBe("failed");
    expect(retried.run.stepStates[0]?.attemptIds).toEqual([
      scheduled.attempt.id,
      retried.attempt.id,
    ]);
    expect(run.stepStates[0]?.attemptIds).toEqual([]);
  });

  it("[integration] fallback creates a new routing decision and Attempt for the same task", async () => {
    const { persistence, revision, scheduled } = setup();
    const failed = await failScheduledExecution({
      persistence,
      run: scheduled.run,
      stepId: "step-a",
      createdAttempt: scheduled.attempt,
      startedAt: now,
      failure: { code: "provider_error", message: "unavailable", retryable: true },
      failedAt: later,
    });
    const fallback = await fallbackFailedExecution({
      persistence,
      run: failed.run,
      runPlanRevision: revision,
      generationTask: task(),
      stepId: "step-a",
      previousAttempt: failed.attempt,
      executionKey: "execution-fallback",
      routingDecision: routing("routing-fallback", failed.attempt.id),
      createdAt: latest,
    });

    expect(fallback.attempt.relation).toBe("fallback");
    expect(fallback.attempt.routingDecision.routingDecisionId).toBe("routing-fallback");
    expect(fallback.attempt.routingDecision.routingDecisionId).not.toBe(
      failed.attempt.routingDecision.routingDecisionId,
    );
    expect(fallback.attempt.generationTaskId).toBe(failed.attempt.generationTaskId);
    expect(fallback.attempt.predecessorAttemptReference?.identity).toBe(failed.attempt.id);
  });

  it("[persistence] persists created, running, and failed Attempt revisions with run outcome", async () => {
    const { persistence, scheduled } = setup();
    const failed = await failScheduledExecution({
      persistence,
      run: scheduled.run,
      stepId: "step-a",
      createdAttempt: scheduled.attempt,
      startedAt: now,
      failure: { code: "provider_error", message: "unavailable", retryable: true },
      failedAt: later,
      retryReason: "retry after outage",
    });

    expect(failed.attempt.status).toBe("failed");
    expect(failed.attempt.retryReason).toBe("retry after outage");
    expect(await persistence.attempts.getRevision(scheduled.attempt.id, scheduled.attempt.currentRevisionId)).toBeDefined();
    expect(await persistence.attempts.getRevision(scheduled.attempt.id, `${scheduled.attempt.id}:running`)).toBeDefined();
    expect((await persistence.attempts.findById(failed.attempt.id))?.currentRevisionId).toBe(failed.attempt.currentRevisionId);
    expect(failed.run.stepStates[0]?.status).toBe("failed");
    expect((await persistence.runs.findById(failed.run.id))?.currentRevisionId).toBe(
      failed.run.currentRevisionId,
    );
  });

  it("[transaction] leaves no half-written Attempt or Run outcome when run persistence fails", async () => {
    const base = createInMemoryExecutionRecoveryPersistence();
    const initial = setup();
    await base.runs.saveRevisionIfAbsent(initial.scheduled.run);
    const failing: ExecutionRecoveryPersistence = {
      ...base,
      transaction: {
        run: (work) => base.transaction.run(async (transactionWork) => work({
          ...transactionWork,
          runs: new Proxy(transactionWork.runs, {
            get(target, property, receiver) {
              if (property === "saveRevisionIfAbsent") {
                return async () => {
                  throw new Error("injected run persistence failure");
                };
              }
              const value = Reflect.get(target, property, receiver);
              return typeof value === "function" ? value.bind(target) : value;
            },
          }),
        })),
      },
    };

    await expect(failScheduledExecution({
      persistence: failing,
      run: initial.scheduled.run,
      stepId: "step-a",
      createdAttempt: initial.scheduled.attempt,
      startedAt: now,
      failure: { code: "provider_error", message: "unavailable", retryable: true },
      failedAt: later,
    })).rejects.toThrow("injected run persistence failure");

    expect(await failing.attempts.findById(initial.scheduled.attempt.id)).toBeUndefined();
    expect((await failing.runs.findById(initial.scheduled.run.id))?.status).toBe("running");
  });

  it("[concurrency] lets only one recovery revision win and returns the same current state", async () => {
    const { persistence, scheduled } = setup();
    const failedAttempt = await persistFailedAttemptHistory(persistence, scheduled.attempt);

    const [left, right] = await Promise.all([
      recoverProductionRunExecution({
        persistence,
        run: scheduled.run,
        stepId: "step-a",
        recoveredAt: latest,
      }),
      recoverProductionRunExecution({
        persistence,
        run: scheduled.run,
        stepId: "step-a",
        recoveredAt: final,
      }),
    ]);

    expect(left.attempt).toEqual(failedAttempt);
    expect(left.run.currentRevisionId).toBe(right.run.currentRevisionId);
    expect((await persistence.runs.findById(scheduled.run.id))?.currentRevisionId).toBe(
      left.run.currentRevisionId,
    );
  });

  it("[recovery] reconciles terminal Attempt state once and is idempotent afterward", async () => {
    const { persistence, scheduled } = setup();
    const failedAttempt = await persistFailedAttemptHistory(persistence, scheduled.attempt);

    const recovered = await recoverProductionRunExecution({
      persistence,
      run: scheduled.run,
      stepId: "step-a",
      recoveredAt: latest,
    });
    const repeated = await recoverProductionRunExecution({
      persistence,
      run: recovered.run,
      stepId: "step-a",
      recoveredAt: final,
    });

    expect(recovered.run.stepStates[0]?.status).toBe("failed");
    expect(repeated.run).toEqual(recovered.run);
    expect(repeated.attempt).toEqual(failedAttempt);
  });

  it("[replay] retains prior run revisions and stable failure evidence", async () => {
    const { persistence, scheduled } = setup();
    const failed = await failScheduledExecution({
      persistence,
      run: scheduled.run,
      stepId: "step-a",
      createdAttempt: scheduled.attempt,
      startedAt: now,
      failure: { code: "provider_error", message: "unavailable", retryable: true },
      failedAt: later,
    });

    expect(await persistence.runs.getRevision(scheduled.run.id, scheduled.run.currentRevisionId))
      .toEqual(scheduled.run);
    expect(await persistence.runs.getRevision(failed.run.id, failed.run.currentRevisionId))
      .toEqual(failed.run);
    expect((await persistence.attempts.findById(failed.attempt.id))?.failureEvidence?.data)
      .toMatchObject({
        code: "provider_error",
        occurredAt: { iso: later.toISOString(), epochMilliseconds: later.getTime() },
      });
  });

  it("[cross-system] reuses Task 2.1 Attempt and Task 4.2 Run without a second core system", async () => {
    const { persistence, revision, scheduled } = setup();
    const failed = await failScheduledExecution({
      persistence,
      run: scheduled.run,
      stepId: "step-a",
      createdAttempt: scheduled.attempt,
      startedAt: now,
      failure: { code: "provider_error", message: "unavailable", retryable: true },
      failedAt: later,
    });

    expect(Object.prototype.hasOwnProperty.call(failed.run, "generationTasks")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(failed.attempt, "candidateIds")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(failed.attempt, "reviewDecisions")).toBe(false);
    const retried = await retryFailedExecution({
      persistence,
      run: failed.run,
      runPlanRevision: revision,
      generationTask: task(),
      stepId: "step-a",
      previousAttempt: failed.attempt,
      executionKey: "execution-cross-system",
      routingDecision: routing("routing-cross-system"),
      createdAt: latest,
    });
    expect(retried.attempt.novelId).toBe("novel-recovery");
  });

  it("[regression] failed work has no candidate/commit half state and never rewrites history", async () => {
    const { persistence, scheduled } = setup();
    const before = structuredClone(scheduled.attempt);
    const failed = await failScheduledExecution({
      persistence,
      run: scheduled.run,
      stepId: "step-a",
      createdAttempt: scheduled.attempt,
      startedAt: now,
      failure: { code: "provider_error", message: "unavailable", retryable: true },
      failedAt: later,
    });

    expect(failed.attempt.candidateReference).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(failed.attempt, "narrativeCommit")).toBe(false);
    expect(await persistence.attempts.getRevision(before.id, before.currentRevisionId))
      .toEqual(scheduled.attempt);
    expect(before.currentRevisionId).toBe(`${before.id}:created`);
    expect(failed.attempt.currentRevisionId).toBe(`${failed.attempt.id}:failed`);
  });
});
