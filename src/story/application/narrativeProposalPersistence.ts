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
  createObservation,
  isImmutableTimestamp,
  type ImmutableTimestamp,
} from "../../shared/domain/observationSource";
import type { PrismaClient } from "@prisma/client";
import {
  rehydrateNarrativeProposal,
  type NarrativeProposal,
} from "../domain/narrativeProposal";
import type { AdoptionDecision, AdoptionDecisionEvidence } from "../domain/adoptionDecision";

export type NarrativeProposalPort = RevisionCreatePort<NarrativeProposal> &
  RevisionCompareAndSwapPort<NarrativeProposal>;
export type AdoptionDecisionPort = UniqueCreatePort<AdoptionDecision>;

export interface NarrativeProposalWork {
  readonly proposals: NarrativeProposalPort;
  readonly decisions: AdoptionDecisionPort;
}
export interface NarrativeProposalPersistence {
  readonly transaction: PersistenceTransaction<NarrativeProposalWork>;
  readonly proposals: NarrativeProposalPort;
  readonly decisions: AdoptionDecisionPort;
}

function validateProposalInput(proposal: NarrativeProposal): NarrativeProposal {
  return rehydrateNarrativeProposal(proposal as unknown as Record<string, unknown>);
}

function reviveTimestamp(value: Date | ImmutableTimestamp): ImmutableTimestamp {
  if (value instanceof Date) {
    return createImmutableTimestamp({ iso: value.toISOString(), epochMilliseconds: value.getTime() });
  }
  if (!isImmutableTimestamp(value)) throw new Error("invalid persisted timestamp");
  return createImmutableTimestamp(value);
}

function reviveProposal(payload: Record<string, unknown>): NarrativeProposal {
  return rehydrateNarrativeProposal({
    ...payload,
    createdAt: reviveTimestamp((payload as unknown as NarrativeProposal).createdAt),
    updatedAt: reviveTimestamp((payload as unknown as NarrativeProposal).updatedAt),
  });
}

function reviveDecision(payload: Record<string, unknown>): AdoptionDecision {
  const decision = payload as unknown as AdoptionDecision;
  const evidenceData = decision.evidence.data as unknown as {
    decidedAt: Date | ImmutableTimestamp;
  };
  return {
    ...decision,
    decidedAt: reviveTimestamp(decision.decidedAt),
    evidence: createObservation<AdoptionDecisionEvidence>({
      evidenceReference: decision.evidence.evidenceReference,
      sourceReference: decision.evidence.sourceReference,
      ordinal: decision.evidence.ordinal,
      data: {
        ...decision.evidence.data,
        decidedAt: reviveTimestamp(evidenceData.decidedAt),
      },
    }),
  };
}

function prismaProposalPort(
  client: PrismaRepositoryClient,
  aggregateType: string,
): NarrativeProposalPort {
  const repository = new PrismaRevisionedRepository<NarrativeProposal>(
    client,
    aggregateType,
    reviveProposal,
    capabilityPersistencePayloadCodec,
  );
  return {
    saveRevisionIfAbsent: async (entity) => repository.saveRevisionIfAbsent(validateProposalInput(entity)),
    saveIfCurrent: async (expectedRevisionId, entity) =>
      repository.saveIfCurrent(expectedRevisionId, validateProposalInput(entity)),
    findById: (id) => repository.findById(id),
    getRevision: (id, revisionId) => repository.getRevision(id, revisionId),
    listByNovel: (novelId) => repository.listByNovel(novelId),
  };
}

function prismaDecisionPort(
  client: PrismaRepositoryClient,
  aggregateType: string,
): AdoptionDecisionPort {
  const repository = new PrismaRepository<AdoptionDecision>(
    client,
    aggregateType,
    reviveDecision,
    capabilityPersistencePayloadCodec,
  );
  return {
    saveIfAbsent: (entity) => repository.saveIfAbsent(entity),
    findById: (id) => repository.findById(id),
    listByNovel: (novelId) => repository.listByNovel(novelId),
  };
}

export function createInMemoryNarrativeProposalPersistence(): NarrativeProposalPersistence {
  const proposals = new InMemoryRevisionedRepository<NarrativeProposal>(capabilityPersistencePayloadCodec);
  const decisions = new InMemoryRepository<AdoptionDecision>(capabilityPersistencePayloadCodec);
  const transaction = new InMemoryPersistenceTransaction<NarrativeProposalWork>(
    (access) => ({
      proposals: access.revisioned(proposals),
      decisions: access.unique(decisions),
    }),
    [proposals, decisions],
  );
  const proposalPort = transaction.revisioned(proposals);
  return {
    transaction,
    proposals: {
      saveRevisionIfAbsent: async (entity) => proposalPort.saveRevisionIfAbsent(validateProposalInput(entity)),
      saveIfCurrent: async (expectedRevisionId, entity) =>
        proposalPort.saveIfCurrent(expectedRevisionId, validateProposalInput(entity)),
      findById: (id) => proposalPort.findById(id),
      getRevision: (id, revisionId) => proposalPort.getRevision(id, revisionId),
      listByNovel: (novelId) => proposalPort.listByNovel(novelId),
    },
    decisions: transaction.unique(decisions),
  };
}

export function createPrismaNarrativeProposalPersistence(
  prisma: PrismaClient,
  aggregateType = "NarrativeProposalTask22",
): NarrativeProposalPersistence {
  const proposalAggregate = `${aggregateType}:Proposal`;
  const decisionAggregate = `${aggregateType}:Decision`;
  const transaction = new PrismaPersistenceTransaction<NarrativeProposalWork>(
    prisma,
    (client) => ({
      proposals: prismaProposalPort(client, proposalAggregate),
      decisions: prismaDecisionPort(client, decisionAggregate),
    }),
  );
  return {
    transaction,
    proposals: prismaProposalPort(prisma, proposalAggregate),
    decisions: prismaDecisionPort(prisma, decisionAggregate),
  };
}
