import { describe, expect, it } from "vitest";
import {
  recordExecutionAttemptFromRuntimeResult,
} from "../../src/production/application/executionAttemptService";
import type { ExecutionAttemptPersistence } from "../../src/production/application/executionAttemptPersistence";
import type { ExecutionAttempt } from "../../src/production/domain/executionAttempt";
import { createExecutionAttemptVerificationFixture } from "./executionAttemptFixtures";

export interface ExecutionAttemptCorruptionEnvironment {
  readonly persistence: ExecutionAttemptPersistence;
  makeCurrentStale(current: ExecutionAttempt, stale: ExecutionAttempt): Promise<void>;
  removeHistoryRevision(attempt: ExecutionAttempt, revisionId: string): Promise<void>;
}

export function runExecutionAttemptPersistenceCorruptionContract(
  adapterName: string,
  createEnvironment: () => Promise<ExecutionAttemptCorruptionEnvironment>,
): void {
  describe(`${adapterName} [task:2.1] execution attempt corruption contract`, () => {
    it("rejects duplicate predecessor/ordinal reservation with a different executionKey", async () => {
      const environment = await createEnvironment();
      const fixture = createExecutionAttemptVerificationFixture(environment.persistence);
      const base = {
        persistence: environment.persistence,
        relation: "initial" as const,
        generationTask: fixture.generationTask,
        routingDecision: fixture.routingDecision,
        runtimeRequest: fixture.runtimeRequest,
        runtimeResult: fixture.runtimeResult,
        startedAt: new Date("2026-10-04T00:00:00.000Z"),
        completedAt: new Date("2026-10-04T00:01:00.000Z"),
        attemptOrdinal: 1,
      };
      await recordExecutionAttemptFromRuntimeResult({
        ...base,
        executionKey: "corruption-key-a",
      });

      await expect(recordExecutionAttemptFromRuntimeResult({
        ...base,
        executionKey: "corruption-key-b",
      })).rejects.toMatchObject({ code: "revision_conflict" });
    });

    it("rejects stale current pointers instead of replay success", async () => {
      const environment = await createEnvironment();
      const fixture = createExecutionAttemptVerificationFixture(environment.persistence);
      const completed = await recordExecutionAttemptFromRuntimeResult({
        persistence: environment.persistence,
        executionKey: "corruption-stale",
        attemptOrdinal: 1,
        relation: "initial",
        generationTask: fixture.generationTask,
        routingDecision: fixture.routingDecision,
        runtimeRequest: fixture.runtimeRequest,
        runtimeResult: fixture.runtimeResult,
        startedAt: new Date("2026-10-04T00:00:00.000Z"),
        completedAt: new Date("2026-10-04T00:01:00.000Z"),
      });
      const running = await environment.persistence.attempts.getRevision(
        completed.id,
        `${completed.id}:running`,
      );
      if (!running) throw new Error("missing running revision");

      await environment.makeCurrentStale(completed, running);
      await expect(recordExecutionAttemptFromRuntimeResult({
        persistence: environment.persistence,
        executionKey: "corruption-stale",
        attemptOrdinal: 1,
        relation: "initial",
        generationTask: fixture.generationTask,
        routingDecision: fixture.routingDecision,
        runtimeRequest: fixture.runtimeRequest,
        runtimeResult: fixture.runtimeResult,
        startedAt: new Date("2026-10-04T00:00:00.000Z"),
        completedAt: new Date("2026-10-04T00:01:00.000Z"),
      })).rejects.toMatchObject({ code: "current_revision_mismatch" });
    });

    it("rejects missing intermediate history instead of replay success", async () => {
      const environment = await createEnvironment();
      const fixture = createExecutionAttemptVerificationFixture(environment.persistence);
      const completed = await recordExecutionAttemptFromRuntimeResult({
        persistence: environment.persistence,
        executionKey: "corruption-history",
        attemptOrdinal: 1,
        relation: "initial",
        generationTask: fixture.generationTask,
        routingDecision: fixture.routingDecision,
        runtimeRequest: fixture.runtimeRequest,
        runtimeResult: fixture.runtimeResult,
        startedAt: new Date("2026-10-04T00:00:00.000Z"),
        completedAt: new Date("2026-10-04T00:01:00.000Z"),
      });

      await environment.removeHistoryRevision(completed, `${completed.id}:running`);
      await expect(recordExecutionAttemptFromRuntimeResult({
        persistence: environment.persistence,
        executionKey: "corruption-history",
        attemptOrdinal: 1,
        relation: "initial",
        generationTask: fixture.generationTask,
        routingDecision: fixture.routingDecision,
        runtimeRequest: fixture.runtimeRequest,
        runtimeResult: fixture.runtimeResult,
        startedAt: new Date("2026-10-04T00:00:00.000Z"),
        completedAt: new Date("2026-10-04T00:01:00.000Z"),
      })).rejects.toMatchObject({ code: "history_inconsistency" });
    });
  });
}
