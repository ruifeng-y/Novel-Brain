import { describe, expect, it } from "vitest";
import {
  recordExecutionAttemptFailure,
  recordExecutionAttemptFromRuntimeResult,
} from "../../src/production/application/executionAttemptService";
import { createInMemoryExecutionAttemptPersistence } from "../../src/production/application/executionAttemptPersistence";
import {
  createCandidate,
} from "../../src/production/domain/candidate";
import {
  createGenerationTask,
} from "../../src/production/domain/generationTask";
import type { RuntimeRequest, RuntimeResult } from "../../src/production/runtime/runtimeAdapter";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import { createTestExecutionAttemptPersistence } from "../support/executionAttemptConflictPersistence";

const now = new Date("2026-10-04T00:00:00.000Z");
const later = new Date("2026-10-04T00:01:00.000Z");
const task = createGenerationTask({
  id: "task-app-1",
  novelId: "novel-app-1",
  operation: "rewrite",
  targetSceneId: "scene-1",
  intent: "Rewrite the scene.",
  basedOnVersionSet: createVersionSet({
    scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
  }),
  createdAt: now,
});
const candidate = createCandidate({
  id: "candidate-app-1",
  taskId: task.id,
  novelId: task.novelId,
  basedOnVersionSet: task.basedOnVersionSet,
  change: { type: "text", sceneId: "scene-1", text: "Generated text" },
  createdAt: now,
});
const routing = {
  routingDecisionId: "routing-app-1",
  resolverVersion: "resolver-1",
  routingPolicyVersion: "policy-1",
  provider: "test",
  model: "deterministic",
  reason: "capability match",
};
const request: RuntimeRequest = {
  taskId: task.id,
  agentRole: "writer",
  modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
  basedOnVersionSet: task.basedOnVersionSet,
  context: {},
  requestedChange: { type: "text", sceneId: "scene-1", text: "Generated text" },
};
const result: RuntimeResult = {
  taskId: task.id,
  agentRole: "writer",
  modelPolicy: request.modelPolicy,
  change: request.requestedChange,
  basedOnVersionSet: task.basedOnVersionSet,
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    persistence: createInMemoryExecutionAttemptPersistence(),
    executionKey: "execution-app-1",
    attemptOrdinal: 1,
    relation: "initial" as const,
    generationTask: task,
    routingDecision: routing,
    runtimeRequest: request,
    runtimeResult: result,
    startedAt: now,
    completedAt: later,
    candidateReference: undefined,
    ...overrides,
  };
}

