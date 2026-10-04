import { describe, expect, it } from "vitest";
import {
  createInMemoryRunOrchestrationPersistence,
  type RunOrchestrationPersistence,
} from "../../src/production/application/runPlanPersistence";
import {
  loadApprovedRunPlanRevision,
  saveProductionRun,
  saveRunPlanApproval,
  saveRunPlanRevision,
} from "../../src/production/application/runPlanService";
import {
  createRunPlanApproval,
  createRunPlanRevision,
  reviseRunPlanRevision,
  type RunPlanRevision,
} from "../../src/production/domain/runPlan";
import {
  approveProductionRun,
  cancelProductionRun,
  createProductionRun,
  pauseProductionRun,
  planProductionRun,
  startProductionRun,
} from "../../src/production/domain/productionRun";
import {
  scheduleProductionRunAttempt,
} from "../../src/production/application/productionRunScheduler";
import {
  createGenerationTask,
  startGenerationTask,
} from "../../src/production/domain/generationTask";
import {
  createFallbackExecutionAttempt,
  createRetryExecutionAttempt,
  failExecutionAttempt,
  startExecutionAttempt,
} from "../../src/production/domain/executionAttempt";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-04T11:00:00.000Z");
const later = new Date("2026-10-04T11:01:00.000Z");

function plan(id = "run-plan-app:r1", revisionNumber = 1, parentRevisionId?: string): RunPlanRevision {
  return createRunPlanRevision({
    id,
    planId: "run-plan-app",
    novelId: "novel-run-app",
    revisionNumber,
    ...(parentRevisionId === undefined ? {} : { parentRevisionId }),
    goal: "Run two generation tasks",
    steps: [
      { id: "step-a", ordinal: 1, generationTaskId: "task-a", dependsOn: [] },
      { id: "step-b", ordinal: 2, generationTaskId: "task-b", dependsOn: ["step-a"] },
    ],
    createdAt: now,
  });
}

function approval(revision = plan(), id = "approval-app:r1") {
  return createRunPlanApproval({ id, revision, approvedBy: "author-1", approvedAt: now });
}

function task(id = "task-a") {
  return createGenerationTask({
    id,
    novelId: "novel-run-app",
    operation: "scene_generation",
    targetSceneId: "scene-1",
    intent: "Generate the scene",
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-1:r1"),
    }),
    createdAt: now,
  });
}

function routing(id = "routing-app-1") {
  return {
    routingDecisionId: id,
    resolverVersion: "resolver-1",
    routingPolicyVersion: "policy-1",
    provider: "test",
    model: "deterministic",
    reason: "scheduled by run",
  };
}

async function approvedPersistence(): Promise<{
  persistence: RunOrchestrationPersistence;
  revision: RunPlanRevision;
  approval: ReturnType<typeof approval>;
}> {
  const persistence = createInMemoryRunOrchestrationPersistence();
  const revision = plan();
  const planApproval = approval(revision);
  await saveRunPlanRevision(persistence, revision);
  await saveRunPlanApproval(persistence, planApproval);
  return { persistence, revision, approval: planApproval };
}

async function runningRun(persistence: RunOrchestrationPersistence, revision: RunPlanRevision, planApproval: ReturnType<typeof approval>) {
  const draft = createProductionRun({
    id: "run-app",
    novelId: revision.novelId,
    runPlanRevision: revision,
    createdAt: now,
  });
  const planned = await saveProductionRun(persistence, planProductionRun(draft, now), draft);
  const approved = await saveProductionRun(
    persistence,
    approveProductionRun(planned, planApproval, now),
    planned,
  );
  return saveProductionRun(persistence, startProductionRun(approved, now), approved);
}

