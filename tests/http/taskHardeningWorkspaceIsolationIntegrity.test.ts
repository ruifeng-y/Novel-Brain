import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createNovelBrainServer } from "../../src/http/server";
import {
  createHttpBoundaryPipeline,
  type HttpBoundaryContext,
  type HttpBoundaryPipeline,
} from "../../src/http/httpBoundaryPipeline";
import { createProductRequestValidators } from "../../src/http/productRequestSchemas";
import { createPlatformObservabilityBoundary } from "../../src/platform/observabilityBoundary";
import { createProductionSecurityBoundary } from "../../src/platform/productionSecurityProvider";
import { createNovel } from "../../src/narrative/novel/domain/novel";
import { createScene } from "../../src/manuscript/domain/scene";
import { createGenerationTask } from "../../src/production/domain/generationTask";
import { createCandidate } from "../../src/production/domain/candidate";
import { createRunPlanRevision } from "../../src/production/domain/runPlan";
import { createProductionRun } from "../../src/production/domain/productionRun";
import {
  saveProductionRun,
  saveRunPlanRevision,
} from "../../src/production/application/runPlanService";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import { hashContent } from "../../src/shared/domain/contentHash";

const now = new Date("2026-10-06T00:00:00.000Z");

const scopedWorkspaceId = "iso-novel-a";
const foreignWorkspaceId = "iso-novel-b";
const authorToken = "iso-author-token";
const principalSubjectId = "iso-author-1";

/**
 * Real production security boundary with a principal scoped to exactly one
 * workspace. Reads and writes in the second workspace must be unreachable.
 */
function harness() {
  const dependencies = createInMemoryEngineDependencies();
  const calls: string[] = [];
  const security = createProductionSecurityBoundary({
    NB_SECURITY_PRINCIPALS: JSON.stringify([
      {
        token: authorToken,
        subjectId: principalSubjectId,
        accountId: "account-1",
        workspaceIds: [scopedWorkspaceId],
        roles: ["author"],
      },
    ]),
    NB_SECURITY_RATE_LIMIT: "1000",
    NB_SECURITY_SECRETS: "{}",
  });
  const inner = createHttpBoundaryPipeline({
    security,
    observability: createPlatformObservabilityBoundary({
      sink: () => undefined,
      now: () => new Date(),
      idGenerator: () => "iso-event",
    }),
    validators: createProductRequestValidators(),
  });
  const pipeline: HttpBoundaryPipeline = {
    execute<TValue>(
      contractId: string,
      context: HttpBoundaryContext,
      input: unknown,
      handler: (validated: unknown) => Promise<TValue>,
    ): Promise<TValue> {
      calls.push(contractId);
      return inner.execute(contractId, context, input, handler);
    },
  };
  const app = createNovelBrainServer(dependencies, { httpBoundaryPipeline: pipeline });
  return { app, dependencies, calls };
}

const authorHeader = { "x-author-id": authorToken };
const scopedHeader = { "x-author-id": authorToken, "x-workspace-id": scopedWorkspaceId };

async function seedWorkspace(
  dependencies: ReturnType<typeof createInMemoryEngineDependencies>,
  workspaceId: string,
  suffix: string,
) {
  const sceneId = `scene-${suffix}`;
  await dependencies.novels.save(
    createNovel({
      id: workspaceId,
      authorId: authorToken,
      title: `Novel ${suffix}`,
      createdAt: now,
    }),
  );
  await dependencies.scenes.save(
    createScene({
      id: sceneId,
      novelId: workspaceId,
      chapterId: `chapter-${suffix}`,
      title: `Scene ${suffix}`,
      revisionId: `${sceneId}:rev-1`,
      commitId: `initial:${sceneId}`,
      createdAt: now,
    }),
  );
  await dependencies.generationTasks.save(
    createGenerationTask({
      id: `task-${suffix}`,
      novelId: workspaceId,
      operation: "scene_generation",
      targetSceneId: sceneId,
      intent: "Draft the scene",
      basedOnVersionSet: createVersionSet({
        scene: createVersionReference("Scene", sceneId, `${sceneId}:rev-1`),
      }),
      createdAt: now,
    }),
  );
}

function generationTaskPayload(id: string, sceneId: string) {
  return {
    id,
    operation: "scene_generation",
    targetSceneId: sceneId,
    intent: "Draft the scene",
    basedOnVersionSet: {
      scene: { aggregateType: "Scene", objectId: sceneId, revisionId: `${sceneId}:rev-1` },
    },
  };
}

