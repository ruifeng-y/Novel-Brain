import { expect, it } from "vitest";
import type {
  EventAuditPersistenceRecord,
  IdempotencyReservationRecord,
  ProductionPersistenceEnvironment,
  ProductionPersistenceWork,
} from "../../src/shared/application/postgresPersistenceMapping";

export interface ProductionPersistenceFixture {
  readonly environment: ProductionPersistenceEnvironment;
}

export type ProductionPersistenceFixtureFactory = () => Promise<ProductionPersistenceFixture>;

function canonicalState(contract: string, objectId: string, label: string) {
  return {
    contract,
    objectId,
    novelId: "novel-parity",
    revisionId: `${objectId}-rev-1`,
    value: {
      label,
      occurredAt: new Date("2026-10-05T01:02:03.045Z"),
      nested: { values: ["first", "second"] },
    },
  };
}

function versionedSnapshot(contract: string, objectId: string, label: string) {
  return {
    contract,
    objectId,
    novelId: "novel-parity",
    revisionId: `${objectId}-rev-1`,
    commitId: `${objectId}-commit-1`,
    value: {
      label,
      recoveredAt: new Date("2026-10-05T02:03:04.056Z"),
      nested: { values: ["snapshot"] },
    },
  };
}

function eventAudit(eventId: string, label: string): EventAuditPersistenceRecord {
  return {
    eventId,
    name: "NarrativeCommitRecorded",
    context: "ai_production",
    novelId: "novel-parity",
    objectId: "object-parity",
    revisionId: "object-parity-rev-1",
    commitId: "commit-parity",
    payload: { label, count: 2 },
    occurredAt: new Date("2026-10-05T03:04:05.067Z"),
  };
}

function reservation(key: string, fingerprint: string): IdempotencyReservationRecord {
  return { key, fingerprint };
}

async function expectAbsent(work: ProductionPersistenceWork): Promise<void> {
  await expect(work.findCanonicalState("candidate", "state-atomic")).resolves.toBeUndefined();
  await expect(
    work.findVersionedSnapshot("candidate", "snapshot-atomic", "snapshot-atomic-rev-1"),
  ).resolves.toBeUndefined();
  await expect(work.listEventAudit("novel-parity")).resolves.toEqual([]);
  await expect(work.findIdempotencyReservation("core:commit:atomic")).resolves.toBeUndefined();
}

export function runProductionPersistenceBoundaryContract(
  adapterName: string,
  createFixture: ProductionPersistenceFixtureFactory,
): void {
  it(`[task:P1.2] [persistence] [integration] ${adapterName} round-trips state snapshot and event/audit mappings`, async () => {
    const { environment } = await createFixture();
    const state = canonicalState("candidate", "state-round-trip", "current");
    const snapshot = versionedSnapshot("candidate", "snapshot-round-trip", "snapshot");
    const event = eventAudit("event-round-trip", "evidence");
    const reserved = reservation("core:commit:round-trip", "fingerprint-round-trip");

    await environment.transaction.run(async (work) => {
      await work.saveCanonicalStateIfAbsent(state);
      await work.saveVersionedSnapshotIfAbsent(snapshot);
      await work.appendEventAudit([event]);
      await expect(work.reserveIdempotency(reserved)).resolves.toBe("reserved");
    });

    await expect(environment.external.findCanonicalState("candidate", "state-round-trip")).resolves.toEqual(state);
    await expect(
      environment.external.findVersionedSnapshot("candidate", "snapshot-round-trip", "snapshot-round-trip-rev-1"),
    ).resolves.toEqual(snapshot);
    await expect(environment.external.listEventAudit("novel-parity")).resolves.toEqual([event]);
    await expect(environment.external.findIdempotencyReservation("core:commit:round-trip")).resolves.toEqual(reserved);
  });

  it(`[task:P1.2] [persistence] [concurrency] [integration] ${adapterName} reserves idempotency keys and rejects fingerprint conflicts`, async () => {
    const { environment } = await createFixture();
    const key = "core:commit:reservation-race";

    const sameFingerprint = await Promise.all([
      environment.external.reserveIdempotency(reservation(key, "same-fingerprint")),
      environment.external.reserveIdempotency(reservation(key, "same-fingerprint")),
    ]);
    expect(sameFingerprint.sort()).toEqual(["replayed", "reserved"]);

    await expect(
      environment.external.reserveIdempotency(reservation(key, "different-fingerprint")),
    ).rejects.toThrow(`Idempotency reservation conflict: ${key}`);

    const conflictRace = await Promise.allSettled([
      environment.external.reserveIdempotency(reservation("core:commit:conflict-race", "left")),
      environment.external.reserveIdempotency(reservation("core:commit:conflict-race", "right")),
    ]);
    expect(conflictRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(conflictRace.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it(`[task:P1.2] [transaction] [recovery] [integration] ${adapterName} rolls back authoritative writes and recovers after a caught reservation conflict`, async () => {
    const { environment } = await createFixture();

    await expect(
      environment.transaction.run(async (work) => {
        await work.saveCanonicalStateIfAbsent(canonicalState("candidate", "state-atomic", "atomic"));
        await work.saveVersionedSnapshotIfAbsent(versionedSnapshot("candidate", "snapshot-atomic", "atomic"));
        await work.appendEventAudit([eventAudit("event-atomic", "atomic")]);
        await work.reserveIdempotency(reservation("core:commit:atomic", "atomic-fingerprint"));
        throw new Error("authoritative transaction must roll back");
      }),
    ).rejects.toThrow("authoritative transaction must roll back");

    await expectAbsent(environment.external);

    const stableReservation = reservation("core:commit:recovery", "stable-fingerprint");
    await environment.external.reserveIdempotency(stableReservation);
    await environment.transaction.run(async (work) => {
      await expect(
        work.reserveIdempotency(reservation("core:commit:recovery", "conflicting-fingerprint")),
      ).rejects.toThrow("Idempotency reservation conflict: core:commit:recovery");
      await work.saveCanonicalStateIfAbsent(canonicalState("candidate", "state-recovery", "recovered"));
    });

    await expect(environment.external.findCanonicalState("candidate", "state-recovery")).resolves.toMatchObject({
      value: { label: "recovered" },
    });
    await expect(environment.external.findIdempotencyReservation("core:commit:recovery")).resolves.toEqual(
      stableReservation,
    );
  });

  it(`[task:P1.2] [cross-system] [regression] [integration] ${adapterName} preserves legacy-compatible payloads and rejects duplicate append-only evidence`, async () => {
    const { environment } = await createFixture();
    const legacy = {
      contract: "candidate",
      objectId: "state-legacy",
      novelId: "novel-legacy",
      value: {
        createdAt: "2026-10-04T00:00:00.000Z",
        payload: { source: "legacy-generic-row" },
      },
    };

    await environment.external.saveCanonicalStateIfAbsent(legacy);
    await expect(environment.external.findCanonicalState("candidate", "state-legacy")).resolves.toEqual(legacy);

    const event = eventAudit("event-duplicate", "evidence");
    await environment.external.appendEventAudit([event]);
    await expect(environment.external.appendEventAudit([event])).rejects.toThrow(
      "Duplicate event id: event-duplicate",
    );
    await expect(environment.external.listEventAudit("novel-parity")).resolves.toHaveLength(1);
  });
}
