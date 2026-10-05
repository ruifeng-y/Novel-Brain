import { describe, expect, it } from "vitest";
import {
  createDomainEvent,
  type DomainEvent,
} from "../../src/safety/domain/domainEvent";
import type { EventStore } from "../../src/safety/infrastructure/eventStore";
import {
  InMemoryRepository,
  InMemoryRevisionedRepository,
} from "../../src/app/inMemoryRepositories";
import {
  InMemoryPersistenceTransaction,
  type SnapshotStore,
} from "../../src/shared/infrastructure/persistenceTransaction";
import { capabilityPersistencePayloadCodec } from "../../src/shared/domain/persistencePayload";
import {
  capabilityRecord,
  capabilityRevision,
  type CapabilityRecord,
  type CapabilityRevisionRecord,
} from "../support/capabilityPersistenceContract";
import {
  canonicalCommitAuthoritativeTransactionMembers,
  canonicalPersistenceMappingContract,
  mapIdempotencyReservation,
  roundTripCanonicalState,
  roundTripEventAudit,
  roundTripVersionedSnapshot,
  validateCanonicalPersistenceMappingContract,
  type CanonicalPersistenceMappingContract,
  type CanonicalPersistenceValueMapping,
} from "../../src/shared/application/canonicalPersistenceMapping";

interface OpaqueState {
  readonly id: string;
  readonly createdAt: Date;
  readonly versions: readonly number[];
}

interface ReservationRecord {
  readonly id: string;
  readonly novelId: string;
  readonly key: string;
  readonly fingerprint: string;
}

interface AtomicWork {
  readonly records: {
    saveIfAbsent(entity: CapabilityRecord): Promise<void>;
    findById(id: string): Promise<CapabilityRecord | undefined>;
  };
  readonly revisions: {
    saveRevisionIfAbsent(entity: CapabilityRevisionRecord): Promise<void>;
    findById(id: string): Promise<CapabilityRevisionRecord | undefined>;
    getRevision(
      id: string,
      revisionId: string,
    ): Promise<CapabilityRevisionRecord | undefined>;
  };
  readonly reservations: {
    saveIfAbsent(entity: ReservationRecord): Promise<void>;
    findById(id: string): Promise<ReservationRecord | undefined>;
  };
  readonly events: EventStore;
}

const valueMapping: CanonicalPersistenceValueMapping<
  OpaqueState,
  Record<string, unknown>
> = {
  encode: (value) => capabilityPersistencePayloadCodec.encode(value),
  decode: (value) =>
    capabilityPersistencePayloadCodec.decode(value) as OpaqueState,
};

const eventMapping: CanonicalPersistenceValueMapping<
  DomainEvent,
  Record<string, unknown>
> = {
  encode: (value) => capabilityPersistencePayloadCodec.encode(value),
  decode: (value) =>
    capabilityPersistencePayloadCodec.decode(value) as DomainEvent,
};

class ContractEventStore implements EventStore, SnapshotStore {
  private events: readonly DomainEvent[] = [];
  private eventIds = new Set<string>();

  async append(event: DomainEvent): Promise<void> {
    await this.appendMany([event]);
  }

  async appendMany(events: readonly DomainEvent[]): Promise<void> {
    const batchIds = new Set<string>();
    for (const event of events) {
      if (this.eventIds.has(event.eventId) || batchIds.has(event.eventId)) {
        throw new Error(`Duplicate event id: ${event.eventId}`);
      }
      batchIds.add(event.eventId);
    }
    for (const event of events) this.eventIds.add(event.eventId);
    this.events = [...this.events, ...events];
  }

  async listByNovel(novelId: string): Promise<readonly DomainEvent[]> {
    return Object.freeze(this.events.filter((event) => event.novelId === novelId));
  }

  captureSnapshot(): unknown {
    return {
      events: [...this.events],
      eventIds: [...this.eventIds],
    };
  }

  restoreSnapshot(snapshot: unknown): void {
    const state = snapshot as {
      readonly events: readonly DomainEvent[];
      readonly eventIds: readonly string[];
    };
    this.events = [...state.events];
    this.eventIds = new Set(state.eventIds);
  }
}