describe("[task:4.1-4.2] Run Plan baseline and Production Run scheduler application contracts", () => {
  it("[domain] keeps approved plan revisions immutable and requires a fresh approval for a new revision", async () => {
    const { persistence, revision } = await approvedPersistence();
    const changed = reviseRunPlanRevision({
      sourceRevision: revision,
      revisionId: "run-plan-app:r2",
      revisionNumber: 2,
      goal: "Changed production goal",
      steps: revision.steps,
      revisedAt: later,
    });

    await expect(saveRunPlanRevision(persistence, { ...revision, goal: "silent mutation" })).rejects.toThrow(
      "Run Plan Revision already exists with different content",
    );
    await saveRunPlanRevision(persistence, changed);
    await expect(loadApprovedRunPlanRevision(persistence, changed.id)).rejects.toThrow(
      "Run Plan Revision is not approved",
    );
    await saveRunPlanApproval(persistence, approval(changed, "approval-app:r2"));
    expect((await loadApprovedRunPlanRevision(persistence, changed.id)).id).toBe(changed.id);
  });

  it("[integration] persists run-to-plan identity across lifecycle replay", async () => {
    const { persistence, revision, approval: planApproval } = await approvedPersistence();
    const running = await runningRun(persistence, revision, planApproval);

    expect(running.planRevisionReference).toEqual({
      identity: revision.planId,
      version: revision.id,
      hash: revision.contentHash,
    });
    expect(await persistence.runs.findById(running.id)).toEqual(running);
    expect((await persistence.runs.getRevision(running.id, running.currentRevisionId))?.status).toBe(
      "running",
    );
  });

  it("[persistence] retains every lifecycle revision and rejects silent run mutation", async () => {
    const { persistence, revision, approval: planApproval } = await approvedPersistence();
    const running = await runningRun(persistence, revision, planApproval);
    const paused = pauseProductionRun(running, later, "pause");
    await saveProductionRun(persistence, paused, running);

    expect((await persistence.runs.getRevision(running.id, running.currentRevisionId))?.status).toBe("running");
    expect((await persistence.runs.getRevision(paused.id, paused.currentRevisionId))?.status).toBe("paused");
    await expect(
      saveProductionRun(persistence, { ...running, status: "cancelled" }, running),
    ).rejects.toThrow("Run revision already exists with different content");
  });

  it("[transaction] rolls back plan, approval, and run writes together", async () => {
    const persistence = createInMemoryRunOrchestrationPersistence();
    const revision = plan();
    await expect(persistence.transaction.run(async (work) => {
      await work.planRevisions.saveIfAbsent(revision);
      await work.planApprovals.saveIfAbsent(approval(revision));
      throw new Error("rollback run orchestration");
    })).rejects.toThrow("rollback run orchestration");

    expect(await persistence.planRevisions.findById(revision.id)).toBeUndefined();
    expect(await persistence.planApprovals.findById("approval-app:r1")).toBeUndefined();
  });

  it("[concurrency] preserves one winner for the same immutable plan revision", async () => {
    const persistence = createInMemoryRunOrchestrationPersistence();
    const results = await Promise.allSettled([
      saveRunPlanRevision(persistence, plan()),
      saveRunPlanRevision(persistence, { ...plan(), goal: "different goal" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await persistence.planRevisions.findById("run-plan-app:r1"))?.goal).toBe(
      "Run two generation tasks",
    );
  });

  it("[recovery] continues after a caught CAS conflict without losing history", async () => {
    const { persistence, revision, approval: planApproval } = await approvedPersistence();
    const running = await runningRun(persistence, revision, planApproval);
    const paused = pauseProductionRun(running, later, "pause");

    await expect(saveProductionRun(persistence, { ...paused, statusReason: "different" }, running))
      .rejects.toThrow("Run revision already exists with different content");
    await saveProductionRun(persistence, paused, running);
    expect(await persistence.runs.findById(running.id)).toEqual(paused);
    expect(await persistence.runs.getRevision(running.id, running.currentRevisionId)).toEqual(running);
  });

  it("[replay] returns stable immutable plan, approval, and run snapshots", async () => {
    const { persistence, revision, approval: planApproval } = await approvedPersistence();
    const first = await loadApprovedRunPlanRevision(persistence, revision.id);
    const second = await loadApprovedRunPlanRevision(persistence, revision.id);
    const running = await runningRun(persistence, revision, planApproval);
    const runFirst = await persistence.runs.findById(running.id);
    const runSecond = await persistence.runs.findById(running.id);

    expect(second).toEqual(first);
    expect(runSecond).toEqual(runFirst);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(planApproval)).toBe(true);
    expect(Object.isFrozen(runFirst)).toBe(true);
  });

  it("[cross-system] schedules existing GenerationTask and Task 2.1 Attempt identity without a second core system", async () => {
    const { persistence, revision, approval: planApproval } = await approvedPersistence();
    const running = await runningRun(persistence, revision, planApproval);
    const generationTask = task();
    const scheduled = scheduleProductionRunAttempt({
      run: running,
      runPlanRevision: revision,
      generationTask,
      stepId: "step-a",
      executionKey: "execution-app-4142",
      routingDecision: routing(),
      createdAt: later,
    });
    const predecessor = failExecutionAttempt({
      attempt: startExecutionAttempt(scheduled.attempt, later),
      failure: { code: "scheduled_failure", message: "retryable", retryable: true },
      failedAt: later,
    });
    const retry = scheduleProductionRunAttempt({
      run: scheduled.run,
      runPlanRevision: revision,
      generationTask: startGenerationTask(generationTask, later),
      stepId: "step-a",
      relation: "retry",
      previousAttempt: predecessor,
      executionKey: "execution-app-4142-retry",
      routingDecision: routing("routing-app-2"),
      createdAt: later,
    });
    const fallback = scheduleProductionRunAttempt({
      run: retry.run,
      runPlanRevision: revision,
      generationTask: startGenerationTask(generationTask, later),
      stepId: "step-a",
      relation: "fallback",
      previousAttempt: failExecutionAttempt({
        attempt: startExecutionAttempt(retry.attempt, later),
        failure: { code: "scheduled_failure", message: "fallback", retryable: true },
        failedAt: later,
      }),
      executionKey: "execution-app-4142-fallback",
      routingDecision: { ...routing("routing-app-3"), fallbackFromAttemptId: retry.attempt.id },
      createdAt: later,
    });

    expect(scheduled.attempt.id).toBe(
      createRetryExecutionAttempt({
        previousAttempt: predecessor,
        executionKey: "identity-check",
        attemptOrdinal: 2,
        routingDecision: routing("routing-identity-check"),
        createdAt: later,
      }).predecessorAttemptReference?.identity,
    );
    expect(retry.attempt.id).not.toBe(scheduled.attempt.id);
    expect(fallback.attempt.id).not.toBe(retry.attempt.id);
    expect(scheduled.generationTask).toBe(generationTask);
    expect(Object.prototype.hasOwnProperty.call(scheduled.run, "generationTasks")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(scheduled.attempt, "candidateIds")).toBe(false);
  });

  it("[cross-system] rejects a replacement Run Plan Revision before creating an Attempt", async () => {
    const { persistence, revision, approval: planApproval } = await approvedPersistence();
    const running = await runningRun(persistence, revision, planApproval);
    const replacement = reviseRunPlanRevision({
      sourceRevision: revision,
      revisionId: "run-plan-app:r2",
      revisionNumber: 2,
      goal: "Replacement plan",
      steps: revision.steps,
      revisedAt: later,
    });

    expect(() => scheduleProductionRunAttempt({
      run: running,
      runPlanRevision: replacement,
      generationTask: task(),
      stepId: "step-a",
      executionKey: "wrong-plan",
      routingDecision: routing("routing-wrong-plan"),
      createdAt: later,
    })).toThrow("Run Plan Revision does not match Production Run");
    expect(running.stepStates[0]?.attemptIds).toEqual([]);
  });

  it("[cross-system] rejects a GenerationTask from another novel before creating an Attempt", async () => {
    const { persistence, revision, approval: planApproval } = await approvedPersistence();
    const running = await runningRun(persistence, revision, planApproval);
    const wrongNovelTask = { ...task(), novelId: "another-novel" };

    expect(() => scheduleProductionRunAttempt({
      run: running,
      runPlanRevision: revision,
      generationTask: wrongNovelTask,
      stepId: "step-a",
      executionKey: "wrong-novel",
      routingDecision: routing("routing-wrong-novel"),
      createdAt: later,
    })).toThrow("GenerationTask novelId must match Run and Run Plan");
    expect(running.stepStates[0]?.attemptIds).toEqual([]);
  });
  it("[regression] enforces plan order and keeps pause and cancel from scheduling", async () => {
    const { persistence, revision, approval: planApproval } = await approvedPersistence();
    const running = await runningRun(persistence, revision, planApproval);

    expect(() => scheduleProductionRunAttempt({
      run: running,
      runPlanRevision: revision,
      generationTask: task("task-b"),
      stepId: "step-b",
      executionKey: "blocked",
      routingDecision: routing("routing-blocked"),
      createdAt: later,
    })).toThrow("step is not runnable");

    const paused = pauseProductionRun(running, later, "pause");
    expect(() => scheduleProductionRunAttempt({
      run: paused,
      runPlanRevision: revision,
      generationTask: task(),
      stepId: "step-a",
      executionKey: "paused",
      routingDecision: routing("routing-paused"),
      createdAt: later,
    })).toThrow("run must be running");

    const cancelled = cancelProductionRun(running, later, "cancel");
    await saveProductionRun(persistence, cancelled, running);
    expect((await persistence.runs.findById(cancelled.id))?.status).toBe("cancelled");
    expect(() => createFallbackExecutionAttempt({
      previousAttempt: failExecutionAttempt({
        attempt: startExecutionAttempt(createRetryExecutionAttempt({
        previousAttempt: failExecutionAttempt({
          attempt: startExecutionAttempt((scheduleProductionRunAttempt({
            run: running,
            runPlanRevision: revision,
            generationTask: task(),
            stepId: "step-a",
            executionKey: "identity-base",
            routingDecision: routing("routing-base"),
            createdAt: later,
          })).attempt, later),
          failure: { code: "scheduled_failure", message: "retryable", retryable: true },
          failedAt: later,
        }),
        executionKey: "identity-retry",
        attemptOrdinal: 2,
        routingDecision: routing("routing-retry"),
        createdAt: later,
      }), later),
        failure: { code: "scheduled_failure", message: "fallback", retryable: true },
        failedAt: later,
      }),
      executionKey: "identity-fallback",
      attemptOrdinal: 3,
      routingDecision: { ...routing("routing-fallback"), fallbackFromAttemptId: "wrong" },
      createdAt: later,
    })).toThrow("fallbackFromAttemptId must reference the predecessor attempt");
  });
});
