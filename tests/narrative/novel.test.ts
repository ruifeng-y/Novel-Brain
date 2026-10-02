import { describe, expect, it } from "vitest";
import { createNovel, renameNovel, setAutonomyPolicy } from "../../src/narrative/novel/domain/novel";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("Novel aggregate", () => {
  it("creates a single-author novel", () => {
    const novel = createNovel({
      id: "novel-1",
      authorId: "author-1",
      title: "Blade of the Northern Sect",
      createdAt: now,
    });

    expect(novel).toEqual({
      id: "novel-1",
      authorId: "author-1",
      title: "Blade of the Northern Sect",
      status: "draft",
      autonomyPolicy: "human_review_required",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("rejects an empty author or title", () => {
    expect(() =>
      createNovel({ id: "novel-1", authorId: "", title: "Title", createdAt: now }),
    ).toThrow("authorId is required");
    expect(() =>
      createNovel({ id: "novel-1", authorId: "author-1", title: "", createdAt: now }),
    ).toThrow("title is required");
  });

  it("returns a new novel revision and does not mutate the original", () => {
    const original = createNovel({
      id: "novel-1",
      authorId: "author-1",
      title: "Old Title",
      createdAt: now,
    });
    const renamed = renameNovel(original, "New Title", new Date("2026-10-03T00:00:00.000Z"));
    expect(original.title).toBe("Old Title");
    expect(renamed.title).toBe("New Title");
    expect(renamed.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
  });

  it("does not allow autonomous writes to bypass review by default", () => {
    const original = createNovel({
      id: "novel-1",
      authorId: "author-1",
      title: "Title",
      createdAt: now,
    });
    const updated = setAutonomyPolicy(
      original,
      "policy_driven",
      new Date("2026-10-03T00:00:00.000Z"),
    );
    expect(original.autonomyPolicy).toBe("human_review_required");
    expect(updated.autonomyPolicy).toBe("policy_driven");
  });
});
