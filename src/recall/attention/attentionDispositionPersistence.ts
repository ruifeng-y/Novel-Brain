import type { PrismaClient } from "@prisma/client";
import { InMemoryRevisionedRepository } from "../../app/inMemoryRepositories";
import {
  InMemoryPersistenceTransaction,
  PrismaPersistenceTransaction,
} from "../../shared/infrastructure/persistenceTransaction";
import {
  PrismaRevisionedRepository,
  type PrismaRepositoryClient,
} from "../../shared/infrastructure/prismaRepositories";
import type {
  PersistenceTransaction,
  RevisionCompareAndSwapPort,
  RevisionCreatePort,
} from "../../shared/application/repository";
import { capabilityPersistencePayloadCodec } from "../../shared/domain/persistencePayload";
import type { AttentionDispositionRecord } from "./attentionDisposition";

export type AttentionDispositionPort = RevisionCreatePort<AttentionDispositionRecord> &
  RevisionCompareAndSwapPort<AttentionDispositionRecord>;

export interface AttentionDispositionWork {
  readonly dispositions: AttentionDispositionPort;
}

export interface AttentionDispositionPersistence {
  readonly transaction: PersistenceTransaction<AttentionDispositionWork>;
  readonly dispositions: AttentionDispositionPort;
}

function reviveAttentionDisposition(
  payload: Record<string, unknown>,
): AttentionDispositionRecord {
  const record = payload as unknown as AttentionDispositionRecord;
  return {
    ...record,
    history: record.history.map((event) => ({ ...event })),
  };
}

function prismaAttentionPort(
  client: PrismaRepositoryClient,
  aggregateType: string,
): AttentionDispositionPort {
  const repository = new PrismaRevisionedRepository<AttentionDispositionRecord>(
    client,
    aggregateType,
    reviveAttentionDisposition,
    capabilityPersistencePayloadCodec,
  );
  return {
    saveRevisionIfAbsent: (entity) => repository.saveRevisionIfAbsent(entity),
    saveIfCurrent: (expectedRevisionId, entity) =>
      repository.saveIfCurrent(expectedRevisionId, entity),
    findById: (id) => repository.findById(id),
    getRevision: (id, revisionId) => repository.getRevision(id, revisionId),
    listByNovel: (novelId) => repository.listByNovel(novelId),
  };
}

export function createInMemoryAttentionDispositionPersistence(): AttentionDispositionPersistence {
  const repository = new InMemoryRevisionedRepository<AttentionDispositionRecord>(
    capabilityPersistencePayloadCodec,
  );
  const transaction = new InMemoryPersistenceTransaction<AttentionDispositionWork>(
    (access) => ({ dispositions: access.revisioned(repository) }),
    [repository],
  );
  return {
    transaction,
    dispositions: transaction.revisioned(repository),
  };
}

export function createPrismaAttentionDispositionPersistence(
  prisma: PrismaClient,
  aggregateType = "AttentionDisposition",
): AttentionDispositionPersistence {
  const transaction = new PrismaPersistenceTransaction<AttentionDispositionWork>(
    prisma,
    (client) => ({ dispositions: prismaAttentionPort(client, aggregateType) }),
  );
  return {
    transaction,
    dispositions: prismaAttentionPort(prisma, aggregateType),
  };
}