describe("ExecutionAttempt application service", () => {
  it("records RuntimeAdapter result evidence without creating Candidate or workflow state", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    const recorded = await recordExecutionAttemptFromRuntimeResult(input({ persistence }));

    expect(recorded.status).toBe("succeeded");
    expect(recorded.runtimeEvidence?.data).toMatchObject({ result: { taskId: task.id } });
    expect(recorded.candidateReference).toBeUndefined();
    expect(await persistence.attempts.findById(recorded.id)).toEqual(recorded);
    expect(Object.prototype.hasOwnProperty.call(task, "candidateIds")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(candidate, "attemptIds")).toBe(false);
  });

  it("is idempotent for the same execution identity and evidence", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    const first = await recordExecutionAttemptFromRuntimeResult(input({ persistence }));
    const replay = await recordExecutionAttemptFromRuntimeResult(input({ persistence }));

    expect(replay).toEqual(first);
    expect(await persistence.attempts.listByNovel(task.novelId)).toHaveLength(1);
  });

  it("records retry and fallback as distinct attempt identities", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    const first = await recordExecutionAttemptFromRuntimeResult(input({ persistence }));
    const retry = await recordExecutionAttemptFromRuntimeResult(input({
      persistence,
      executionKey: "execution-app-2",
      attemptOrdinal: 2,
      relation: "retry" as const,
      previousAttempt: first,
    }));
    const fallback = await recordExecutionAttemptFromRuntimeResult(input({
      persistence,
      executionKey: "execution-app-3",
      attemptOrdinal: 3,
      relation: "fallback" as const,
      previousAttempt: retry,
      routingDecision: {
        ...routing,
        routingDecisionId: "routing-app-2",
        reason: "fallback after runtime failure",
        fallbackFromAttemptId: retry.id,
      },
    }));

    expect(retry.id).not.toBe(first.id);
    expect(fallback.id).not.toBe(retry.id);
    expect(retry.generationTaskId).toBe(task.id);
    expect(fallback.routingDecision.routingDecisionId).not.toBe(retry.routingDecision.routingDecisionId);
    expect(await persistence.attempts.listByNovel(task.novelId)).toHaveLength(3);
  });

  it("records failure evidence and keeps the failed attempt replayable", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    const failed = await recordExecutionAttemptFailure({
      persistence,
      executionKey: "execution-app-fail",
      attemptOrdinal: 4,
      relation: "initial" as const,
      generationTask: task,
      routingDecision: routing,
      startedAt: now,
      failedAt: later,
      failure: { code: "provider_error", message: "unavailable", retryable: true },
      retryReason: "retry after provider error",
    });

    expect(failed.status).toBe("failed");
    expect(failed.failureEvidence?.data).toMatchObject({ code: "provider_error" });
    expect(await persistence.attempts.getRevision(failed.id, failed.currentRevisionId)).toEqual(failed);
  });

  it("rejects a result for a different GenerationTask", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    await expect(recordExecutionAttemptFromRuntimeResult(input({
      persistence,
      runtimeResult: { ...result, taskId: "other-task" },
    }))).rejects.toThrow("runtime result taskId must match GenerationTask");
  });
});

describe("ExecutionAttempt CAS/recovery contract", () => {
  it("rejects a reused revision id whose full entity differs instead of treating it as replay", async () => {
    const persistence = createTestExecutionAttemptPersistence();
    const expected = await recordExecutionAttemptFromRuntimeResult(input({ persistence }));
    persistence.testPort.seed({
      ...expected,
      runtimeEvidence: expected.runtimeEvidence,
      auditReferences: ["different-evidence"],
    }, true);

    const error = await recordExecutionAttemptFromRuntimeResult(input({ persistence })).then(
      () => undefined,
      (reason: unknown) => reason as { code?: string },
    );
    expect(error).toMatchObject({ code: "revision_conflict" });
  });

  it("rejects exact history with a stale current pointer", async () => {
    const persistence = createTestExecutionAttemptPersistence();
    const expected = await recordExecutionAttemptFromRuntimeResult(input({ persistence }));
    persistence.testPort.setCurrent(expected.id, `${expected.id}:running`);

    const error = await recordExecutionAttemptFromRuntimeResult(input({ persistence })).then(
      () => undefined,
      (reason: unknown) => reason as { code?: string },
    );
    expect(error).toMatchObject({ code: "current_revision_mismatch" });
  });

  it("rejects a terminal current pointer with missing intermediate history", async () => {
    const persistence = createTestExecutionAttemptPersistence();
    const expected = await recordExecutionAttemptFromRuntimeResult(input({ persistence }));
    persistence.testPort.removeRevision(expected.id, `${expected.id}:running`);

    const error = await recordExecutionAttemptFromRuntimeResult(input({ persistence })).then(
      () => undefined,
      (reason: unknown) => reason as { code?: string },
    );
    expect(error).toMatchObject({ code: "history_inconsistency" });
  });

  it("returns an existing attempt only for exact full-history replay", async () => {
    const persistence = createTestExecutionAttemptPersistence();
    const first = await recordExecutionAttemptFromRuntimeResult(input({ persistence }));
    const replay = await recordExecutionAttemptFromRuntimeResult(input({ persistence }));

    expect(replay).toEqual(first);
    expect(await persistence.attempts.getRevision(first.id, `${first.id}:created`)).toBeDefined();
    expect(await persistence.attempts.getRevision(first.id, `${first.id}:running`)).toBeDefined();
    expect(await persistence.attempts.getRevision(first.id, first.currentRevisionId)).toBeDefined();
  });

  it("maps CAS/current races to stable conflict errors and preserves one winner", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    const outcomes = await Promise.allSettled([
      recordExecutionAttemptFromRuntimeResult(input({ persistence })),
      recordExecutionAttemptFromRuntimeResult(input({
        persistence,
        runtimeResult: { ...result, change: { type: "text", sceneId: "scene-1", text: "Different" } },
      })),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "revision_conflict" });
    expect(await persistence.attempts.listByNovel(task.novelId)).toHaveLength(1);
  });
});


