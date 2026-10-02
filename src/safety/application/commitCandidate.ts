import type { Repository, RevisionedRepository } from "../../shared/application/repository";
import {
  createVersionReference,
  type VersionReference,
  type VersionSet,
} from "../../shared/domain/versioning";
import type {
  Candidate,
  CandidateAtomicChange,
  CandidateChange,
} from "../../production/domain/candidate";
import type { ValidationRun } from "../../production/domain/validationRun";
import type { ReviewDecision } from "../../production/domain/reviewDecision";
import {
  commitSceneText,
  type Scene,
} from "../../manuscript/domain/scene";
import { rebaseSpanAnchors, replaceTargetSpan } from "../../manuscript/domain/targetSpan";
import type { CanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import { replaceCanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../narrative/state/domain/stateRecord";
import { replaceStateRecord } from "../../narrative/state/domain/stateRecord";
import {
  createNarrativeCommit,
  markNarrativeCommitCommitted,
  markNarrativeCommitFailed,
  markNarrativeCommitStale,
  type NarrativeCommit,
} from "../domain/narrativeCommit";
import type { DomainEvent } from "../domain/domainEvent";
import type { EventStore } from "../infrastructure/eventStore";
import { createSceneCommittedEvent } from "../../manuscript/domain/manuscriptEvents";
import {
  createCanonicalFactChangedEvent,
  createCharacterStateChangedEvent,
  createWorldStateChangedEvent,
  createPlotStateChangedEvent,
} from "../../narrative/state/domain/narrativeStateEvents";
import { createNarrativeCommitRecordedEvent } from "../../production/domain/aiProductionEvents";

export interface CommitCandidateRepositories {
  readonly scenes: RevisionedRepository<Scene>;
  readonly candidates: RevisionedRepository<Candidate>;
  readonly canonicalFacts: RevisionedRepository<CanonicalFact>;
  readonly stateRecords: RevisionedRepository<StateRecord>;
  readonly narrativeCommits: Repository<NarrativeCommit>;
}

export interface CommitCandidateDependencies extends CommitCandidateRepositories {
  readonly eventStore: EventStore;
}

export interface CommitCandidateInput {
  readonly commitId: string;
  readonly candidateId: string;
  readonly validationRuns: readonly ValidationRun[];
  readonly reviewDecision: ReviewDecision;
  readonly now: Date;
}

type SupportedVersionType = "Scene" | "CanonicalFact" | "StateRecord";

class StaleDependencyError extends Error {
  constructor(public readonly dependencyName: string) {
    super(`Stale dependency: ${dependencyName}`);
    this.name = "StaleDependencyError";
  }
}

class UnsupportedDependencyError extends Error {
  constructor(public readonly dependencyType: string) {
    super(`Unsupported version dependency type: ${dependencyType}`);
    this.name = "UnsupportedDependencyError";
  }
}

type PreparedSceneChange = {
  readonly kind: "scene";
  readonly original: Scene;
  readonly next: Scene;
  readonly event: DomainEvent;
  readonly resultKey: string;
  readonly resultReference: VersionReference;
};

type PreparedCanonicalChange = {
  readonly kind: "canonicalFact";
  readonly original: CanonicalFact;
  readonly next: CanonicalFact;
  readonly event: DomainEvent;
  readonly resultKey: string;
  readonly resultReference: VersionReference;
};

type PreparedStateChange = {
  readonly kind: "stateRecord";
  readonly original: StateRecord;
  readonly next: StateRecord;
  readonly event: DomainEvent;
  readonly resultKey: string;
  readonly resultReference: VersionReference;
};

type PreparedChange = PreparedSceneChange | PreparedCanonicalChange | PreparedStateChange;

function atomicChanges(change: CandidateChange): readonly CandidateAtomicChange[] {
  return change.type === "composite" ? change.changes : [change];
}

function targetKey(change: CandidateAtomicChange): string {
  if (change.type === "text" || change.type === "local_text") {
    return `Scene:${change.sceneId}`;
  }
  if (change.type === "canonical_fact") {
    return `CanonicalFact:${change.canonicalFactId}`;
  }
  return `StateRecord:${change.stateRecordId}`;
}

function resultKeyFor(kind: PreparedChange["kind"], objectId: string, used: Set<string>): string {
  const base = kind === "scene" ? "scene" : kind === "canonicalFact" ? "canonicalFact" : "stateRecord";
  let key = base;
  let suffix = 2;
  while (used.has(key)) key = `${base}-${suffix++}`;
  used.add(key);
  return key;
}

function assertSupportedDependencyType(aggregateType: string): asserts aggregateType is SupportedVersionType {
  if (aggregateType !== "Scene" && aggregateType !== "CanonicalFact" && aggregateType !== "StateRecord") {
    throw new UnsupportedDependencyError(aggregateType);
  }
}

async function assertDependenciesAreCurrent(
  repositories: CommitCandidateRepositories,
  versionSet: VersionSet,
): Promise<void> {
  for (const [dependencyName, reference] of Object.entries(versionSet)) {
    assertSupportedDependencyType(reference.aggregateType);

    let currentRevisionId: string | undefined;
    if (reference.aggregateType === "Scene") {
      currentRevisionId = (await repositories.scenes.findById(reference.objectId))?.currentRevisionId;
    } else if (reference.aggregateType === "CanonicalFact") {
      currentRevisionId = (await repositories.canonicalFacts.findById(reference.objectId))?.currentRevisionId;
    } else {
      currentRevisionId = (await repositories.stateRecords.findById(reference.objectId))?.currentRevisionId;
    }

    if (currentRevisionId === undefined) {
      throw new Error(`Missing version dependency object: ${dependencyName}`);
    }
    if (currentRevisionId !== reference.revisionId) {
      throw new StaleDependencyError(dependencyName);
    }
  }
}

function assertTargetVersionDependency(
  change: CandidateAtomicChange,
  versionSet: VersionSet,
): VersionReference {
  const key = targetKey(change);
  const [aggregateType, objectId] = key.split(":") as [SupportedVersionType, string];
  const reference = Object.values(versionSet).find(
    candidateReference =>
      candidateReference.aggregateType === aggregateType &&
      candidateReference.objectId === objectId,
  );
  if (!reference) throw new Error(`Missing target version dependency: ${key}`);
  return reference;
}

async function prepareChange(
  repositories: CommitCandidateRepositories,
  candidate: Candidate,
  change: CandidateAtomicChange,
  commitId: string,
  now: Date,
  usedResultKeys: Set<string>,
): Promise<PreparedChange> {
  assertTargetVersionDependency(change, candidate.basedOnVersionSet);

  if (change.type === "text" || change.type === "local_text") {
    const original = await repositories.scenes.findById(change.sceneId);
    if (!original) throw new Error(`Scene not found: ${change.sceneId}`);
    const nextRevisionId = `${original.currentRevisionId}:${commitId}`;
    const nextText =
      change.type === "text"
        ? change.text
        : replaceTargetSpan({
            scene: original,
            target: change.targetSpan,
            replacement: change.replacement,
          });
    const nextSpanAnchors =
      change.type === "local_text"
        ? rebaseSpanAnchors(original, change.targetSpan, change.replacement)
        : {};
    const next = commitSceneText({
      scene: original,
      text: nextText,
      spanAnchors: nextSpanAnchors,
      revisionId: nextRevisionId,
      commitId,
      updatedAt: now,
    });
    const resultKey = resultKeyFor("scene", original.id, usedResultKeys);
    return {
      kind: "scene",
      original,
      next,
      resultKey,
      resultReference: createVersionReference("Scene", original.id, nextRevisionId),
      event: createSceneCommittedEvent({
        eventId: `event:${commitId}:${original.id}:${resultKey}`,
        novelId: candidate.novelId,
        objectId: original.id,
        revisionId: nextRevisionId,
        commitId,
        payload: { candidateId: candidate.id },
        occurredAt: now,
      }),
    };
  }

  if (change.type === "canonical_fact") {
    const original = await repositories.canonicalFacts.findById(change.canonicalFactId);
    if (!original) throw new Error(`Canonical fact not found: ${change.canonicalFactId}`);
    const nextRevisionId = `${original.currentRevisionId}:${commitId}`;
    const next = replaceCanonicalFact({
      fact: original,
      content: change.content,
      revisionId: nextRevisionId,
      commitId,
      updatedAt: now,
    });
    const resultKey = resultKeyFor("canonicalFact", original.id, usedResultKeys);
    return {
      kind: "canonicalFact",
      original,
      next,
      resultKey,
      resultReference: createVersionReference("CanonicalFact", original.id, nextRevisionId),
      event: createCanonicalFactChangedEvent({
        eventId: `event:${commitId}:${original.id}:${resultKey}`,
        novelId: candidate.novelId,
        objectId: original.id,
        revisionId: nextRevisionId,
        commitId,
        payload: { candidateId: candidate.id },
        occurredAt: now,
      }),
    };
  }

  const original = await repositories.stateRecords.findById(change.stateRecordId);
  if (!original) throw new Error(`State record not found: ${change.stateRecordId}`);
  const nextRevisionId = `${original.currentRevisionId}:${commitId}`;
  const next = replaceStateRecord({
    record: original,
    content: change.content,
    revisionId: nextRevisionId,
    commitId,
    updatedAt: now,
  });
  const resultKey = resultKeyFor("stateRecord", original.id, usedResultKeys);
  return {
    kind: "stateRecord",
    original,
    next,
    resultKey,
    resultReference: createVersionReference("StateRecord", original.id, nextRevisionId),
    event: (next.type === "character_state"
      ? createCharacterStateChangedEvent
      : next.type === "world_state"
        ? createWorldStateChangedEvent
        : createPlotStateChangedEvent)({
          eventId: `event:${commitId}:${original.id}:${resultKey}`,
          novelId: candidate.novelId,
          objectId: original.id,
          revisionId: nextRevisionId,
          commitId,
          payload: { candidateId: candidate.id },
          occurredAt: now,
        }),
  };
}

async function restoreOriginals(
  repositories: CommitCandidateRepositories,
  prepared: readonly PreparedChange[],
): Promise<void> {
  for (const change of prepared) {
    try {
      if (change.kind === "scene") await repositories.scenes.save(change.original);
      if (change.kind === "canonicalFact") await repositories.canonicalFacts.save(change.original);
      if (change.kind === "stateRecord") await repositories.stateRecords.save(change.original);
    } catch {
      // Best effort compensation; the failed NarrativeCommit remains the evidence.
    }
  }
}

export async function commitCandidate(input: {
  repositories: CommitCandidateRepositories;
  eventStore: EventStore;
  input: CommitCandidateInput;
}): Promise<NarrativeCommit> {
  const candidate = await input.repositories.candidates.findById(input.input.candidateId);
  if (!candidate) throw new Error(`Candidate not found: ${input.input.candidateId}`);
  if (candidate.status !== "selected") throw new Error("Only a selected candidate can be committed");

  const pendingCommit = createNarrativeCommit({
    id: input.input.commitId,
    novelId: candidate.novelId,
    candidate,
    validationRuns: input.input.validationRuns,
    reviewDecision: input.input.reviewDecision,
    createdAt: input.input.now,
  });
  await input.repositories.narrativeCommits.save(pendingCommit);

  const changes = atomicChanges(candidate.change);
  const seenTargets = new Set<string>();
  for (const change of changes) {
    const key = targetKey(change);
    if (seenTargets.has(key)) throw new Error(`Duplicate candidate change target: ${key}`);
    seenTargets.add(key);
  }

  const prepared: PreparedChange[] = [];
  try {
    await assertDependenciesAreCurrent(input.repositories, candidate.basedOnVersionSet);
    const usedResultKeys = new Set<string>();
    for (const change of changes) {
      prepared.push(
        await prepareChange(
          input.repositories,
          candidate,
          change,
          pendingCommit.id,
          input.input.now,
          usedResultKeys,
        ),
      );
    }

    for (const change of prepared) {
      if (change.kind === "scene") await input.repositories.scenes.save(change.next);
      if (change.kind === "canonicalFact") await input.repositories.canonicalFacts.save(change.next);
      if (change.kind === "stateRecord") await input.repositories.stateRecords.save(change.next);
    }

    const resultingVersionSet: Record<string, VersionReference> = {};
    for (const change of prepared) resultingVersionSet[change.resultKey] = change.resultReference;

    const committed = markNarrativeCommitCommitted({
      commit: pendingCommit,
      resultingVersionSet: Object.freeze(resultingVersionSet),
      committedAt: input.input.now,
    });
    await input.eventStore.appendMany([
      ...prepared.map(change => change.event),
      createNarrativeCommitRecordedEvent({
        eventId: `event:${committed.id}:recorded`,
        novelId: candidate.novelId,
        objectId: committed.id,
        revisionId: committed.id,
        commitId: committed.id,
        payload: {
          candidateId: candidate.id,
          resultingVersionSet,
        },
        occurredAt: input.input.now,
      }),
    ]);
    await input.repositories.narrativeCommits.save(committed);
    return committed;
  } catch (error) {
    await restoreOriginals(input.repositories, prepared);
    if (error instanceof StaleDependencyError) {
      const stale = markNarrativeCommitStale(pendingCommit, input.input.now);
      await input.repositories.narrativeCommits.save(stale);
      throw error;
    }
    const reason = error instanceof Error ? error.message : "Unknown commit failure";
    const failed = markNarrativeCommitFailed({
      commit: pendingCommit,
      reason,
      failedAt: input.input.now,
    });
    await input.repositories.narrativeCommits.save(failed);
    throw error;
  }
}
