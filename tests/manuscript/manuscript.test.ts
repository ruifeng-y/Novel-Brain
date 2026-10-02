import { describe, expect, it } from "vitest";
import { createArc, reorderArcChapters } from "../../src/manuscript/domain/arc";
import { createChapter, reorderChapterScenes } from "../../src/manuscript/domain/chapter";
import { hashContent } from "../../src/shared/domain/contentHash";
import {
  commitSceneText,
  createScene,
  replaceTargetSpan,
  resolveTargetSpan,
} from "../../src/manuscript/domain/scene";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("manuscript aggregates", () => {
  it("keeps arc, chapter, and scene ordering independent", () => {
    const arc = createArc({ id: "arc-1", novelId: "novel-1", title: "Arc 1", createdAt: now });
    const reorderedArc = reorderArcChapters({
      arc,
      chapterIds: ["chapter-2", "chapter-1"],
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });
    expect(arc.chapterIds).toEqual([]);
    expect(reorderedArc.chapterIds).toEqual(["chapter-2", "chapter-1"]);

    const chapter = createChapter({
      id: "chapter-1",
      novelId: "novel-1",
      arcId: "arc-1",
      title: "Chapter 1",
      createdAt: now,
    });
    const reorderedChapter = reorderChapterScenes({
      chapter,
      sceneIds: ["scene-2", "scene-1"],
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });
    expect(chapter.sceneIds).toEqual([]);
    expect(reorderedChapter.sceneIds).toEqual(["scene-2", "scene-1"]);
  });

  it("commits scene text as a new immutable scene revision", () => {
    const scene = createScene({
      id: "scene-1",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "The Northern Gate",
      revisionId: "scene-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    const committed = commitSceneText({
      scene,
      text: "Lin Chuan stopped at the gate.",
      revisionId: "scene-rev-2",
      commitId: "commit-2",
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });

    expect(scene.text).toBe("");
    expect(committed.text).toBe("Lin Chuan stopped at the gate.");
    expect(committed.currentRevisionId).toBe("scene-rev-2");
  });

  it("replaces only a valid target span and rejects stale source text", () => {
    const scene = createScene({
      id: "scene-1",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "The Northern Gate",
      revisionId: "scene-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });
    const original = commitSceneText({
      scene,
      text: "First paragraph. Second paragraph. Third paragraph.",
      spanAnchors: { "span-2": "Second paragraph." },
      revisionId: "scene-rev-2",
      commitId: "commit-2",
      updatedAt: now,
    });

    const target = {
      anchorId: "span-2",
      text: "Second paragraph.",
      sourceContentHash: hashContent("Different paragraph."),
    };

    expect(() => replaceTargetSpan({ scene: original, target, replacement: "Changed." })).toThrow(
      "Target span source hash does not match scene text",
    );
  });

  it("uses stable anchors rather than character offsets for target spans", () => {
    const scene = createScene({
      id: "scene-1",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "The Northern Gate",
      revisionId: "scene-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });
    const committed = commitSceneText({
      scene,
      text: "First paragraph. Second paragraph. Third paragraph.",
      spanAnchors: { "span-2": "Second paragraph." },
      revisionId: "scene-rev-2",
      commitId: "commit-2",
      updatedAt: now,
    });

    const resolved = resolveTargetSpan(committed, {
      anchorId: "span-2",
      text: "Second paragraph.",
      sourceContentHash: hashContent("Second paragraph."),
    });

    expect(resolved).toEqual({ start: 17, end: 34, text: "Second paragraph." });
  });
});
