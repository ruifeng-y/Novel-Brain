import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaEngineDependencies } from "../../src/app/prismaComposition";
import { createArc, reorderArcChapters } from "../../src/manuscript/domain/arc";
import { createChapter } from "../../src/manuscript/domain/chapter";
import { reconcileStructure } from "../../src/manuscript/application/structureReconciliation";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public";

const novelId = "novel-w1-arc-chapter";
const at = new Date("2026-10-06T00:00:00.000Z");

const prisma = new PrismaClient();
const readerPrisma = new PrismaClient();
const aggregateTypes = ["Arc", "Chapter"];

async function clear(): Promise<void> {
  await prisma.currentObject.deleteMany({
    where: { novelId, aggregateType: { in: aggregateTypes } },
  });
  await prisma.revisionRecord.deleteMany({
    where: { novelId, aggregateType: { in: aggregateTypes } },
  });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
  await readerPrisma.$disconnect();
});

describe("Prisma [task:W1-1] arc and chapter persistence", () => {
  it("reads an arc and a chapter written through a fresh composition root", async () => {
    const writer = createPrismaEngineDependencies(prisma);
    const arc = createArc({ id: "arc-w1", novelId, title: "第一幕", createdAt: at });
    await writer.arcs.save(
      reorderArcChapters({
        arc,
        chapterIds: ["chapter-w1"],
        updatedAt: new Date(at.getTime() + 1000),
      }),
    );
    await writer.chapters.save(
      createChapter({ id: "chapter-w1", novelId, arcId: "arc-w1", title: "第一章", createdAt: at }),
    );

    const reader = createPrismaEngineDependencies(readerPrisma);
    const storedArc = await reader.arcs.findById("arc-w1");
    const storedChapter = await reader.chapters.findById("chapter-w1");

    expect(storedArc).toBeDefined();
    expect(storedArc?.chapterIds).toEqual(["chapter-w1"]);
    expect(storedArc?.createdAt).toBeInstanceOf(Date);
    expect(storedArc?.updatedAt.toISOString()).toBe(
      new Date(at.getTime() + 1000).toISOString(),
    );
    expect(storedChapter?.arcId).toBe("arc-w1");
    expect(storedChapter?.createdAt).toBeInstanceOf(Date);
  });

  it("scopes listByNovel to the novel that owns the structure", async () => {
    const writer = createPrismaEngineDependencies(prisma);
    const arc = createArc({ id: "arc-list", novelId, title: "Arc", createdAt: at });
    await writer.arcs.save(
      reorderArcChapters({
        arc,
        chapterIds: ["chapter-list"],
        updatedAt: new Date(at.getTime() + 1000),
      }),
    );
    await writer.chapters.save(
      createChapter({ id: "chapter-list", novelId, arcId: "arc-list", title: "Chapter", createdAt: at }),
    );

    const reader = createPrismaEngineDependencies(readerPrisma);
    expect((await reader.arcs.listByNovel(novelId)).map((entry) => entry.id)).toEqual(["arc-list"]);
    expect((await reader.chapters.listByNovel(novelId)).map((entry) => entry.id)).toEqual([
      "chapter-list",
    ]);
    expect(await reader.arcs.listByNovel("novel-other")).toEqual([]);

    const result = reconcileStructure({
      arcs: await reader.arcs.listByNovel(novelId),
      chapters: await reader.chapters.listByNovel(novelId),
      scenes: [],
    });
    expect(result.degraded).toBe(false);
  });
});
