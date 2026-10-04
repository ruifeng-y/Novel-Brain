import { describe, expect, it } from "vitest";
import {
  cancelExecutionAttempt,
  candidateSourceReference,
  completeExecutionAttempt,
  createExecutionAttempt,
  createExecutionAttemptId,
  createFallbackExecutionAttempt,
  createRetryExecutionAttempt,
  executionAttemptSourceReference,
  failExecutionAttempt,
  generationTaskSourceReference,
  runtimeRequestSourceReference,
  runtimeResultSourceReference,
  startExecutionAttempt,
  type ExecutionRoutingDecisionReference,
} from "../../src/production/domain/executionAttempt";
import {
  createCandidate,
} from "../../src/production/domain/candidate";
import {
  createGenerationTask,
} from "../../src/production/domain/generationTask";
import type { RuntimeRequest, RuntimeResult } from "../../src/production/runtime/runtimeAdapter";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import { isImmutableTimestamp } from "../../src/shared/domain/observationSource";

const now = new Date("2026-10-04T00:00:00.000Z");
const later = new Date("2026-10-04T00:01:00.000Z");
const task = createGenerationTask({
  id: "task-1",
  novelId: "novel-1",
  operation: "rewrite",
  targetSceneId: "scene-1",
  intent: "Rewrite the scene.",
  basedOnVersionSet: createVersionSet({
    scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
  }),
  createdAt: now,
});
const candidate = createCandidate({
  id: "candidate-1",
  taskId: task.id,
  novelId: task.novelId,
  basedOnVersionSet: task.basedOnVersionSet,
  change: { type: "text", sceneId: "scene-1", text: "Generated text" },
  createdAt: now,
});
const routing: ExecutionRoutingDecisionReference = {
  routingDecisionId: "routing-1",
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
  context: { source: "test" },
  requestedChange: { type: "text", sceneId: "scene-1", text: "Generated text" },
};
const runtimeResult: RuntimeResult = {
  taskId: task.id,
  agentRole: "writer",
  modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
  change: { type: "text", sceneId: "scene-1", text: "Generated text" },
  basedOnVersionSet: task.basedOnVersionSet,
};

function attempt(overrides: Partial<Parameters<typeof createExecutionAttempt>[0]> = {}) {
  return createExecutionAttempt({
    executionKey: "execution-1",
    relation: "initial",
    generationTask: task,
    routingDecision: routing,
    createdAt: now,
    ...overrides,
  });
}

