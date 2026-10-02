import type { DomainId, RevisionId } from "../../../shared/domain/ids";

export type CanonicalFactType =
  | "character_profile"
  | "world_rule"
  | "plot_decision"
  | "style_constraint";

export type CanonicalFactContent = Readonly<Record<string, unknown>>;

export interface CanonicalFact {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly type: CanonicalFactType;
  readonly content: CanonicalFactContent;
  readonly currentRevisionId: RevisionId;
  readonly lastCommitId: DomainId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateCanonicalFactInput {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly type: CanonicalFactType;
  readonly content: CanonicalFactContent;
  readonly revisionId: RevisionId;
  readonly commitId: DomainId;
  readonly createdAt: Date;
}

export interface ReplaceCanonicalFactInput {
  readonly fact: CanonicalFact;
  readonly content: CanonicalFactContent;
  readonly revisionId: RevisionId;
  readonly commitId: DomainId;
  readonly updatedAt: Date;
}

export function createCanonicalFact(input: CreateCanonicalFactInput): CanonicalFact {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.commitId) throw new Error("commitId is required");

  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    type: input.type,
    content: Object.freeze({ ...input.content }),
    currentRevisionId: input.revisionId,
    lastCommitId: input.commitId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function replaceCanonicalFact(input: ReplaceCanonicalFactInput): CanonicalFact {
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.commitId) throw new Error("commitId is required");
  if (input.updatedAt < input.fact.updatedAt) throw new Error("updatedAt cannot move backward");

  return Object.freeze({
    ...input.fact,
    content: Object.freeze({ ...input.content }),
    currentRevisionId: input.revisionId,
    lastCommitId: input.commitId,
    updatedAt: input.updatedAt,
  });
}
