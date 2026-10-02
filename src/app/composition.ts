import { InMemoryRepository, InMemoryRevisionedRepository } from "./inMemoryRepositories";
import type { Novel } from "../narrative/novel/domain/novel";
import type { CanonicalFact } from "../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../narrative/state/domain/stateRecord";
import type { Scene } from "../manuscript/domain/scene";
import type { GenerationTask } from "../production/domain/generationTask";
import type { Candidate } from "../production/domain/candidate";
import type { ValidationRun } from "../production/domain/validationRun";
import type { ReviewDecision } from "../production/domain/reviewDecision";
import type { NarrativeCommit } from "../safety/domain/narrativeCommit";
import { InMemoryEventStore } from "../safety/infrastructure/eventStore";
import { DeterministicRuntime } from "../production/runtime/deterministicRuntime";
import { createNovelBrainServer } from "../http/server";
import type { ApiDependencies } from "../http/routes";

export function createInMemoryEngineDependencies(): ApiDependencies {
  return {
    novels: new InMemoryRepository<Novel>(),
    scenes: new InMemoryRevisionedRepository<Scene>(),
    generationTasks: new InMemoryRepository<GenerationTask>(),
    candidates: new InMemoryRevisionedRepository<Candidate>(),
    validationRuns: new InMemoryRepository<ValidationRun>(),
    reviewDecisions: new InMemoryRepository<ReviewDecision>(),
    canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
    stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
    narrativeCommits: new InMemoryRepository<NarrativeCommit>(),
    eventStore: new InMemoryEventStore(),
    runtime: new DeterministicRuntime(),
  };
}

export function createInMemoryEngineServer() {
  return createNovelBrainServer(createInMemoryEngineDependencies());
}
