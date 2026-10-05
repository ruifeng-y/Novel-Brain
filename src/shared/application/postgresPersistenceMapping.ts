import {
  canonicalPersistenceMappingContract,
  type CanonicalPersistenceRole,
} from "./canonicalPersistenceMapping";
import {
  decodePersistencePayload,
  encodePersistencePayload,
} from "../domain/persistencePayload";

export type PersistenceValue = Readonly<Record<string, unknown>>;

export interface CanonicalStatePersistenceRecord {
  readonly contract: string;
  readonly objectId: string;
  readonly novelId: string;
  readonly revisionId?: string;
  readonly value: PersistenceValue;
}

export interface VersionedSnapshotPersistenceRecord {
  readonly contract: string;
  readonly objectId: string;
  readonly novelId: string;
  readonly revisionId: string;
  readonly commitId?: string;
  readonly value: PersistenceValue;
}

export interface EventAuditPersistenceRecord {
  readonly eventId: string;
  readonly name: string;
  readonly context: string;
  readonly novelId: string;
  readonly objectId: string;
  readonly revisionId: string;
  readonly commitId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export interface IdempotencyReservationRecord {
  readonly key: string;
  readonly fingerprint: string;
}

export type IdempotencyReservationDisposition = "reserved" | "replayed";

export interface ProductionPersistenceWork {
  saveCanonicalStateIfAbsent(record: CanonicalStatePersistenceRecord): Promise<void>;
  findCanonicalState(contract: string, objectId: string): Promise<CanonicalStatePersistenceRecord | undefined>;
  saveVersionedSnapshotIfAbsent(record: VersionedSnapshotPersistenceRecord): Promise<void>;
  findVersionedSnapshot(contract: string, objectId: string, revisionId: string): Promise<VersionedSnapshotPersistenceRecord | undefined>;
  appendEventAudit(records: readonly EventAuditPersistenceRecord[]): Promise<void>;
  listEventAudit(novelId: string): Promise<readonly EventAuditPersistenceRecord[]>;
  reserveIdempotency(reservation: IdempotencyReservationRecord): Promise<IdempotencyReservationDisposition>;
  findIdempotencyReservation(key: string): Promise<IdempotencyReservationRecord | undefined>;
}

export interface ProductionPersistenceEnvironment {
  readonly transaction: {
    run<T>(operation: (work: ProductionPersistenceWork) => Promise<T>): Promise<T>;
  };
  readonly external: ProductionPersistenceWork;
}

export interface PostgresPersistenceStorageMapping {
  readonly storage: "CurrentObject" | "RevisionRecord" | "DomainEvent" | "IdempotencyReservation";
  readonly role: CanonicalPersistenceRole;
}

export interface PostgresPersistenceMappingBoundary {
  readonly source: "canonical-persistence-mapping-contract";
  readonly migrationCompatibility: "additive";
  readonly rollbackRecovery: "transactional";
  readonly projection: "excluded";
  readonly mappings: {
    readonly canonicalState: PostgresPersistenceStorageMapping;
    readonly versionedSnapshot: PostgresPersistenceStorageMapping;
    readonly eventAudit: PostgresPersistenceStorageMapping;
    readonly idempotencyReservation: PostgresPersistenceStorageMapping;
  };
}

export const postgresPersistenceMappingBoundary: PostgresPersistenceMappingBoundary = Object.freeze({
  source: "canonical-persistence-mapping-contract",
  migrationCompatibility: "additive",
  rollbackRecovery: "transactional",
  projection: "excluded",
  mappings: Object.freeze({
    canonicalState: Object.freeze({ storage: "CurrentObject", role: "canonical-state" }),
    versionedSnapshot: Object.freeze({ storage: "RevisionRecord", role: "versioned-snapshot" }),
    eventAudit: Object.freeze({ storage: "DomainEvent", role: "event-audit" }),
    idempotencyReservation: Object.freeze({
      storage: "IdempotencyReservation",
      role: "idempotency-reservation",
    }),
  }),
});

export function validatePostgresPersistenceMappingBoundary(
  boundary: PostgresPersistenceMappingBoundary,
): void {
  if (boundary.source !== "canonical-persistence-mapping-contract") {
    throw new Error("PostgreSQL mapping must follow the canonical persistence mapping contract");
  }
  if (boundary.migrationCompatibility !== "additive") {
    throw new Error("PostgreSQL migration compatibility must be additive");
  }
  if (boundary.rollbackRecovery !== "transactional") {
    throw new Error("PostgreSQL rollback/recovery boundary must be transactional");
  }
  if (boundary.projection !== "excluded") {
    throw new Error("PostgreSQL mapping must exclude projections");
  }

  const mappedRoles = new Set<CanonicalPersistenceRole>(
    Object.values(boundary.mappings).map((mapping) => mapping.role),
  );
  const requiredRoles = new Set<CanonicalPersistenceRole>();
  for (const entry of canonicalPersistenceMappingContract.entries) {
    for (const role of entry.roles) {
      if (role !== "projection") requiredRoles.add(role);
    }
  }
  for (const role of requiredRoles) {
    if (!mappedRoles.has(role)) {
      throw new Error(`PostgreSQL mapping is missing role: ${role}`);
    }
  }
}

export function assertProductionPersistenceRole(
  contract: string,
  role: CanonicalPersistenceRole,
): void {
  const entry = canonicalPersistenceMappingContract.entries.find(
    (candidate) => candidate.contract === contract,
  );
  if (!entry) throw new Error(`Unknown canonical persistence contract: ${contract}`);
  if (!entry.roles.includes(role)) {
    throw new Error(`Persistence contract does not map role ${role}: ${contract}`);
  }
}

export function encodeProductionPersistenceValue(value: PersistenceValue): Record<string, unknown> {
  return encodePersistencePayload(value);
}

export function decodeProductionPersistenceValue(value: unknown): PersistenceValue {
  return decodePersistencePayload(value) as PersistenceValue;
}
