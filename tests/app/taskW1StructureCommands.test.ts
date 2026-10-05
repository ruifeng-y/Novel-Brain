import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createStructureCommandService } from "../../src/app/structureCommandService";
import { createArc, reorderArcChapters, type Arc } from "../../src/manuscript/domain/arc";
import {
  createChapter,
  reorderChapterScenes,
  type Chapter,
} from "../../src/manuscript/domain/chapter";
import { createScene, type Scene } from "../../src/manuscript/domain/scene";

const NOVEL = "novel-1";
const AT = new Date("2026-10-06T00:00:00.000Z");

type Dependencies = ReturnType<typeof createInMemoryEngineDependencies>;

function arcFixture(input: {
  readonly id: string;
  readonly novelId?: string;
  readonly chapterIds?: readonly string[];
}): Arc {
  const base = createArc({
    id: input.id,
    novelId: input.novelId ?? NOVEL,
    title: input.id,
    createdAt: AT,
  });
  return reorderArcChapters({ arc: base, chapterIds: input.chapterIds ?? [], updatedAt: AT });
}

function chapterFixture(input: {
  readonly id: string;
  readonly novelId?: string;
  readonly arcId: string;
  readonly sceneIds?: readonly string[];
}): Chapter {
  const base = createChapter({
    id: input.id,
    novelId: input.novelId ?? NOVEL,
    arcId: input.arcId,
    title: input.id,
    createdAt: AT,
  });
  return reorderChapterScenes({ chapter: base, sceneIds: input.sceneIds ?? [], updatedAt: AT });
}

function sceneFixture(input: {
  readonly id: string;
  readonly novelId?: string;
  readonly chapterId: string;
}): Scene {
  return createScene({
    id: input.id,
    novelId: input.novelId ?? NOVEL,
    chapterId: input.chapterId,
    title: input.id,
    revisionId: `${input.id}:rev-1`,
    commitId: `initial:${input.id}`,
    createdAt: AT,
  });
}

async function build(seed: {
  readonly arcs?: readonly Arc[];
  readonly chapters?: readonly Chapter[];
  readonly scenes?: readonly Scene[];
}): Promise<Dependencies> {
  const dependencies = createInMemoryEngineDependencies();
  for (const arc of seed.arcs ?? []) await dependencies.arcs.save(arc);
  for (const chapter of seed.chapters ?? []) await dependencies.chapters.save(chapter);
  for (const scene of seed.scenes ?? []) await dependencies.scenes.save(scene);
  return dependencies;
}

function service(dependencies: Dependencies) {
  return createStructureCommandService(dependencies);
}

describe("[task:W1] [domain] structure command service", () => {
  it("rejects a chapter whose arc does not exist", async () => {
    const dependencies = await build({});

    await expect(
      service(dependencies).createChapter({
        id: "chapter-x",
        novelId: NOVEL,
        arcId: "arc-missing",
        title: "X",
        createdAt: AT,
      }),
    ).rejects.toThrow();

    expect(await dependencies.chapters.findById("chapter-x")).toBeUndefined();
  });

  it("rejects a chapter whose arc belongs to another novel", async () => {
    const dependencies = await build({
      arcs: [arcFixture({ id: "arc-other", novelId: "novel-2" })],
    });

    await expect(
      service(dependencies).createChapter({
        id: "chapter-x",
        novelId: NOVEL,
        arcId: "arc-other",
        title: "X",
        createdAt: AT,
      }),
    ).rejects.toThrow();
  });

  it("[cross-system] creates an arc and a chapter and reads back the container order", async () => {
    const dependencies = await build({});
    const commands = service(dependencies);

    const arc = await commands.createArc({
      id: "arc-1",
      novelId: NOVEL,
      title: "第一幕",
      createdAt: AT,
    });
    const chapter = await commands.createChapter({
      id: "chapter-1",
      novelId: NOVEL,
      arcId: "arc-1",
      title: "第一章",
      createdAt: AT,
    });
    const reordered = await commands.reorderArcChapters({
      arcId: "arc-1",
      chapterIds: ["chapter-1"],
      updatedAt: new Date(AT.getTime() + 1000),
    });

    expect(arc.chapterIds).toEqual([]);
    expect(chapter.arcId).toBe("arc-1");
    expect(reordered.chapterIds).toEqual(["chapter-1"]);
    expect((await dependencies.arcs.findById("arc-1"))?.chapterIds).toEqual(["chapter-1"]);
  });

  it("rejects reordering an arc with a chapter that does not exist", async () => {
    const dependencies = await build({
      arcs: [arcFixture({ id: "arc-1" })],
    });

    await expect(
      service(dependencies).reorderArcChapters({
        arcId: "arc-1",
        chapterIds: ["chapter-ghost"],
        updatedAt: new Date(AT.getTime() + 1000),
      }),
    ).rejects.toThrow();

    expect((await dependencies.arcs.findById("arc-1"))?.chapterIds).toEqual([]);
  });

  it("rejects reordering an arc with a chapter from another novel", async () => {
    const dependencies = await build({
      arcs: [arcFixture({ id: "arc-1" })],
      chapters: [
        chapterFixture({ id: "chapter-other", novelId: "novel-2", arcId: "arc-other" }),
      ],
    });

    await expect(
      service(dependencies).reorderArcChapters({
        arcId: "arc-1",
        chapterIds: ["chapter-other"],
        updatedAt: new Date(AT.getTime() + 1000),
      }),
    ).rejects.toThrow();
  });

  it("rejects reordering a chapter with a scene that does not exist", async () => {
    const dependencies = await build({
      arcs: [arcFixture({ id: "arc-1" })],
      chapters: [chapterFixture({ id: "chapter-1", arcId: "arc-1" })],
    });

    await expect(
      service(dependencies).reorderChapterScenes({
        chapterId: "chapter-1",
        sceneIds: ["scene-ghost"],
        updatedAt: new Date(AT.getTime() + 1000),
      }),
    ).rejects.toThrow();

    expect((await dependencies.chapters.findById("chapter-1"))?.sceneIds).toEqual([]);
  });

  it("rejects reordering a chapter with a scene from another novel", async () => {
    const dependencies = await build({
      arcs: [arcFixture({ id: "arc-1" })],
      chapters: [chapterFixture({ id: "chapter-1", arcId: "arc-1" })],
      scenes: [sceneFixture({ id: "scene-other", novelId: "novel-2", chapterId: "chapter-other" })],
    });

    await expect(
      service(dependencies).reorderChapterScenes({
        chapterId: "chapter-1",
        sceneIds: ["scene-other"],
        updatedAt: new Date(AT.getTime() + 1000),
      }),
    ).rejects.toThrow();
  });

  it("[regression] persists a valid scene order through the domain function", async () => {
    const dependencies = await build({
      arcs: [arcFixture({ id: "arc-1" })],
      chapters: [chapterFixture({ id: "chapter-1", arcId: "arc-1" })],
      scenes: [
        sceneFixture({ id: "scene-1", chapterId: "chapter-1" }),
        sceneFixture({ id: "scene-2", chapterId: "chapter-1" }),
      ],
    });

    const reordered = await service(dependencies).reorderChapterScenes({
      chapterId: "chapter-1",
      sceneIds: ["scene-2", "scene-1"],
      updatedAt: new Date(AT.getTime() + 1000),
    });

    expect(reordered.sceneIds).toEqual(["scene-2", "scene-1"]);
    expect((await dependencies.chapters.findById("chapter-1"))?.sceneIds).toEqual([
      "scene-2",
      "scene-1",
    ]);
  });
});
