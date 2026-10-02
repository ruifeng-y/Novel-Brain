import { describe, expect, it } from "vitest";
import { createStateRecord, replaceStateRecord } from "../../src/narrative/state/domain/stateRecord";

const now = new Date("2026-10-02T00:00:00.000Z");
const position = { sceneId: "scene-1", ordinal: 3 };

describe("position-aware StateRecord", () => {
  it("binds state to a narrative position", () => {
    const record = createStateRecord({
      id: "state-1",
      novelId: "novel-1",
      type: "character_state",
      subjectId: "fact-1",
      position,
      content: { condition: "left arm injured" },
      revisionId: "state-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    expect(record.position).toEqual(position);
    expect(record.currentRevisionId).toBe("state-rev-1");
  });

  it("rejects a state record without a subject", () => {
    expect(() =>
      createStateRecord({
        id: "state-1",
        novelId: "novel-1",
        type: "world_state",
        subjectId: "",
        position,
        content: { season: "winter" },
        revisionId: "state-rev-1",
        commitId: "commit-1",
        createdAt: now,
      }),
    ).toThrow("subjectId is required");
  });

  it("creates a new position-aware revision only through a commit", () => {
    const original = createStateRecord({
      id: "state-1",
      novelId: "novel-1",
      type: "character_state",
      subjectId: "fact-1",
      position,
      content: { condition: "healthy" },
      revisionId: "state-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    const replacement = replaceStateRecord({
      record: original,
      content: { condition: "left arm injured" },
      revisionId: "state-rev-2",
      commitId: "commit-2",
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });

    expect(original.content).toEqual({ condition: "healthy" });
    expect(replacement.currentRevisionId).toBe("state-rev-2");
    expect(replacement.position).toEqual(position);
  });

  it("deep-freezes nested state content", () => {
    const record = createStateRecord({
      id: "state-nested",
      novelId: "novel-1",
      type: "character_state",
      subjectId: "fact-1",
      position: { sceneId: "scene-1", ordinal: 0 },
      content: { knowledge: { facts: ["secret"] } },
      revisionId: "state-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    const knowledge = (record.content as { knowledge: { facts: string[] } }).knowledge;
    expect(Object.isFrozen(knowledge)).toBe(true);
    expect(Object.isFrozen(knowledge.facts)).toBe(true);
    expect(() => {
      knowledge.facts.push("changed");
    }).toThrow();
  });
});
