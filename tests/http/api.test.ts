import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { InMemoryRepository, InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import type { Candidate } from "../../src/production/domain/candidate";
import type { GenerationTask } from "../../src/production/domain/generationTask";
import type { ValidationRun } from "../../src/production/domain/validationRun";
import type { ReviewDecision } from "../../src/production/domain/reviewDecision";
import type { CanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../src/narrative/state/domain/stateRecord";
import type { Scene } from "../../src/manuscript/domain/scene";
import type { Novel } from "../../src/narrative/novel/domain/novel";
import type { NarrativeCommit } from "../../src/safety/domain/narrativeCommit";
import { DeterministicRuntime } from "../../src/production/runtime/deterministicRuntime";
import { InMemoryEventStore } from "../../src/safety/infrastructure/eventStore";
import { registerNovelBrainRoutes } from "../../src/http/routes";

function server() {
  const app = Fastify();
  registerNovelBrainRoutes(app, {
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
  });
  return app;
}

describe("core engine API", () => {
  it("supports the co-creation loop over HTTP", async () => {
    const app = server();
    const novelResponse = await app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-1", authorId: "author-1", title: "Blade of the Northern Sect" },
    });
    expect(novelResponse.statusCode).toBe(201);

    const sceneResponse = await app.inject({
      method: "POST",
      url: "/novels/novel-1/scenes",
      payload: { id: "scene-1", chapterId: "chapter-1", title: "The Northern Gate" },
    });
    expect(sceneResponse.statusCode).toBe(201);
    const scene = sceneResponse.json();

    const taskResponse = await app.inject({
      method: "POST",
      url: "/novels/novel-1/generation-tasks",
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
    ]);

    await app.close();
  });

  it("rejects an invalid novel payload", async () => {
    const app = server();
    const response = await app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-1", authorId: "", title: "Title" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "Bad Request" });
    await app.close();
  });
});