function commitPayload(candidateId: string, sceneId: string) {
  return {
    commitId: `commit-${candidateId}`,
    changeSetRevisionId: `revision-${candidateId}`,
    candidateId,
    candidateSource: { version: "v1", hash: hashContent("candidate-source") },
    planVersionId: "plan-v1",
    validationId: `validation-${candidateId}`,
    mustPreserve: [],
    currentRevisionFacts: { unresolvedConflict: false, stale: false },
    targetInvariantViolations: [],
    requiredApproval: false,
    approvalScopeRequirements: [
      {
        approvalScope: {
          requirementDomain: "manuscript",
          targetType: "manuscript",
          objectId: sceneId,
        },
        requirement: "policy",
        requirementLevel: "not_required",
      },
    ],
    reviewDecision: {
      id: "review-1",
      decidedBy: "human",
      actorId: "iso-author-1",
      reason: "Approved",
      evidenceReferences: [],
    },
  };
}

describe("[task:Hardening-C] [integration] workspace isolation on the read path", () => {
  it("rejects a scoped workspace header that disagrees with the addressed novel", async () => {
    const { app, dependencies } = harness();
    await seedWorkspace(dependencies, scopedWorkspaceId, "a");
    await seedWorkspace(dependencies, foreignWorkspaceId, "b");

    const response = await app.inject({
      method: "GET",
      url: `/workspace/${foreignWorkspaceId}`,
      headers: scopedHeader,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("Forbidden");
  });

  it("allows a read in the scoped workspace when the header is omitted", async () => {
    const { app, calls } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/workspace/${scopedWorkspaceId}`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual(["foundation.query.workspace-focus"]);
  });

  it("allows a read when the header equals the derived identity", async () => {
    const { app } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/workspace/${scopedWorkspaceId}`,
      headers: scopedHeader,
    });

    expect(response.statusCode).toBe(200);
  });

  it("rejects a header naming another workspace while the derived identity is in scope", async () => {
    const { app } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/workspace/${scopedWorkspaceId}`,
      headers: { "x-author-id": authorToken, "x-workspace-id": foreignWorkspaceId },
    });

    expect(response.statusCode).toBe(403);
  });

  it("keeps a scoped principal out of another workspace when the header is omitted", async () => {
    const { app } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/workspace/${foreignWorkspaceId}`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().message).toContain("is not scoped to workspace");
  });
});

