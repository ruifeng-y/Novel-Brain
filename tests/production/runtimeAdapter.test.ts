import { describe, expect, it } from "vitest";
import { createGenerationTask } from "../../src/production/domain/generationTask";
import { DeterministicRuntime } from "../../src/production/runtime/deterministicRuntime";
import type { CandidateChange } from "../../src/production/domain/candidate";
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
      basedOnVersionSet: task.basedOnVersionSet,
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
        basedOnVersionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
        }),
        context: {},
        requestedChange: { type: "text", sceneId: "scene-1", text: "Result" },
      }),
    ).resolves.toMatchObject({ taskId: "task-1" });
  });

  it("returns the request version set instead of an empty set", async () => {
    const basedOnVersionSet = createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
    });
    const result = await new DeterministicRuntime().execute({
      taskId: "task-version",
      agentRole: "writer",
      modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
      basedOnVersionSet,
      context: {},
      requestedChange: { type: "text", sceneId: "scene-1", text: "Result" },
    });
    expect(result.basedOnVersionSet).toEqual(basedOnVersionSet);
  });

  it("rejects invalid runtime inputs", async () => {
    const runtime = new DeterministicRuntime();
    await expect(
      runtime.execute({
        taskId: "",
        agentRole: "writer",
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
        basedOnVersionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
        }),
        context: {},
        requestedChange: { type: "text", sceneId: "scene-1", text: "Result" },
      }),
    ).rejects.toThrow("taskId is required");
    await expect(
      runtime.execute({
        taskId: "task-invalid",
        agentRole: "writer",
        modelPolicy: { provider: "", model: "deterministic", maxOutputTokens: 1000 },
        basedOnVersionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
        }),
        context: {},
        requestedChange: { type: "text", sceneId: "scene-1", text: "Result" },
      }),
    ).rejects.toThrow("provider is required");
    await expect(
      runtime.execute({
        taskId: "task-invalid",
        agentRole: "unknown" as never,
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
        basedOnVersionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
        }),
        context: {},
        requestedChange: { type: "text", sceneId: "scene-1", text: "Result" },
      }),
    ).rejects.toThrow("agentRole is invalid");
    await expect(
      runtime.execute({
        taskId: "task-invalid",
        agentRole: "writer",
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 0 },
        basedOnVersionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
        }),
        context: {},
        requestedChange: { type: "text", sceneId: "scene-1", text: "Result" },
      }),
    ).rejects.toThrow("maxOutputTokens must be positive");
    await expect(
      runtime.execute({
        taskId: "task-invalid-change",
        agentRole: "writer",
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
        basedOnVersionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
        }),
        context: {},
        requestedChange: { type: "text", sceneId: "scene-1", text: "" },
      }),
    ).rejects.toThrow("text change requires sceneId and text");
  });

  it("clones and freezes nested change content", async () => {
    const requestedChange = {
      type: "structured_state",
      stateRecordId: "state-1",
      content: { nested: { values: ["original"] } },
    } as unknown as CandidateChange;
    const result = await new DeterministicRuntime().execute({
      taskId: "task-immutable",
      agentRole: "writer",
      modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
      basedOnVersionSet: createVersionSet({
        state: createVersionReference("StateRecord", "state-1", "state-rev-1"),
      }),
      context: {},
      requestedChange,
    });
    const mutableContent = (requestedChange as unknown as {
      content: { nested: { values: string[] } };
    }).content;
    mutableContent.nested.values.push("mutated-input");
    const content = (result.change as unknown as {
      content: { nested: { values: string[] } };
    }).content;
    expect(content.nested.values).toEqual(["original"]);
    expect(Object.isFrozen(content)).toBe(true);
    expect(Object.isFrozen(content.nested)).toBe(true);
    expect(Object.isFrozen(content.nested.values)).toBe(true);
  });
});
