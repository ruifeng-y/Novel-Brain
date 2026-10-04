import { describe, expect, it } from "vitest";
import {
  createFallbackExecutionAttempt,
  createRetryExecutionAttempt,
  candidateSourceReference,
  completeExecutionAttempt,
  createExecutionAttempt,
  generationTaskSourceReference,
  runtimeRequestSourceReference,
  runtimeResultSourceReference,
  startExecutionAttempt,
} from "../../src/production/domain/executionAttempt";
import type { Candidate } from "../../src/production/domain/candidate";
import type {
  ExecutionAttempt,
  ExecutionRoutingDecisionReference,
} from "../../src/production/domain/executionAttempt";
import {
  recordExecutionAttemptFromRuntimeResult,
} from "../../src/production/application/executionAttemptService";
import type { ExecutionAttemptPersistence } from "../../src/production/application/executionAttemptPersistence";
import type { GenerationTask } from "../../src/production/domain/generationTask";
import type { RuntimeRequest, RuntimeResult } from "../../src/production/runtime/runtimeAdapter";
import {
  createObservationSnapshot,
  resolveObservation,
} from "../../src/shared/domain/observationSource";
import {
  describeVerificationGate,
  type CapabilityVerificationGate,
} from "./capabilityVerificationContract";

export interface ExecutionAttemptVerificationEnvironment {
  readonly persistence: ExecutionAttemptPersistence;
  readonly generationTask: GenerationTask;
  readonly routingDecision: ExecutionRoutingDecisionReference;
  readonly runtimeRequest: RuntimeRequest;
  readonly runtimeResult: RuntimeResult;
  readonly candidate: Candidate;
}

function input(
  environment: ExecutionAttemptVerificationEnvironment,
  overrides: Record<string, unknown> = {},
) {
  return {
    persistence: environment.persistence,
    executionKey: "verification-attempt-1",
    attemptOrdinal: 1,
    relation: "initial" as const,
    generationTask: environment.generationTask,
    routingDecision: environment.routingDecision,
    runtimeRequest: environment.runtimeRequest,
    runtimeResult: environment.runtimeResult,
    startedAt: new Date("2026-10-04T00:00:00.000Z"),
    completedAt: new Date("2026-10-04T00:01:00.000Z"),
    ...overrides,
  };
}

function attemptInput(environment: ExecutionAttemptVerificationEnvironment, executionKey: string) {
  return {
    executionKey,
    attemptOrdinal: 1,
    relation: "initial" as const,
    generationTask: environment.generationTask,
    routingDecision: environment.routingDecision,
    createdAt: new Date("2026-10-04T00:00:00.000Z"),
  };
}

function gate(
  name: CapabilityVerificationGate,
  title: string,
  body: (
    environment: ExecutionAttemptVerificationEnvironment,
  ) => void | Promise<void>,
  createEnvironment: () => Promise<ExecutionAttemptVerificationEnvironment>,
): void {
  describeVerificationGate(name, title, async () => {
    await body(await createEnvironment());
  });
}

