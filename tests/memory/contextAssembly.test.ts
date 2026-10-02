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
      maxCharacters: 100000,
    });

    expect(context.sceneText).toBe(scene.text);
    expect(context.canonicalFacts).toEqual([relevantFact]);
    expect(context.stateRecords).toEqual([relevantState]);
    expect(context.memory.scenes).toEqual(memory.scenes);
    expect(context.taskIntent).toBe("Continue the scene.");
  });

  it("ignores stale scene event revisions when rebuilding memory", () => {
    const scene = sceneWithText("scene-rev-2", "Current text");
    const staleEvent = createDomainEvent({
      eventId: "event-stale",
      name: "SceneCommitted",
      context: "manuscript",
      novelId: "novel-1",
      objectId: scene.id,
      revisionId: "scene-rev-1",
      commitId: "commit-stale",
      payload: {},
      occurredAt: now,
    });
    const projection = rebuildMemoryProjection([staleEvent], [scene]);
    expect(projection.scenes[scene.id]).toBeUndefined();
  });

  it("excludes unrelated novel and position records", () => {
    const scene = sceneWithText("scene-rev-2", "Scoped context");
    const relevantFact = {
      id: "fact-relevant",
      novelId: "novel-1",
      type: "character_profile",
      content: { name: "Relevant" },
      currentRevisionId: "fact-rev-1",
      lastCommitId: "commit-1",
      createdAt: now,
      updatedAt: now,
    } satisfies CanonicalFact;
    const unrelatedFact = {
      ...relevantFact,
      id: "fact-other-novel",
      novelId: "novel-2",
    };
    const relevantState = {
      id: "state-relevant",
      novelId: "novel-1",
      type: "character_state",
      subjectId: "fact-relevant",
      position: { sceneId: scene.id, ordinal: 1 },
      content: { condition: "ready" },
      currentRevisionId: "state-rev-1",
      lastCommitId: "commit-1",
      createdAt: now,
      updatedAt: now,
    } satisfies StateRecord;
    const unrelatedState = {
      ...relevantState,
      id: "state-other-position",
      position: { sceneId: "scene-other", ordinal: 2 },
    };
    const context = assembleContext({
      scene,
      canonicalFacts: [relevantFact, unrelatedFact],
      stateRecords: [relevantState, unrelatedState],
      memory: rebuildMemoryProjection([], [scene]),
      requiredFactIds: ["fact-relevant"],
      requiredStateIds: ["state-relevant"],
      taskIntent: "Use only relevant context.",
      maxCharacters: 100000,
    });

    expect(context.canonicalFacts.map((fact) => fact.id)).toEqual(["fact-relevant"]);
    expect(context.stateRecords.map((record) => record.id)).toEqual(["state-relevant"]);
  });

  it("rejects missing required fact and state IDs", () => {
    const scene = sceneWithText("scene-rev-2", "Missing required context");
    const memory = rebuildMemoryProjection([], [scene]);
    expect(() =>
      assembleContext({
        scene,
        canonicalFacts: [],
        stateRecords: [],
        memory,
        requiredFactIds: ["missing-fact"],
        requiredStateIds: [],
        taskIntent: "Continue.",
        maxCharacters: 100000,
      }),
    ).toThrow("Required canonical fact not found: missing-fact");
    expect(() =>
      assembleContext({
        scene,
        canonicalFacts: [],
        stateRecords: [],
        memory,
        requiredFactIds: [],
        requiredStateIds: ["missing-state"],
        taskIntent: "Continue.",
        maxCharacters: 100000,
      }),
    ).toThrow("Required state record not found: missing-state");
  });

  it("truncates deterministic context entries and reports overflow", () => {
    const scene = sceneWithText("scene-rev-2", "Scene.");
    const makeFact = (id: string, value: string) =>
      ({
        id,
        novelId: "novel-1",
        type: "character_profile",
        content: { value },
        currentRevisionId: `${id}-rev-1`,
        lastCommitId: "commit-1",
        createdAt: now,
        updatedAt: now,
      }) satisfies CanonicalFact;
    const facts = [makeFact("fact-a", "x".repeat(50)), makeFact("fact-b", "y".repeat(50))];
    const context = assembleContext({
      scene,
      canonicalFacts: facts,
      stateRecords: [],
      memory: rebuildMemoryProjection([], [scene]),
      requiredFactIds: ["fact-a", "fact-b"],
      requiredStateIds: [],
      taskIntent: "Fit within budget.",
      maxCharacters: 300,
    });

    expect(context.overflowed).toBe(true);
    expect(context.selectedCharacterCount).toBeLessThanOrEqual(300);
    expect(context.canonicalFacts.map((fact) => fact.id)).toEqual(["fact-a"]);
    expect(context.omittedFactIds).toEqual(["fact-b"]);
    expect(context.omittedStateIds).toEqual([]);
  });
});
