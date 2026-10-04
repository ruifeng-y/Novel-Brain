import { describe, expect, it } from "vitest";
import {
  createRecallRunObservation,
  createRecallProposedAction,
  createRecallProposedGenerationTaskRequest,
  requestRecallRunPolicy,
  type RunPolicyRequestPort,
} from "../../src/recall/run/runAwareRecall";
import { createProductionRun, type ProductionRun } from "../../src/production/domain/productionRun";
import { pauseRunCheckpoint, type RunCheckpoint } from "../../src/production/domain/runCheckpoint";
import type { RunPlanRevision } from "../../src/production/domain/runPlan";

const planRevision = {
  id: "plan-rev-1",
  planId: "plan-1",
  novelId: "novel-1",
  revisionNumber: 1,
  goal: "run task 5.3-5.5",
  steps: [
    {
      id: "step-1",
      ordinal: 1,
      generationTaskId: "task-1",
      dependsOn: [],
    },
  ],
  contentHash: "plan-hash-1",
  createdAt: new Date("2026-10-05T00:00:00.000Z"),
} as unknown as RunPlanRevision;

const run: ProductionRun = createProductionRun({
  id: "run-1",
  novelId: "novel-1",
  runPlanRevision: planRevision,
  createdAt: new Date("2026-10-05T00:00:00.000Z"),
});

const checkpoint: RunCheckpoint = pauseRunCheckpoint({
  id: "checkpoint-1",
  runId: "run-1",
  novelId: "novel-1",
  triggerCategory: "risk",
  triggerReason: "checkpoint risk",
  evidenceReferences: ["run-checkpoint-evidence-1"],
  control: { kind: "human", actorId: "author-1" },
  pausedAt: new Date("2026-10-05T01:00:00.000Z"),
});

describe("[task:5.3-5.5] [cross-system] Run-aware Recall observation", () => {
  it("observes run and checkpoint evidence deterministically without mutating Run", () => {
    const before = structuredClone(run);
    const first = createRecallRunObservation({
      run,
      checkpoints: [checkpoint],
      observedAt: "2026-10-05T02:00:00.000Z",
    });
    const second = createRecallRunObservation({
      run,
      checkpoints: [checkpoint],
      observedAt: "2026-10-05T03:00:00.000Z",
    });

    expect(first.observationId).toBe("run:run-1:run-1:1:draft");
    expect(first.evidence.map((entry) => entry.evidenceReference)).toEqual([
      "ProductionRun:run-1",
      "RunCheckpoint:checkpoint-1",
    ]);
    expect(second.hash).toBe(first.hash);
    expect(run).toEqual(before);
    expect(Object.isFrozen(first)).toBe(true);
  });
});

describe("[task:5.3-5.5] [integration] proposed action policy boundary", () => {
  it("can only request normal Run policy and never creates task/domain/commit work", async () => {
    const requests: unknown[] = [];
    const port: RunPolicyRequestPort = {
      requestNormalRunPolicy: async (request) => {
        requests.push(request);
        return { requestId: request.requestId, status: "accepted" };
      },
    };
    const observation = createRecallRunObservation({
      run,
      checkpoints: [checkpoint],
      observedAt: "2026-10-05T02:00:00.000Z",
    });
    const action = createRecallProposedAction({
      observation,
      action: "checkpoint",
      reason: "review checkpoint risk",
      evidenceReferences: ["RunCheckpoint:checkpoint-1"],
      actorId: "recall",
      requestedAt: "2026-10-05T02:01:00.000Z",
    });
    const result = await requestRecallRunPolicy({ action, port });

    expect(result.blocking).toBe(false);
    expect(result.receipt.status).toBe("accepted");
    expect(requests).toHaveLength(1);
    expect(action.request).toMatchObject({
      kind: "normal_run_policy",
      requestType: "threshold_action",
      runId: "run-1",
      action: "checkpoint",
    });
    expect(JSON.stringify(action)).not.toContain("taskId");
    expect(JSON.stringify(action)).not.toContain("domainMutation");
    expect(JSON.stringify(action)).not.toContain("commitId");
    expect(JSON.stringify(result)).not.toContain("taskId");
  });

  it("submits a GenerationTask proposal only as a normal Run policy request", async () => {
    const requests: unknown[] = [];
    const port: RunPolicyRequestPort = {
      requestNormalRunPolicy: (request) => {
        requests.push(request);
        return { requestId: request.requestId, status: "queued" };
      },
    };
    const observation = createRecallRunObservation({
      run,
      checkpoints: [checkpoint],
      observedAt: "2026-10-05T02:00:00.000Z",
    });
    const proposal = {
      operation: "consistency_analysis",
      targetSceneId: "scene-1",
      intent: "check the current scene for unresolved consistency risks",
      basedOnVersionSet: {
        "Scene:scene-1": {
          aggregateType: "Scene",
          objectId: "scene-1",
          revisionId: "scene-rev-1",
        },
      },
    } as const;
    const action = createRecallProposedGenerationTaskRequest({
      observation,
      proposal,
      reason: "run checkpoint suggests a consistency analysis",
      evidenceReferences: ["RunCheckpoint:checkpoint-1"],
      actorId: "recall",
      requestedAt: "2026-10-05T02:01:00.000Z",
    });
    const result = await requestRecallRunPolicy({ action, port });

    expect(result.receipt.status).toBe("queued");
    expect(requests).toEqual([
      {
        kind: "normal_run_policy",
        requestType: "generation_task",
        requestId: action.request.requestId,
        runId: "run-1",
        proposal,
        reason: "run checkpoint suggests a consistency analysis",
        evidenceReferences: ["RunCheckpoint:checkpoint-1"],
        requestedBy: "recall",
        requestedAt: "2026-10-05T02:01:00.000Z",
        observationHash: observation.hash,
      },
    ]);
    expect(action).not.toHaveProperty("taskId");
    expect(action).not.toHaveProperty("execution");
    expect(action).not.toHaveProperty("candidate");
    expect(action).not.toHaveProperty("domainCommand");
    expect(action).not.toHaveProperty("commitCommand");
  });
});

describe("[task:5.3-5.5] [regression] Run-aware Recall non-authority", () => {
  it("keeps proposed actions optional and policy-only", () => {
    const observation = createRecallRunObservation({
      run,
      checkpoints: [],
      observedAt: "2026-10-05T02:00:00.000Z",
    });
    const action = createRecallProposedAction({
      observation,
      action: "ask",
      reason: "ask the author",
      evidenceReferences: ["ProductionRun:run-1"],
      actorId: "recall",
      requestedAt: "2026-10-05T02:01:00.000Z",
    });

    expect(action.request).toMatchObject({
      kind: "normal_run_policy",
      action: "ask",
    });
    expect(action).not.toHaveProperty("taskId");
    expect(action).not.toHaveProperty("domainCommand");
    expect(action).not.toHaveProperty("commitCommand");
  });
});
