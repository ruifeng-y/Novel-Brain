import { describe, expect, it } from "vitest";
import {
  createInMemoryRunOrchestrationPersistence,
} from "../../src/production/application/runPlanPersistence";
import {
  saveProductionRun,
  saveRunPlanApproval,
  saveRunPlanRevision,
} from "../../src/production/application/runPlanService";
import {
  cancelProductionRun,
  pauseProductionRun,
  resumeProductionRun,
} from "../../src/production/application/runLifecycleService";
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

const now = new Date("2026-10-04T13:00:00.000Z");
const later = new Date("2026-10-04T13:01:00.000Z");

describe("[task:4.1-4.2] [transaction] Production Run lifecycle application services", () => {
  it("persists pause, resume, and cancel transitions through the run history port", async () => {
    const persistence = createInMemoryRunOrchestrationPersistence();
    const revision = createRunPlanRevision({
      id: "run-plan-lifecycle:r1",
      planId: "run-plan-lifecycle",
      novelId: "novel-run-lifecycle",
      revisionNumber: 1,
      goal: "Lifecycle persistence",
      steps: [{ id: "step-a", ordinal: 1, generationTaskId: "task-a", dependsOn: [] }],
      createdAt: now,
    });
    const planApproval = createRunPlanApproval({
      id: "approval-lifecycle:r1",
      revision,
      approvedBy: "author-1",
      approvedAt: now,
    });
    expect(approveRunPlanRevision(planApproval, revision)).toBe(true);
    await saveRunPlanRevision(persistence, revision);
    await saveRunPlanApproval(persistence, planApproval);

    const draft = createProductionRun({
      id: "run-lifecycle",
      novelId: revision.novelId,
      runPlanRevision: revision,
      createdAt: now,
    });
    const planned = planProductionRun(draft, now);
    const approved = approveProductionRun(planned, planApproval, now);
    const running = await saveProductionRun(
      persistence,
      startProductionRun(approved, now),
      approved,
    );

    const paused = await pauseProductionRun(persistence, running.id, later, "operator pause");
    const resumed = await resumeProductionRun(persistence, running.id, later);
    const cancelled = await cancelProductionRun(persistence, running.id, later, "operator cancel");

    expect(paused.status).toBe("paused");
    expect(resumed.status).toBe("running");
    expect(cancelled.status).toBe("cancelled");
    expect((await persistence.runs.getRevision(running.id, paused.currentRevisionId))?.status).toBe(
      "paused",
    );
    expect((await persistence.runs.getRevision(running.id, cancelled.currentRevisionId))?.status).toBe(
      "cancelled",
    );
  });
});
