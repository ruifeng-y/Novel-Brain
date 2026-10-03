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
  readonly status: GenerationTaskStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function isTerminalTaskStatus(status: GenerationTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "stale" || status === "expired";
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
  if (Object.keys(input.basedOnVersionSet).length === 0) {
    throw new Error("basedOnVersionSet must contain the target scene version");
  }
  const hasTargetVersion = Object.values(input.basedOnVersionSet).some(
    reference => reference.aggregateType === "Scene" && reference.objectId === input.targetSceneId,
  );
  if (!hasTargetVersion) {
    throw new Error("basedOnVersionSet must include the target scene version");
  }

  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    operation: input.operation,
    targetSceneId: input.targetSceneId,
    intent: input.intent.trim(),
    basedOnVersionSet: input.basedOnVersionSet,
    status: "draft",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function startGenerationTask(task: GenerationTask, updatedAt: Date): GenerationTask {
  if (task.status !== "draft" && task.status !== "ready") throw new Error("Only a draft or ready task can start");
  if (updatedAt < task.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...task, status: "running", updatedAt });
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
    status: "completed",
    updatedAt: input.updatedAt,
  });
}

export function cancelGenerationTask(task: GenerationTask, updatedAt: Date): GenerationTask {
  if (isTerminalTaskStatus(task.status)) throw new Error("Only a draft, ready, or running task can be cancelled");
  if (updatedAt < task.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...task, status: "cancelled", updatedAt });
}

export function markGenerationTaskStale(task: GenerationTask, updatedAt: Date): GenerationTask {
  if (isTerminalTaskStatus(task.status)) throw new Error("Only a draft, ready, or running task can become stale");
  if (updatedAt < task.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...task, status: "stale", updatedAt });
}
