import { InMemoryRepository, InMemoryRevisionedRepository } from "./inMemoryRepositories";
import { InMemoryCommitTransaction } from "./inMemoryCommitTransaction";
import type { Novel } from "../narrative/novel/domain/novel";
import type { Candidate } from "../production/domain/candidate";
import type { GenerationTask } from "../production/domain/generationTask";
import { DeterministicRuntime } from "../production/runtime/deterministicRuntime";
import { DeterministicFoundationRuntime } from "../production/runtime/deterministicFoundationRuntime";
import { createInMemoryNarrativeProposalPersistence } from "../story/application/narrativeProposalPersistence";
import { createInMemoryRunOrchestrationPersistence } from "../production/application/runPlanPersistence";
import { createInMemoryAttentionDispositionPersistence } from "../recall/attention/attentionDispositionPersistence";
import { createNovelBrainServer } from "../http/server";
import type { ApiDependencies } from "../http/routes";

export function createInMemoryEngineDependencies(): ApiDependencies {
  const commitTransaction = new InMemoryCommitTransaction();
  return {
    novels: commitTransaction.serializeRepository(new InMemoryRepository<Novel>()),
    scenes: commitTransaction.scenes,
    generationTasks: commitTransaction.serializeRepository(new InMemoryRepository<GenerationTask>()),
    candidates: commitTransaction.serializeRevisionedRepository(new InMemoryRevisionedRepository<Candidate>()),
    canonicalFacts: commitTransaction.canonicalFacts,
    stateRecords: commitTransaction.stateRecords,
    narrativeCommits: commitTransaction.narrativeCommits,
    eventStore: commitTransaction.eventStore,
    runtime: new DeterministicRuntime(),
    commitTransaction,
    product: {
      foundationPersistence: createInMemoryNarrativeProposalPersistence(),
      runPersistence: createInMemoryRunOrchestrationPersistence(),
      attentionPersistence: createInMemoryAttentionDispositionPersistence(),
      runtime: new DeterministicFoundationRuntime(),
    },
  };
}

export function createInMemoryEngineServer() {
  return createNovelBrainServer(createInMemoryEngineDependencies());
}
