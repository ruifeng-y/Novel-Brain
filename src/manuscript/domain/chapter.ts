import type { DomainId } from "../../shared/domain/ids";

export interface Chapter {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly arcId: DomainId;
  readonly title: string;
  readonly sceneIds: readonly DomainId[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function createChapter(input: {
  id: DomainId;
  novelId: DomainId;
  arcId: DomainId;
  title: string;
  createdAt: Date;
}): Chapter {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.arcId) throw new Error("arcId is required");
  if (!input.title.trim()) throw new Error("title is required");
  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    arcId: input.arcId,
    title: input.title.trim(),
    sceneIds: Object.freeze([]),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function reorderChapterScenes(input: {
  chapter: Chapter;
  sceneIds: readonly DomainId[];
  updatedAt: Date;
}): Chapter {
  const unique = [...new Set(input.sceneIds)];
  if (unique.length !== input.sceneIds.length) throw new Error("scene order contains duplicates");
  if (input.updatedAt < input.chapter.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...input.chapter, sceneIds: Object.freeze([...unique]), updatedAt: input.updatedAt });
}
