import { describe, expect, it } from "vitest";
import { createArc, type Arc } from "../../src/manuscript/domain/arc";
import { createChapter, type Chapter } from "../../src/manuscript/domain/chapter";
import { createScene, type Scene } from "../../src/manuscript/domain/scene";
import { reconcileStructure } from "../../src/manuscript/application/structureReconciliation";
import { createInMemoryEngineDependencies } from "../../src/app/composition";

const NOVEL = "novel-1";
const AT = new Date("2026-10-06T00:00:00.000Z");

function arcWith(input: { id: string } & Partial<Arc>): Arc {
  const base = createArc({
    id: input.id,
    novelId: input.novelId ?? NOVEL,
    title: input.title ?? input.id,
    createdAt: input.createdAt ?? AT,
  });
  return Object.freeze({ ...base, ...input });
}

function chapterWith(input: { id: string; arcId: string } & Partial<Chapter>): Chapter {
  const base = createChapter({
    id: input.id,
    novelId: input.novelId ?? NOVEL,
    arcId: input.arcId,
    title: input.title ?? input.id,
    createdAt: input.createdAt ?? AT,
  });
  return Object.freeze({ ...base, ...input });
}

function sceneWith(input: { id: string; chapterId: string } & Partial<Scene>): Scene {
  const base = createScene({
    id: input.id,
    novelId: input.novelId ?? NOVEL,
    chapterId: input.chapterId,
    title: input.title ?? input.id,
    revisionId: input.currentRevisionId ?? `${input.id}:rev-1`,
    commitId: input.lastCommitId ?? `commit-${input.id}`,
    createdAt: input.createdAt ?? AT,
  });
  return Object.freeze({ ...base, ...input });
}

describe("structure reconciliation", () => {
  it("reports a degraded structure when a scene points at a chapter that does not contain it", () => {
    const result = reconcileStructure({
      arcs: [arcWith({ id: "arc-1", chapterIds: ["chapter-1"] })],
      chapters: [chapterWith({ id: "chapter-1", arcId: "arc-1", sceneIds: ["scene-2"] })],
      scenes: [sceneWith({ id: "scene-1", chapterId: "chapter-1" })],
    });

    expect(result.degraded).toBe(true);
    expect(result.issues.map((issue) => issue.kind)).toEqual(["scene_pointer_mismatch"]);
  });

  it("reports a clean structure when pointers and containers agree", () => {
    const result = reconcileStructure({
      arcs: [arcWith({ id: "arc-1", chapterIds: ["chapter-1"] })],
      chapters: [chapterWith({ id: "chapter-1", arcId: "arc-1", sceneIds: ["scene-1"] })],
      scenes: [sceneWith({ id: "scene-1", chapterId: "chapter-1" })],
    });

    expect(result.degraded).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it("reports missing arcs and chapters instead of guessing membership", () => {
    const result = reconcileStructure({
      arcs: [],
      chapters: [chapterWith({ id: "chapter-1", arcId: "arc-missing" })],
      scenes: [sceneWith({ id: "scene-1", chapterId: "chapter-missing" })],
    });

    expect(result.degraded).toBe(true);
    expect(result.issues.map((issue) => issue.kind).sort()).toEqual([
      "arc_missing",
      "chapter_missing",
    ]);
  });

  it("reports a chapter whose arc exists but does not list it", () => {
    const result = reconcileStructure({
      arcs: [arcWith({ id: "arc-1", chapterIds: [] })],
      chapters: [chapterWith({ id: "chapter-1", arcId: "arc-1" })],
      scenes: [],
    });

    expect(result.issues.map((issue) => issue.kind)).toEqual(["chapter_pointer_mismatch"]);
    expect(result.issues[0]!.objectId).toBe("chapter-1");
  });
});

describe("Arc and Chapter composition wiring", () => {
  it("exposes Arc and Chapter repositories on the in-memory composition root", async () => {
    const dependencies = createInMemoryEngineDependencies();
    await dependencies.arcs.save(arcWith({ id: "arc-w1" }));
    await dependencies.chapters.save(chapterWith({ id: "chapter-w1", arcId: "arc-w1" }));

    expect((await dependencies.arcs.findById("arc-w1"))?.title).toBe("arc-w1");
    expect((await dependencies.chapters.findById("chapter-w1"))?.novelId).toBe(NOVEL);
    expect((await dependencies.chapters.listByNovel(NOVEL)).map((chapter) => chapter.id)).toEqual([
      "chapter-w1",
    ]);
  });

  it("persists the container ordering without inventing a second membership truth", async () => {
    const dependencies = createInMemoryEngineDependencies();
    await dependencies.arcs.save(
      arcWith({ id: "arc-order", chapterIds: ["chapter-b", "chapter-a"] }),
    );

    const stored = await dependencies.arcs.findById("arc-order");
    expect(stored?.chapterIds).toEqual(["chapter-b", "chapter-a"]);
    expect(stored?.createdAt).toBeInstanceOf(Date);
  });
});
