import { deepFreeze } from "../../shared/domain/immutable";
import { createVersionSet } from "../../shared/domain/versioning";
import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "./runtimeAdapter";

const agentRoles = new Set([
  "planner",
  "writer",
  "editor",
  "reviewer",
  "consistency_agent",
  "memory_agent",
]);

/**
 * Deterministic reference runtime for Story Foundation design requests. It
 * derives a stable proposal draft from the request context so the foundation
 * surface is runnable without a provider-specific model vendor.
 */
export class DeterministicFoundationRuntime implements RuntimeAdapter {
  async execute(request: RuntimeRequest): Promise<RuntimeResult> {
    if (request.requestedChange.type !== "structured_state") {
      throw new Error("Foundation runtime requires a structured_state design request");
    }
    const content = request.requestedChange.content as { kind?: unknown };
    if (content.kind !== "foundation_design_request") {
      throw new Error("Foundation runtime requires a Foundation design request");
    }
    if (!request.taskId.trim()) throw new Error("taskId is required");
    if (!agentRoles.has(request.agentRole)) throw new Error("agentRole is invalid");
    if (!request.modelPolicy.provider.trim()) throw new Error("provider is required");
    if (!request.modelPolicy.model.trim()) throw new Error("model is required");
    if (request.modelPolicy.maxOutputTokens <= 0) {
      throw new Error("maxOutputTokens must be positive");
    }

    const draftContent = content as {
      readonly sourceText?: unknown;
      readonly proposalType?: unknown;
    };
    const proposalType =
      typeof draftContent.proposalType === "string" ? draftContent.proposalType : "story_concept";
    const sourceText = typeof draftContent.sourceText === "string" ? draftContent.sourceText : "";

    return deepFreeze({
      taskId: request.taskId,
      agentRole: request.agentRole,
      modelPolicy: request.modelPolicy,
      basedOnVersionSet: createVersionSet({ ...request.basedOnVersionSet }),
      change: {
        type: "structured_state" as const,
        stateRecordId: request.requestedChange.stateRecordId,
        content: deepFreeze({
          sections: [
            {
              id: `${request.taskId}:section-1`,
              content: {
                proposalType,
                sourceText,
                summary: `Deterministic foundation draft for ${proposalType}`,
              },
            },
          ],
          openQuestions: [],
        }),
      },
    });
  }
}
