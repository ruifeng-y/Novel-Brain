import type { PrismaClient } from "@prisma/client";
import type {
  PersistenceTransaction,
  RevisionCompareAndSwapPort,
  RevisionCreatePort,
  RevisionedRepository,
} from "../../shared/application/repository";
import {
  InMemoryPersistenceTransaction,
  PrismaPersistenceTransaction,
} from "../../shared/infrastructure/persistenceTransaction";
import { InMemoryRevisionedRepository } from "../../app/inMemoryRepositories";
import {
  PrismaRevisionedRepository,
  type PrismaRepositoryClient,
} from "../../shared/infrastructure/prismaRepositories";
import { capabilityPersistencePayloadCodec } from "../../shared/domain/persistencePayload";
import type { DomainId, RevisionId } from "../../shared/domain/ids";
import type { ChangeSet } from "../domain/changeSet";
import { createChange, type Change } from "../domain/change";
import type { ChangeSetRevision } from "../domain/changeSetRevision";

/**
 * The persisted payload of one Change Set revision. The stored revision payload
 * IS the Change Set Revision snapshot, so `revisionId` addresses exactly what
 * Validation, Approval and the Gate need. The Change Set aggregate-root fields
 * the snapshot does not carry (`lifecycle` / `updatedAt`) ride in the same
 * payload rather than a second store; `id` and `currentRevisionId` are the keys
 * the revisioned store indexes on and are aliases of `changeSetId` / `revisionId`.
 */
export interface StoredChangeSetRevision extends ChangeSetRevision, ChangeSet {
  readonly id: DomainId;
  readonly currentRevisionId: RevisionId;
}

export type ChangeSetRevisionRepository = RevisionedRepository<StoredChangeSetRevision>;
export type ChangeSetRevisionWorkPort = RevisionCreatePort<StoredChangeSetRevision> &
  RevisionCompareAndSwapPort<StoredChangeSetRevision>;
export type ChangeSetRevisionStore = ChangeSetRevisionRepository & ChangeSetRevisionWorkPort;

export interface ChangeSetWork {
  readonly changeSets: ChangeSetRevisionWorkPort;
}

export interface ChangeSetPersistence {
  readonly transaction: PersistenceTransaction<ChangeSetWork>;
  readonly changeSets: ChangeSetRevisionRepository;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function reviveChange(value: unknown): Change {
  return createChange(value as Parameters<typeof createChange>[0]);
}

/** The revision snapshot as it is written: the snapshot plus the aggregate-root fields. */
export function storedChangeSetRevision(revision: ChangeSetRevision): StoredChangeSetRevision {
  return Object.freeze({
    id: revision.changeSetId,
    currentRevisionId: revision.revisionId,
    revisionId: revision.revisionId,
    changeSetId: revision.changeSetId,
    novelId: revision.novelId,
    revisionNumber: revision.revisionNumber,
    ...(revision.parentRevisionId === undefined
      ? {}
      : { parentRevisionId: revision.parentRevisionId }),
    trigger: Object.freeze({
      type: revision.trigger.type,
      references: Object.freeze([...revision.trigger.references]),
    }),
    changes: Object.freeze([...revision.changes]),
    lifecycle: "open",
    createdAt: new Date(revision.createdAt.getTime()),
    updatedAt: new Date(revision.createdAt.getTime()),
  });
}

/** The immutable Change Set Revision snapshot a stored payload carries. */
export function changeSetRevisionOf(stored: StoredChangeSetRevision): ChangeSetRevision {
  return Object.freeze({
    revisionId: stored.revisionId,
    changeSetId: stored.changeSetId,
    novelId: stored.novelId,
    revisionNumber: stored.revisionNumber,
    ...(stored.parentRevisionId === undefined
      ? {}
      : { parentRevisionId: stored.parentRevisionId }),
    trigger: Object.freeze({
      type: stored.trigger.type,
      references: Object.freeze([...stored.trigger.references]),
    }),
    changes: Object.freeze(stored.changes.map(reviveChange)),
    createdAt: new Date(stored.createdAt.getTime()),
  });
}

function reviveStoredChangeSetRevision(payload: Record<string, unknown>): StoredChangeSetRevision {
  const stored = payload as unknown as StoredChangeSetRevision;
  return Object.freeze({
    ...stored,
    trigger: Object.freeze({
      type: stored.trigger.type,
      references: Object.freeze([...stored.trigger.references]),
    }),
    changes: Object.freeze(stored.changes.map(reviveChange)),
    createdAt: asDate(stored.createdAt),
    updatedAt: asDate(stored.updatedAt),
  });
}

function prismaChangeSetPort(
  client: PrismaRepositoryClient,
  aggregateType: string,
): ChangeSetRevisionStore {
  return new PrismaRevisionedRepository<StoredChangeSetRevision>(
    client,
    aggregateType,
    reviveStoredChangeSetRevision,
    capabilityPersistencePayloadCodec,
  );
}

export function createInMemoryChangeSetPersistence(): ChangeSetPersistence {
  const changeSets = new InMemoryRevisionedRepository<StoredChangeSetRevision>(
    capabilityPersistencePayloadCodec,
  );
  const transaction = new InMemoryPersistenceTransaction<ChangeSetWork>(
    access => ({ changeSets: access.revisioned(changeSets) }),
    [changeSets],
  );
  return { transaction, changeSets };
}

export function createPrismaChangeSetPersistence(
  prisma: PrismaClient,
  aggregateType = "ChangeSet",
): ChangeSetPersistence {
  const transaction = new PrismaPersistenceTransaction<ChangeSetWork>(prisma, client => ({
    changeSets: prismaChangeSetPort(client, aggregateType),
  }));
  return { transaction, changeSets: prismaChangeSetPort(prisma, aggregateType) };
}
