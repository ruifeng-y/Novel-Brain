import { createVersionSet } from "../../shared/domain/versioning";
import { deepFreeze } from "../../shared/domain/immutable";
import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "./runtimeAdapter";

const AGENT_ROLES = new Set([
  "planner",
  "writer",
  "editor",
  "reviewer",
  "consistency_agent",
  "memory_agent",
]);

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  if (value !== null && typeof value === "object") {
    const clone = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      clone[key] = cloneValue(nested);
    }
    return clone as T;
  }
  return value;
}

function assertRequestedChange(change: RuntimeRequest["requestedChange"]): void {
  if (change.type === "text") {
    if (!change.sceneId || !change.text) throw new Error("text change requires sceneId and text");
    return;
  }
  if (change.type === "structured_state") {
    if (!change.stateRecordId || Object.keys(change.content).length === 0) {
      throw new Error("structured_state change requires stateRecordId and content");
    }
    return;
  }
  if (change.type === "canonical_fact") {
    if (!change.canonicalFactId || Object.keys(change.content).length === 0) {
      throw new Error("canonical_fact change requires canonicalFactId and content");
    }
    return;
  }
  if (!change.sceneId || !change.targetSpan.anchorId || !change.targetSpan.text || !change.targetSpan.sourceContentHash || !change.replacement) {
    throw new Error("local_text change requires sceneId, targetSpan, and replacement");
  }
}

export class DeterministicRuntime implements RuntimeAdapter {
  async execute(request: RuntimeRequest): Promise<RuntimeResult> {
    if (!request.taskId) throw new Error("taskId is required");
    if (!request.modelPolicy.provider.trim()) throw new Error("provider is required");
    if (!request.modelPolicy.model.trim()) throw new Error("model is required");
    if (!AGENT_ROLES.has(request.agentRole)) throw new Error("agentRole is invalid");
    if (request.modelPolicy.maxOutputTokens <= 0) {
      throw new Error("maxOutputTokens must be positive");
    }
    assertRequestedChange(request.requestedChange);

    return Object.freeze({
      taskId: request.taskId,
      agentRole: request.agentRole,
      modelPolicy: Object.freeze({ ...request.modelPolicy }),
      change: deepFreeze(cloneValue(request.requestedChange)),
      basedOnVersionSet: createVersionSet({ ...request.basedOnVersionSet }),
    });
  }
}
