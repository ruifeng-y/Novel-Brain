import { describe, expect, it } from "vitest";
import {
  canonicalPersistenceMappingContract,
} from "../../src/shared/application/canonicalPersistenceMapping";
import {
  executeDerivedProjectionAfterCanonicalCommit,
  executeForwardCompensation,
  projectionReplayRecoveryContract,
  rebuildProjection,
  recoverProjectionFromSnapshot,
  replayProjectionEvents,
  validateProjectionReplayRecoveryContract,

  type ProjectionReplayRecoveryContract,
} from "../../src/shared/application/projectionReplayRecovery";
import {
  failingProjectionFixture,
  inMemoryForwardCompensationStore,
  numberReducer,
  projectionEvents,
} from "../support/projectionReplayRecoveryFixtures";

describe("[task:P1.3] projection replay and recovery contracts", () => {
  it("[domain] [integration] [cross-system] keeps every existing capability projection derived and outside canonical success", () => {
    validateProjectionReplayRecoveryContract(projectionReplayRecoveryContract);

    expect(projectionReplayRecoveryContract.projectionOwnership).toBe("derived");
    expect(projectionReplayRecoveryContract.canonicalSuccessCriterion).toBe("excluded");
    expect(projectionReplayRecoveryContract.entries.map((entry) => entry.contract)).toEqual([
      "change-set-revision-projection",
      "run-audit-projection",
      "recall-item-projection",
      "memory-context-projection",
      "dependency-registry-view",
      "impact-analysis-result",
    ]);

    const projectedMappingContracts = canonicalPersistenceMappingContract.entries
      .filter((entry) => entry.roles.includes("projection"))
      .map((entry) => entry.contract)
      .sort();
    const coveredContracts = projectionReplayRecoveryContract.entries
      .map((entry) => entry.contract)
      .sort();
    expect(coveredContracts).toEqual(expect.arrayContaining(projectedMappingContracts));
  });

  it("[persistence] [regression] rejects canonical projection ownership, schema metadata, and incomplete recovery coverage", () => {
    const canonicalProjection = {
      ...projectionReplayRecoveryContract,
      entries: projectionReplayRecoveryContract.entries.map((entry, index) =>
        index === 0 ? { ...entry, projectionOwnership: "canonical" } : entry,
      ),
    } as unknown as ProjectionReplayRecoveryContract;
    expect(() => validateProjectionReplayRecoveryContract(canonicalProjection)).toThrow(
      "Projection must remain derived: change-set-revision-projection",
    );

    const schemaMetadata = {
      ...projectionReplayRecoveryContract,
      entries: projectionReplayRecoveryContract.entries.map((entry, index) =>
        index === 0 ? { ...entry, table: "ProjectionRow" } : entry,
      ),
    } as unknown as ProjectionReplayRecoveryContract;
    expect(() => validateProjectionReplayRecoveryContract(schemaMetadata)).toThrow(
      "schema/field metadata is not allowed: change-set-revision-projection.table",
    );

    const missingReplay = {
      ...projectionReplayRecoveryContract,
      entries: projectionReplayRecoveryContract.entries.map((entry) =>
        entry.contract === "run-audit-projection"
          ? { ...entry, recoveryMechanisms: ["projection-rebuild"] }
          : entry,
      ),
    } as unknown as ProjectionReplayRecoveryContract;
    expect(() => validateProjectionReplayRecoveryContract(missingReplay)).toThrow(
      "Projection event replay is required: run-audit-projection",
    );
  });

  it("[replay] rebuilds deterministic projection state from ordered append-only events", () => {
    const rebuilt = rebuildProjection(numberReducer, projectionEvents);

    expect(rebuilt).toEqual({
      mechanism: "projection-rebuild",
      state: { total: 6 },
      firstSequence: 1,
      lastSequence: 3,
      appliedEvents: 3,
    });
    expect(replayProjectionEvents(numberReducer, [...projectionEvents].reverse().reverse())).toEqual({
      mechanism: "event-replay",
      state: { total: 6 },
      firstSequence: 1,
      lastSequence: 3,
      appliedEvents: 3,
    });
    expect(() =>
      replayProjectionEvents(numberReducer, [projectionEvents[0]!, projectionEvents[0]!]),
    ).toThrow("Projection event sequence must be strictly increasing");
  });

  it("[recovery] restores from a versioned snapshot and replays only later events", () => {
    const snapshot = { throughSequence: 2, state: { total: 3 } };

    expect(recoverProjectionFromSnapshot(numberReducer, snapshot, projectionEvents.slice(2))).toEqual({
      mechanism: "snapshot-recovery",
      state: { total: 6 },
      firstSequence: 3,
      lastSequence: 3,
      appliedEvents: 1,
    });
    expect(() =>
      recoverProjectionFromSnapshot(numberReducer, snapshot, projectionEvents.slice(1)),
    ).toThrow("Projection event sequence must follow the snapshot");
  });

  it("[transaction] keeps canonical success authoritative when projection rebuild fails", async () => {
    const fixture = failingProjectionFixture();
    const execution = await executeDerivedProjectionAfterCanonicalCommit({
      commitCanonical: fixture.commitCanonical,
      rebuildProjection: fixture.failProjection,
    });

    expect(fixture.canonicalCommits).toBe(1);
    expect(execution).toEqual({
      canonicalStatus: "committed",
      canonicalSuccess: true,
      projectionStatus: "failed",
      recoveryRequired: true,
      error: "injected projection rebuild failure",
    });

    const recovered = await executeDerivedProjectionAfterCanonicalCommit({
      commitCanonical: fixture.commitCanonical,
      rebuildProjection: fixture.recoverProjection,
    });
    expect(recovered).toEqual({
      canonicalStatus: "committed",
      canonicalSuccess: true,
      projectionStatus: "succeeded",
      value: { total: 6 },
    });
  });

  it("[replay] [regression] replays forward compensation idempotently without touching canonical success", async () => {
    const store = inMemoryForwardCompensationStore();
    const compensate = async () => ({ effect: "restored-read-model" });

    const first = await executeForwardCompensation({
      id: "projection-recovery:memory-context-projection",
      fingerprint: "fingerprint-a",
      compensate,
      store,
    });
    const replay = await executeForwardCompensation({
      id: "projection-recovery:memory-context-projection",
      fingerprint: "fingerprint-a",
      compensate,
      store,
    });

    expect(first.status).toBe("compensated");
    expect(replay).toEqual({
      status: "replayed",
      record: {
        id: "projection-recovery:memory-context-projection",
        fingerprint: "fingerprint-a",
        effect: "restored-read-model",
      },
    });
    await expect(
      executeForwardCompensation({
        id: "projection-recovery:memory-context-projection",
        fingerprint: "fingerprint-b",
        compensate,
        store,
      }),
    ).rejects.toThrow(
      "Forward compensation conflict: projection-recovery:memory-context-projection",
    );
  });

  it("[concurrency] [recovery] races one forward compensation winner and retries failed compensation", async () => {
    const store = inMemoryForwardCompensationStore();
    const firstAttempt = await executeForwardCompensation({
      id: "projection-recovery:failed-attempt",
      fingerprint: "stable",
      compensate: async () => {
        throw new Error("injected compensation outage");
      },
      store,
    }).catch((error: unknown) => error);
    expect(firstAttempt).toBeInstanceOf(Error);

    const recovered = await executeForwardCompensation({
      id: "projection-recovery:failed-attempt",
      fingerprint: "stable",
      compensate: async () => ({ effect: "recovered" }),
      store,
    });
    expect(recovered.status).toBe("compensated");

    const races = await Promise.all([
      executeForwardCompensation({
        id: "projection-recovery:race",
        fingerprint: "stable",
        compensate: async () => ({ effect: "race" }),
        store,
      }),
      executeForwardCompensation({
        id: "projection-recovery:race",
        fingerprint: "stable",
        compensate: async () => ({ effect: "race" }),
        store,
      }),
    ]);
    expect(races.map((result) => result.status).sort()).toEqual(["compensated", "replayed"]);
  });
});
