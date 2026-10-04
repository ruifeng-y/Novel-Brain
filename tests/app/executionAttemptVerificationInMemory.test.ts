import { describe, expect, it } from "vitest";
import {
  createInMemoryExecutionAttemptPersistence,
  type ExecutionAttemptPersistence,
} from "../../src/production/application/executionAttemptPersistence";
import {
  InMemoryPersistenceTransaction,
} from "../../src/shared/infrastructure/persistenceTransaction";
import {
  InMemoryRevisionedRepository,
} from "../../src/app/inMemoryRepositories";
import { capabilityPersistencePayloadCodec } from "../../src/shared/domain/persistencePayload";
import {
  runExecutionAttemptPersistenceCorruptionContract,
  type ExecutionAttemptCorruptionEnvironment,
} from "../support/executionAttemptPersistenceCorruptionContract";
import {
  recordExecutionAttemptFromRuntimeResult,
} from "../../src/production/application/executionAttemptService";
import {
  completeExecutionAttempt,
  createExecutionAttempt,
  startExecutionAttempt,
} from "../../src/production/domain/executionAttempt";
import {
  createGenerationTask,
} from "../../src/production/domain/generationTask";
import type { RuntimeRequest, RuntimeResult } from "../../src/production/runtime/runtimeAdapter";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import { isImmutableTimestamp } from "../../src/shared/domain/observationSource";
import type { ExecutionAttempt } from "../../src/production/domain/executionAttempt";

