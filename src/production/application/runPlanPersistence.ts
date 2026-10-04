import type {
  PersistenceTransaction,
  RevisionCompareAndSwapPort,
  RevisionCreatePort,
  UniqueCreatePort,
} from "../../shared/application/repository";
import {
  InMemoryPersistenceTransaction,
  PrismaPersistenceTransaction,
} from "../../shared/infrastructure/persistenceTransaction";
import {
  InMemoryRepository,
  InMemoryRevisionedRepository,
} from "../../app/inMemoryRepositories";
import {
  PrismaRepository,
  PrismaRevisionedRepository,
  type PrismaRepositoryClient,
} from "../../shared/infrastructure/prismaRepositories";
import { capabilityPersistencePayloadCodec } from "../../shared/domain/persistencePayload";
import {
  createImmutableTimestamp,
  isImmutableTimestamp,
  type ImmutableTimestamp,
} from "../../shared/domain/observationSource";
import type { PrismaClient } from "@prisma/client";
import type { RunPlanApproval, RunPlanRevision } from "../domain/runPlan";
import type { ProductionRun } from "../domain/productionRun";

export type RunPlanRevisionPort = UniqueCreatePort<RunPlanRevision>;
export interface RunPlanApprovalPort extends UniqueCreatePort<RunPlanApproval> {
  findByRevisionId(revisionId: string, novelId: string): Promise<RunPlanApproval | undefined>;
}
export type ProductionRunPort = RevisionCreatePort<ProductionRun> &
  RevisionCompareAndSwapPort<ProductionRun>;

export interface RunOrchestrationWork {
  readonly planRevisions: RunPlanRevisionPort;
  readonly planApprovals: RunPlanApprovalPort;
  readonly runs: ProductionRunPort;
}

export interface RunOrchestrationPersistence {
  readonly transaction: PersistenceTransaction<RunOrchestrationWork>;
  readonly planRevisions: RunPlanRevisionPort;
  readonly planApprovals: RunPlanApprovalPort;
  readonly runs: ProductionRunPort;
}

function reviveTimestamp(value: Date | ImmutableTimestamp): ImmutableTimestamp {
  return value instanceof Date
    ? createImmutableTimestamp({ iso: value.toISOString(), epochMilliseconds: value.getTime() })
    : createImmutableTimestamp(value);
}

function reviveRunPlanRevision(payload: Record<string, unknown>): RunPlanRevision {
  const revision = payload as unknown as RunPlanRevision;
  return {
    ...revision,
    steps: revision.steps.map((step) => ({ ...step, dependsOn: [...step.dependsOn] })),
    createdAt: reviveTimestamp(revision.createdAt),
  };
}

function reviveRunPlanApproval(payload: Record<string, unknown>): RunPlanApproval {
  const approval = payload as unknown as RunPlanApproval;
  return {
    ...approval,
    approvedAt: reviveTimestamp(approval.approvedAt),
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

function approvalPort(
  delegate: UniqueCreatePort<RunPlanApproval>,
): RunPlanApprovalPort {
  return {
    saveIfAbsent: (entity) => delegate.saveIfAbsent(entity),
    findById: (id) => delegate.findById(id),
    listByNovel: (novelId) => delegate.listByNovel(novelId),
    findByRevisionId: async (revisionId, novelId) =>
      (await delegate.listByNovel(novelId)).find(
        (approval) => approval.planRevisionReference.version === revisionId,
      ),
  };
}

function prismaApprovalPort(
  client: PrismaRepositoryClient,
  aggregateType: string,
): RunPlanApprovalPort {
  const repository = new PrismaRepository<RunPlanApproval>(
    client,
    aggregateType,
    reviveRunPlanApproval,
    capabilityPersistencePayloadCodec,
  );
  return approvalPort({
    saveIfAbsent: (entity) => repository.saveIfAbsent(entity),
    findById: (id) => repository.findById(id),
    listByNovel: (novelId) => repository.listByNovel(novelId),
  });
}

function prismaRunPort(client: PrismaRepositoryClient, aggregateType: string): ProductionRunPort {
  const repository = new PrismaRevisionedRepository<ProductionRun>(
    client,
    aggregateType,
    reviveProductionRun,
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

export function createInMemoryRunOrchestrationPersistence(): RunOrchestrationPersistence {
  const planRevisions = new InMemoryRepository<RunPlanRevision>(capabilityPersistencePayloadCodec);
  const planApprovals = new InMemoryRepository<RunPlanApproval>(capabilityPersistencePayloadCodec);
  const runs = new InMemoryRevisionedRepository<ProductionRun>(capabilityPersistencePayloadCodec);
  const transaction = new InMemoryPersistenceTransaction<RunOrchestrationWork>(
    (access) => ({
      planRevisions: access.unique(planRevisions),
      planApprovals: approvalPort(access.unique(planApprovals)),
      runs: access.revisioned(runs),
    }),
    [planRevisions, planApprovals, runs],
  );
  return {
    transaction,
    planRevisions: transaction.unique(planRevisions),
    planApprovals: approvalPort(transaction.unique(planApprovals)),
    runs: transaction.revisioned(runs),
  };
}

export function createPrismaRunOrchestrationPersistence(
  prisma: PrismaClient,
  aggregateTypes: {
    readonly planRevision?: string;
    readonly planApproval?: string;
    readonly run?: string;
  } = {},
): RunOrchestrationPersistence {
  const planRevisionType = aggregateTypes.planRevision ?? "RunPlanRevision";
  const planApprovalType = aggregateTypes.planApproval ?? "RunPlanApproval";
  const runType = aggregateTypes.run ?? "ProductionRun";
  const planRevisions = new PrismaRepository<RunPlanRevision>(
    prisma,
    planRevisionType,
    reviveRunPlanRevision,
    capabilityPersistencePayloadCodec,
  );
  const runs = prismaRunPort(prisma, runType);
  const transaction = new PrismaPersistenceTransaction<RunOrchestrationWork>(
    prisma,
    (client) => ({
      planRevisions: new PrismaRepository<RunPlanRevision>(
        client,
        planRevisionType,
        reviveRunPlanRevision,
        capabilityPersistencePayloadCodec,
      ),
      planApprovals: prismaApprovalPort(client, planApprovalType),
      runs: prismaRunPort(client, runType),
    }),
  );
  return {
    transaction,
    planRevisions: {
      saveIfAbsent: (entity) => planRevisions.saveIfAbsent(entity),
      findById: (id) => planRevisions.findById(id),
      listByNovel: (novelId) => planRevisions.listByNovel(novelId),
    },
    planApprovals: prismaApprovalPort(prisma, planApprovalType),
    runs,
  };
}