describe("ExecutionAttempt domain", () => {
  it("binds stable attempt identity to GenerationTask and pins cross-aggregate references", () => {
    const created = attempt();
    expect(created.id).toBe(
      createExecutionAttemptId({
        generationTaskId: task.id,
        attemptOrdinal: 1,
        relation: "initial",
        routingDecisionId: routing.routingDecisionId,
      }),
    );
    expect(created.generationTaskReference).toEqual(generationTaskSourceReference(task));
    expect(created.generationTaskId).toBe(task.id);
    expect(Object.isFrozen(created)).toBe(true);
    expect(created.status).toBe("created");
  });

  it("keeps Candidate as a reference/provenance boundary rather than task history", () => {
    const completed = completeExecutionAttempt({
      attempt: startExecutionAttempt(attempt(), now),
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
      candidate,
    });

    expect(completed.candidateReference).toEqual(candidateSourceReference(candidate));
    expect(Object.prototype.hasOwnProperty.call(completed, "candidate")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(task, "candidateIds")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(candidate, "attemptIds")).toBe(false);
  });

  it("moves created through running to succeeded with immutable runtime evidence", () => {
    const created = attempt();
    const running = startExecutionAttempt(created, now);
    const completed = completeExecutionAttempt({
      attempt: running,
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
    });

    expect(running.status).toBe("running");
    expect(completed.status).toBe("succeeded");
    expect(completed.startedAt?.iso).toBe(now.toISOString());
    expect(completed.endedAt?.iso).toBe(later.toISOString());
    expect(completed.runtimeEvidence?.evidenceReference).toBe(`${completed.id}:runtime-result`);
    expect(completed.runtimeEvidence?.sourceReference).toEqual(
      runtimeResultSourceReference(
        completed.id,
        runtimeResult,
        later,
        runtimeRequestSourceReference(completed.id, request),
      ),
    );
    expect(completed.auditReferences).toContain(`${completed.id}:runtime-result`);
    expect(() => startExecutionAttempt(completed, later)).toThrow("terminal");
    expect(() => completeExecutionAttempt({
      attempt: completed,
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
    })).toThrow("terminal");
  });

  it("records failure and cancellation as terminal evidence without deleting attempts", () => {
    const failed = failExecutionAttempt({
      attempt: startExecutionAttempt(attempt({ executionKey: "execution-fail" }), now),
      failure: { code: "provider_error", message: "unavailable", retryable: true },
      failedAt: later,
      retryReason: "provider unavailable",
    });
    const cancelled = cancelExecutionAttempt({
      attempt: attempt({ executionKey: "execution-cancel" }),
      reason: "author cancelled",
      cancelledAt: later,
    });

    expect(failed.status).toBe("failed");
    expect(failed.failureEvidence?.data).toMatchObject({ code: "provider_error", retryable: true });
    expect(failed.retryReason).toBe("provider unavailable");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancellationReason).toBe("author cancelled");
    expect(() => failExecutionAttempt({
      attempt: failed,
      failure: { code: "second", message: "no", retryable: false },
      failedAt: later,
    })).toThrow("terminal");
  });

  it("creates a new attempt for retry on the same GenerationTask", () => {
    const first = completeExecutionAttempt({
      attempt: startExecutionAttempt(attempt(), now),
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
    });
    const retried = createRetryExecutionAttempt({
      previousAttempt: first,
      executionKey: "execution-2",
      routingDecision: routing,
      createdAt: later,
    });

    expect(retried.id).not.toBe(first.id);
    expect(retried.generationTaskId).toBe(first.generationTaskId);
    expect(retried.relation).toBe("retry");
    expect(retried.predecessorAttemptReference).toEqual(executionAttemptSourceReference(first));
    expect(retried.routingDecision.routingDecisionId).toBe(routing.routingDecisionId);
  });

  it("keeps sequential retries distinct even with the same execution key and routing", () => {
    const first = completeExecutionAttempt({
      attempt: startExecutionAttempt(attempt(), now),
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
    });
    const second = createRetryExecutionAttempt({
      previousAttempt: first,
      executionKey: "same-retry-key",
      routingDecision: routing,
      createdAt: later,
    });
    const secondTerminal = completeExecutionAttempt({
      attempt: startExecutionAttempt(second, later),
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
    });
    const third = createRetryExecutionAttempt({
      previousAttempt: secondTerminal,
      executionKey: "same-retry-key",
      routingDecision: routing,
      createdAt: later,
    });

    expect(second.id).not.toBe(first.id);
    expect(third.id).not.toBe(second.id);
  });
  it("derives retry/fallback only from a terminal predecessor", () => {
    const nonTerminal = attempt();

    expect(() => createRetryExecutionAttempt({
      previousAttempt: nonTerminal,
      executionKey: "non-terminal-retry",
      attemptOrdinal: 2,
      routingDecision: routing,
      createdAt: later,
    })).toThrow("terminal predecessor");
    expect(() => createFallbackExecutionAttempt({
      previousAttempt: nonTerminal,
      executionKey: "non-terminal-fallback",
      attemptOrdinal: 2,
      routingDecision: { ...routing, routingDecisionId: "routing-fallback" },
      createdAt: later,
    })).toThrow("terminal predecessor");
  });

  it("separates sibling retries from one terminal predecessor", () => {
    const terminal = completeExecutionAttempt({
      attempt: startExecutionAttempt(attempt(), now),
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
    });
    const firstSibling = createRetryExecutionAttempt({
      previousAttempt: terminal,
      executionKey: "sibling-key",
      attemptOrdinal: 2,
      routingDecision: routing,
      createdAt: later,
    });
    const secondSibling = createRetryExecutionAttempt({
      previousAttempt: terminal,
      executionKey: "sibling-key",
      attemptOrdinal: 3,
      routingDecision: routing,
      createdAt: later,
    });

    expect(firstSibling.id).not.toBe(secondSibling.id);
  });

  it("does not derive retry identity from mutable predecessor hash", () => {
    const terminal = completeExecutionAttempt({
      attempt: startExecutionAttempt(attempt(), now),
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
    });
    const mutatedPredecessor = {
      ...terminal,
      executionKey: "mutated-predecessor-key",
    };
    const before = createRetryExecutionAttempt({
      previousAttempt: terminal,
      executionKey: "identity-key",
      attemptOrdinal: 2,
      routingDecision: routing,
      createdAt: later,
    });
    const after = createRetryExecutionAttempt({
      previousAttempt: mutatedPredecessor,
      executionKey: "identity-key",
      attemptOrdinal: 2,
      routingDecision: routing,
      createdAt: later,
    });

    expect(after.id).toBe(before.id);
    expect(after.id).not.toBe(terminal.id);
  });
  it("requires a new routing decision and new attempt for fallback", () => {
    const first = completeExecutionAttempt({
      attempt: startExecutionAttempt(attempt(), now),
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
    });
    const fallbackRoute = {
      ...routing,
      routingDecisionId: "routing-2",
      reason: "fallback after runtime failure",
      fallbackFromAttemptId: first.id,
    };
    const fallback = createFallbackExecutionAttempt({
      previousAttempt: first,
      executionKey: "execution-3",
      routingDecision: fallbackRoute,
      createdAt: later,
    });

    expect(fallback.id).not.toBe(first.id);
    expect(fallback.relation).toBe("fallback");
    expect(fallback.routingDecision.routingDecisionId).toBe("routing-2");
    expect(fallback.predecessorAttemptReference).toEqual(executionAttemptSourceReference(first));
    expect(() => createFallbackExecutionAttempt({
      previousAttempt: first,
      executionKey: "execution-4",
      routingDecision: { ...routing, fallbackFromAttemptId: first.id },
      createdAt: later,
    })).toThrow("fallback requires a new routing decision");
  });

  it("rejects Candidate provenance that does not match task and runtime result", () => {
    const running = startExecutionAttempt(attempt(), now);
    expect(() => completeExecutionAttempt({
      attempt: running,
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
      candidate: { ...candidate, taskId: "other-task" },
    })).toThrow("Candidate taskId must match GenerationTask");
    expect(() => completeExecutionAttempt({
      attempt: running,
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
      candidate: { ...candidate, novelId: "other-novel" },
    })).toThrow("Candidate novelId must match GenerationTask");
    expect(() => completeExecutionAttempt({
      attempt: running,
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
      candidate: {
        ...candidate,
        change: { type: "text", sceneId: "scene-1", text: "Different text" },
      },
    })).toThrow("Candidate change must match RuntimeResult");
  });

  it("rejects routing provider/model provenance that differs from RuntimeResult", () => {
    const running = startExecutionAttempt(attempt(), now);
    expect(() => completeExecutionAttempt({
      attempt: running,
      runtimeRequest: {
        ...request,
        modelPolicy: { ...request.modelPolicy, provider: "other-provider" },
      },
      runtimeResult: {
        ...runtimeResult,
        modelPolicy: { ...runtimeResult.modelPolicy, provider: "other-provider" },
      },
      completedAt: later,
    })).toThrow("routing provider must match RuntimeResult");
    expect(() => completeExecutionAttempt({
      attempt: running,
      runtimeRequest: {
        ...request,
        modelPolicy: { ...request.modelPolicy, model: "other-model" },
      },
      runtimeResult: {
        ...runtimeResult,
        modelPolicy: { ...runtimeResult.modelPolicy, model: "other-model" },
      },
      completedAt: later,
    })).toThrow("routing model must match RuntimeResult");
  });

  it("keeps evidence timestamps immutable when source Date mutates", () => {
    const completedAt = new Date(later);
    const cancelledAt = new Date(later);
    const completed = completeExecutionAttempt({
      attempt: startExecutionAttempt(attempt({ executionKey: "evidence-success" }), now),
      runtimeRequest: request,
      runtimeResult,
      completedAt,
    });
    const cancelled = cancelExecutionAttempt({
      attempt: attempt({ executionKey: "evidence-cancel" }),
      reason: "author cancelled",
      cancelledAt,
    });

    completedAt.setTime(Date.parse("2027-01-01T00:00:00.000Z"));
    cancelledAt.setTime(Date.parse("2027-01-01T00:00:00.000Z"));

    expect(isImmutableTimestamp(completed.runtimeEvidence?.data.occurredAt)).toBe(true);
    expect(completed.runtimeEvidence?.data.occurredAt.iso).toBe(later.toISOString());
    expect(isImmutableTimestamp(cancelled.cancellationEvidence?.data.occurredAt)).toBe(true);
    expect(cancelled.cancellationEvidence?.data.occurredAt.iso).toBe(later.toISOString());
  });

  it("gives cancellation complete observation/source/evidence references", () => {
    const cancelled = cancelExecutionAttempt({
      attempt: attempt({ executionKey: "evidence-cancel-refs" }),
      reason: "author cancelled",
      cancelledAt: later,
    });

    expect(cancelled.cancellationEvidence).toMatchObject({
      evidenceReference: `${cancelled.id}:cancellation`,
      sourceReference: {
        identity: cancelled.id,
        version: "execution-cancellation",
      },
      ordinal: 1,
      data: { reason: "author cancelled" },
    });
    expect(cancelled.auditReferences).toContain(`${cancelled.id}:cancellation`);
  });
  it("binds RuntimeRequest and RuntimeResult into one request-referenced evidence record", () => {
    const completed = completeExecutionAttempt({
      attempt: startExecutionAttempt(attempt({ executionKey: "request-binding" }), now),
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
    });
    const requestReference = runtimeRequestSourceReference(completed.id, request);

    expect(completed.runtimeEvidence?.data.requestReference).toEqual(requestReference);
    expect(completed.runtimeEvidence?.data.result.requestReference).toEqual(requestReference);
    expect(completed.runtimeEvidence?.data.resultReference.identity).toBe(
      `${completed.id}:runtime-result`,
    );
    expect(completed.runtimeEvidence?.data.resultReference.version).toBe(
      `request:${requestReference.hash}`,
    );
    expect(
      runtimeRequestSourceReference(completed.id, {
        ...request,
        context: { source: "changed" },
      }).hash,
    ).not.toBe(requestReference.hash);
  });

  it.each([
    ["taskId", { ...request, taskId: "other-task" }, runtimeResult],
    ["agentRole", { ...request, agentRole: "editor" as const }, runtimeResult],
    [
      "modelPolicy",
      { ...request, modelPolicy: { ...request.modelPolicy, model: "other-model" } },
      runtimeResult,
    ],
    ["basedOnVersionSet", { ...request, basedOnVersionSet: {} }, runtimeResult],
  ] as const)("rejects RuntimeRequest/RuntimeResult %s mismatch", (_field, changedRequest, changedResult) => {
    expect(() => completeExecutionAttempt({
      attempt: startExecutionAttempt(attempt({ executionKey: `mismatch-${_field}` }), now),
      runtimeRequest: changedRequest,
      runtimeResult: changedResult,
      completedAt: later,
    })).toThrow("RuntimeRequest and RuntimeResult must match");
  });

  it("makes attempt identity independent of executionKey for duplicate ordinal reservation", () => {
    const terminal = completeExecutionAttempt({
      attempt: startExecutionAttempt(attempt({ executionKey: "identity-predecessor" }), now),
      runtimeRequest: request,
      runtimeResult,
      completedAt: later,
    });
    const first = createRetryExecutionAttempt({
      previousAttempt: terminal,
      executionKey: "key-a",
      attemptOrdinal: 2,
      routingDecision: routing,
      createdAt: later,
    });
    const duplicate = createRetryExecutionAttempt({
      previousAttempt: terminal,
      executionKey: "key-b",
      attemptOrdinal: 2,
      routingDecision: routing,
      createdAt: later,
    });
    const sibling = createRetryExecutionAttempt({
      previousAttempt: terminal,
      executionKey: "key-a",
      attemptOrdinal: 3,
      routingDecision: routing,
      createdAt: later,
    });
    const fallback = createFallbackExecutionAttempt({
      previousAttempt: terminal,
      executionKey: "key-a",
      attemptOrdinal: 2,
      routingDecision: { ...routing, routingDecisionId: "routing-identity-new" },
      createdAt: later,
    });

    expect(duplicate.id).toBe(first.id);
    expect(sibling.id).not.toBe(first.id);
    expect(fallback.id).not.toBe(first.id);
  });

  it("keeps lifecycle timestamps immutable under Date and prototype mutation", () => {
    const createdAt = new Date(now);
    const startedAt = new Date(now);
    const completedAt = new Date(later);
    const created = attempt({ executionKey: "lifecycle-immutable", createdAt });
    const running = startExecutionAttempt(created, startedAt);
    const completed = completeExecutionAttempt({
      attempt: running,
      runtimeRequest: request,
      runtimeResult,
      completedAt,
    });

    createdAt.setTime(Date.parse("2027-01-01T00:00:00.000Z"));
    startedAt.setTime(Date.parse("2027-01-01T00:00:00.000Z"));
    completedAt.setTime(Date.parse("2027-01-01T00:00:00.000Z"));

    expect(isImmutableTimestamp(created.createdAt)).toBe(true);
    expect(isImmutableTimestamp(running.startedAt)).toBe(true);
    expect(isImmutableTimestamp(completed.endedAt)).toBe(true);
    expect(created.createdAt.iso).toBe(now.toISOString());
    expect(running.startedAt?.iso).toBe(now.toISOString());
    expect(completed.endedAt?.iso).toBe(later.toISOString());
    expect(() => Date.prototype.setTime.call(created.createdAt, 0)).toThrow();
  });

  it("uses stable source hashes for task, runtime result, and candidate references", () => {
    const first = runtimeResultSourceReference("attempt-hash", runtimeResult);
    const second = runtimeResultSourceReference("attempt-hash", {
      ...runtimeResult,
      change: { type: "text", sceneId: "scene-1", text: "Generated text" },
    });
    const changed = runtimeResultSourceReference("attempt-hash", {
      ...runtimeResult,
      change: { type: "text", sceneId: "scene-1", text: "Different text" },
    });

    expect(first).toEqual(second);
    expect(changed.hash).not.toBe(first.hash);
    expect(generationTaskSourceReference(task).hash).toBe(
      generationTaskSourceReference({ ...task }).hash,
    );
    expect(candidateSourceReference(candidate).identity).toBe(candidate.id);
    expect(candidateSourceReference(candidate).version).toBe(candidate.currentRevisionId);
  });
});
