import type {
  PersistenceTransaction,
  RevisionCompareAndSwapPort,
  RevisionCreatePort,
} from "../../shared/application/repository";
import {
  InMemoryPersistenceTransaction,
  PrismaPersistenceTransaction,
} from "../../shared/infrastructure/persistenceTransaction";
import {
  InMemoryRevisionedRepository,
} from "../../app/inMemoryRepositories";
import {
  PrismaRevisionedRepository,
  type PrismaRepositoryClient,
} from "../../shared/infrastructure/prismaRepositories";
import type { PrismaClient } from "@prisma/client";
import { capabilityPersistencePayloadCodec } from "../../shared/domain/persistencePayload";
import type { ExecutionAttempt } from "../domain/executionAttempt";
import {
  createImmutableTimestamp,
  createObservation,
  isImmutableTimestamp,
  type ImmutableTimestamp,
  type Observation,
} from "../../shared/domain/observationSource";

export type ExecutionAttemptPort = RevisionCreatePort<ExecutionAttempt> &
  RevisionCompareAndSwapPort<ExecutionAttempt>;

export interface ExecutionAttemptWork {
  readonly attempts: ExecutionAttemptPort;
}

export interface ExecutionAttemptPersistence {
  readonly transaction: PersistenceTransaction<ExecutionAttemptWork>;
  readonly attempts: ExecutionAttemptPort;
}

function reviveObservation<T>(observation: Observation<T>): Observation<T> {
  return createObservation<T>({
    evidenceReference: observation.evidenceReference,
    sourceReference: observation.sourceReference,
    ordinal: observation.ordinal,
    data: observation.data as T,
  });
}

function reviveTimestamp(value: Date | ImmutableTimestamp): ImmutableTimestamp {
  if (value instanceof Date) {
    return createImmutableTimestamp({
      iso: value.toISOString(),
      epochMilliseconds: value.getTime(),
    });
  }
  if (!isImmutableTimestamp(value)) throw new Error("invalid persisted timestamp");
  return createImmutableTimestamp(value);
}

function reviveExecutionAttempt(payload: Record<string, unknown>): ExecutionAttempt {
  const attempt = payload as unknown as ExecutionAttempt;
  return {
    ...attempt,
    createdAt: reviveTimestamp(attempt.createdAt),
    updatedAt: reviveTimestamp(attempt.updatedAt),
    ...(attempt.startedAt === undefined ? {} : { startedAt: reviveTimestamp(attempt.startedAt) }),
    ...(attempt.endedAt === undefined ? {} : { endedAt: reviveTimestamp(attempt.endedAt) }),
    ...(attempt.runtimeEvidence
      ? { runtimeEvidence: reviveObservation(attempt.runtimeEvidence) }
      : {}),
    ...(attempt.failureEvidence
      ? { failureEvidence: reviveObservation(attempt.failureEvidence) }
      : {}),
    ...(attempt.cancellationEvidence
      ? { cancellationEvidence: reviveObservation(attempt.cancellationEvidence) }
      : {}),
  };
}

function prismaAttemptPort(
  client: PrismaRepositoryClient,
  aggregateType: string,
): ExecutionAttemptPort {
  const repository = new PrismaRevisionedRepository(
    client,
    aggregateType,
    reviveExecutionAttempt,
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

export function createInMemoryExecutionAttemptPersistence(): ExecutionAttemptPersistence {
  const attempts = new InMemoryRevisionedRepository<ExecutionAttempt>(
    capabilityPersistencePayloadCodec,
  );
  const transaction = new InMemoryPersistenceTransaction<ExecutionAttemptWork>(
    (access) => ({ attempts: access.revisioned(attempts) }),
    [attempts],
  );
  return {
    transaction,
    attempts: transaction.revisioned(attempts),
  };
}

export function createPrismaExecutionAttemptPersistence(
  prisma: PrismaClient,
  aggregateType = "ExecutionAttempt",
): ExecutionAttemptPersistence {
  const transaction = new PrismaPersistenceTransaction<ExecutionAttemptWork>(
    prisma,
    (client) => ({ attempts: prismaAttemptPort(client, aggregateType) }),
  );
  return {
    transaction,
    attempts: prismaAttemptPort(prisma, aggregateType),
  };
}
