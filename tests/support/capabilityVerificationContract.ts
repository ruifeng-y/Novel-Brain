import { describe, expect, it } from "vitest";
import { createSceneCommittedEvent } from "../../src/manuscript/domain/manuscriptEvents";
import {
  createReviewDecisionRecordedEvent,
  createValidationCompletedEvent,
} from "../../src/production/domain/aiProductionEvents";
import type { EventStore } from "../../src/safety/infrastructure/eventStore";
import {
  capabilityRecord,
  capabilityRevision,
  runCapabilityPersistenceTransactionContract,
  runCapabilityRepositoryContract,
  type CapabilityPersistenceEnvironment,
  type CapabilityRepositoryEnvironment,
} from "./capabilityPersistenceContract";
import {
  runObservationSourceContract,
  type ObservationSourceContractEnvironment,
} from "./observationSourceContract";
import { createEventStoreObservationEnvironment } from "./observationSourceFixtures";

export const capabilityVerificationGates = [
  "domain",
  "integration",
  "persistence",
  "transaction",
  "concurrency",
  "recovery",
  "replay",
  "cross-system",
  "regression",
] as const;

export type CapabilityVerificationGate = (typeof capabilityVerificationGates)[number];

export interface CapabilityVerificationEnvironment {
  readonly repository: CapabilityRepositoryEnvironment;
  readonly persistence: CapabilityPersistenceEnvironment;
  readonly eventStore: EventStore;
  readonly novelId: string;
  readonly sourceIdentity: string;
  createObservationEnvironment(): Promise<ObservationSourceContractEnvironment<unknown>>;
}

export function describeVerificationGate(
  gate: CapabilityVerificationGate,
  title: string,
  body: () => void | Promise<void>,
): void {
  it(`[${gate}] ${title}`, body);
}

export async function seedCapabilityVerificationEvidence(
  environment: CapabilityVerificationEnvironment,
): Promise<void> {
  const now = new Date("2026-10-04T00:00:00.000Z");
  await environment.eventStore.appendMany([
    createSceneCommittedEvent({
      eventId: `${environment.novelId}:event-1`,
      novelId: environment.novelId,
      objectId: "scene-1",
      revisionId: "scene-rev-1",
      commitId: "commit-1",
      payload: { textLength: 12 },
      occurredAt: now,
    }),
    createValidationCompletedEvent({
      eventId: `${environment.novelId}:event-2`,
      novelId: environment.novelId,
      objectId: "validation-run-1",
      revisionId: "validation-rev-1",
      payload: { outcome: "pass" },
      occurredAt: now,
    }),
    createReviewDecisionRecordedEvent({
      eventId: `${environment.novelId}:event-3`,
      novelId: environment.novelId,
      objectId: "review-decision-1",
      revisionId: "review-rev-1",
      payload: { decision: "approve" },
      occurredAt: now,
    }),
  ]);
}

