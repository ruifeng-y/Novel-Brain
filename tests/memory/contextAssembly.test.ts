import { describe, expect, it } from "vitest";
import type { CanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../src/narrative/state/domain/stateRecord";
import { commitSceneText, createScene } from "../../src/manuscript/domain/scene";
import { assembleContext } from "../../src/memory/application/contextAssembly";
import {
  isMemoryProjectionStale,
  rebuildMemoryProjection,
} from "../../src/memory/projections/memoryProjection";
import { createDomainEvent } from "../../src/safety/domain/domainEvent";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");

function sceneWithText(revisionId: string, text: string) {
  const scene = createScene({
    id: "scene-1",
    novelId: "novel-1",
    chapterId: "chapter-1",
    title: "The Northern Gate",
    revisionId: "scene-rev-1",
    commitId: "initial-commit",
    createdAt: now,
  });
  return commitSceneText({
    scene,
    text,
    revisionId,
    commitId: `commit-${revisionId}`,
    updatedAt: now,
  });
}

describe("memory and context", () => {
  it("rebuilds memory from committed scene events", () => {
    const scene = sceneWithText("scene-rev-2", "Lin Chuan entered the Northern Sect gate.");
    const events = [
      createDomainEvent({
        eventId: "event-1",
        name: "SceneCommitted",
        context: "manuscript",
        novelId: "novel-1",
        objectId: scene.id,
        revisionId: scene.currentRevisionId,
        commitId: "commit-1",
        payload: { textLength: scene.text.length },
        occurredAt: now,
      }),
    ];
    const projection = rebuildMemoryProjection(events, [scene]);
    expect(projection.scenes["scene-1"]).toEqual({
      revisionId: "scene-rev-2",
      summary: "Lin Chuan entered the Northern Sect gate.",
    });
  });

  it("detects stale memory using the scene version set", () => {
    const scene = sceneWithText("scene-rev-2", "Old text");
    const projection = rebuildMemoryProjection([], [scene]);
    const versionSet = createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-rev-3"),
    });
    expect(isMemoryProjectionStale(projection, versionSet)).toBe(true);
  });

  it("assembles only relevant facts and current state for a task", () => {
    const scene = sceneWithText("scene-rev-2", "Lin Chuan waited at the gate.");
    const relevantFact = {
      id: "fact-1",
      novelId: "novel-1",
      type: "character_profile",
      content: { name: "Lin Chuan", sect: "Northern Sect" },
      currentRevisionId: "fact-rev-1",
      lastCommitId: "commit-1",
      createdAt: now,
      updatedAt: now,
    } satisfies CanonicalFact;
    const relevantState = {
      id: "state-1",
      novelId: "novel-1",
      type: "character_state",
      subjectId: "fact-1",
      position: { sceneId: "scene-1", ordinal: 1 },
      content: { condition: "left arm injured" },
      currentRevisionId: "state-rev-1",
      lastCommitId: "commit-1",
      createdAt: now,
      updatedAt: now,
    } satisfies StateRecord;
    const memory = rebuildMemoryProjection([], [scene]);

    const context = assembleContext({
      scene,
      canonicalFacts: [relevantFact],
      stateRecords: [relevantState],
      memory,
      requiredFactIds: ["fact-1"],
      requiredStateIds: ["state-1"],
      taskIntent: "Continue the scene.",
    });

    expect(context.sceneText).toBe(scene.text);
    expect(context.canonicalFacts).toEqual([relevantFact]);
    expect(context.stateRecords).toEqual([relevantState]);
    expect(context.memory.scenes).toEqual(memory.scenes);
    expect(context.taskIntent).toBe("Continue the scene.");
  });
});
