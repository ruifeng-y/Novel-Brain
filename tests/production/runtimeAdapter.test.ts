import { describe, expect, it } from "vitest";
import { createGenerationTask } from "../../src/production/domain/generationTask";
import { DeterministicRuntime } from "../../src/production/runtime/deterministicRuntime";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("runtime abstraction", () => {
  it("separates agent role from model and runtime", async () => {
    const task = createGenerationTask({
      id: "task-1",
      novelId: "novel-1",
      operation: "rewrite",
      targetSceneId: "scene-1",
      intent: "Rewrite with more tension.",
      basedOnVersionSet: createVersionSet({
        scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
      }),
      createdAt: now,
    });

    const runtime = new DeterministicRuntime();
    const result = await runtime.execute({
      taskId: "task-1",
      agentRole: "writer",
      modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
      context: { taskIntent: task.intent },
      requestedChange: { type: "text", sceneId: "scene-1", text: "Deterministic result" },
    });

    expect(result.taskId).toBe("task-1");
    expect(result.agentRole).toBe("writer");
    expect(result.modelPolicy.model).toBe("deterministic");
    expect(result.change).toEqual({ type: "text", sceneId: "scene-1", text: "Deterministic result" });
  });

  it("requires the same task identity in the result contract", async () => {
    const runtime = new DeterministicRuntime();
    await expect(
      runtime.execute({
        taskId: "task-1",
        agentRole: "writer",
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
        context: {},
        requestedChange: { type: "text", sceneId: "scene-1", text: "Result" },
      }),
    ).resolves.toMatchObject({ taskId: "task-1" });
  });
});
