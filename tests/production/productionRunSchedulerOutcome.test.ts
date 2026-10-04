import { describe, expect, it } from "vitest";
import { createInMemoryRunOrchestrationPersistence } from "../../src/production/application/runPlanPersistence";
import {
  saveProductionRun,
  saveRunPlanApproval,
  saveRunPlanRevision,
} from "../../src/production/application/runPlanService";
import {
  recordProductionRunAttemptOutcome,
  scheduleProductionRunAttempt,
} from "../../src/production/application/productionRunScheduler";
import {
  approveProductionRun,
  createProductionRun,
  planProductionRun,
  startProductionRun,
} from "../../src/production/domain/productionRun";
import {
  approveRunPlanRevision,
  createRunPlanApproval,
  createRunPlanRevision,
} from "../../src/production/domain/runPlan";
import {
  completeExecutionAttempt,
  startExecutionAttempt,
} from "../../src/production/domain/executionAttempt";
import { createGenerationTask } from "../../src/production/domain/generationTask";
import type { RuntimeRequest, RuntimeResult } from "../../src/production/runtime/runtimeAdapter";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-04T12:00:00.000Z");
const later = new Date("2026-10-04T12:01:00.000Z");

function task(id: string) {
  return createGenerationTask({
    id,
    novelId: "novel-scheduler-outcome",
    operation: "scene_generation",
    targetSceneId: "scene-1",
    intent: "Generate scene",
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-1:r1"),
    }),
    createdAt: now,
  });
}

function runtime(taskId: string): { request: RuntimeRequest; result: RuntimeResult } {
  const modelPolicy = {
    provider: "test",
    model: "deterministic",
    maxOutputTokens: 100,
  };
  const requestedChange = { type: "text" as const, sceneId: "scene-1", text: `Text ${taskId}` };
  return {
    request: {
      taskId,
      agentRole: "writer",
      modelPolicy,
      basedOnVersionSet: task(taskId).basedOnVersionSet,
      context: {},
      requestedChange,
    },
    result: {
      taskId,
      agentRole: "writer",
      modelPolicy,
      change: requestedChange,
      basedOnVersionSet: task(taskId).basedOnVersionSet,
    },
  };
}

function routing(id: string) {
  return {
    routingDecisionId: id,
    resolverVersion: "resolver-1",
    routingPolicyVersion: "policy-1",
    provider: "test",
    model: "deterministic",
    reason: "scheduled",
  };
}

describe("[task:4.1-4.2] [integration] Production Run attempt outcome scheduling", () => {
  it("advances dependency order only after the scheduled GenerationTask attempt succeeds", async () => {
    const persistence = createInMemoryRunOrchestrationPersistence();
    const revision = createRunPlanRevision({
      id: "run-plan-outcome:r1",
      planId: "run-plan-outcome",
      novelId: "novel-scheduler-outcome",
      revisionNumber: 1,
      goal: "Run ordered tasks",
      steps: [
        { id: "step-a", ordinal: 1, generationTaskId: "task-a", dependsOn: [] },
        { id: "step-b", ordinal: 2, generationTaskId: "task-b", dependsOn: ["step-a"] },
      ],
      createdAt: now,
    });
    const planApproval = createRunPlanApproval({
      id: "approval-outcome:r1",
      revision,
      approvedBy: "author-1",
      approvedAt: now,
    });
    expect(approveRunPlanRevision(planApproval, revision)).toBe(true);
    await saveRunPlanRevision(persistence, revision);
    await saveRunPlanApproval(persistence, planApproval);

    const draft = createProductionRun({
      id: "run-outcome",
      novelId: revision.novelId,
      runPlanRevision: revision,
      createdAt: now,
    });
    const planned = planProductionRun(draft, now);
    const approved = approveProductionRun(planned, planApproval, now);
    const running = startProductionRun(approved, now);

    const first = scheduleProductionRunAttempt({
      run: running,
      runPlanRevision: revision,
      generationTask: task("task-a"),
      stepId: "step-a",
      executionKey: "execution-outcome-a",
      routingDecision: routing("routing-outcome-a"),
      createdAt: now,
    });
    expect(() => scheduleProductionRunAttempt({
      run: first.run,
      runPlanRevision: revision,
      generationTask: task("task-b"),
      stepId: "step-b",
      executionKey: "execution-outcome-b",
      routingDecision: routing("routing-outcome-b"),
      createdAt: later,
    })).toThrow("step is not runnable");

    const execution = runtime("task-a");
    const succeeded = completeExecutionAttempt({
      attempt: startExecutionAttempt(first.attempt, now),
      runtimeRequest: execution.request,
      runtimeResult: execution.result,
      completedAt: later,
    });
    const advanced = recordProductionRunAttemptOutcome({
      run: first.run,
      stepId: "step-a",
      attempt: succeeded,
      at: later,
    });
    const second = scheduleProductionRunAttempt({
      run: advanced,
      runPlanRevision: revision,
      generationTask: task("task-b"),
      stepId: "step-b",
      executionKey: "execution-outcome-b",
      routingDecision: routing("routing-outcome-b"),
      createdAt: later,
    });

    expect(advanced.stepStates.map((state) => state.status)).toEqual(["succeeded", "pending"]);
    expect(second.generationTask.id).toBe("task-b");
    expect(second.attempt.generationTaskId).toBe("task-b");
    await saveProductionRun(persistence, second.run, advanced);
    expect((await persistence.runs.findById(second.run.id))?.currentRevisionId).toBe(
      second.run.currentRevisionId,
    );
  });
});
