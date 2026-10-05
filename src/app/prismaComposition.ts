import type { PrismaClient } from "@prisma/client";
import { createNovelBrainServer, type NovelBrainServerOptions } from "../http/server";
import type { ApiDependencies } from "../http/routes";
import { capabilityPersistencePayloadCodec } from "../shared/domain/persistencePayload";
import {
  PrismaEventStore,
  PrismaRepository,
  PrismaRevisionedRepository,
} from "../shared/infrastructure/prismaRepositories";
import {
  createPrismaCommitTransaction,
  prismaCommitAggregateTypes,
} from "./prismaCommitTransaction";
import type { Novel } from "../narrative/novel/domain/novel";
import type { Scene } from "../manuscript/domain/scene";
import type { Arc } from "../manuscript/domain/arc";
import type { Chapter } from "../manuscript/domain/chapter";
import type { GenerationTask } from "../production/domain/generationTask";
import type { Candidate } from "../production/domain/candidate";
import type { CanonicalFact } from "../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../narrative/state/domain/stateRecord";
import type { NarrativeCommit } from "../safety/domain/narrativeCommit";
import { DeterministicRuntime } from "../production/runtime/deterministicRuntime";
import { DeterministicFoundationRuntime } from "../production/runtime/deterministicFoundationRuntime";
import { createPrismaNarrativeProposalPersistence } from "../story/application/narrativeProposalPersistence";
import { createPrismaRunOrchestrationPersistence } from "../production/application/runPlanPersistence";
import { createPrismaAttentionDispositionPersistence } from "../recall/attention/attentionDispositionPersistence";
import { createPrismaDependencyImpactPersistence } from "../dependency/application/dependencyImpactPersistence";

/**
 * Frozen VersionReference aggregate names for the aggregates whose identity is
 * addressed directly rather than through the commit transaction.
 */
const prismaEngineAggregateTypes = Object.freeze({
  novel: "Novel",
  arc: "Arc",
  chapter: "Chapter",
  generationTask: "GenerationTask",
  candidate: "Candidate",
});

function revive<T>(payload: Record<string, unknown>): T {
  return payload as unknown as T;
}

/**
 * Prisma-backed composition root. Every canonical repository and the commit
 * transaction share one PostgreSQL truth: scene / canonical fact / state
 * record / narrative commit use the exact aggregate types exported by the
 * commit transaction, so application reads observe what commits write. There
 * is no in-memory fallback; a deployment either runs on this root or refuses
 * to build it.
 */
export function createPrismaEngineDependencies(prisma: PrismaClient): ApiDependencies {
  const codec = capabilityPersistencePayloadCodec;
  const commitTransaction = createPrismaCommitTransaction(prisma);
  const dependencyImpactPersistence = createPrismaDependencyImpactPersistence(prisma);
  return {
    novels: new PrismaRepository<Novel>(
      prisma,
      prismaEngineAggregateTypes.novel,
      revive,
      codec,
    ),
    scenes: new PrismaRevisionedRepository<Scene>(
      prisma,
      prismaCommitAggregateTypes.scene,
      revive,
      codec,
    ),
    arcs: new PrismaRepository<Arc>(prisma, prismaEngineAggregateTypes.arc, revive, codec),
    chapters: new PrismaRepository<Chapter>(
      prisma,
      prismaEngineAggregateTypes.chapter,
      revive,
      codec,
    ),
    generationTasks: new PrismaRepository<GenerationTask>(
      prisma,
      prismaEngineAggregateTypes.generationTask,
      revive,
      codec,
    ),
    candidates: new PrismaRevisionedRepository<Candidate>(
      prisma,
      prismaEngineAggregateTypes.candidate,
      revive,
      codec,
    ),
    canonicalFacts: new PrismaRevisionedRepository<CanonicalFact>(
      prisma,
      prismaCommitAggregateTypes.canonicalFact,
      revive,
      codec,
    ),
    stateRecords: new PrismaRevisionedRepository<StateRecord>(
      prisma,
      prismaCommitAggregateTypes.stateRecord,
      revive,
      codec,
    ),
    narrativeCommits: new PrismaRepository<NarrativeCommit>(
      prisma,
      prismaCommitAggregateTypes.narrativeCommit,
      revive,
      codec,
    ),
    eventStore: new PrismaEventStore(prisma),
    runtime: new DeterministicRuntime(),
    commitTransaction,
    product: {
      foundationPersistence: createPrismaNarrativeProposalPersistence(prisma),
      runPersistence: createPrismaRunOrchestrationPersistence(prisma),
      attentionPersistence: createPrismaAttentionDispositionPersistence(prisma),
      dependencyImpactPersistence,
      runtime: new DeterministicFoundationRuntime(),
    },
  };
}

export function createPrismaEngineServer(
  prisma: PrismaClient,
  options: NovelBrainServerOptions = {},
) {
  return createNovelBrainServer(createPrismaEngineDependencies(prisma), options);
}