export function runCapabilityVerificationSmokeContract(
  adapterName: string,
  taskId: string,
  createEnvironment: () => Promise<CapabilityVerificationEnvironment>,
): void {
  runCapabilityRepositoryContract(adapterName, async () => {
    const environment = await createEnvironment();
    return environment.repository;
  });

  runCapabilityPersistenceTransactionContract(adapterName, async () => {
    const environment = await createEnvironment();
    return environment.persistence;
  });

  runObservationSourceContract<unknown>(adapterName, async () => {
    const environment = await createEnvironment();
    await seedCapabilityVerificationEvidence(environment);
    return environment.createObservationEnvironment();
  });

  describe(`${adapterName} [task:${taskId}] capability verification gate smoke`, () => {
    describeVerificationGate("domain", "keeps fixture snapshots independent", () => {
      const first = capabilityRecord("domain-record", "first");
      const second = capabilityRecord("domain-record", "second");

      (first.state.flags as number[]).push(99);

      expect(second.state.flags).toEqual([1, 2]);
      expect(first.state.label).toBe("first");
      expect(second.state.label).toBe("second");
    });

    describeVerificationGate("integration", "links persisted state to observed evidence", async () => {
      const environment = await createEnvironment();
      await seedCapabilityVerificationEvidence(environment);
      const record = capabilityRecord("integrated-record", "ready", environment.novelId);
      await environment.repository.records.save(record);

      const loaded = await environment.repository.records.findById(record.id);
      const observation = await environment.createObservationEnvironment();
      const resolution = (
        await observation.source.snapshot()
      ).observations[0];

      expect(loaded).toEqual(record);
      expect(resolution?.evidenceReference).toBe(`${environment.novelId}:event-1`);
    });

    describeVerificationGate("persistence", "round-trips records and revision history", async () => {
      const environment = await createEnvironment();
      const first = capabilityRevision("persisted-revision", "rev-1", "first", environment.novelId);
      const second = capabilityRevision("persisted-revision", "rev-2", "second", environment.novelId);

      await environment.repository.revisions.save(first);
      await environment.repository.revisions.save(second);

      expect(await environment.repository.revisions.findById(first.id)).toEqual(second);
      expect(await environment.repository.revisions.getRevision(first.id, "rev-1")).toEqual(first);
    });

    describeVerificationGate("transaction", "rolls back failed capability work", async () => {
      const environment = await createEnvironment();

      await expect(
        environment.persistence.transaction.run(async (work) => {
          await work.records.saveIfAbsent(capabilityRecord("rolled-back", "write", environment.novelId));
          throw new Error("verification rollback");
        }),
      ).rejects.toThrow("verification rollback");

      expect(await environment.persistence.external.records.findById("rolled-back")).toBeUndefined();
    });

    describeVerificationGate("concurrency", "allows one winner for the same identity", async () => {
      const environment = await createEnvironment();
      const attempts = [
        environment.persistence.external.records.saveIfAbsent(
          capabilityRecord("concurrent-record", "first", environment.novelId),
        ),
        environment.persistence.external.records.saveIfAbsent(
          capabilityRecord("concurrent-record", "second", environment.novelId),
        ),
      ];

      const results = await Promise.allSettled(attempts);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    });

    describeVerificationGate("recovery", "continues after a caught conflict", async () => {
      const environment = await createEnvironment();
      const original = capabilityRecord("recoverable-record", "original", environment.novelId);
      await environment.persistence.external.records.saveIfAbsent(original);

      await environment.persistence.transaction.run(async (work) => {
        await expect(
          work.records.saveIfAbsent(capabilityRecord("recoverable-record", "conflict", environment.novelId)),
        ).rejects.toThrow();
        await work.records.saveIfAbsent(capabilityRecord("recovered-record", "committed", environment.novelId));
      });

      expect(await environment.persistence.external.records.findById("recoverable-record")).toEqual(original);
      expect(await environment.persistence.external.records.findById("recovered-record")).toBeDefined();
    });

    describeVerificationGate("replay", "returns stable observation snapshots", async () => {
      const environment = await createEnvironment();
      await seedCapabilityVerificationEvidence(environment);
      const observation = await environment.createObservationEnvironment();

      const first = await observation.source.snapshot();
      const second = await observation.source.snapshot();

      expect(second).toEqual(first);
      expect(observation.expectedObservations).toHaveLength(3);
    });

    describeVerificationGate("cross-system", "detects source movement without losing event provenance", async () => {
      const environment = await createEnvironment();
      await seedCapabilityVerificationEvidence(environment);
      const observation = await environment.createObservationEnvironment();
      const initial = await observation.source.snapshot();

      await environment.eventStore.append(
        createSceneCommittedEvent({
          eventId: `${environment.novelId}:event-4`,
          novelId: environment.novelId,
          objectId: "scene-2",
          revisionId: "scene-rev-2",
          commitId: "commit-2",
          payload: { textLength: 18 },
          occurredAt: new Date("2026-10-04T00:01:00.000Z"),
        }),
      );
      const changed = await observation.source.snapshot();

      expect(changed.sourceReference.identity).toBe(initial.sourceReference.identity);
      expect(changed.sourceReference.version).not.toBe(initial.sourceReference.version);
      expect(changed.sourceReference.hash).not.toBe(initial.sourceReference.hash);
      expect(changed.observations[0]?.sourceReference).toEqual(initial.observations[0]?.sourceReference);
    });

    describeVerificationGate("regression", "preserves shared persistence and observation fixtures", async () => {
      const environment = await createEnvironment();
      await seedCapabilityVerificationEvidence(environment);
      const record = capabilityRecord("regression-record", "stable", environment.novelId);
      const revision = capabilityRevision(
        "regression-revision",
        "rev-1",
        "stable",
        environment.novelId,
        { at: new Date("2026-10-04T00:00:00.000Z") },
      );

      await environment.repository.records.save(record);
      await environment.repository.revisions.save(revision);
      const observation = await environment.createObservationEnvironment();

      expect(await environment.repository.records.findById(record.id)).toEqual(record);
      expect(await environment.repository.revisions.findById(revision.id)).toEqual(revision);
      expect(observation.expectedSourceReference.identity).toBe(environment.sourceIdentity);
    });
  });
}
