import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createStructuralNavigationQuery } from "../../src/app/structuralNavigationQuery";
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

describe("[task:W1] [domain] structural navigation query", () => {
  it("assembles arcs, chapters, and scenes in container order", async () => {
    const dependencies = await build({
      arcs: [arcFixture({ id: "arc-1", chapterIds: ["chapter-2", "chapter-1"] })],
      chapters: [
        chapterFixture({ id: "chapter-1", arcId: "arc-1", sceneIds: ["scene-2", "scene-1"] }),
        chapterFixture({ id: "chapter-2", arcId: "arc-1" }),
      ],
      scenes: [
        sceneFixture({ id: "scene-1", chapterId: "chapter-1" }),
        sceneFixture({ id: "scene-2", chapterId: "chapter-1" }),
      ],
    });

    const view = await createStructuralNavigationQuery(dependencies).getStructure(NOVEL);

    expect(view.novelId).toBe(NOVEL);
    expect(view.degraded).toBe(false);
    expect(view.orphanScenes).toEqual([]);
    expect(view.arcs.map(arc => arc.objectId)).toEqual(["arc-1"]);
    expect(view.arcs[0]!.kind).toBe("arc");
    expect(view.arcs[0]!.children.map(chapter => chapter.objectId)).toEqual([
      "chapter-2",
      "chapter-1",
    ]);
    expect(view.arcs[0]!.children[1]!.kind).toBe("chapter");
    expect(view.arcs[0]!.children[1]!.children.map(scene => scene.objectId)).toEqual([
      "scene-2",
      "scene-1",
    ]);
    expect(view.arcs[0]!.children[1]!.children[0]!.kind).toBe("scene");
    expect(view.issues).toEqual([]);
  });

  it("[cross-system] surfaces pointer mismatches as degraded instead of repairing them", async () => {
    const dependencies = await build({
      arcs: [arcFixture({ id: "arc-1", chapterIds: ["chapter-1"] })],
      chapters: [chapterFixture({ id: "chapter-1", arcId: "arc-1" })],
      scenes: [sceneFixture({ id: "scene-1", chapterId: "chapter-1" })],
    });

    const view = await createStructuralNavigationQuery(dependencies).getStructure(NOVEL);

    expect(view.degraded).toBe(true);
    expect(view.issues[0]!.kind).toBe("scene_pointer_mismatch");
    expect(view.arcs[0]!.children[0]!.children).toEqual([]);
    expect(view.orphanScenes.map(scene => scene.objectId)).toEqual(["scene-1"]);
  });

  it("[cross-system] surfaces a dangling chapter entry without fabricating a node", async () => {
    const dependencies = await build({
      arcs: [arcFixture({ id: "arc-1", chapterIds: ["chapter-1", "chapter-ghost"] })],
      chapters: [chapterFixture({ id: "chapter-1", arcId: "arc-1" })],
    });

    const view = await createStructuralNavigationQuery(dependencies).getStructure(NOVEL);

    expect(view.degraded).toBe(true);
    expect(view.arcs[0]!.children.map(chapter => chapter.objectId)).toEqual(["chapter-1"]);
    const ghost = view.issues.find(issue => issue.kind === "arc_chapter_entry_missing");
    expect(ghost?.objectId).toBe("chapter-ghost");
  });

  it("surfaces a dangling scene entry without fabricating a node", async () => {
    const dependencies = await build({
      arcs: [arcFixture({ id: "arc-1", chapterIds: ["chapter-1"] })],
      chapters: [chapterFixture({ id: "chapter-1", arcId: "arc-1", sceneIds: ["scene-ghost"] })],
    });

    const view = await createStructuralNavigationQuery(dependencies).getStructure(NOVEL);

    expect(view.degraded).toBe(true);
    expect(view.arcs[0]!.children[0]!.children).toEqual([]);
    const ghost = view.issues.find(issue => issue.kind === "chapter_scene_entry_missing");
    expect(ghost?.objectId).toBe("scene-ghost");
  });

  it("reports a scene with no resolvable chapter as an orphan instead of dropping it", async () => {
    const dependencies = await build({
      arcs: [arcFixture({ id: "arc-1", chapterIds: ["chapter-1"] })],
      chapters: [chapterFixture({ id: "chapter-1", arcId: "arc-1" })],
      scenes: [sceneFixture({ id: "scene-1", chapterId: "chapter-missing" })],
    });

    const view = await createStructuralNavigationQuery(dependencies).getStructure(NOVEL);

    expect(view.degraded).toBe(true);
    expect(view.orphanScenes.map(scene => scene.objectId)).toEqual(["scene-1"]);
    expect(view.orphanScenes[0]!.kind).toBe("scene");
    expect(view.issues.map(issue => issue.kind)).toContain("chapter_missing");
  });

  it("[regression] scopes the structure to the addressed novel", async () => {
    const dependencies = await build({
      arcs: [arcFixture({ id: "arc-1", chapterIds: ["chapter-1"] })],
      chapters: [chapterFixture({ id: "chapter-1", arcId: "arc-1" })],
    });

    const view = await createStructuralNavigationQuery(dependencies).getStructure("novel-other");

    expect(view.novelId).toBe("novel-other");
    expect(view.arcs).toEqual([]);
    expect(view.orphanScenes).toEqual([]);
    expect(view.degraded).toBe(false);
    expect(view.issues).toEqual([]);
  });
});
