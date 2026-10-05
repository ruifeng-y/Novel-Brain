import type { RevisionedRepository } from "../shared/application/repository";
import { toSceneRevision, type Scene } from "../manuscript/domain/scene";

/**
 * The reading shape of a Scene: the object identity, its placement, and the
 * current manuscript revision. It deliberately carries no domain internals
 * (no commit id, no raw anchor records, no timestamps).
 */
export interface SceneReadView {
  readonly sceneId: string;
  readonly novelId: string;
  readonly chapterId: string;
  readonly title: string;
  readonly revisionId: string;
  readonly text: string;
  readonly anchorIds: readonly string[];
}

export interface SceneReadQueryDependencies {
  readonly scenes: RevisionedRepository<Scene>;
}

/**
 * Reads one scene for the manuscript surface. The novel id is part of the
 * lookup, so a scene that exists under a different novel resolves to
 * `undefined` rather than being returned to the caller.
 */
export function createSceneReadQuery(dependencies: SceneReadQueryDependencies): {
  getScene(input: {
    readonly novelId: string;
    readonly sceneId: string;
  }): Promise<SceneReadView | undefined>;
} {
  return {
    async getScene(input: {
      readonly novelId: string;
      readonly sceneId: string;
    }): Promise<SceneReadView | undefined> {
      const scene = await dependencies.scenes.findById(input.sceneId);
      if (!scene || scene.novelId !== input.novelId) return undefined;

      const revision = toSceneRevision(scene);
      return Object.freeze({
        sceneId: revision.sceneId,
        novelId: scene.novelId,
        chapterId: scene.chapterId,
        title: scene.title,
        revisionId: revision.revisionId,
        text: revision.text,
        anchorIds: Object.freeze(Object.keys(revision.spanAnchors)),
      });
    },
  };
}
