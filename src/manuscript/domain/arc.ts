import type { DomainId } from "../../shared/domain/ids";

export interface Arc {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly title: string;
  readonly chapterIds: readonly DomainId[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateArcInput {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly title: string;
  readonly createdAt: Date;
}

export function createArc(input: CreateArcInput): Arc {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.title.trim()) throw new Error("title is required");
  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    title: input.title.trim(),
    chapterIds: Object.freeze([]),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function reorderArcChapters(input: {
  arc: Arc;
  chapterIds: readonly DomainId[];
  updatedAt: Date;
}): Arc {
  const unique = [...new Set(input.chapterIds)];
  if (unique.length !== input.chapterIds.length) throw new Error("chapter order contains duplicates");
  if (input.updatedAt < input.arc.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...input.arc, chapterIds: Object.freeze([...unique]), updatedAt: input.updatedAt });
}
