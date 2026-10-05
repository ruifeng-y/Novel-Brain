import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createNovelBrainServer } from "../../src/http/server";
import { createHttpBoundaryPipeline } from "../../src/http/httpBoundaryPipeline";
import type { HttpBoundaryPipeline } from "../../src/http/httpBoundaryPipeline";
import { createProductRequestValidators } from "../../src/http/productRequestSchemas";
import { createPlatformObservabilityBoundary } from "../../src/platform/observabilityBoundary";
import { createProductionSecurityBoundary } from "../../src/platform/productionSecurityProvider";

const author = "author-bootstrap";
const novelId = "novel-bootstrap";
const sceneId = "scene-bootstrap";
const scopedWorkspaceId = "boot-live-1";
const productionAuthor = "boot-author";

function publicFile(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../public/${name}`, import.meta.url)), "utf8");
}

function harness() {
  const calls: string[] = [];
  const pipeline: HttpBoundaryPipeline = {
    async execute(contractId, _context, input, handler) {
      calls.push(contractId);
      return handler(input);
    },
  };
  const app = createNovelBrainServer(createInMemoryEngineDependencies(), {
    httpBoundaryPipeline: pipeline,
  });
  return { app, calls };
}

/** Real production security boundary: the principal is scoped to one workspace. */
function secureHarness() {
  const pipeline = createHttpBoundaryPipeline({
    security: createProductionSecurityBoundary({
      NB_SECURITY_PRINCIPALS: JSON.stringify([
        {
          token: productionAuthor,
          subjectId: productionAuthor,
          accountId: "account-1",
          workspaceIds: [scopedWorkspaceId],
          roles: ["author"],
        },
      ]),
      NB_SECURITY_RATE_LIMIT: "50",
      NB_SECURITY_SECRETS: "{}",
    }),
    observability: createPlatformObservabilityBoundary({
      sink: () => {},
      now: () => new Date(0),
      idGenerator: () => "secure-harness-event",
    }),
    validators: createProductRequestValidators(),
  });
  const app = createNovelBrainServer(createInMemoryEngineDependencies(), {
    httpBoundaryPipeline: pipeline,
  });
  return { app };
}

/** Slices a top-level function body out of app.js so assertions stay scoped. */
function functionBody(source: string, name: string): string {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`function not found in app.js: ${name}`);
  const next = source.indexOf("\n  function ", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

describe("[task:Hardening-A] [integration] blank deployment bootstrap chain", () => {
  it("creates a Novel, then a Scene, then starts a generation task on the returned revision", async () => {
    const { app, calls } = harness();

    const novel = await app.inject({
      method: "POST",
      url: "/novels",
      headers: { "x-author-id": author },
      payload: { id: novelId, authorId: author, title: "空白部署" },
    });
    expect(novel.statusCode).toBe(201);
    expect(novel.json().id).toBe(novelId);

    const scene = await app.inject({
      method: "POST",
      url: `/novels/${novelId}/scenes`,
      headers: { "x-author-id": author },
      payload: { id: sceneId, chapterId: "chapter-1", title: "开场" },
    });
    expect(scene.statusCode).toBe(201);
    const sceneBody = scene.json();
    expect(sceneBody.id).toBe(sceneId);
    const sceneRevisionId = sceneBody.currentRevisionId as string;
    expect(typeof sceneRevisionId).toBe("string");
    expect(sceneRevisionId.length).toBeGreaterThan(0);

    // The Run chain references the revision the Scene response returned.
    const task = await app.inject({
      method: "POST",
      url: `/novels/${novelId}/generation-tasks`,
      headers: { "x-author-id": author },
      payload: {
        id: "generation-task-bootstrap",
        operation: "scene_generation",
        targetSceneId: sceneBody.id,
        intent: "起草开场",
        basedOnVersionSet: {
          scene: {
            aggregateType: "Scene",
            objectId: sceneBody.id,
            revisionId: sceneRevisionId,
          },
        },
      },
    });
    expect(task.statusCode).toBe(201);
    expect(task.json().targetSceneId).toBe(sceneBody.id);
    expect(task.json().basedOnVersionSet.scene.revisionId).toBe(sceneRevisionId);

    expect(calls).toEqual([
      "foundation.command.create-blank-foundation",
      "foundation.command.adopt-proposal-content",
      "generation.command.create-generation-task",
    ]);
  });

  it("cannot start the Run chain on a fresh Novel before a Scene exists", async () => {
    const { app } = harness();

    await app.inject({
      method: "POST",
      url: "/novels",
      headers: { "x-author-id": author },
      payload: { id: novelId, authorId: author, title: "空白部署" },
    });

    const refused = await app.inject({
      method: "POST",
      url: `/novels/${novelId}/generation-tasks`,
      headers: { "x-author-id": author },
      payload: {
        id: "generation-task-early",
        operation: "scene_generation",
        targetSceneId: sceneId,
        intent: "起草开场",
        basedOnVersionSet: {
          scene: { aggregateType: "Scene", objectId: sceneId, revisionId: `${sceneId}:rev-1` },
        },
      },
    });

    expect(refused.statusCode).toBe(404);
    expect(refused.json().error).toBe("Target scene not found");
  });

  it("binds Scene creation to the context author id", async () => {
    const { app } = harness();

    await app.inject({
      method: "POST",
      url: "/novels",
      headers: { "x-author-id": author },
      payload: { id: novelId, authorId: author, title: "空白部署" },
    });

    const denied = await app.inject({
      method: "POST",
      url: `/novels/${novelId}/scenes`,
      headers: { "x-author-id": "author-other" },
      payload: { id: sceneId, chapterId: "chapter-1", title: "开场" },
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "POST",
      url: `/novels/${novelId}/scenes`,
      headers: { "x-author-id": author },
      payload: { id: sceneId, chapterId: "chapter-1", title: "开场" },
    });
    expect(allowed.statusCode).toBe(201);
    expect(typeof allowed.json().currentRevisionId).toBe("string");
  });
});

describe("[task:Hardening-A] [cross-system] workspace bootstrap surface", () => {
  it("exposes both bootstrap actions over the existing product routes", () => {
    const markup = publicFile("index.html");
    const source = publicFile("app.js");

    expect(markup).toContain('data-action="create-novel"');
    expect(markup).toContain('id="novel-title"');
    expect(source).toContain('data-action="create-scene"');
    expect(source).toContain('"/novels"');
    expect(source).toContain('"/scenes"');
    expect(source).toContain("创建小说");
    expect(source).toContain("创建场景");
  });

  it("backfills the created Novel id into the persisted workspace context", () => {
    const source = publicFile("app.js");
    const body = functionBody(source, "createNovel");

    expect(body).toContain("appState.authorId");
    expect(body).toContain('byId("novel-id")');
    expect(body).toContain("appState.novelId");
    expect(body).toContain("persistIdentity()");
  });

  it("creates the Novel from the author-supplied id and binds the workspace header to it", () => {
    const source = publicFile("app.js");
    const createNovelBody = functionBody(source, "createNovel");

    // The deployment pre-configures workspace scope, so the client must not
    // invent an id the operator could never have provisioned.
    expect(createNovelBody).not.toContain('newId("novel")');
    expect(createNovelBody).toContain("workspaceId");

    const apiBody = functionBody(source, "api");
    expect(apiBody).toContain("x-workspace-id");

    // Only the Novel creation overrides workspace scope; scoped paths keep
    // deriving it from the route parameter.
    for (const name of ["createScene", "createGenerationTask", "createRunPlan", "startRun"]) {
      expect(functionBody(source, name)).not.toContain("workspaceId");
    }
  });

  it("backfills the created Scene id and revision from the Scene response", () => {
    const source = publicFile("app.js");
    const body = functionBody(source, "createScene");

    expect(body).toContain("currentRevisionId");
    expect(body).toContain("sceneRevisionId");
    expect(body).toContain('byId("run-scene-id")');
  });

  it("takes the Run chain scene revision from the response instead of deriving it", () => {
    const source = publicFile("app.js");
    const body = functionBody(source, "createGenerationTask");

    expect(body).toContain("sceneRevisionId");
    expect(body).not.toContain('":rev-1"');
    expect(body).not.toMatch(/revisionId:\s*sceneId\s*\+/);
    expect(source).not.toContain('sceneId + ":rev-1"');
  });

  it("keeps the bootstrap actions free of commit calls and generation-task creation", () => {
    const source = publicFile("app.js");

    for (const name of ["createNovel", "createScene"]) {
      const body = functionBody(source, name);
      expect(body).not.toContain("/change-sets/");
      expect(body).not.toContain("generation-tasks");
      expect(body).not.toMatch(/data-action="commit"/);
    }
  });
});

describe("[task:Hardening-A] [regression] localized surface stays intact", () => {
  it("keeps Chinese copy, the six workspace states, and no full-page reload", () => {
    const markup = publicFile("index.html");
    const source = publicFile("app.js");

    expect(markup).toContain('lang="zh-CN"');
    expect(source).toContain('data-state="loading"');
    expect(source).toContain('data-state="empty"');
    expect(source).toContain('data-state="error"');
    expect(source).toContain('data-action="retry"');
    expect(source).toContain('data-state="disabled"');
    expect(source).toContain('data-state="success"');
    expect(source).not.toContain("location.reload");
    expect(source).not.toContain("location.href");
    expect(source).not.toContain("/change-sets/");
    expect(source).not.toMatch(/data-action="commit"/);
  });
});

describe("[task:Hardening-A] [integration] create Novel under the real workspace isolation boundary", () => {
  it("accepts the create when x-workspace-id matches the scoped workspace", async () => {
    const { app } = secureHarness();

    const response = await app.inject({
      method: "POST",
      url: "/novels",
      headers: { "x-author-id": productionAuthor, "x-workspace-id": scopedWorkspaceId },
      payload: { id: scopedWorkspaceId, authorId: productionAuthor, title: "作用域小说" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().id).toBe(scopedWorkspaceId);
    expect(response.json().authorId).toBe(productionAuthor);
  });

  it("rejects the create when x-workspace-id is absent", async () => {
    const { app } = secureHarness();

    const response = await app.inject({
      method: "POST",
      url: "/novels",
      headers: { "x-author-id": productionAuthor },
      payload: { id: scopedWorkspaceId, authorId: productionAuthor, title: "作用域小说" },
    });

    expect(response.statusCode).not.toBe(201);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.json().message).toContain("is not scoped to workspace");
  });

  it("rejects the create when x-workspace-id falls outside the principal scope", async () => {
    const { app } = secureHarness();

    const response = await app.inject({
      method: "POST",
      url: "/novels",
      headers: { "x-author-id": productionAuthor, "x-workspace-id": "someone-else" },
      payload: { id: "someone-else", authorId: productionAuthor, title: "作用域小说" },
    });

    expect(response.statusCode).not.toBe(201);
    expect(response.json().message).toContain("is not scoped to workspace someone-else");
  });
});
