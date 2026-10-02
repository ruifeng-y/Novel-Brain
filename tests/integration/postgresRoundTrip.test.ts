import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { commitSceneText, createScene } from "../../src/manuscript/domain/scene";
import {
  PrismaEventStore,
  PrismaRevisionedRepository,
} from "../../src/shared/infrastructure/prismaRepositories";
import { createDomainEvent } from "../../src/safety/domain/domainEvent";
import type { Scene } from "../../src/manuscript/domain/scene";

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
    expect(events).toEqual([event]);
    await expect(store.append(event)).rejects.toThrow("Unique constraint failed");
  });
});
