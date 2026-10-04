import { describe, expect, it } from "vitest";
import {
  approveRunPlanRevision,
  createRunPlanApproval,
  createRunPlanRevision,
  nextRunnableRunPlanStep,
  reviseRunPlanRevision,
  runPlanRevisionSourceReference,
  type RunPlanStep,
} from "../../src/production/domain/runPlan";

const now = new Date("2026-10-04T08:00:00.000Z");
const later = new Date("2026-10-04T09:00:00.000Z");

function steps(): readonly RunPlanStep[] {
  return [
    { id: "step-a", ordinal: 1, generationTaskId: "task-a", dependsOn: [] },
    { id: "step-b", ordinal: 2, generationTaskId: "task-b", dependsOn: ["step-a"] },
    { id: "step-c", ordinal: 3, generationTaskId: "task-c", dependsOn: ["step-a", "step-b"] },
  ];
}

function revision(id = "plan-4142:r1", revisionNumber = 1) {
  return createRunPlanRevision({
    id,
    planId: "plan-4142",
    novelId: "novel-4142",
    revisionNumber,
    goal: "Produce the next chapter",
    steps: steps(),
    createdAt: now,
    ...(revisionNumber === 1 ? {} : { parentRevisionId: "plan-4142:r1" }),
  });
}

describe("[task:4.1-4.2] [domain] Run Plan immutable approved baseline", () => {
  it("freezes an approved revision and requires a new revision for changed work", () => {
    const source = revision();
    const changed = reviseRunPlanRevision({
      sourceRevision: source,
      revisionId: "plan-4142:r2",
      revisionNumber: 2,
      goal: "Produce the next chapter with a new constraint",
      steps: steps(),
      revisedAt: later,
    });

    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.steps[0])).toBe(true);
    expect(source.goal).toBe("Produce the next chapter");
    expect(changed.id).toBe("plan-4142:r2");
    expect(changed.parentRevisionId).toBe(source.id);
    expect(changed.revisionNumber).toBe(2);
    expect(changed.contentHash).not.toBe(source.contentHash);
    expect(runPlanRevisionSourceReference(changed)).toEqual({
      identity: changed.planId,
      version: changed.id,
      hash: changed.contentHash,
    });
  });

  it("binds approval to the exact revision content", () => {
    const source = revision();
    const changed = reviseRunPlanRevision({
      sourceRevision: source,
      revisionId: "plan-4142:r2",
      revisionNumber: 2,
      goal: "Changed goal",
      steps: steps(),
      revisedAt: later,
    });
    const approval = createRunPlanApproval({
      id: "approval-plan-4142-r1",
      revision: source,
      approvedBy: "author-1",
      approvedAt: later,
    });

    expect(approveRunPlanRevision(approval, source)).toBe(true);
    expect(approveRunPlanRevision(approval, changed)).toBe(false);
    expect(Object.isFrozen(approval)).toBe(true);
  });

  it("orders runnable work by ordinal and dependency completion", () => {
    const source = revision();

    expect(nextRunnableRunPlanStep(source, [])?.id).toBe("step-a");
    expect(nextRunnableRunPlanStep(source, ["step-a"])?.id).toBe("step-b");
    expect(nextRunnableRunPlanStep(source, ["step-a", "step-b"])?.id).toBe("step-c");
    expect(nextRunnableRunPlanStep(source, ["step-a", "step-b", "step-c"])).toBeUndefined();
    expect(() => nextRunnableRunPlanStep(source, ["step-b"])).toThrow(
      "completed steps must satisfy dependencies",
    );
  });

  it("rejects ambiguous ordering and unknown dependencies", () => {
    expect(() => createRunPlanRevision({
      id: "bad-r1",
      planId: "bad",
      novelId: "novel-bad",
      revisionNumber: 1,
      goal: "Bad plan",
      steps: [
        { id: "a", ordinal: 1, generationTaskId: "task-a", dependsOn: [] },
        { id: "b", ordinal: 1, generationTaskId: "task-b", dependsOn: [] },
      ],
      createdAt: now,
    })).toThrow("step ordinals must be strictly increasing");

    expect(() => createRunPlanRevision({
      id: "bad-r2",
      planId: "bad",
      novelId: "novel-bad",
      revisionNumber: 1,
      goal: "Bad plan",
      steps: [{ id: "a", ordinal: 1, generationTaskId: "task-a", dependsOn: ["missing"] }],
      createdAt: now,
    })).toThrow("unknown dependency: missing");
  });
});