describe("[task:Hardening-C] [integration] workspace isolation on the write path", () => {
  it("rejects a write whose addressed novel disagrees with the scoped header and writes nothing", async () => {
    const { app, dependencies } = harness();
    await seedWorkspace(dependencies, scopedWorkspaceId, "a");
    await seedWorkspace(dependencies, foreignWorkspaceId, "b");

    const response = await app.inject({
      method: "POST",
      url: `/novels/${foreignWorkspaceId}/generation-tasks`,
      headers: scopedHeader,
      payload: generationTaskPayload("task-attack", "scene-b"),
    });

    expect(response.statusCode).toBe(403);
    expect(await dependencies.generationTasks.findById("task-attack")).toBeUndefined();
    expect(await dependencies.generationTasks.listByNovel(foreignWorkspaceId)).toHaveLength(1);
  });

  it("allows a write in the scoped workspace when the header is omitted", async () => {
    const { app, dependencies, calls } = harness();
    await seedWorkspace(dependencies, scopedWorkspaceId, "a");

    const response = await app.inject({
      method: "POST",
      url: `/novels/${scopedWorkspaceId}/generation-tasks`,
      headers: authorHeader,
      payload: generationTaskPayload("task-allowed-1", "scene-a"),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().novelId).toBe(scopedWorkspaceId);
    expect(await dependencies.generationTasks.findById("task-allowed-1")).toBeDefined();
    expect(calls).toEqual(["generation.command.create-generation-task"]);
  });

  it("allows a write when the header equals the derived identity", async () => {
    const { app, dependencies } = harness();
    await seedWorkspace(dependencies, scopedWorkspaceId, "a");

    const response = await app.inject({
      method: "POST",
      url: `/novels/${scopedWorkspaceId}/generation-tasks`,
      headers: scopedHeader,
      payload: generationTaskPayload("task-allowed-2", "scene-a"),
    });

    expect(response.statusCode).toBe(201);
  });

  it("rejects a foreign-workspace write when the header is omitted", async () => {
    const { app, dependencies } = harness();
    await seedWorkspace(dependencies, scopedWorkspaceId, "a");
    await seedWorkspace(dependencies, foreignWorkspaceId, "b");

    const response = await app.inject({
      method: "POST",
      url: `/novels/${foreignWorkspaceId}/generation-tasks`,
      headers: authorHeader,
      payload: generationTaskPayload("task-foreign", "scene-b"),
    });

    expect(response.statusCode).toBe(403);
    expect(await dependencies.generationTasks.findById("task-foreign")).toBeUndefined();
  });
});

describe("[task:Hardening-C] [integration] identity derived from a pre-loaded aggregate", () => {
  it("derives the candidate submission workspace from the loaded GenerationTask", async () => {
    const { app, dependencies } = harness();
    await seedWorkspace(dependencies, scopedWorkspaceId, "a");
    await seedWorkspace(dependencies, foreignWorkspaceId, "b");

    const response = await app.inject({
      method: "POST",
      url: "/generation-tasks/task-b/candidates",
      headers: scopedHeader,
      payload: {
        id: "candidate-attack",
        agentRole: "writer",
        modelPolicy: { provider: "reference", model: "reference-1", maxOutputTokens: 128 },
        change: { type: "text", sceneId: "scene-b", text: "Attacked text" },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(await dependencies.candidates.findById("candidate-attack")).toBeUndefined();
  });

  it("derives the commit workspace from the loaded Candidate", async () => {
    const { app, dependencies } = harness();
    await seedWorkspace(dependencies, foreignWorkspaceId, "b");
    await dependencies.candidates.save(
      createCandidate({
        id: "candidate-b",
        taskId: "task-b",
        novelId: foreignWorkspaceId,
        basedOnVersionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-b", "scene-b:rev-1"),
        }),
        change: { type: "text", sceneId: "scene-b", text: "Foreign text" },
        createdAt: now,
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/change-sets/change-set-b/commit",
      headers: scopedHeader,
      payload: commitPayload("candidate-b", "scene-b"),
    });

    expect(response.statusCode).toBe(403);
    expect(await dependencies.narrativeCommits.listByNovel(foreignWorkspaceId)).toEqual([]);
    expect(await dependencies.eventStore.listByNovel(foreignWorkspaceId)).toEqual([]);
  });

  it("derives the approval workspace from the loaded RunPlanRevision", async () => {
    const { app, dependencies } = harness();
    await seedWorkspace(dependencies, foreignWorkspaceId, "b");
    await saveRunPlanRevision(
      dependencies.product!.runPersistence,
      createRunPlanRevision({
        id: "plan-revision-b",
        planId: "plan-b",
        novelId: foreignWorkspaceId,
        revisionNumber: 1,
        goal: "Foreign plan",
        steps: [
          { id: "step-1", ordinal: 1, generationTaskId: "task-b", dependsOn: [] },
        ],
        createdAt: now,
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/run-plans/plan-revision-b/approvals",
      headers: scopedHeader,
      payload: {
        approvalId: "approval-attack",
        approvedBy: "iso-author-1",
        evidenceReferences: ["evidence-1"],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(
      await dependencies.product!.runPersistence.planApprovals.findById("approval-attack"),
    ).toBeUndefined();
  });

  it("derives the run transition workspace from the loaded ProductionRun", async () => {
    const { app, dependencies } = harness();
    await seedWorkspace(dependencies, foreignWorkspaceId, "b");
    const revision = createRunPlanRevision({
      id: "plan-revision-b",
      planId: "plan-b",
      novelId: foreignWorkspaceId,
      revisionNumber: 1,
      goal: "Foreign plan",
      steps: [{ id: "step-1", ordinal: 1, generationTaskId: "task-b", dependsOn: [] }],
      createdAt: now,
    });
    await saveRunPlanRevision(dependencies.product!.runPersistence, revision);
    await saveProductionRun(
      dependencies.product!.runPersistence,
      createProductionRun({
        id: "run-b",
        novelId: foreignWorkspaceId,
        runPlanRevision: revision,
        createdAt: now,
      }),
    );

    const paused = await app.inject({
      method: "POST",
      url: "/runs/run-b/pause",
      headers: scopedHeader,
      payload: { reason: "attack" },
    });
    const status = await app.inject({
      method: "GET",
      url: "/runs/run-b/status",
      headers: authorHeader,
    });

    expect(paused.statusCode).toBe(403);
    expect(status.statusCode).toBe(403);
    expect(
      (await dependencies.product!.runPersistence.runs.findById("run-b"))!.status,
    ).toBe("draft");
  });
});
