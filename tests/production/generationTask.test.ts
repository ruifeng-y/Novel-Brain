import { describe, expect, it } from "vitest";
import {
  addCandidateReference,
  cancelGenerationTask,
  completeGenerationTask,
  createGenerationTask,
  markGenerationTaskStale,
  startGenerationTask,
} from "../../src/production/domain/generationTask";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");
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
  it("starts as draft with a precise based-on version set", () => {
    expect(task()).toMatchObject({
      status: "draft",
      operation: "rewrite",
      basedOnVersionSet: { scene: sceneVersion },
      candidateIds: [],
    });
  });

  it("stores candidate references without owning candidate content", () => {
    const started = startGenerationTask(task(), new Date("2026-10-03T00:00:00.000Z"));
    const withCandidate = addCandidateReference(started, "candidate-1");
    expect(withCandidate.candidateIds).toEqual(["candidate-1"]);
    expect(started.candidateIds).toEqual([]);
  });

  it("requires the target scene version and rejects empty version sets", () => {
    expect(() =>
      createGenerationTask({
        id: "task-empty",
        novelId: "novel-1",
        operation: "rewrite",
        targetSceneId: "scene-1",
        intent: "Rewrite the scene.",
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
        intent: "Rewrite the scene.",
        basedOnVersionSet: createVersionSet({
          other: createVersionReference("CanonicalFact", "fact-1", "fact-rev-1"),
        }),
        createdAt: now,
      }),
    ).toThrow("basedOnVersionSet must include the target scene version");
  });

  it("cannot complete without at least one candidate", () => {
    const running = startGenerationTask(task(), new Date("2026-10-03T00:00:00.000Z"));
    expect(() =>
      completeGenerationTask({
        task: running,
        candidateIds: [],
        updatedAt: new Date("2026-10-04T00:00:00.000Z"),
      }),
    ).toThrow("GenerationTask requires at least one candidate to complete");
  });

  it("rejects candidate IDs that were not associated with the task", () => {
    const running = startGenerationTask(
      addCandidateReference(task(), "candidate-1"),
      new Date("2026-10-03T00:00:00.000Z"),
    );
    expect(() =>
      completeGenerationTask({
        task: running,
        candidateIds: ["candidate-2"],
        updatedAt: new Date("2026-10-04T00:00:00.000Z"),
      }),
    ).toThrow("Candidate reference is not associated with task: candidate-2");
    expect(
      completeGenerationTask({
        task: running,
        candidateIds: ["candidate-1"],
        updatedAt: new Date("2026-10-04T00:00:00.000Z"),
      }).status,
    ).toBe("completed");
  });

  it("supports stale and cancelled terminal states", () => {
    const running = startGenerationTask(task(), new Date("2026-10-03T00:00:00.000Z"));
    const stale = markGenerationTaskStale(running, new Date("2026-10-04T00:00:00.000Z"));
    expect(stale.status).toBe("stale");
    expect(() => startGenerationTask(stale, new Date("2026-10-05T00:00:00.000Z"))).toThrow(
      "Only a draft or ready task can start",
    );
    expect(() => markGenerationTaskStale(stale, new Date("2026-10-05T00:00:00.000Z"))).toThrow(
      "Only a draft, ready, or running task can become stale",
    );
    expect(() => cancelGenerationTask(stale, new Date("2026-10-05T00:00:00.000Z"))).toThrow(
      "Only a draft, ready, or running task can be cancelled",
    );
    const cancelled = cancelGenerationTask(task(), new Date("2026-10-05T00:00:00.000Z"));
    expect(cancelled.status).toBe("cancelled");
    expect(() => cancelGenerationTask(cancelled, new Date("2026-10-06T00:00:00.000Z"))).toThrow(
      "Only a draft, ready, or running task can be cancelled",
    );
  });
});
