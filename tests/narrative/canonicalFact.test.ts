import { describe, expect, it } from "vitest";
import { createCanonicalFact, replaceCanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("CanonicalFact", () => {
  it("creates an immutable author-approved fact", () => {
    const fact = createCanonicalFact({
      id: "fact-1",
      novelId: "novel-1",
      type: "character_profile",
      content: { name: "Lin Chuan", sect: "Northern Sect" },
      revisionId: "fact-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    expect(fact.currentRevisionId).toBe("fact-rev-1");
    expect(fact.content).toEqual({ name: "Lin Chuan", sect: "Northern Sect" });
    expect(Object.isFrozen(fact.content)).toBe(true);
  });

  it("deep-freezes nested canonical content", () => {
    const fact = createCanonicalFact({
      id: "fact-nested",
      novelId: "novel-1",
      type: "character_profile",
      content: { traits: { patience: 8 }, tags: [{ value: "sword" }] },
      revisionId: "fact-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    const traits = (fact.content as { traits: Record<string, number> }).traits;
    const tags = (fact.content as { tags: Array<{ value: string }> }).tags;
    const firstTag = tags[0];
    if (!firstTag) throw new Error("Expected nested tag");
    expect(Object.isFrozen(traits)).toBe(true);
    expect(Object.isFrozen(tags)).toBe(true);
    expect(Object.isFrozen(firstTag)).toBe(true);
    expect(() => {
      traits.patience = 1;
    }).toThrow();
    expect(() => {
      firstTag.value = "changed";
    }).toThrow();
  });

  it("requires a commit id for canonical replacement", () => {
    const fact = createCanonicalFact({
      id: "fact-1",
      novelId: "novel-1",
      type: "world_rule",
      content: { rule: "Cultivation drains stamina" },
      revisionId: "fact-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    expect(() =>
      replaceCanonicalFact({
        fact,
        content: { rule: "Cultivation drains life force" },
        revisionId: "fact-rev-2",
        commitId: "",
        updatedAt: new Date("2026-10-03T00:00:00.000Z"),
      }),
    ).toThrow("commitId is required");
  });

  it("replaces content as a new revision without mutating the old fact", () => {
    const fact = createCanonicalFact({
      id: "fact-1",
      novelId: "novel-1",
      type: "world_rule",
      content: { rule: "Old rule" },
      revisionId: "fact-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    const replacement = replaceCanonicalFact({
      fact,
      content: { rule: "New rule" },
      revisionId: "fact-rev-2",
      commitId: "commit-2",
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });

    expect(fact.content).toEqual({ rule: "Old rule" });
    expect(replacement.currentRevisionId).toBe("fact-rev-2");
    expect(replacement.lastCommitId).toBe("commit-2");
  });
});