const now = new Date("2026-10-04T00:00:00.000Z");
const later = new Date("2026-10-04T00:01:00.000Z");
const task = createGenerationTask({
  id: "task-persist-1",
  novelId: "novel-persist-1",
  operation: "rewrite",
  targetSceneId: "scene-1",
  intent: "Rewrite the scene.",
  basedOnVersionSet: createVersionSet({
    scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
  }),
  createdAt: now,
});
const routing = {
  routingDecisionId: "routing-persist-1",
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

function createInMemoryCorruptionEnvironment(): ExecutionAttemptCorruptionEnvironment {
  const attempts = new InMemoryRevisionedRepository<ExecutionAttempt>(
    capabilityPersistencePayloadCodec,
  );
  const transaction = new InMemoryPersistenceTransaction(
    (access) => ({ attempts: access.revisioned(attempts) }),
    [attempts],
  );
  const persistence: ExecutionAttemptPersistence = {
    transaction,
    attempts: transaction.revisioned(attempts),
  };
  return {
    persistence,
    makeCurrentStale: async (current, stale) => {
      await persistence.attempts.saveIfCurrent(current.currentRevisionId, stale);
    },
    removeHistoryRevision: async (_attempt, revisionId) => {
      const snapshot = attempts.captureSnapshot() as {
        revisions: Map<string, unknown>;
      };
      snapshot.revisions.delete(`${_attempt.id}:${revisionId}`);
      attempts.restoreSnapshot(snapshot);
    },
  };
}

function serviceInput(persistence = createInMemoryExecutionAttemptPersistence()) {
  return {
    persistence,
    executionKey: "execution-persist-1",
    relation: "initial" as const,
    generationTask: task,
    routingDecision: routing,
    runtimeRequest: request,
    runtimeResult: result,
    startedAt: now,
    completedAt: later,
  };
}

describe("ExecutionAttempt persistence", () => {
  it("round-trips attempt lifecycle revisions with generic capability persistence", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    const created = createExecutionAttempt({
      executionKey: "execution-persist-roundtrip",
      relation: "initial",
      generationTask: task,
      routingDecision: routing,
      createdAt: now,
    });
    const running = startExecutionAttempt(created, now);
    const completed = completeExecutionAttempt({
      attempt: running,
      runtimeRequest: request,
      runtimeResult: result,
      completedAt: later,
    });

    await persistence.attempts.saveRevisionIfAbsent(created);
    await persistence.attempts.saveRevisionIfAbsent(running);
    await persistence.attempts.saveIfCurrent(created.currentRevisionId, running);
    await persistence.attempts.saveRevisionIfAbsent(completed);
    await persistence.attempts.saveIfCurrent(running.currentRevisionId, completed);

    expect(await persistence.attempts.findById(created.id)).toEqual(completed);
    expect(await persistence.attempts.getRevision(created.id, created.currentRevisionId)).toEqual(created);
    expect(await persistence.attempts.getRevision(created.id, running.currentRevisionId)).toEqual(running);
    expect(await persistence.attempts.listByNovel(task.novelId)).toEqual([completed]);
  });

  it("replays an identical RuntimeAdapter result without duplicate revisions", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    const first = await recordExecutionAttemptFromRuntimeResult(serviceInput(persistence));
    const replay = await recordExecutionAttemptFromRuntimeResult(serviceInput(persistence));

    expect(replay).toEqual(first);
    expect(await persistence.attempts.listByNovel(task.novelId)).toHaveLength(1);
    expect(await persistence.attempts.getRevision(first.id, first.currentRevisionId)).toEqual(first);
  });

  it("serializes concurrent idempotent writes to one attempt history", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    const [first, second] = await Promise.all([
      recordExecutionAttemptFromRuntimeResult(serviceInput(persistence)),
      recordExecutionAttemptFromRuntimeResult(serviceInput(persistence)),
    ]);

    expect(second).toEqual(first);
    expect(await persistence.attempts.listByNovel(task.novelId)).toHaveLength(1);
  });

  it("rolls back partial lifecycle writes on transaction failure", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    const created = createExecutionAttempt({
      executionKey: "execution-persist-rollback",
      relation: "initial",
      generationTask: task,
      routingDecision: routing,
      createdAt: now,
    });

    await expect(
      persistence.transaction.run(async (work) => {
        await work.attempts.saveRevisionIfAbsent(created);
        throw new Error("rollback requested");
      }),
    ).rejects.toThrow("rollback requested");

    expect(await persistence.attempts.findById(created.id)).toBeUndefined();
  });

  it("recovers after a partial write by completing the same identity", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    const created = createExecutionAttempt({
      executionKey: "execution-persist-recovery",
      relation: "initial",
      generationTask: task,
      routingDecision: routing,
      createdAt: now,
    });
    await persistence.attempts.saveRevisionIfAbsent(created);

    const recovered = await recordExecutionAttemptFromRuntimeResult({
      ...serviceInput(persistence),
      executionKey: "execution-persist-recovery",
    });

    expect(recovered.id).toBe(created.id);
    expect(recovered.status).toBe("succeeded");
    expect(await persistence.attempts.getRevision(created.id, created.currentRevisionId)).toEqual(created);
    expect(await persistence.attempts.getRevision(recovered.id, recovered.currentRevisionId)).toEqual(recovered);
  });
});

describe("ExecutionAttempt evidence persistence immutability", () => {
  it("round-trips evidence timestamps as ImmutableTimestamp and isolates source Date mutation", async () => {
    const persistence = createInMemoryExecutionAttemptPersistence();
    const completedAt = new Date("2026-10-04T00:01:00.000Z");
    const recorded = await recordExecutionAttemptFromRuntimeResult({
      ...serviceInput(persistence),
      completedAt,
    });
    completedAt.setTime(Date.parse("2027-01-01T00:00:00.000Z"));

    const loaded = await persistence.attempts.findById(recorded.id);
    expect(loaded?.runtimeEvidence?.data.occurredAt).toMatchObject({
      iso: "2026-10-04T00:01:00.000Z",
    });
    expect(isImmutableTimestamp(loaded?.runtimeEvidence?.data.occurredAt)).toBe(true);
    expect(isImmutableTimestamp(loaded?.createdAt)).toBe(true);
    expect(isImmutableTimestamp(loaded?.updatedAt)).toBe(true);
    expect(isImmutableTimestamp(loaded?.startedAt)).toBe(true);
    expect(isImmutableTimestamp(loaded?.endedAt)).toBe(true);
  });
});

runExecutionAttemptPersistenceCorruptionContract(
  "InMemory",
  async () => createInMemoryCorruptionEnvironment(),
);
