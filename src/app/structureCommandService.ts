import {
  createArc as createArcDomain,
  reorderArcChapters as reorderArcChaptersDomain,
  type Arc,
} from "../manuscript/domain/arc";
import {
  createChapter as createChapterDomain,
  reorderChapterScenes as reorderChapterScenesDomain,
  type Chapter,
} from "../manuscript/domain/chapter";
import type { Scene } from "../manuscript/domain/scene";
import type { Repository, RevisionedRepository } from "../shared/application/repository";

export interface StructureCommandServiceDependencies {
  readonly arcs: Repository<Arc>;
  readonly chapters: Repository<Chapter>;
  readonly scenes: RevisionedRepository<Scene>;
}

export interface CreateArcCommand {
  readonly id: string;
  readonly novelId: string;
  readonly title: string;
  readonly createdAt: Date;
}

export interface CreateChapterCommand {
  readonly id: string;
  readonly novelId: string;
  readonly arcId: string;
  readonly title: string;
  readonly createdAt: Date;
}

export interface ReorderArcChaptersCommand {
  readonly arcId: string;
  readonly chapterIds: readonly string[];
  readonly updatedAt: Date;
}

export interface ReorderChapterScenesCommand {
  readonly chapterId: string;
  readonly sceneIds: readonly string[];
  readonly updatedAt: Date;
}

/**
 * Structure writes stay on the frozen domain functions for ordering. The service
 * adds the container-integrity check those functions do not perform: a container
 * must never persist an entry whose entity is missing or owned by another novel.
 */
export function createStructureCommandService(
  dependencies: StructureCommandServiceDependencies,
): {
  createArc(input: CreateArcCommand): Promise<Arc>;
  createChapter(input: CreateChapterCommand): Promise<Chapter>;
  reorderArcChapters(input: ReorderArcChaptersCommand): Promise<Arc>;
  reorderChapterScenes(input: ReorderChapterScenesCommand): Promise<Chapter>;
} {
  return {
    async createArc(input: CreateArcCommand): Promise<Arc> {
      const arc = createArcDomain(input);
      await dependencies.arcs.save(arc);
      return arc;
    },

    async createChapter(input: CreateChapterCommand): Promise<Chapter> {
      const arc = await dependencies.arcs.findById(input.arcId);
      if (!arc) throw new Error(`Arc does not exist: ${input.arcId}`);
      if (arc.novelId !== input.novelId) {
        throw new Error(`Arc ${input.arcId} belongs to another novel`);
      }
      const chapter = createChapterDomain(input);
      await dependencies.chapters.save(chapter);
      return chapter;
    },

    async reorderArcChapters(input: ReorderArcChaptersCommand): Promise<Arc> {
      const arc = await dependencies.arcs.findById(input.arcId);
      if (!arc) throw new Error(`Arc does not exist: ${input.arcId}`);
      for (const chapterId of input.chapterIds) {
        const chapter = await dependencies.chapters.findById(chapterId);
        if (!chapter) throw new Error(`Chapter does not exist: ${chapterId}`);
        if (chapter.novelId !== arc.novelId) {
          throw new Error(`Chapter ${chapterId} belongs to another novel`);
        }
      }
      const reordered = reorderArcChaptersDomain({
        arc,
        chapterIds: input.chapterIds,
        updatedAt: input.updatedAt,
      });
      await dependencies.arcs.save(reordered);
      return reordered;
    },

    async reorderChapterScenes(input: ReorderChapterScenesCommand): Promise<Chapter> {
      const chapter = await dependencies.chapters.findById(input.chapterId);
      if (!chapter) throw new Error(`Chapter does not exist: ${input.chapterId}`);
      for (const sceneId of input.sceneIds) {
        const scene = await dependencies.scenes.findById(sceneId);
        if (!scene) throw new Error(`Scene does not exist: ${sceneId}`);
        if (scene.novelId !== chapter.novelId) {
          throw new Error(`Scene ${sceneId} belongs to another novel`);
        }
      }
      const reordered = reorderChapterScenesDomain({
        chapter,
        sceneIds: input.sceneIds,
        updatedAt: input.updatedAt,
      });
      await dependencies.chapters.save(reordered);
      return reordered;
    },
  };
}
