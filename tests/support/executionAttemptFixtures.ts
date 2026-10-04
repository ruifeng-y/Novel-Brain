import {
  createCandidate,
} from "../../src/production/domain/candidate";
import {
  createGenerationTask,
} from "../../src/production/domain/generationTask";
import type { Candidate } from "../../src/production/domain/candidate";
import type { RuntimeRequest, RuntimeResult } from "../../src/production/runtime/runtimeAdapter";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import type { ExecutionAttemptVerificationEnvironment } from "./executionAttemptVerificationContract";

const now = new Date("2026-10-04T00:00:00.000Z");

export function createExecutionAttemptVerificationFixture(
  persistence: ExecutionAttemptVerificationEnvironment["persistence"],
): ExecutionAttemptVerificationEnvironment {
  const generationTask = createGenerationTask({
    id: "task-verification-2.1",
    novelId: "novel-verification-2.1",
    operation: "rewrite",
    targetSceneId: "scene-1",
    intent: "Rewrite the scene.",
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
    }),
    createdAt: now,
  });
  const candidate = createCandidate({
    id: "candidate-verification-2.1",
    taskId: generationTask.id,
    novelId: generationTask.novelId,
    basedOnVersionSet: generationTask.basedOnVersionSet,
    change: { type: "text", sceneId: "scene-1", text: "Generated text" },
    createdAt: now,
  });
  const routingDecision = {
    routingDecisionId: "verification-routing-1",
    resolverVersion: "resolver-1",
    routingPolicyVersion: "policy-1",
    provider: "test",
    model: "deterministic",
    reason: "capability match",
  };
  const runtimeRequest: RuntimeRequest = {
    taskId: generationTask.id,
    agentRole: "writer",
    modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
    basedOnVersionSet: generationTask.basedOnVersionSet,
    context: {},
    requestedChange: { type: "text", sceneId: "scene-1", text: "Generated text" },
  };
  const runtimeResult: RuntimeResult = {
    taskId: generationTask.id,
    agentRole: "writer",
    modelPolicy: runtimeRequest.modelPolicy,
    change: runtimeRequest.requestedChange,
    basedOnVersionSet: generationTask.basedOnVersionSet,
  };
  return {
    persistence,
    generationTask,
    routingDecision,
    runtimeRequest,
    runtimeResult,
    candidate,
  };
}
