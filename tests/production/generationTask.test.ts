import { describe, expect, it } from "vitest";
import {
  cancelGenerationTask,
  completeGenerationTask,
  createGenerationTask,
  markGenerationTaskStale,
  startGenerationTask,
} from "../../src/production/domain/generationTask";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-03T00:00:00.000Z");
const sceneVersion = createVersionReference("Scene", "scene-1", "scene-rev-1");

function task() {
  return createGenerationTask({
    id: "task-1",
    novelId: "novel-1",
    operation: "rewrite",
    targetSceneId: "scene-1",
    intent: "Rewrite the second paragraph with more tension.",
    basedOnVersionSet: createVersionSet({ scene: sceneVersion }),
    createdAt: now,
  });
}

describe("GenerationTask", () => {
  it("stores definition and lifecycle without a candidate id collection", () => {
    const created = task();
    expect(created).toMatchObject({
      status: "draft",
      operation: "rewrite",
      basedOnVersionSet: { scene: sceneVersion },
    });
    expect(Object.prototype.hasOwnProperty.call(created, "candidateIds")).toBe(false);
  });

  it("requires a based-on version set that includes the target scene", () => {
    expect(() =>
      createGenerationTask({
        id: "task-empty",
        novelId: "novel-1",
        operation: "rewrite",
        targetSceneId: "scene-1",
        intent: "Rewrite.",
        basedOnVersionSet: createVersionSet({}),
        createdAt: now,
      }),
    ).toThrow("basedOnVersionSet must contain the target scene version");
    expect(() =>
      createGenerationTask({
        id: "task-missing-target",
        novelId: "novel-1",
        operation: "rewrite",
        targetSceneId: "scene-1",
        intent: "Rewrite.",
        basedOnVersionSet: createVersionSet({
          other: createVersionReference("CanonicalFact", "fact-1", "fact-rev-1"),
        }),
        createdAt: now,
      }),
    ).toThrow("basedOnVersionSet must include the target scene version");
  });

  it("completes only a running task", () => {
    expect(() =>
      completeGenerationTask({ task: task(), candidateIds: ["candidate-1"], updatedAt: now }),
    ).toThrow("Only a running task can complete");

    const running = startGenerationTask(task(), now);
    const completed = completeGenerationTask({
      task: running,
      candidateIds: ["candidate-1"],
      updatedAt: now,
    });
    expect(completed.status).toBe("completed");
    expect(() =>
      completeGenerationTask({
        task: completed,
        candidateIds: ["candidate-2"],
        updatedAt: new Date("2026-10-04T00:00:00.000Z"),
      }),
    ).toThrow("Only a running task can complete");
  });

  it("cannot move updatedAt backward when completing", () => {
    const running = startGenerationTask(task(), now);
    expect(() =>
      completeGenerationTask({
        task: running,
        candidateIds: ["candidate-1"],
        updatedAt: new Date("2026-10-02T23:59:59.999Z"),
      }),
    ).toThrow("updatedAt cannot move backward");
  });

  it("completes only with at least one transient candidate id", () => {
    const running = startGenerationTask(task(), now);
    expect(() =>
      completeGenerationTask({ task: running, candidateIds: [], updatedAt: now }),
    ).toThrow("GenerationTask requires at least one candidate to complete");
    const completed = completeGenerationTask({
      task: running,
      candidateIds: ["candidate-1"],
      updatedAt: now,
    });
    expect(completed.status).toBe("completed");
    expect(Object.prototype.hasOwnProperty.call(completed, "candidateIds")).toBe(false);
  });

  it("rejects starting a terminal task", () => {
    const stale = markGenerationTaskStale(task(), now);
    expect(() => startGenerationTask(stale, now)).toThrow("Only a draft or ready task can start");
  });

  it("rejects marking a terminal task stale", () => {
    const stale = markGenerationTaskStale(task(), now);
    expect(() =>
      markGenerationTaskStale(stale, new Date("2026-10-04T00:00:00.000Z")),
    ).toThrow("Only a draft, ready, or running task can become stale");
  });

  it("cancels a non-terminal task and rejects cancelling a terminal task", () => {
    const cancelled = cancelGenerationTask(task(), now);
    expect(cancelled.status).toBe("cancelled");
    expect(() =>
      cancelGenerationTask(cancelled, new Date("2026-10-04T00:00:00.000Z")),
    ).toThrow("Only a draft, ready, or running task can be cancelled");
  });
});
