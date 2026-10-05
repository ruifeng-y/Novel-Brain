import { describe, expect, it } from "vitest";
import { createNovelBrainServer } from "../../src/http/server";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import type { HttpBoundaryPipeline } from "../../src/http/httpBoundaryPipeline";

const author = "author-1";
const novelId = "novel-1";

function harness() {
  const calls: string[] = [];
  const pipeline: HttpBoundaryPipeline = {
    async execute(contractId, _context, input, handler) {
      calls.push(contractId);
      return handler(input);
    },
  };
  const dependencies = createInMemoryEngineDependencies();
  const app = createNovelBrainServer(dependencies, { httpBoundaryPipeline: pipeline });
  return { app, calls, dependencies };
}

type Harness = ReturnType<typeof harness>;

async function createGenerationTask(app: Harness["app"]) {
  const scene = await app.inject({
    method: "POST",
    url: `/novels/${novelId}/scenes`,
    headers: { "x-author-id": author },
    payload: { id: "scene-1", chapterId: "chapter-1", title: "Opening" },
  });
  expect(scene.statusCode).toBe(201);
  const sceneRevisionId = scene.json().currentRevisionId as string;

  const task = await app.inject({
    method: "POST",
    url: `/novels/${novelId}/generation-tasks`,
    headers: { "x-author-id": author },
    payload: {
      id: "generation-task-1",
      operation: "scene_generation",
      targetSceneId: "scene-1",
      intent: "Draft the opening scene.",
      basedOnVersionSet: {
        scene: {
          aggregateType: "Scene",
          objectId: "scene-1",
          revisionId: sceneRevisionId,
        },
      },
    },
  });
  expect(task.statusCode).toBe(201);
  return task.json().id as string;
}

async function createRunPlan(app: Harness["app"], generationTaskId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/run-plans",
    headers: { "x-author-id": author },
    payload: {
      id: "plan-revision-1",
      planId: "plan-1",
      novelId,
      revisionNumber: 1,
      goal: "Draft the opening arc",
      steps: [
        { id: "step-1", ordinal: 1, generationTaskId, dependsOn: [] },
      ],
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

describe("[task:R8] [integration] run creation chain product API", () => {
  it("walks a blank workspace to a running production run through the boundary pipeline", async () => {
    const { app, calls } = harness();

    const novel = await app.inject({
      method: "POST",
      url: "/novels",
      headers: { "x-author-id": author },
      payload: { id: novelId, authorId: author, title: "Novel" },
    });
    expect(novel.statusCode).toBe(201);

    const generationTaskId = await createGenerationTask(app);
    const revision = await createRunPlan(app, generationTaskId);
    expect(revision.steps[0].generationTaskId).toBe(generationTaskId);

    const approval = await app.inject({
      method: "POST",
      url: "/run-plans/plan-revision-1/approvals",
      headers: { "x-author-id": author },
      payload: {
        approvalId: "approval-1",
        approvedBy: author,
        evidenceReferences: [generationTaskId],
      },
    });
    expect(approval.statusCode).toBe(201);
    expect(approval.json().planRevisionReference.version).toBe("plan-revision-1");

    const started = await app.inject({
      method: "POST",
      url: "/runs",
      headers: { "x-author-id": author },
      payload: { id: "run-1", novelId, runPlanRevisionId: "plan-revision-1" },
    });
    expect(started.statusCode).toBe(201);
    expect(started.json().run.status).toBe("running");
    expect(started.json().stateBoundary.ownsNarrativeTruth).toBe(false);

    const paused = await app.inject({
      method: "POST",
      url: "/runs/run-1/pause",
      headers: { "x-author-id": author },
      payload: { reason: "awaiting author review" },
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json().run.status).toBe("paused");

    const resumed = await app.inject({
      method: "POST",
      url: "/runs/run-1/resume",
      headers: { "x-author-id": author },
      payload: {},
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().run.status).toBe("running");

    expect(calls).toEqual([
      "foundation.command.create-blank-foundation",
      "foundation.command.adopt-proposal-content",
      "generation.command.create-generation-task",
      "run.command.create-run-plan-revision",
      "run.command.approve-run-plan",
      "run.command.start-run",
      "run.command.pause-run",
      "run.command.resume-run",
    ]);
  });

  it("refuses to start a run before the plan revision is approved", async () => {
    const { app } = harness();

    await app.inject({
      method: "POST",
      url: "/novels",
      headers: { "x-author-id": author },
      payload: { id: novelId, authorId: author, title: "Novel" },
    });
    const generationTaskId = await createGenerationTask(app);
    await createRunPlan(app, generationTaskId);

    const started = await app.inject({
      method: "POST",
      url: "/runs",
      headers: { "x-author-id": author },
      payload: { id: "run-unapproved", novelId, runPlanRevisionId: "plan-revision-1" },
    });

    expect(started.statusCode).toBeGreaterThanOrEqual(400);
    expect(started.statusCode).not.toBe(201);
  });
});