describe("[task:P1.1] canonical persistence mapping contract", () => {
  it("[domain] preserves opaque frozen Domain values through canonical and snapshot mappings", () => {
    const input: OpaqueState = {
      id: "opaque-state",
      createdAt: new Date("2026-10-05T00:00:00.000Z"),
      versions: [1, 2, 3],
    };

    expect(roundTripCanonicalState(valueMapping, input)).toEqual(input);
    expect(roundTripVersionedSnapshot(valueMapping, input)).toEqual(input);
  });

  it("[persistence] preserves immutable revision history while the current snapshot advances", async () => {
    const revisions = new InMemoryRevisionedRepository<CapabilityRevisionRecord>(
      capabilityPersistencePayloadCodec,
    );
    const first = capabilityRevision("history-state", "rev-1", "first");
    const second = capabilityRevision("history-state", "rev-2", "second");

    await revisions.saveRevisionIfAbsent(first);
    await revisions.saveIfCurrent("rev-1", second);

    expect(await revisions.findById("history-state")).toEqual(second);
    expect(await revisions.getRevision("history-state", "rev-1")).toEqual(first);
    expect(await revisions.getRevision("history-state", "rev-2")).toEqual(second);
  });
  it("[persistence] round-trips append-only event/audit evidence without payload loss", () => {
    const event = createDomainEvent({
      eventId: "event-mapping",
      name: "NarrativeCommitRecorded",
      context: "ai_production",
      novelId: "novel-mapping",
      objectId: "object-mapping",
      revisionId: "revision-mapping",
      commitId: "commit-mapping",
      payload: { status: "committed", ordinals: [1, 2] },
      occurredAt: new Date("2026-10-05T00:00:00.000Z"),
    });

    expect(roundTripEventAudit(eventMapping, event)).toEqual(event);
  });

  it("[concurrency] maps idempotency reservations deterministically and rejects empty keys", () => {
    const request = { command: "adopt", targetIds: ["scene-1", "fact-1"] };
    const first = mapIdempotencyReservation("story:adopt:revision-1", request);
    const second = mapIdempotencyReservation("story:adopt:revision-1", {
      ...request,
      targetIds: ["scene-1", "fact-1"],
    });

    expect(first).toEqual(second);
    expect(first.key).toBe("story:adopt:revision-1");
    expect(
      mapIdempotencyReservation("story:adopt:revision-1", { ...request, targetIds: ["scene-1", "fact-2"] }).fingerprint,
    ).not.toBe(first.fingerprint);
    expect(() => mapIdempotencyReservation("  ", request)).toThrow(
      "idempotency reservation key is required",
    );
  });

  it("[transaction] defines the authoritative canonical commit members and excludes projection success", () => {
    expect(canonicalCommitAuthoritativeTransactionMembers).toEqual([
      "canonical-state-mutation",
      "narrative-commit-transition",
      "required-event-audit-evidence",
      "idempotency-reservation",
    ]);
    expect(canonicalPersistenceMappingContract.projectionSuccessCriterion).toBe(
      "excluded",
    );

    const invalid: CanonicalPersistenceMappingContract = {
      ...canonicalPersistenceMappingContract,
      entries: canonicalPersistenceMappingContract.entries.map((entry) =>
        entry.roles.includes("projection")
          ? { ...entry, transactionMembership: "authoritative" as const }
          : entry,
      ),
    };
    expect(() => validateCanonicalPersistenceMappingContract(invalid)).toThrow(
      "projection cannot participate in canonical success",
    );
  });

  it("[transaction] commits state/history/event/audit/idempotency atomically and keeps projection outside", async () => {
    const records = new InMemoryRepository<CapabilityRecord>(
      capabilityPersistencePayloadCodec,
    );
    const revisions = new InMemoryRevisionedRepository<CapabilityRevisionRecord>(
      capabilityPersistencePayloadCodec,
    );
    const reservations = new InMemoryRepository<ReservationRecord>(
      capabilityPersistencePayloadCodec,
    );
    const events = new ContractEventStore();
    const transaction = new InMemoryPersistenceTransaction<AtomicWork>(
      (access) => ({
        records: access.unique(records),
        revisions: access.revisioned(revisions),
        reservations: access.unique(reservations),
        events,
      }),
      [records, revisions, reservations, events],
    );

    const event = createDomainEvent({
      eventId: "atomic-event",
      name: "NarrativeCommitRecorded",
      context: "ai_production",
      novelId: "novel-mapping",
      objectId: "atomic-state",
      revisionId: "rev-1",
      payload: { atomic: true },
      occurredAt: new Date("2026-10-05T00:00:00.000Z"),
    });
    const reservation: ReservationRecord = {
      id: "atomic-reservation",
      novelId: "novel-mapping",
      key: "core:commit:atomic",
      fingerprint: "fingerprint",
    };

    await expect(
      transaction.run(async (work) => {
        await work.records.saveIfAbsent(capabilityRecord("atomic-state"));
        await work.revisions.saveRevisionIfAbsent(
          capabilityRevision("atomic-state", "rev-1"),
        );
        await work.events.appendMany([event]);
        await work.reservations.saveIfAbsent(reservation);
        throw new Error("failed authoritative unit");
      }),
    ).rejects.toThrow("failed authoritative unit");

    await transaction.run(async (work) => {
      expect(await work.records.findById("atomic-state")).toBeUndefined();
      expect(await work.revisions.findById("atomic-state")).toBeUndefined();
      expect(
        await work.revisions.getRevision("atomic-state", "rev-1"),
      ).toBeUndefined();
      expect(
        await work.reservations.findById("atomic-reservation"),
      ).toBeUndefined();
    });
    expect(await events.listByNovel("novel-mapping")).toEqual([]);

    await transaction.run(async (work) => {
      await work.records.saveIfAbsent(capabilityRecord("atomic-state"));
      await work.revisions.saveRevisionIfAbsent(
        capabilityRevision("atomic-state", "rev-1"),
      );
      await work.events.appendMany([event]);
      await work.reservations.saveIfAbsent(reservation);
    });

    await Promise.reject(new Error("projection rebuild failed")).catch(
      () => undefined,
    );

    await transaction.run(async (work) => {
      expect(await work.records.findById("atomic-state")).toBeDefined();
      expect(
        await work.revisions.getRevision("atomic-state", "rev-1"),
      ).toBeDefined();
      expect(
        await work.reservations.findById("atomic-reservation"),
      ).toBeDefined();
    });
    expect(await events.listByNovel("novel-mapping")).toEqual([event]);
  });

  it("[integration] [cross-system] maps Core Story ProductionRun Recall and Dependency contracts", () => {
    validateCanonicalPersistenceMappingContract(canonicalPersistenceMappingContract);

    const contractsFor = (
      capability: CanonicalPersistenceMappingContract["entries"][number]["capability"],
    ) =>
      canonicalPersistenceMappingContract.entries
        .filter((entry) => entry.capability === capability)
        .map((entry) => entry.contract);

    expect(contractsFor("core")).toEqual([
      "novel",
      "generation-task",
      "candidate",
      "scene",
      "canonical-fact",
      "state-record",
      "change-set-revision",
      "validation-run",
      "review-decision",
      "narrative-commit",
      "domain-event",
    ]);
    expect(contractsFor("story")).toEqual([
      "narrative-proposal",
      "adoption-decision",
    ]);
    expect(contractsFor("production-run")).toEqual([
      "run-plan-revision",
      "run-plan-approval",
      "production-run",
      "execution-attempt",
      "run-checkpoint",
      "run-compensation-record",
    ]);
    expect(contractsFor("recall")).toEqual([
      "attention-disposition",
      "recall-item-projection",
      "memory-context-projection",
    ]);
    expect(contractsFor("dependency")).toEqual([
      "dependency-relation-fact",
      "dependency-registry-view",
      "impact-analysis-result",
    ]);
  });

  it("[regression] keeps the mapping semantic and rejects schema-first or projection-authoritative redesign", () => {
    expect(canonicalPersistenceMappingContract).not.toHaveProperty("schema");
    expect(canonicalPersistenceMappingContract).not.toHaveProperty("dto");
    expect(canonicalPersistenceMappingContract).not.toHaveProperty("api");
    expect(
      canonicalPersistenceMappingContract.entries.every(
        (entry) => !("fields" in entry) && !("columns" in entry),
      ),
    ).toBe(true);

    const schemaFirst = {
      ...canonicalPersistenceMappingContract,
      entries: [
        ...canonicalPersistenceMappingContract.entries,
        {
          capability: "core",
          contract: "database-table",
          roles: ["canonical-state"],
          consistency: "unique-reservation",
          transactionMembership: "authoritative",
          fields: ["id"],
        },
      ],
    } as unknown as CanonicalPersistenceMappingContract;
    expect(() =>
      validateCanonicalPersistenceMappingContract(schemaFirst),
    ).toThrow("schema/field metadata is not allowed");
  });
});