export function runExecutionAttemptVerificationSmokeContract(
  adapterName: string,
  taskId: string,
  createEnvironment: () => Promise<ExecutionAttemptVerificationEnvironment>,
): void {
  describe(`${adapterName} [task:${taskId}] execution attempt verification gate smoke`, () => {
    gate("domain", "keeps retry and fallback identity on the same GenerationTask", async (environment) => {
      const first = createExecutionAttempt(attemptInput(environment, "domain-1"));
      const firstTerminal = completeExecutionAttempt({
        attempt: startExecutionAttempt(first, new Date("2026-10-04T00:00:00.000Z")),
        runtimeRequest: environment.runtimeRequest,
        runtimeResult: environment.runtimeResult,
        completedAt: new Date("2026-10-04T00:01:00.000Z"),
      });
      const retry = createRetryExecutionAttempt({
        previousAttempt: firstTerminal,
        executionKey: "domain-2",
        attemptOrdinal: 2,
        routingDecision: environment.routingDecision,
        createdAt: new Date("2026-10-04T00:01:00.000Z"),
      });
      const retryTerminal = completeExecutionAttempt({
        attempt: startExecutionAttempt(retry, new Date("2026-10-04T00:02:00.000Z")),
        runtimeRequest: environment.runtimeRequest,
        runtimeResult: environment.runtimeResult,
        completedAt: new Date("2026-10-04T00:03:00.000Z"),
      });
      const fallback = createFallbackExecutionAttempt({
        previousAttempt: retryTerminal,
        executionKey: "domain-3",
        attemptOrdinal: 3,
        routingDecision: {
          ...environment.routingDecision,
          routingDecisionId: "verification-routing-2",
          fallbackFromAttemptId: retry.id,
        },
        createdAt: new Date("2026-10-04T00:02:00.000Z"),
      });

      expect(new Set([first.id, retry.id, fallback.id]).size).toBe(3);
      expect(retry.generationTaskId).toBe(first.generationTaskId);
      expect(fallback.routingDecision.routingDecisionId).not.toBe(retry.routingDecision.routingDecisionId);
    }, createEnvironment);

    gate("integration", "resolves RuntimeAdapter result evidence through observation contracts", async (environment) => {
      const recorded = await recordExecutionAttemptFromRuntimeResult(input(environment));
      expect(recorded.runtimeEvidence).toBeDefined();
      const snapshot = createObservationSnapshot({
        sourceReference: recorded.runtimeEvidence!.sourceReference,
        observations: [recorded.runtimeEvidence!],
      });
      const resolution = resolveObservation(snapshot, {
        evidenceReference: recorded.runtimeEvidence!.evidenceReference,
        sourceReference: recorded.runtimeEvidence!.sourceReference,
      });
      expect(resolution.status).toBe("observed");
      expect(recorded.generationTaskReference).toEqual(
        generationTaskSourceReference(environment.generationTask),
      );
    }, createEnvironment);

    gate("persistence", "retains every immutable lifecycle revision", async (environment) => {
      const recorded = await recordExecutionAttemptFromRuntimeResult(input(environment));
      expect(await environment.persistence.attempts.findById(recorded.id)).toEqual(recorded);
      for (const suffix of ["created", "running", "succeeded"]) {
        expect(
          await environment.persistence.attempts.getRevision(recorded.id, `${recorded.id}:${suffix}`),
        ).toBeDefined();
      }
    }, createEnvironment);

    gate("transaction", "rolls back partial attempt history on failure", async (environment) => {
      const attempt = createExecutionAttempt(attemptInput(environment, "transaction-1"));
      await expect(
        environment.persistence.transaction.run(async (work) => {
          await work.attempts.saveRevisionIfAbsent(attempt);
          throw new Error("rollback requested");
        }),
      ).rejects.toThrow("rollback requested");
      expect(await environment.persistence.attempts.findById(attempt.id)).toBeUndefined();
    }, createEnvironment);

    gate("concurrency", "serializes concurrent identical recordings", async (environment) => {
      const [first, second] = await Promise.all([
        recordExecutionAttemptFromRuntimeResult(input(environment)),
        recordExecutionAttemptFromRuntimeResult(input(environment)),
      ]);
      expect(second).toEqual(first);
      expect(await environment.persistence.attempts.listByNovel(environment.generationTask.novelId)).toHaveLength(1);
    }, createEnvironment);

    gate("recovery", "completes a partially persisted attempt without rewriting history", async (environment) => {
      const created = createExecutionAttempt(attemptInput(environment, "recovery-1"));
      await environment.persistence.attempts.saveRevisionIfAbsent(created);
      const recovered = await recordExecutionAttemptFromRuntimeResult(input(environment, {
        executionKey: "recovery-1",
      }));
      expect(recovered.id).toBe(created.id);
      expect(await environment.persistence.attempts.getRevision(created.id, created.currentRevisionId)).toEqual(created);
      expect(recovered.status).toBe("succeeded");
    }, createEnvironment);

    gate("replay", "returns identical evidence for an identical execution identity", async (environment) => {
      const first = await recordExecutionAttemptFromRuntimeResult(input(environment));
      const replay = await recordExecutionAttemptFromRuntimeResult(input(environment));
      expect(replay).toEqual(first);
      expect(replay.runtimeEvidence?.sourceReference).toEqual(
        runtimeResultSourceReference(
          first.id,
          environment.runtimeResult,
          new Date("2026-10-04T00:01:00.000Z"),
          runtimeRequestSourceReference(first.id, environment.runtimeRequest),
        ),
      );
    }, createEnvironment);

    gate("transaction", "maps CAS conflict to a stable error without rewriting history", async (environment) => {
      const attempt = createExecutionAttempt(attemptInput(environment, "cas-conflict"));
      await environment.persistence.attempts.saveRevisionIfAbsent(attempt);
      await expect(
        environment.persistence.attempts.saveIfCurrent(
          "wrong-current",
          { ...attempt, currentRevisionId: `${attempt.id}:running` },
        ),
      ).rejects.toThrow("CAS revision conflict");
      expect((await environment.persistence.attempts.findById(attempt.id))?.currentRevisionId).toBe(
        attempt.currentRevisionId,
      );
    }, createEnvironment);

    gate("concurrency", "keeps one winner when identical attempt identity receives conflicting evidence", async (environment) => {
      const outcomes = await Promise.allSettled([
        recordExecutionAttemptFromRuntimeResult(input(environment)),
        recordExecutionAttemptFromRuntimeResult(input(environment, {
          runtimeResult: {
            ...environment.runtimeResult,
            change: { type: "text", sceneId: "scene-1", text: "Different text" },
          },
        })),
      ]);
      const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "revision_conflict",
      });
    }, createEnvironment);

    gate("recovery", "rejects recovery replay when evidence differs from the exact expected transition", async (environment) => {
      const first = await recordExecutionAttemptFromRuntimeResult(input(environment));
      await expect(recordExecutionAttemptFromRuntimeResult(input(environment, {
        runtimeResult: {
          ...environment.runtimeResult,
          change: { type: "text", sceneId: "scene-1", text: "Different text" },
        },
      }))).rejects.toMatchObject({ code: "revision_conflict" });
      expect(await environment.persistence.attempts.findById(first.id)).toEqual(first);
    }, createEnvironment);

    gate("cross-system", "rejects Candidate/runtime provenance mismatch", async (environment) => {
      await expect(recordExecutionAttemptFromRuntimeResult(input(environment, {
        candidate: {
          ...environment.candidate,
          change: { type: "text", sceneId: "scene-1", text: "Different text" },
        },
      }))).rejects.toThrow("Candidate change must match RuntimeResult");
      await expect(recordExecutionAttemptFromRuntimeResult(input(environment, {
        routingDecision: {
          ...environment.routingDecision,
          provider: "other-provider",
        },
      }))).rejects.toThrow("routing provider must match RuntimeResult");
    }, createEnvironment);

    gate("cross-system", "stores Candidate provenance without changing task or candidate history", async (environment) => {
      const recorded = await recordExecutionAttemptFromRuntimeResult(input(environment, {
        candidate: environment.candidate,
      }));
      expect(recorded.candidateReference).toEqual(candidateSourceReference(environment.candidate));
      expect(Object.prototype.hasOwnProperty.call(environment.generationTask, "candidateIds")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(environment.candidate, "attemptIds")).toBe(false);
    }, createEnvironment);

    gate("regression", "keeps task and runtime evidence hashes stable and immutable", async (environment) => {
      const recorded = await recordExecutionAttemptFromRuntimeResult(input(environment));
      expect(recorded.generationTaskReference.hash).toBe(
        generationTaskSourceReference(environment.generationTask).hash,
      );
      expect(recorded.runtimeEvidence?.sourceReference.hash).toBe(
        runtimeResultSourceReference(
          recorded.id,
          environment.runtimeResult,
          new Date("2026-10-04T00:01:00.000Z"),
          runtimeRequestSourceReference(recorded.id, environment.runtimeRequest),
        ).hash,
      );
      expect(Object.isFrozen(recorded)).toBe(true);
      expect(Object.isFrozen(recorded.runtimeEvidence)).toBe(true);
    }, createEnvironment);
  });
}
