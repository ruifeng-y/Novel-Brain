import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createNovel, type Novel } from "../../src/narrative/novel/domain/novel";
import { commitSceneText, createScene } from "../../src/manuscript/domain/scene";
import {
  PrismaRepository,
  PrismaEventStore,
  PrismaRevisionedRepository,
} from "../../src/shared/infrastructure/prismaRepositories";
import { createDomainEvent } from "../../src/safety/domain/domainEvent";
import type { Scene } from "../../src/manuscript/domain/scene";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public";
const prisma = new PrismaClient();

describe("PostgreSQL persistence", () => {
  beforeAll(async () => {
    await prisma.currentObject.deleteMany();
    await prisma.revisionRecord.deleteMany();
    await prisma.domainEvent.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("round-trips immutable scene revisions", async () => {
    const repository = new PrismaRevisionedRepository<Scene>(prisma, "Scene", payload => ({
      ...payload,
      createdAt: new Date(payload.createdAt as string),
      updatedAt: new Date(payload.updatedAt as string),
    } as Scene));

    const now = new Date("2026-10-02T00:00:00.000Z");
    const scene = createScene({
      id: "scene-1",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "The Northern Gate",
      revisionId: "scene-rev-1",
      commitId: "initial-commit",
      createdAt: now,
    });
    const committed = commitSceneText({
      scene,
      text: "Lin Chuan waited.",
      revisionId: "scene-rev-2",
      commitId: "commit-1",
      updatedAt: now,
    });

    await repository.save(committed);
    expect((await repository.findById("scene-1"))?.text).toBe("Lin Chuan waited.");
    expect((await repository.getRevision("scene-1", "scene-rev-2"))?.currentRevisionId).toBe(
      "scene-rev-2",
    );
  });

  it("deep-clones and freezes repository snapshots and supports Novel fallback ownership", async () => {
    interface PlainEntity {
      id: string;
      novelId: string;
      title: string;
      nested: { values: string[] };
    }
    const repository = new PrismaRepository<PlainEntity>(
      prisma,
      "PlainEntity",
      payload =>
        ({
          id: payload.id as string,
          novelId: payload.novelId as string,
          title: payload.title as string,
          nested: payload.nested as PlainEntity["nested"],
        }) as PlainEntity,
    );
    const input: PlainEntity = {
      id: "plain-1",
      novelId: "novel-plain",
      title: "Plain",
      nested: { values: ["original"] },
    };
    await repository.save(input);
    input.nested.values.push("mutated-input");
    const loaded = await repository.findById("plain-1");
    expect(loaded?.nested.values).toEqual(["original"]);
    expect(() => loaded?.nested.values.push("mutated-read")).toThrow();

    const novelRepository = new PrismaRepository<Novel>(
      prisma,
      "Novel",
      payload =>
        ({
          ...payload,
          createdAt: new Date(payload.createdAt as string),
          updatedAt: new Date(payload.updatedAt as string),
        }) as Novel,
    );
    const novel = createNovel({
      id: "novel-fallback",
      authorId: "author-1",
      title: "Fallback Novel",
      createdAt: new Date("2026-10-02T00:00:00.000Z"),
    });
    await novelRepository.save(novel);
    await expect(novelRepository.listByNovel(novel.id)).resolves.toHaveLength(1);
  });

  it("compares revision payloads independently of key order and rejects conflicting reuse", async () => {
    interface RevisionEntity {
      id: string;
      novelId: string;
      currentRevisionId: string;
      content: { first: number; nested: { left: number; right: number } };
    }
    const repository = new PrismaRevisionedRepository<RevisionEntity>(
      prisma,
      "RevisionEntity",
      payload =>
        ({
          id: payload.id as string,
          novelId: payload.novelId as string,
          currentRevisionId: payload.currentRevisionId as string,
          content: payload.content as RevisionEntity["content"],
        }) as RevisionEntity,
    );
    await repository.save({
      id: "revision-order",
      novelId: "novel-order",
      currentRevisionId: "rev-1",
      content: { first: 1, nested: { left: 2, right: 3 } },
    });
    await repository.save({
      id: "revision-order",
      novelId: "novel-order",
      currentRevisionId: "rev-1",
      content: { nested: { right: 3, left: 2 }, first: 1 },
    });
    await expect(
      repository.save({
        id: "revision-order",
        novelId: "novel-order",
        currentRevisionId: "rev-1",
        content: { first: 1, nested: { left: 2, right: 4 } },
      }),
    ).rejects.toThrow("Revision already exists: revision-order:rev-1");
    expect((await repository.getRevision("revision-order", "rev-1"))?.content.nested.right).toBe(3);
  });

  it("round-trips domain events with append-only identity", async () => {
    const store = new PrismaEventStore(prisma);
    const event = createDomainEvent({
      eventId: "event-1",
      name: "SceneCommitted",
      context: "manuscript",
      novelId: "novel-1",
      objectId: "scene-1",
      revisionId: "scene-rev-2",
      commitId: "commit-1",
      payload: { textLength: 18 },
      occurredAt: new Date("2026-10-02T00:00:00.000Z"),
    });

    await store.append(event);
    const events = await store.listByNovel("novel-1");
    const secondEvent = createDomainEvent({
      eventId: "event-2",
      name: "CharacterStateChanged",
      context: "narrative_state",
      novelId: "novel-1",
      objectId: "state-1",
      revisionId: "state-rev-1",
      commitId: "commit-1",
      payload: { condition: "injured" },
      occurredAt: new Date("2026-10-02T00:00:01.000Z"),
    });
    await store.append(secondEvent);
    const orderedEvents = await store.listByNovel("novel-1");
    expect(orderedEvents.map(item => item.eventId)).toEqual(["event-1", "event-2"]);
    await expect(store.append(event)).rejects.toThrow("Unique constraint failed");
  });

  it("rolls back an atomic event batch with duplicate IDs", async () => {
    const store = new PrismaEventStore(prisma);
    const first = createDomainEvent({
      eventId: "batch-event-1",
      name: "SceneCommitted",
      context: "manuscript",
      novelId: "novel-batch",
      objectId: "scene-batch",
      revisionId: "scene-rev-1",
      payload: {},
      occurredAt: new Date("2026-10-02T00:00:00.000Z"),
    });
    await expect(
      store.appendMany([first, { ...first, eventId: "batch-event-1" }]),
    ).rejects.toThrow();
    expect(await store.listByNovel("novel-batch")).toEqual([]);
  });
});
