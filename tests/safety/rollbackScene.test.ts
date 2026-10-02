import { describe, expect, it } from "vitest";
import { InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import { commitSceneText, createScene, type Scene } from "../../src/manuscript/domain/scene";
import { resolveTargetSpan } from "../../src/manuscript/domain/targetSpan";
import { rollbackScene } from "../../src/safety/application/rollbackScene";
import { InMemoryEventStore, type EventStore } from "../../src/safety/infrastructure/eventStore";
import { hashContent } from "../../src/shared/domain/contentHash";

const now = new Date("2026-10-02T00:00:00.000Z");

class FailingRollbackEventStore implements EventStore {
  async append(): Promise<void> {
    throw new Error("event write failed");
  }
  async appendMany(): Promise<void> {
    throw new Error("event write failed");
  }
  async listByNovel(): Promise<readonly never[]> {
    return [];
  }
}

describe("rollbackScene", () => {
  it("restores a prior revision as a new audited commit", async () => {
    const scenes = new InMemoryRevisionedRepository<Scene>();
    const events = new InMemoryEventStore();
    const initial = createScene({
      id: "scene-1",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "The Northern Gate",
      revisionId: "scene-rev-1",
      commitId: "initial-commit",
      createdAt: now,
    });
    const rev2 = commitSceneText({
      scene: initial,
      text: "Stable text",
      spanAnchors: {
        "span-stable": {
          anchorId: "span-stable",
          start: 0,
          end: 11,
          text: "Stable text",
          sourceContentHash: hashContent("Stable text"),
        },
      },
      revisionId: "scene-rev-2",
      commitId: "commit-2",
      updatedAt: now,
    });
    const rev3 = commitSceneText({
      scene: rev2,
      text: "Bad text",
      revisionId: "scene-rev-3",
      commitId: "commit-3",
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });
    await scenes.save(rev2);
    await scenes.save(rev3);

    const result = await rollbackScene({
      scenes,
      eventStore: events,
      input: {
        rollbackId: "rollback-1",
        sceneId: "scene-1",
        targetRevisionId: "scene-rev-2",
        reason: "Undo an invalid local rewrite.",
        now: new Date("2026-10-04T00:00:00.000Z"),
      },
    });

    expect(result.scene.text).toBe("Stable text");
    expect(result.scene.currentRevisionId).toBe("scene-rev-3:rollback:rollback-1");
    expect((await scenes.getRevision("scene-1", "scene-rev-2"))?.text).toBe("Stable text");
    expect(
      resolveTargetSpan(result.scene, {
        anchorId: "span-stable",
        text: "Stable text",
        sourceContentHash: hashContent("Stable text"),
      }),
    ).toEqual({ start: 0, end: 11, text: "Stable text" });
    expect((await events.listByNovel("novel-1"))[0]).toMatchObject({
      name: "SceneCommitted",
      commitId: "rollback-1",
      payload: { rollback: true, reason: "Undo an invalid local rewrite." },
    });
  });

  it("rejects a missing rollback target", async () => {
    const scenes = new InMemoryRevisionedRepository<Scene>();
    await scenes.save(
      createScene({
        id: "scene-1",
        novelId: "novel-1",
        chapterId: "chapter-1",
        title: "The Northern Gate",
        revisionId: "scene-rev-1",
        commitId: "initial-commit",
        createdAt: now,
      }),
    );

    await expect(
      rollbackScene({
        scenes,
        eventStore: new InMemoryEventStore(),
        input: {
          rollbackId: "rollback-1",
          sceneId: "scene-1",
          targetRevisionId: "missing-revision",
          reason: "Undo.",
          now,
        },
      }),
    ).rejects.toThrow("Rollback target revision not found");
  });

  it("compensates canonical state when rollback event persistence fails", async () => {
    const scenes = new InMemoryRevisionedRepository<Scene>();
    const initial = createScene({
      id: "scene-event-failure",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "Event Failure",
      revisionId: "scene-rev-1",
      commitId: "initial-commit",
      createdAt: now,
    });
    const rev2 = commitSceneText({
      scene: initial,
      text: "Stable text",
      spanAnchors: {
        "span-stable": {
          anchorId: "span-stable",
          start: 0,
          end: 11,
          text: "Stable text",
          sourceContentHash: hashContent("Stable text"),
        },
      },
      revisionId: "scene-rev-2",
      commitId: "commit-2",
      updatedAt: now,
    });
    const rev3 = commitSceneText({
      scene: rev2,
      text: "Bad text",
      revisionId: "scene-rev-3",
      commitId: "commit-3",
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });
    await scenes.save(rev2);
    await scenes.save(rev3);

    await expect(
      rollbackScene({
        scenes,
        eventStore: new FailingRollbackEventStore(),
        input: {
          rollbackId: "rollback-event-failure",
          sceneId: "scene-event-failure",
          targetRevisionId: "scene-rev-2",
          reason: "Undo.",
          now: new Date("2026-10-04T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("event write failed");
    expect((await scenes.findById("scene-event-failure"))?.text).toBe("Bad text");
  });
});