describe("ExecutionAttempt request binding and ordinal reservation", () => {
  it("rejects RuntimeRequest evidence that does not match RuntimeResult", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    await expect(recordExecutionAttemptFromRuntimeResult(input({
      persistence,
      runtimeRequest: {
        ...request,
        modelPolicy: { ...request.modelPolicy, model: "other-model" },
      },
    }))).rejects.toThrow("RuntimeRequest and RuntimeResult must match");
  });

  it("reserves one attempt identity per predecessor/ordinal even with different execution keys", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    const first = await recordExecutionAttemptFromRuntimeResult(input({ persistence }));
    const retry = await recordExecutionAttemptFromRuntimeResult(input({
      persistence,
      executionKey: "ordinal-key-a",
      attemptOrdinal: 2,
      relation: "retry" as const,
      previousAttempt: first,
    }));

    await expect(recordExecutionAttemptFromRuntimeResult(input({
      persistence,
      executionKey: "ordinal-key-b",
      attemptOrdinal: 2,
      relation: "retry" as const,
      previousAttempt: first,
    }))).rejects.toMatchObject({ code: "revision_conflict" });

    expect(retry.predecessorAttemptReference?.identity).toBe(first.id);
    expect(await persistence.attempts.listByNovel(task.novelId)).toHaveLength(2);
  });

  it("keeps one winner for concurrent sibling attempts with the same ordinal", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    const first = await recordExecutionAttemptFromRuntimeResult(input({ persistence }));
    const outcomes = await Promise.allSettled([
      recordExecutionAttemptFromRuntimeResult(input({
        persistence,
        executionKey: "sibling-a",
        attemptOrdinal: 2,
        relation: "retry" as const,
        previousAttempt: first,
      })),
      recordExecutionAttemptFromRuntimeResult(input({
        persistence,
        executionKey: "sibling-b",
        attemptOrdinal: 2,
        relation: "retry" as const,
        previousAttempt: first,
      })),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(await persistence.attempts.listByNovel(task.novelId)).toHaveLength(2);
  });
});

describe("ExecutionAttempt provenance contract", () => {
  it("rejects Candidate task/novel/change mismatch before recording evidence", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    await expect(recordExecutionAttemptFromRuntimeResult(input({
      persistence,
      candidate: { ...candidate, taskId: "other-task" },
    }))).rejects.toThrow("Candidate taskId must match GenerationTask");
    await expect(recordExecutionAttemptFromRuntimeResult(input({
      persistence,
      candidate: { ...candidate, novelId: "other-novel" },
    }))).rejects.toThrow("Candidate novelId must match GenerationTask");
    await expect(recordExecutionAttemptFromRuntimeResult(input({
      persistence,
      candidate: {
        ...candidate,
        change: { type: "text", sceneId: "scene-1", text: "Different text" },
      },
    }))).rejects.toThrow("Candidate change must match RuntimeResult");
  });

  it("rejects routing provider/model mismatch with RuntimeResult", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    await expect(recordExecutionAttemptFromRuntimeResult(input({
      persistence,
      routingDecision: { ...routing, provider: "other-provider" },
    }))).rejects.toThrow("routing provider must match RuntimeResult");
    await expect(recordExecutionAttemptFromRuntimeResult(input({
      persistence,
      routingDecision: { ...routing, model: "other-model" },
    }))).rejects.toThrow("routing model must match RuntimeResult");
  });
});
