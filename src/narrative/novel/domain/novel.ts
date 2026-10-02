import type { DomainId } from "../../../shared/domain/ids";

export type NovelStatus = "draft" | "active" | "paused" | "completed";
export type AutonomyPolicy = "human_review_required" | "policy_driven";

export interface Novel {
  readonly id: DomainId;
  readonly authorId: DomainId;
  readonly title: string;
  readonly status: NovelStatus;
  readonly autonomyPolicy: AutonomyPolicy;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateNovelInput {
  readonly id: DomainId;
  readonly authorId: DomainId;
  readonly title: string;
  readonly createdAt: Date;
}

export function createNovel(input: CreateNovelInput): Novel {
  if (!input.id) throw new Error("id is required");
  if (!input.authorId) throw new Error("authorId is required");
  if (!input.title.trim()) throw new Error("title is required");

  return Object.freeze({
    id: input.id,
    authorId: input.authorId,
    title: input.title.trim(),
    status: "draft",
    autonomyPolicy: "human_review_required",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function renameNovel(novel: Novel, title: string, updatedAt: Date): Novel {
  if (!title.trim()) throw new Error("title is required");
  if (updatedAt < novel.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...novel, title: title.trim(), updatedAt });
}

export function setAutonomyPolicy(
  novel: Novel,
  autonomyPolicy: AutonomyPolicy,
  updatedAt: Date,
): Novel {
  if (updatedAt < novel.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...novel, autonomyPolicy, updatedAt });
}
