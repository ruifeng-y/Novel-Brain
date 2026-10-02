import { createVersionSet } from "../../shared/domain/versioning";
import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "./runtimeAdapter";

export class DeterministicRuntime implements RuntimeAdapter {
  async execute(request: RuntimeRequest): Promise<RuntimeResult> {
    if (!request.taskId) throw new Error("taskId is required");
    if (request.modelPolicy.maxOutputTokens <= 0) {
      throw new Error("maxOutputTokens must be positive");
    }

    return Object.freeze({
      taskId: request.taskId,
      agentRole: request.agentRole,
      modelPolicy: Object.freeze({ ...request.modelPolicy }),
      change: request.requestedChange,
      basedOnVersionSet: createVersionSet({}),
    });
  }
}
