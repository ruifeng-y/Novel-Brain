import type { DomainId } from "../../shared/domain/ids";
import type { VersionSet } from "../../shared/domain/versioning";

export type GenerationOperation =
  | "story_planning"
  | "outline_refinement"
  | "chapter_generation"
  | "scene_generation"
  | "continuation"
  | "expansion"
  | "rewrite"
  | "polish"
  | "local_regeneration"
  | "consistency_analysis";

export type GenerationTaskStatus =
  | "draft"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "stale"
  | "expired";

export interface GenerationTask {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly operation: GenerationOperation;
  readonly targetSceneId: DomainId;
  readonly intent: string;
  readonly basedOnVersionSet: VersionSet;
  readonly candidateIds: readonly DomainId[];
  readonly status: GenerationTaskStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function createGenerationTask(input: {
  id: DomainId;
  novelId: DomainId;
  operation: GenerationOperation;
  targetSceneId: DomainId;
  intent: string;
  basedOnVersionSet: VersionSet;
  createdAt: Date;
}): GenerationTask {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.targetSceneId) throw new Error("targetSceneId is required");
  if (!input.intent.trim()) throw new Error("intent is required");

  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    operation: input.operation,
    targetSceneId: input.targetSceneId,
    intent: input.intent.trim(),
    basedOnVersionSet: input.basedOnVersionSet,
    candidateIds: Object.freeze([]),
    status: "draft",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function startGenerationTask(task: GenerationTask, updatedAt: Date): GenerationTask {
  if (task.status !== "draft" && task.status !== "ready") throw new Error("Only a draft task can start");
  if (updatedAt < task.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...task, status: "running", updatedAt });
}

export function addCandidateReference(task: GenerationTask, candidateId: DomainId): GenerationTask {
  if (!candidateId) throw new Error("candidateId is required");
  if (task.candidateIds.includes(candidateId)) return task;
  return Object.freeze({
    ...task,
    candidateIds: Object.freeze([...task.candidateIds, candidateId]),
  });
}

export function completeGenerationTask(input: {
  task: GenerationTask;
  candidateIds: readonly DomainId[];
  updatedAt: Date;
}): GenerationTask {
  if (input.candidateIds.length === 0) {
    throw new Error("GenerationTask requires at least one candidate to complete");
  }
  if (input.task.status !== "running") throw new Error("Only a running task can complete");
  if (input.updatedAt < input.task.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({
    ...input.task,
    candidateIds: Object.freeze([...new Set(input.candidateIds)]),
    status: "completed",
    updatedAt: input.updatedAt,
  });
}

export function cancelGenerationTask(task: GenerationTask, updatedAt: Date): GenerationTask {
  if (task.status === "completed") throw new Error("A completed task cannot be cancelled");
  return Object.freeze({ ...task, status: "cancelled", updatedAt });
}

export function markGenerationTaskStale(task: GenerationTask, updatedAt: Date): GenerationTask {
  return Object.freeze({ ...task, status: "stale", updatedAt });
}
