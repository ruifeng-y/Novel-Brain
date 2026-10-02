import { describe, expect, it } from "vitest";
import { InMemoryRepository, InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import { createCandidate } from "../../src/production/domain/candidate";
import { createNovel } from "../../src/narrative/novel/domain/novel";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("repositories", () => {
  it("saves and lists plain aggregates by novel", async () => {
    const repository = new InMemoryRepository<{ id: string; novelId: string; title: string }>();
    await repository.save({ id: "novel-1", novelId: "novel-1", title: "Novel" });
    const loaded = await repository.findById("novel-1");
    const novels = await repository.listByNovel("novel-1");
    expect(loaded?.title).toBe("Novel");
    expect(novels).toHaveLength(1);
    await expect(repository.findById("missing")).resolves.toBeUndefined();
  });

  it("preserves immutable revisions by object and revision id", async () => {
    const repository = new InMemoryRevisionedRepository<{
      id: string;
      novelId: string;
      currentRevisionId: string;
      value: string;
    }>();

    await repository.save({
      id: "object-1",
      novelId: "novel-1",
      currentRevisionId: "rev-1",
      value: "old",
    });
    await repository.save({
      id: "object-1",
      novelId: "novel-1",
      currentRevisionId: "rev-2",
      value: "new",
    });

    expect((await repository.getRevision("object-1", "rev-1"))?.value).toBe("old");
    expect((await repository.getRevision("object-1", "rev-2"))?.value).toBe("new");
    expect((await repository.findById("object-1"))?.value).toBe("new");
  });

  it("returns frozen current aggregates", async () => {
    const repository = new InMemoryRepository<{ id: string; novelId: string; title: string }>();
    await repository.save({ id: "novel-1", novelId: "novel-1", title: "Novel" });
    const loaded = await repository.findById("novel-1");
    expect(() => {
      if (loaded) (loaded as { title: string }).title = "Mutated";
    }).toThrow();
  });
});
