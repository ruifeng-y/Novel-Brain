import { describe, expect, it } from "vitest";
import { createProductSurfaceCommandService } from "../../src/app/productSurfaceCommandService";
import { createInMemoryNarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";
import { createInMemoryRunOrchestrationPersistence } from "../../src/production/application/runPlanPersistence";
import { createInMemoryAttentionDispositionPersistence } from "../../src/recall/attention/attentionDispositionPersistence";
import { isValidRunPlanApproval } from "../../src/production/domain/runPlan";

function surface() {
  return createProductSurfaceCommandService({
    foundationPersistence: createInMemoryNarrativeProposalPersistence(),
    runPersistence: createInMemoryRunOrchestrationPersistence(),
    attentionPersistence: createInMemoryAttentionDispositionPersistence(),
  });
}

function runPlanInput() {
  return {
    id: "plan-revision-1",
    planId: "plan-1",
    novelId: "novel-1",
    revisionNumber: 1,
    goal: "Draft the opening arc",
    steps: [
      { id: "step-1", ordinal: 1, generationTaskId: "generation-task-1", dependsOn: [] },
    ],
    createdAt: new Date("2026-10-05T00:00:00.000Z"),
  };
}

describe("[task:R8] [domain] run plan approval product surface", () => {
  it("approves a plan revision and then starts a run against it", async () => {
    const service = surface();
    const revision = await service.createRunPlanRevision(runPlanInput());

    const approval = await service.approveRunPlan({
      approvalId: "approval-1",
      planRevisionId: revision.id,
      approvedBy: "author-1",
      approvedAt: new Date("2026-10-05T00:00:00.000Z"),
      evidenceReferences: ["generation-task-1"],
    });

    expect(isValidRunPlanApproval(approval)).toBe(true);
    expect(approval.novelId).toBe("novel-1");
    expect(approval.planRevisionReference.version).toBe(revision.id);

    const started = await service.startRun({
      id: "run-1",
      novelId: revision.novelId,
      runPlanRevision: revision,
      createdAt: new Date("2026-10-05T00:00:01.000Z"),
    });

    expect(started.run.status).toBe("running");
    expect(started.stateBoundary.ownsNarrativeTruth).toBe(false);
  });

  it("refuses to start a run for a plan revision that has no approval", async () => {
    const service = surface();
    const revision = await service.createRunPlanRevision(runPlanInput());

    await expect(
      service.startRun({
        id: "run-2",
        novelId: revision.novelId,
        runPlanRevision: revision,
        createdAt: new Date("2026-10-05T00:00:01.000Z"),
      }),
    ).rejects.toThrow(/not approved/);
  });

  it("refuses to approve a plan revision without evidence references", async () => {
    const service = surface();
    const revision = await service.createRunPlanRevision(runPlanInput());

    await expect(
      service.approveRunPlan({
        approvalId: "approval-no-evidence",
        planRevisionId: revision.id,
        approvedBy: "author-1",
        approvedAt: new Date("2026-10-05T00:00:00.000Z"),
        evidenceReferences: [],
      }),
    ).rejects.toThrow(/evidence/);
  });

  it("refuses to approve a plan revision that was never persisted", async () => {
    const service = surface();

    await expect(
      service.approveRunPlan({
        approvalId: "approval-unknown",
        planRevisionId: "missing-revision",
        approvedBy: "author-1",
        approvedAt: new Date("2026-10-05T00:00:00.000Z"),
        evidenceReferences: ["evidence-1"],
      }),
    ).rejects.toThrow(/not found/i);
  });
});
