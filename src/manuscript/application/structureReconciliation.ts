import type { Arc } from "../domain/arc";
import type { Chapter } from "../domain/chapter";
import type { Scene } from "../domain/scene";

export interface StructureReconciliationIssue {
  readonly kind:
    | "arc_missing"
    | "chapter_missing"
    | "chapter_pointer_mismatch"
    | "scene_pointer_mismatch"
    // Container direction: an ordered entry names an entity that does not exist.
    | "arc_chapter_entry_missing"
    | "chapter_scene_entry_missing";
  readonly objectId: string;
  readonly detail: string;
}

export interface StructureReconciliationResult {
  readonly issues: readonly StructureReconciliationIssue[];
  readonly degraded: boolean;
}

/**
 * Read-only structural check. Ordering lives with the container
 * (`Arc.chapterIds`, `Chapter.sceneIds`) while membership lives on the pointer
 * (`Chapter.arcId`, `Scene.chapterId`). A pointer that its container does not
 * confirm is reported as a degraded issue; nothing is repaired or reordered.
 */
export function reconcileStructure(input: {
  readonly arcs: readonly Arc[];
  readonly chapters: readonly Chapter[];
  readonly scenes: readonly Scene[];
}): StructureReconciliationResult {
  const issues: StructureReconciliationIssue[] = [];
  const arcsById = new Map(input.arcs.map((arc) => [arc.id, arc]));
  const chaptersById = new Map(input.chapters.map((chapter) => [chapter.id, chapter]));

  for (const chapter of input.chapters) {
    const arc = arcsById.get(chapter.arcId);
    if (!arc) {
      issues.push({
        kind: "arc_missing",
        objectId: chapter.arcId,
        detail: `Chapter ${chapter.id} references missing arc ${chapter.arcId}`,
      });
      continue;
    }
    if (!arc.chapterIds.includes(chapter.id)) {
      issues.push({
        kind: "chapter_pointer_mismatch",
        objectId: chapter.id,
        detail: `Arc ${arc.id} does not list chapter ${chapter.id}`,
      });
    }
  }

  for (const scene of input.scenes) {
    const chapter = chaptersById.get(scene.chapterId);
    if (!chapter) {
      issues.push({
        kind: "chapter_missing",
        objectId: scene.chapterId,
        detail: `Scene ${scene.id} references missing chapter ${scene.chapterId}`,
      });
      continue;
    }
    if (!chapter.sceneIds.includes(scene.id)) {
      issues.push({
        kind: "scene_pointer_mismatch",
        objectId: scene.id,
        detail: `Chapter ${chapter.id} does not list scene ${scene.id}`,
      });
    }
  }

  return Object.freeze({ issues: Object.freeze(issues), degraded: issues.length > 0 });
}
