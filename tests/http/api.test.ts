import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { InMemoryRepository, InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import type { Candidate } from "../../src/production/domain/candidate";
import type { GenerationTask } from "../../src/production/domain/generationTask";
import type { ValidationRun } from "../../src/production/domain/validationRun";
import type { ReviewDecision } from "../../src/production/domain/reviewDecision";
import type { CanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../src/narrative/state/domain/stateRecord";
import { commitSceneText, type Scene } from "../../src/manuscript/domain/scene";
import type { Novel } from "../../src/narrative/novel/domain/novel";
import type { NarrativeCommit } from "../../src/safety/domain/narrativeCommit";
import { DeterministicRuntime } from "../../src/production/runtime/deterministicRuntime";
import { InMemoryEventStore } from "../../src/safety/infrastructure/eventStore";
import { registerNovelBrainRoutes } from "../../src/http/routes";

function server() {
  const app = Fastify();
  const dependencies = {
    novels: new InMemoryRepository<Novel>(),
    scenes: new InMemoryRevisionedRepository<Scene>(),
    generationTasks: new InMemoryRepository<GenerationTask>(),
    candidates: new InMemoryRevisionedRepository<Candidate>(),
    validationRuns: new InMemoryRepository<ValidationRun>(),
    reviewDecisions: new InMemoryRepository<ReviewDecision>(),
    canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
    stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
    narrativeCommits: new InMemoryRepository<NarrativeCommit>(),
    eventStore: new InMemoryEventStore(),
    runtime: new DeterministicRuntime(),
  };
  registerNovelBrainRoutes(app, dependencies);
  return { app, dependencies };
}

describe("core engine API", () => {
  it("supports the co-creation loop over HTTP", async () => {
    const { app } = server();
    const novelResponse = await app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-1", authorId: "author-1", title: "Blade of the Northern Sect" },
    });
    expect(novelResponse.statusCode).toBe(201);

    const sceneResponse = await app.inject({
      method: "POST",
      url: "/novels/novel-1/scenes",
      headers: { "x-author-id": "author-1" },
      payload: { id: "scene-1", chapterId: "chapter-1", title: "The Northern Gate" },
    });
    expect(sceneResponse.statusCode).toBe(201);
    const scene = sceneResponse.json();

    const taskResponse = await app.inject({
      method: "POST",
      url: "/novels/novel-1/generation-tasks",
      headers: { "x-author-id": "author-1" },
      payload: {
        id: "task-1",
        operation: "rewrite",
        targetSceneId: "scene-1",
        intent: "Rewrite with more tension.",
        basedOnVersionSet: {
          scene: {
            aggregateType: "Scene",
            objectId: "scene-1",
            revisionId: scene.currentRevisionId,
          },
        },
      },
    });
    expect(taskResponse.statusCode).toBe(201);

    const candidateResponse = await app.inject({
      method: "POST",
      url: "/generation-tasks/task-1/candidates",
      payload: {
        id: "candidate-1",
        agentRole: "writer",
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
        change: { type: "text", sceneId: "scene-1", text: "New tense text" },
      },
    });
    expect(candidateResponse.statusCode).toBe(201);

    const commitResponse = await app.inject({
      method: "POST",
      url: "/candidates/candidate-1/commit",
      payload: {
        commitId: "commit-1",
        validationId: "validation-1",
        reviewId: "review-1",
        actorId: "author-1",
        mustPreserve: [],
      },
    });
    expect(commitResponse.statusCode).toBe(201);
    expect(commitResponse.json()).toMatchObject({ status: "committed" });

    const eventsResponse = await app.inject({ method: "GET", url: "/novels/novel-1/events" });
    expect(eventsResponse.statusCode).toBe(200);
    expect(eventsResponse.json()).toEqual([
      expect.objectContaining({ name: "SceneCommitted", objectId: "scene-1" }),
      expect.objectContaining({ name: "NarrativeCommitRecorded", objectId: "commit-1" }),
    ]);

    await app.close();
  });

  it("rejects an invalid novel payload", async () => {
    const { app } = server();
    const response = await app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-1", authorId: "", title: "Title" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "Bad Request" });
    await app.close();
  });

  it("returns validation failure without selecting the candidate", async () => {
    const { app, dependencies } = server();
    await app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-validation", authorId: "author-1", title: "Validation Novel" },
    });
    const sceneResponse = await app.inject({
      method: "POST",
      url: "/novels/novel-validation/scenes",
      headers: { "x-author-id": "author-1" },
      payload: { id: "scene-validation", chapterId: "chapter-1", title: "Validation Scene" },
    });
    const scene = sceneResponse.json();
    await app.inject({
      method: "POST",
      url: "/novels/novel-validation/generation-tasks",
      headers: { "x-author-id": "author-1" },
      payload: {
        id: "task-validation",
        operation: "rewrite",
        targetSceneId: scene.id,
        intent: "Rewrite the scene.",
        basedOnVersionSet: {
          scene: {
            aggregateType: "Scene",
            objectId: scene.id,
            revisionId: scene.currentRevisionId,
          },
        },
      },
    });
    await app.inject({
      method: "POST",
      url: "/generation-tasks/task-validation/candidates",
      payload: {
        id: "candidate-validation",
        agentRole: "writer",
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
        change: { type: "text", sceneId: scene.id, text: "Different text" },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/candidates/candidate-validation/commit",
      payload: {
        commitId: "commit-validation",
        validationId: "validation-run",
        reviewId: "review-run",
        actorId: "author-1",
        mustPreserve: ["Northern Sect"],
      },
    });

    expect(response.statusCode).toBe(422);
    expect((await dependencies.candidates.findById("candidate-validation"))?.status).toBe("generated");
    await app.close();
  });

  it("commits structured-only and canonical-only candidates without a scene change", async () => {
    const structured = server();
    await structured.app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-structured", authorId: "author-1", title: "Structured Novel" },
    });
    const structuredScene = (
      await structured.app.inject({
        method: "POST",
        url: "/novels/novel-structured/scenes",
        headers: { "x-author-id": "author-1" },
        payload: { id: "scene-structured", chapterId: "chapter-1", title: "Structured Scene" },
      })
    ).json();
    await structured.dependencies.stateRecords.save({
      id: "state-structured",
      novelId: "novel-structured",
      type: "character_state",
      subjectId: "fact-structured",
      position: { sceneId: structuredScene.id, ordinal: 1 },
      content: { condition: "healthy" },
      currentRevisionId: "state-rev-1",
      lastCommitId: "initial",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await structured.app.inject({
      method: "POST",
      url: "/novels/novel-structured/generation-tasks",
      headers: { "x-author-id": "author-1" },
      payload: {
        id: "task-structured",
        operation: "rewrite",
        targetSceneId: structuredScene.id,
        intent: "Change state only.",
        basedOnVersionSet: {
          scene: {
            aggregateType: "Scene",
            objectId: structuredScene.id,
            revisionId: structuredScene.currentRevisionId,
          },
          stateRecord: {
            aggregateType: "StateRecord",
            objectId: "state-structured",
            revisionId: "state-rev-1",
          },
        },
      },
    });
    await structured.app.inject({
      method: "POST",
      url: "/generation-tasks/task-structured/candidates",
      payload: {
        id: "candidate-structured",
        agentRole: "writer",
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
        change: {
          type: "structured_state",
          stateRecordId: "state-structured",
          content: { condition: "injured" },
        },
      },
    });
    const structuredCommit = await structured.app.inject({
      method: "POST",
      url: "/candidates/candidate-structured/commit",
      payload: {
        commitId: "commit-structured",
        validationId: "validation-structured",
        reviewId: "review-structured",
        actorId: "author-1",
        mustPreserve: [],
      },
    });
    expect(structuredCommit.statusCode).toBe(201);
    await structured.app.close();

    const canonical = server();
    await canonical.app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-canonical", authorId: "author-1", title: "Canonical Novel" },
    });
    const canonicalScene = (
      await canonical.app.inject({
        method: "POST",
        url: "/novels/novel-canonical/scenes",
        headers: { "x-author-id": "author-1" },
        payload: { id: "scene-canonical", chapterId: "chapter-1", title: "Canonical Scene" },
      })
    ).json();
    await canonical.dependencies.canonicalFacts.save({
      id: "fact-canonical",
      novelId: "novel-canonical",
      type: "world_rule",
      content: { rule: "Old rule" },
      currentRevisionId: "fact-rev-1",
      lastCommitId: "initial",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await canonical.app.inject({
      method: "POST",
      url: "/novels/novel-canonical/generation-tasks",
      headers: { "x-author-id": "author-1" },
      payload: {
        id: "task-canonical",
        operation: "rewrite",
        targetSceneId: canonicalScene.id,
        intent: "Change canon only.",
        basedOnVersionSet: {
          scene: {
            aggregateType: "Scene",
            objectId: canonicalScene.id,
            revisionId: canonicalScene.currentRevisionId,
          },
          canonicalFact: {
            aggregateType: "CanonicalFact",
            objectId: "fact-canonical",
            revisionId: "fact-rev-1",
          },
        },
      },
    });
    await canonical.app.inject({
      method: "POST",
      url: "/generation-tasks/task-canonical/candidates",
      payload: {
        id: "candidate-canonical",
        agentRole: "writer",
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
        change: {
          type: "canonical_fact",
          canonicalFactId: "fact-canonical",
          content: { rule: "New rule" },
        },
      },
    });
    const canonicalCommit = await canonical.app.inject({
      method: "POST",
      url: "/candidates/candidate-canonical/commit",
      payload: {
        commitId: "commit-canonical",
        validationId: "validation-canonical",
        reviewId: "review-canonical",
        actorId: "author-1",
        mustPreserve: [],
      },
    });
    expect(canonicalCommit.statusCode).toBe(201);
    await canonical.app.close();
  });

  it("rejects empty version sets through the API schema", async () => {
    const { app } = server();
    await app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-empty-version", authorId: "author-1", title: "Empty Version" },
    });
    await app.inject({
      method: "POST",
      url: "/novels/novel-empty-version/scenes",
      headers: { "x-author-id": "author-1" },
      payload: { id: "scene-empty-version", chapterId: "chapter-1", title: "Scene" },
    });
    const response = await app.inject({
      method: "POST",
      url: "/novels/novel-empty-version/generation-tasks",
      headers: { "x-author-id": "author-1" },
      payload: {
        id: "task-empty-version",
        operation: "rewrite",
        targetSceneId: "scene-empty-version",
        intent: "Rewrite.",
        basedOnVersionSet: {},
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "Bad Request" });
    await app.close();
  });

  it("verifies novel existence and author ownership before creating child objects", async () => {
    const { app } = server();
    const novelResponse = await app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-owned", authorId: "author-1", title: "Owned Novel" },
    });
    expect(novelResponse.statusCode).toBe(201);
    const missing = await app.inject({
      method: "POST",
      url: "/novels/novel-missing/scenes",
      headers: { "x-author-id": "author-1" },
      payload: { id: "scene-missing", chapterId: "chapter-1", title: "Missing" },
    });
    expect(missing.statusCode).toBe(404);
    const forbidden = await app.inject({
      method: "POST",
      url: "/novels/novel-owned/scenes",
      headers: { "x-author-id": "author-2" },
      payload: { id: "scene-forbidden", chapterId: "chapter-1", title: "Forbidden" },
    });
    expect(forbidden.statusCode).toBe(403);
    const targetMissing = await app.inject({
      method: "POST",
      url: "/novels/novel-owned/generation-tasks",
      headers: { "x-author-id": "author-1" },
      payload: {
        id: "task-target-missing",
        operation: "rewrite",
        targetSceneId: "scene-missing",
        intent: "Rewrite.",
        basedOnVersionSet: {
          scene: {
            aggregateType: "Scene",
            objectId: "scene-missing",
            revisionId: "scene-rev-1",
          },
        },
      },
    });
    expect(targetMissing.statusCode).toBe(404);
    await app.close();
  });

  it("commits a composite candidate over scene and state changes", async () => {
    const { app, dependencies } = server();
    await app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-composite-api", authorId: "author-1", title: "Composite API" },
    });
    const sceneResponse = await app.inject({
      method: "POST",
      url: "/novels/novel-composite-api/scenes",
      headers: { "x-author-id": "author-1" },
      payload: { id: "scene-composite-api", chapterId: "chapter-1", title: "Composite Scene" },
    });
    const scene = sceneResponse.json();
    await dependencies.stateRecords.save({
      id: "state-composite-api",
      novelId: "novel-composite-api",
      type: "character_state",
      subjectId: "fact-composite-api",
      position: { sceneId: scene.id, ordinal: 1 },
      content: { condition: "healthy" },
      currentRevisionId: "state-rev-1",
      lastCommitId: "initial",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await app.inject({
      method: "POST",
      url: "/novels/novel-composite-api/generation-tasks",
      headers: { "x-author-id": "author-1" },
      payload: {
        id: "task-composite-api",
        operation: "rewrite",
        targetSceneId: scene.id,
        intent: "Update scene and state.",
        basedOnVersionSet: {
          scene: {
            aggregateType: "Scene",
            objectId: scene.id,
            revisionId: scene.currentRevisionId,
          },
          stateRecord: {
            aggregateType: "StateRecord",
            objectId: "state-composite-api",
            revisionId: "state-rev-1",
          },
        },
      },
    });
    await app.inject({
      method: "POST",
      url: "/generation-tasks/task-composite-api/candidates",
      payload: {
        id: "candidate-composite-api",
        agentRole: "writer",
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
        change: {
          type: "composite",
          changes: [
            { type: "text", sceneId: scene.id, text: "Composite scene text" },
            {
              type: "structured_state",
              stateRecordId: "state-composite-api",
              content: { condition: "injured" },
            },
          ],
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/candidates/candidate-composite-api/commit",
      payload: {
        commitId: "commit-composite-api",
        validationId: "validation-composite-api",
        reviewId: "review-composite-api",
        actorId: "author-1",
        mustPreserve: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect((await dependencies.scenes.findById(scene.id))?.text).toBe("Composite scene text");
    expect((await dependencies.stateRecords.findById("state-composite-api"))?.content).toEqual({
      condition: "injured",
    });
    const events = await dependencies.eventStore.listByNovel("novel-composite-api");
    expect(events.map(event => event.name)).toEqual([
      "SceneCommitted",
      "CharacterStateChanged",
      "NarrativeCommitRecorded",
    ]);
    await app.close();
  });

  it("returns a controlled commit conflict for stale versions without corrupting state", async () => {
    const { app, dependencies } = server();
    await app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-stale-api", authorId: "author-1", title: "Stale API" },
    });
    const sceneResponse = await app.inject({
      method: "POST",
      url: "/novels/novel-stale-api/scenes",
      headers: { "x-author-id": "author-1" },
      payload: { id: "scene-stale-api", chapterId: "chapter-1", title: "Stale Scene" },
    });
    const scene = sceneResponse.json() as Scene;
    await app.inject({
      method: "POST",
      url: "/novels/novel-stale-api/generation-tasks",
      headers: { "x-author-id": "author-1" },
      payload: {
        id: "task-stale-api",
        operation: "rewrite",
        targetSceneId: scene.id,
        intent: "Rewrite stale scene.",
        basedOnVersionSet: {
          scene: {
            aggregateType: "Scene",
            objectId: scene.id,
            revisionId: scene.currentRevisionId,
          },
        },
      },
    });
    await app.inject({
      method: "POST",
      url: "/generation-tasks/task-stale-api/candidates",
      payload: {
        id: "candidate-stale-api",
        agentRole: "writer",
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
        change: { type: "text", sceneId: scene.id, text: "Candidate stale text" },
      },
    });
    await dependencies.scenes.save(
      commitSceneText({
        scene,
        text: "Author updated text",
        revisionId: "scene-rev-author",
        commitId: "author-edit",
        updatedAt: new Date(),
      }),
    );
    const response = await app.inject({
      method: "POST",
      url: "/candidates/candidate-stale-api/commit",
      payload: {
        commitId: "commit-stale-api",
        validationId: "validation-stale-api",
        reviewId: "review-stale-api",
        actorId: "author-1",
        mustPreserve: [],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "Commit Conflict" });
    expect((await dependencies.scenes.findById(scene.id))?.text).toBe("Author updated text");
    expect(await dependencies.eventStore.listByNovel("novel-stale-api")).toEqual([]);
    await app.close();
  });
});
