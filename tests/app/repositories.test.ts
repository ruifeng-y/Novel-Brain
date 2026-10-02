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

  it("lists a real Novel using its id as novel identity", async () => {
    const repository = new InMemoryRepository<ReturnType<typeof createNovel>>();
    const novel = createNovel({
      id: "novel-real",
      authorId: "author-1",
      title: "Real Novel",
      createdAt: now,
    });
    await repository.save(novel);
    await expect(repository.listByNovel(novel.id)).resolves.toHaveLength(1);
    await expect(repository.listByNovel("missing")).resolves.toHaveLength(0);
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

  it("deep-clones nested current and revision snapshots", async () => {
    const repository = new InMemoryRevisionedRepository<{
      id: string;
      novelId: string;
      currentRevisionId: string;
      nested: { values: string[] };
    }>();
    const original = {
      id: "nested-1",
      novelId: "novel-1",
      currentRevisionId: "rev-1",
      nested: { values: ["original"] },
    };
    await repository.save(original);
    original.nested.values.push("mutated-input");
    const loaded = await repository.findById("nested-1");
    expect(loaded?.nested.values).toEqual(["original"]);
    expect(() => loaded?.nested.values.push("mutated-snapshot")).toThrow();
  });

  it("rejects reusing an immutable revision id with different content", async () => {
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
    await expect(
      repository.save({
        id: "object-1",
        novelId: "novel-1",
        currentRevisionId: "rev-1",
        value: "changed",
      }),
    ).rejects.toThrow("Revision already exists: object-1:rev-1");
    await repository.save({
      id: "object-1",
      novelId: "novel-1",
      currentRevisionId: "rev-2",
      value: "new",
    });
    expect((await repository.getRevision("object-1", "rev-1"))?.value).toBe("old");
    expect((await repository.findById("object-1"))?.value).toBe("new");
  });
});
