import {
  reconcileStructure,
  type StructureReconciliationIssue,
} from "../manuscript/application/structureReconciliation";
import type { Arc } from "../manuscript/domain/arc";
import type { Chapter } from "../manuscript/domain/chapter";
import type { Scene } from "../manuscript/domain/scene";
import type { Repository, RevisionedRepository } from "../shared/application/repository";

export interface StructureNode {
  readonly objectId: string;
  readonly kind: "arc" | "chapter" | "scene";
  readonly title: string;
  readonly children: readonly StructureNode[];
}

export interface StructuralNavigationView {
  readonly novelId: string;
  readonly arcs: readonly StructureNode[];
  readonly orphanScenes: readonly StructureNode[];
  readonly degraded: boolean;
  readonly issues: readonly StructureReconciliationIssue[];
}

export interface StructuralNavigationQueryDependencies {
  readonly arcs: Repository<Arc>;
  readonly chapters: Repository<Chapter>;
  readonly scenes: RevisionedRepository<Scene>;
}

function structureNode(
  objectId: string,
  kind: StructureNode["kind"],
  title: string,
  children: readonly StructureNode[],
): StructureNode {
  return Object.freeze({ objectId, kind, title, children: Object.freeze([...children]) });
}

/**
 * Assembles the `Novel -> Arc -> Chapter -> Scene` tree from the containers that
 * actually order it (`Arc.chapterIds`, `Chapter.sceneIds`). The walk reuses the
 * frozen `reconcileStructure` check for pointer/container disagreements and adds
 * only what that check cannot see: an ordered entry whose entity does not exist.
 *
 * A dangling entry is surfaced as an issue and never becomes a node. A scene that
 * no container places is reported in `orphanScenes`, so no scene disappears from
 * the view.
 */
export function createStructuralNavigationQuery(
  dependencies: StructuralNavigationQueryDependencies,
): {
  getStructure(novelId: string): Promise<StructuralNavigationView>;
} {
  return {
    async getStructure(novelId: string): Promise<StructuralNavigationView> {
      const arcs = await dependencies.arcs.listByNovel(novelId);
      const chapters = await dependencies.chapters.listByNovel(novelId);
      const scenes = await dependencies.scenes.listByNovel(novelId);

      const reconciliation = reconcileStructure({ arcs, chapters, scenes });
      const containerIssues: StructureReconciliationIssue[] = [];
      const chaptersById = new Map(chapters.map(chapter => [chapter.id, chapter]));
      const scenesById = new Map(scenes.map(scene => [scene.id, scene]));
      const placedSceneIds = new Set<string>();

      const arcNodes: StructureNode[] = [];
      for (const arc of arcs) {
        const chapterNodes: StructureNode[] = [];
        for (const chapterId of arc.chapterIds) {
          const chapter = chaptersById.get(chapterId);
          if (!chapter) {
            containerIssues.push({
              kind: "arc_chapter_entry_missing",
              objectId: chapterId,
              detail: `Arc ${arc.id} lists missing chapter ${chapterId}`,
            });
            continue;
          }

          const sceneNodes: StructureNode[] = [];
          for (const sceneId of chapter.sceneIds) {
            const scene = scenesById.get(sceneId);
            if (!scene) {
              containerIssues.push({
                kind: "chapter_scene_entry_missing",
                objectId: sceneId,
                detail: `Chapter ${chapter.id} lists missing scene ${sceneId}`,
              });
              continue;
            }
            placedSceneIds.add(sceneId);
            sceneNodes.push(structureNode(scene.id, "scene", scene.title, []));
          }
          chapterNodes.push(structureNode(chapter.id, "chapter", chapter.title, sceneNodes));
        }
        arcNodes.push(structureNode(arc.id, "arc", arc.title, chapterNodes));
      }

      const orphanScenes = scenes
        .filter(scene => !placedSceneIds.has(scene.id))
        .map(scene => structureNode(scene.id, "scene", scene.title, []));

      return Object.freeze({
        novelId,
        arcs: Object.freeze(arcNodes),
        orphanScenes: Object.freeze(orphanScenes),
        degraded: reconciliation.degraded || containerIssues.length > 0,
        issues: Object.freeze([...reconciliation.issues, ...containerIssues]),
      });
    },
  };
}
