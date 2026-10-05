import type {
  CanonicalStatePersistenceRecord,
  EventAuditPersistenceRecord,
  IdempotencyReservationDisposition,
  IdempotencyReservationRecord,
  ProductionPersistenceEnvironment,
  ProductionPersistenceWork,
  VersionedSnapshotPersistenceRecord,
} from "../application/postgresPersistenceMapping";
import { assertProductionPersistenceRole } from "../application/postgresPersistenceMapping";
import { InMemoryPersistenceTransaction } from "./persistenceTransaction";

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, clone(nested)]),
    ) as T;
  }
  return value;
}

function stateKey(contract: string, objectId: string): string {
  return `${contract}\u0000${objectId}`;
}

function snapshotKey(contract: string, objectId: string, revisionId: string): string {
  return `${contract}\u0000${objectId}\u0000${revisionId}`;
}

interface InMemoryBoundarySnapshot {
  readonly states: readonly (readonly [string, CanonicalStatePersistenceRecord])[];
  readonly snapshots: readonly (readonly [string, VersionedSnapshotPersistenceRecord])[];
  readonly events: readonly EventAuditPersistenceRecord[];
  readonly reservations: readonly (readonly [string, IdempotencyReservationRecord])[];
}

export class InMemoryProductionPersistenceBoundary implements ProductionPersistenceWork {
  private readonly states = new Map<string, CanonicalStatePersistenceRecord>();
  private readonly snapshots = new Map<string, VersionedSnapshotPersistenceRecord>();
  private readonly events: EventAuditPersistenceRecord[] = [];
  private readonly reservations = new Map<string, IdempotencyReservationRecord>();

  async saveCanonicalStateIfAbsent(record: CanonicalStatePersistenceRecord): Promise<void> {
    assertProductionPersistenceRole(record.contract, "canonical-state");
    const key = stateKey(record.contract, record.objectId);
    if (this.states.has(key)) {
      throw new Error(`Canonical state already exists: ${record.contract}:${record.objectId}`);
    }
    this.states.set(key, clone(record));
  }

  async findCanonicalState(contract: string, objectId: string) {
    const record = this.states.get(stateKey(contract, objectId));
    return record ? clone(record) : undefined;
  }

  async saveVersionedSnapshotIfAbsent(record: VersionedSnapshotPersistenceRecord): Promise<void> {
    assertProductionPersistenceRole(record.contract, "versioned-snapshot");
    const key = snapshotKey(record.contract, record.objectId, record.revisionId);
    if (this.snapshots.has(key)) {
      throw new Error(
        `Versioned snapshot already exists: ${record.contract}:${record.objectId}:${record.revisionId}`,
      );
    }
    this.snapshots.set(key, clone(record));
  }

  async findVersionedSnapshot(contract: string, objectId: string, revisionId: string) {
    const record = this.snapshots.get(snapshotKey(contract, objectId, revisionId));
    return record ? clone(record) : undefined;
  }

  async appendEventAudit(records: readonly EventAuditPersistenceRecord[]): Promise<void> {
    assertProductionPersistenceRole("domain-event", "event-audit");
    const batchIds = new Set<string>();
    for (const record of records) {
      if (this.events.some((event) => event.eventId === record.eventId) || batchIds.has(record.eventId)) {
        throw new Error(`Duplicate event id: ${record.eventId}`);
      }
      batchIds.add(record.eventId);
    }
    this.events.push(...records.map(clone));
  }

  async listEventAudit(novelId: string): Promise<readonly EventAuditPersistenceRecord[]> {
    return this.events.filter((event) => event.novelId === novelId).map(clone);
  }

  async reserveIdempotency(
    reservation: IdempotencyReservationRecord,
  ): Promise<IdempotencyReservationDisposition> {
    if (!reservation.key || reservation.key.trim() !== reservation.key) {
      throw new Error("idempotency reservation key is required");
    }
    if (!reservation.fingerprint) {
      throw new Error("idempotency reservation fingerprint is required");
    }
    const existing = this.reservations.get(reservation.key);
    if (existing) {
      if (existing.fingerprint === reservation.fingerprint) return "replayed";
      throw new Error(`Idempotency reservation conflict: ${reservation.key}`);
    }
    this.reservations.set(reservation.key, clone(reservation));
    return "reserved";
  }

  async findIdempotencyReservation(key: string) {
    const reservation = this.reservations.get(key);
    return reservation ? clone(reservation) : undefined;
  }

  captureSnapshot(): InMemoryBoundarySnapshot {
    return {
      states: [...this.states].map(([key, value]) => [key, clone(value)] as const),
      snapshots: [...this.snapshots].map(([key, value]) => [key, clone(value)] as const),
      events: this.events.map(clone),
      reservations: [...this.reservations].map(([key, value]) => [key, clone(value)] as const),
    };
  }

  restoreSnapshot(snapshot: InMemoryBoundarySnapshot): void {
    this.states.clear();
    for (const [key, value] of snapshot.states) this.states.set(key, clone(value));
    this.snapshots.clear();
    for (const [key, value] of snapshot.snapshots) this.snapshots.set(key, clone(value));
    this.events.splice(0, this.events.length, ...snapshot.events.map(clone));
    this.reservations.clear();
    for (const [key, value] of snapshot.reservations) this.reservations.set(key, clone(value));
  }
}

export function createInMemoryProductionPersistenceEnvironment(): ProductionPersistenceEnvironment {
  const boundary = new InMemoryProductionPersistenceBoundary();
  const transaction = new InMemoryPersistenceTransaction<ProductionPersistenceWork>(
    () => boundary,
    [boundary],
  );
  return { transaction, external: boundary };
}
