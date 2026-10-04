import { describe, expect, it } from "vitest";
import {
  approveRunPlanRevision,
  createRunPlanApproval,
  createRunPlanRevision,
  type RunPlanStep,
} from "../../src/production/domain/runPlan";
import {
  approveProductionRun,
  cancelProductionRun,
  completeProductionRun,
  createProductionRun,
  failProductionRun,
  nextRunnableProductionRunStep,
  pauseProductionRun,
  planProductionRun,
  resumeProductionRun,
  startProductionRun,
  waitForHumanProductionRun,
} from "../../src/production/domain/productionRun";

const now = new Date("2026-10-04T10:00:00.000Z");
const later = new Date("2026-10-04T10:01:00.000Z");
const steps: readonly RunPlanStep[] = [
  { id: "step-a", ordinal: 1, generationTaskId: "task-a", dependsOn: [] },
  { id: "step-b", ordinal: 2, generationTaskId: "task-b", dependsOn: ["step-a"] },
];

function plan() {
  return createRunPlanRevision({
    id: "run-plan-4142:r1",
    planId: "run-plan-4142",
    novelId: "novel-run-4142",
    revisionNumber: 1,
    goal: "Generate a chapter",
    steps,
    createdAt: now,
  });
}

function approvedRun() {
  const revision = plan();
  const approval = createRunPlanApproval({
    id: "run-plan-4142:approval:r1",
    revision,
    approvedBy: "author-1",
    approvedAt: now,
  });
  expect(approveRunPlanRevision(approval, revision)).toBe(true);
  return approveProductionRun(
    planProductionRun(createProductionRun({
      id: "run-4142",
      novelId: revision.novelId,
      runPlanRevision: revision,
      createdAt: now,
    }), now),
    approval,
    later,
  );
}

describe("[task:4.1-4.2] [domain] Production Run lifecycle and ordering", () => {
  it("moves Draft through Planned and Approved only against an approved plan revision", () => {
    const revision = plan();
    const draft = createProductionRun({
      id: "run-4142",
      novelId: revision.novelId,
      runPlanRevision: revision,
      createdAt: now,
    });
    const planned = planProductionRun(draft, now);
    const approval = createRunPlanApproval({
      id: "run-plan-4142:approval:r1",
      revision,
      approvedBy: "author-1",
      approvedAt: now,
    });

    expect(draft.status).toBe("draft");
    expect(planned.status).toBe("planned");
    expect(planned.planRevisionReference).toEqual({
      identity: revision.planId,
      version: revision.id,
      hash: revision.contentHash,
    });
    expect(() => approveProductionRun(planned, { ...approval, approvedBy: "other" }, later)).toThrow(
      "Run Plan approval does not match the referenced revision",
    );
    expect(approveProductionRun(planned, approval, later).status).toBe("approved");
  });

  it("supports pause, human waiting, resume, completion, failure, and cancellation", () => {
    const running = startProductionRun(approvedRun(), later);
    const paused = pauseProductionRun(running, later, "operator pause");
    const resumed = resumeProductionRun(paused, later);
    const waiting = waitForHumanProductionRun(resumed, later, "author decision");
    const resumedAgain = resumeProductionRun(waiting, later);

    expect(running.status).toBe("running");
    expect(paused.status).toBe("paused");
    expect(waiting.status).toBe("waiting_for_human");
    expect(resumedAgain.status).toBe("running");
    const succeeded = {
      ...resumedAgain,
      stepStates: resumedAgain.stepStates.map((state) => ({ ...state, status: "succeeded" as const })),
    };
    expect(completeProductionRun(succeeded, later).status).toBe("completed");
    expect(failProductionRun(resumedAgain, later, "runtime failure").status).toBe("failed");
    expect(cancelProductionRun(resumedAgain, later, "operator cancel").status).toBe("cancelled");
  });

  it("rejects completion while planned work remains", () => {
    const running = startProductionRun(approvedRun(), later);

    expect(() => completeProductionRun(running, later)).toThrow(
      "all plan steps must succeed before completion",
    );
    expect(running.status).toBe("running");
  });
  it("rejects invalid and backward lifecycle transitions without mutating the source run", () => {
    const draft = createProductionRun({
      id: "run-invalid",
      novelId: "novel-run-4142",
      runPlanRevision: plan(),
      createdAt: now,
    });
    const running = startProductionRun(approvedRun(), later);

    expect(() => startProductionRun(draft, later)).toThrow("Only an approved run can start");
    expect(() => pauseProductionRun(draft, later, "invalid")).toThrow("Only a running run can pause");
    expect(() => resumeProductionRun(running, later)).toThrow(
      "Only a paused or waiting run can resume",
    );
    expect(() => cancelProductionRun(cancelProductionRun(running, later, "first"), later, "second")).toThrow(
      "terminal run cannot transition",
    );
    expect(running.status).toBe("running");
    expect(running.currentRevisionId).not.toBe(draft.currentRevisionId);
  });

  it("selects only dependency-ready plan steps in ordinal order", () => {
    const planned = planProductionRun(createProductionRun({
      id: "run-ordering",
      novelId: "novel-run-4142",
      runPlanRevision: plan(),
      createdAt: now,
    }), now);

    expect(nextRunnableProductionRunStep(planned)?.stepId).toBe("step-a");
    const afterFirst = {
      ...planned,
      revisionNumber: planned.revisionNumber + 1,
      currentRevisionId: `${planned.id}:step-a:${planned.revisionNumber + 1}`,
      stepStates: planned.stepStates.map((state) =>
        state.stepId === "step-a" ? { ...state, status: "succeeded" as const } : state,
      ),
    };
    expect(nextRunnableProductionRunStep(afterFirst)?.stepId).toBe("step-b");
    expect(() => nextRunnableProductionRunStep({
      ...planned,
      stepStates: planned.stepStates.map((state) =>
        state.stepId === "step-b" ? { ...state, status: "succeeded" as const } : state,
      ),
    })).toThrow("step states must satisfy dependencies");
  });
});
