import type {
  PersistenceTransaction,
  RevisionCompareAndSwapPort,
  RevisionCreatePort,
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
import type { PrismaClient } from "@prisma/client";
import { capabilityPersistencePayloadCodec } from "../../shared/domain/persistencePayload";
import type { ExecutionAttempt } from "../domain/executionAttempt";
import type { ProductionRun } from "../domain/productionRun";
import {
  createImmutableTimestamp,
  createObservation,
  isImmutableTimestamp,
  type ImmutableTimestamp,
  type Observation,
} from "../../shared/domain/observationSource";

export type ExecutionRecoveryAttemptPort = RevisionCreatePort<ExecutionAttempt> &
  RevisionCompareAndSwapPort<ExecutionAttempt>;
export type ExecutionRecoveryRunPort = RevisionCreatePort<ProductionRun> &
  RevisionCompareAndSwapPort<ProductionRun>;

export interface ExecutionRecoveryWork {
  readonly attempts: ExecutionRecoveryAttemptPort;
  readonly runs: ExecutionRecoveryRunPort;
}

export interface ExecutionRecoveryPersistence {
  readonly transaction: PersistenceTransaction<ExecutionRecoveryWork>;
  readonly attempts: ExecutionRecoveryAttemptPort;
  readonly runs: ExecutionRecoveryRunPort;
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

function reviveObservation<T>(observation: Observation<T>): Observation<T> {
  return createObservation<T>({
    evidenceReference: observation.evidenceReference,
    sourceReference: observation.sourceReference,
    ordinal: observation.ordinal,
    data: observation.data as T,
  });
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

function reviveProductionRun(payload: Record<string, unknown>): ProductionRun {
  const run = payload as unknown as ProductionRun;
  return {
    ...run,
    stepStates: run.stepStates.map((state) => ({
      ...state,
      dependsOn: [...state.dependsOn],
      attemptIds: [...state.attemptIds],
    })),
    createdAt: reviveTimestamp(run.createdAt),
    updatedAt: reviveTimestamp(run.updatedAt),
  };
}


function prismaAttemptPort(
  client: PrismaRepositoryClient,
  aggregateType: string,
): ExecutionRecoveryAttemptPort {
  return new PrismaRevisionedRepository(
    client,
    aggregateType,
    reviveExecutionAttempt,
    capabilityPersistencePayloadCodec,
  );
}

function prismaRunPort(
  client: PrismaRepositoryClient,
  aggregateType: string,
): ExecutionRecoveryRunPort {
  return new PrismaRevisionedRepository(
    client,
    aggregateType,
    reviveProductionRun,
    capabilityPersistencePayloadCodec,
  );
}

export function createInMemoryExecutionRecoveryPersistence(): ExecutionRecoveryPersistence {
  const attempts = new InMemoryRevisionedRepository<ExecutionAttempt>(
    capabilityPersistencePayloadCodec,
  );
  const runs = new InMemoryRevisionedRepository<ProductionRun>(
    capabilityPersistencePayloadCodec,
  );
  const transaction = new InMemoryPersistenceTransaction<ExecutionRecoveryWork>(
    (access) => ({
      attempts: access.revisioned(attempts),
      runs: access.revisioned(runs),
    }),
    [attempts, runs],
  );
  return {
    transaction,
    attempts: transaction.revisioned(attempts),
    runs: transaction.revisioned(runs),
  };
}

export function createPrismaExecutionRecoveryPersistence(
  prisma: PrismaClient,
  aggregateTypes: { readonly attempt?: string; readonly run?: string } = {},
): ExecutionRecoveryPersistence {
  const attemptType = aggregateTypes.attempt ?? "ExecutionAttempt";
  const runType = aggregateTypes.run ?? "ProductionRun";
  const transaction = new PrismaPersistenceTransaction<ExecutionRecoveryWork>(
    prisma,
    (client) => ({
      attempts: prismaAttemptPort(client, attemptType),
      runs: prismaRunPort(client, runType),
    }),
  );
  return {
    transaction,
    attempts: prismaAttemptPort(prisma, attemptType),
    runs: prismaRunPort(prisma, runType),
  };
}
