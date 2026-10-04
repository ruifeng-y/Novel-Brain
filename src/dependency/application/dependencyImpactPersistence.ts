import type { PrismaClient } from "@prisma/client";
import type { PersistenceTransaction, UniqueCreatePort } from "../../shared/application/repository";
import { InMemoryRepository } from "../../app/inMemoryRepositories";
import {
  InMemoryPersistenceTransaction,
  PrismaPersistenceTransaction,
} from "../../shared/infrastructure/persistenceTransaction";
import {
  PrismaRepository,
  type PrismaRepositoryClient,
} from "../../shared/infrastructure/prismaRepositories";
import { capabilityPersistencePayloadCodec } from "../../shared/domain/persistencePayload";
import type { DependencyRelationFact } from "../domain/dependencyRegistry";
import type { ImpactAnalysisResult } from "../domain/impactAnalysis";

export type DependencyRelationPort = UniqueCreatePort<DependencyRelationFact>;
export type ImpactAnalysisPort = UniqueCreatePort<ImpactAnalysisResult>;

export interface DependencyImpactWork {
  readonly relations: DependencyRelationPort;
  readonly impactResults: ImpactAnalysisPort;
}

export interface DependencyImpactPersistence {
  readonly transaction: PersistenceTransaction<DependencyImpactWork>;
  readonly relations: DependencyRelationPort;
  readonly impactResults: ImpactAnalysisPort;
}

function reviveRelation(payload: Record<string, unknown>): DependencyRelationFact {
  const relation = payload as unknown as DependencyRelationFact;
  return {
    ...relation,
    createdAt: new Date(relation.createdAt.getTime()),
    ...(relation.lastConfirmedAt === undefined
      ? {}
      : { lastConfirmedAt: new Date(relation.lastConfirmedAt.getTime()) }),
    ...(relation.lastRevalidatedAt === undefined
      ? {}
      : { lastRevalidatedAt: new Date(relation.lastRevalidatedAt.getTime()) }),
    revisionProvenance: {
      ...relation.revisionProvenance,
      versionSet: { ...relation.revisionProvenance.versionSet },
      evidence: [...relation.revisionProvenance.evidence],
    },
  };
}

function reviveImpactResult(payload: Record<string, unknown>): ImpactAnalysisResult {
  const result = payload as unknown as ImpactAnalysisResult;
  return {
    ...result,
    basedOnVersionSet: { ...result.basedOnVersionSet },
    computedAt: new Date(result.computedAt.getTime()),
  };
}

function prismaRelationPort(
  client: PrismaRepositoryClient,
  aggregateType: string,
): DependencyRelationPort {
  return new PrismaRepository<DependencyRelationFact>(
    client,
    aggregateType,
    reviveRelation,
    capabilityPersistencePayloadCodec,
  );
}

function prismaImpactPort(
  client: PrismaRepositoryClient,
  aggregateType: string,
): ImpactAnalysisPort {
  return new PrismaRepository<ImpactAnalysisResult>(
    client,
    aggregateType,
    reviveImpactResult,
    capabilityPersistencePayloadCodec,
  );
}

export function createInMemoryDependencyImpactPersistence(): DependencyImpactPersistence {
  const relations = new InMemoryRepository<DependencyRelationFact>(
    capabilityPersistencePayloadCodec,
  );
  const impactResults = new InMemoryRepository<ImpactAnalysisResult>(
    capabilityPersistencePayloadCodec,
  );
  const transaction = new InMemoryPersistenceTransaction<DependencyImpactWork>(
    (access) => ({
      relations: access.unique(relations),
      impactResults: access.unique(impactResults),
    }),
    [relations, impactResults],
  );
  return {
    transaction,
    relations: transaction.unique(relations),
    impactResults: transaction.unique(impactResults),
  };
}

export function createPrismaDependencyImpactPersistence(
  prisma: PrismaClient,
  aggregateType = "DependencyImpact",
): DependencyImpactPersistence {
  const relationAggregate = `${aggregateType}:Relation`;
  const impactAggregate = `${aggregateType}:Impact`;
  const transaction = new PrismaPersistenceTransaction<DependencyImpactWork>(
    prisma,
    (client) => ({
      relations: prismaRelationPort(client, relationAggregate),
      impactResults: prismaImpactPort(client, impactAggregate),
    }),
  );
  return {
    transaction,
    relations: prismaRelationPort(prisma, relationAggregate),
    impactResults: prismaImpactPort(prisma, impactAggregate),
  };
}
