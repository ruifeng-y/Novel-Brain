import type { Repository, RevisionedRepository } from "../../shared/application/repository";
import { createVersionReference, type VersionSet } from "../../shared/domain/versioning";
import type { Candidate } from "../../production/domain/candidate";
import type { ValidationRun } from "../../production/domain/validationRun";
import type { ReviewDecision } from "../../production/domain/reviewDecision";
import {
  commitSceneText,
  type Scene,
} from "../../manuscript/domain/scene";
import { replaceTargetSpan } from "../../manuscript/domain/targetSpan";
import type { CanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import { replaceCanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../narrative/state/domain/stateRecord";
import { replaceStateRecord } from "../../narrative/state/domain/stateRecord";
import {
  createNarrativeCommit,
  markNarrativeCommitCommitted,
  markNarrativeCommitStale,
  type NarrativeCommit,
} from "../domain/narrativeCommit";
import { createDomainEvent } from "../domain/domainEvent";
import type { EventStore } from "../infrastructure/eventStore";

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

async function assertDependenciesAreCurrent(
  repositories: CommitCandidateRepositories,
  versionSet: VersionSet,
): Promise<void> {
  for (const [dependencyName, reference] of Object.entries(versionSet)) {
    let currentRevisionId: string | undefined;

    if (reference.aggregateType === "Scene") {
      currentRevisionId = (await repositories.scenes.findById(reference.objectId))?.currentRevisionId;
    } else if (reference.aggregateType === "CanonicalFact") {
      currentRevisionId = (await repositories.canonicalFacts.findById(reference.objectId))?.currentRevisionId;
    } else if (reference.aggregateType === "StateRecord") {
      currentRevisionId = (await repositories.stateRecords.findById(reference.objectId))?.currentRevisionId;
    }

    if (currentRevisionId !== reference.revisionId) {
      throw new Error(`Stale dependency: ${dependencyName}`);
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

  let commit = createNarrativeCommit({
    id: input.input.commitId,
    novelId: candidate.novelId,
    candidate,
    validationRuns: input.input.validationRuns,
    reviewDecision: input.input.reviewDecision,
    createdAt: input.input.now,
  });

  try {
    await assertDependenciesAreCurrent(input.repositories, candidate.basedOnVersionSet);
  } catch (error) {
    commit = markNarrativeCommitStale(commit, input.input.now);
    await input.repositories.narrativeCommits.save(commit);
    throw error;
  }

  const resultingVersionSet: Record<string, ReturnType<typeof createVersionReference>> = {};
  let eventName:
    | "SceneCommitted"
    | "CanonicalFactChanged"
    | "CharacterStateChanged"
    | "WorldStateChanged"
    | "PlotStateChanged";
  let objectId = "";
  let revisionId = "";

  if (candidate.change.type === "text" || candidate.change.type === "local_text") {
    const scene = await input.repositories.scenes.findById(candidate.change.sceneId);
    if (!scene) throw new Error(`Scene not found: ${candidate.change.sceneId}`);
    const nextRevisionId = `${scene.currentRevisionId}:${input.input.commitId}`;
    const nextText =
      candidate.change.type === "text"
        ? candidate.change.text
        : replaceTargetSpan({
            scene,
            target: candidate.change.targetSpan,
            replacement: candidate.change.replacement,
          });
    const nextSpanAnchors =
      candidate.change.type === "local_text"
        ? {
            ...scene.spanAnchors,
            [candidate.change.targetSpan.anchorId]: candidate.change.replacement,
          }
        : {};

    const nextScene = commitSceneText({
      scene,
      text: nextText,
      spanAnchors: nextSpanAnchors,
      revisionId: nextRevisionId,
      commitId: commit.id,
      updatedAt: input.input.now,
    });
    await input.repositories.scenes.save(nextScene);
    resultingVersionSet.scene = createVersionReference("Scene", nextScene.id, nextRevisionId);
    eventName = "SceneCommitted";
    objectId = nextScene.id;
    revisionId = nextRevisionId;
  } else if (candidate.change.type === "canonical_fact") {
    const fact = await input.repositories.canonicalFacts.findById(candidate.change.canonicalFactId);
    if (!fact) throw new Error(`Canonical fact not found: ${candidate.change.canonicalFactId}`);
    const nextRevisionId = `${fact.currentRevisionId}:${commit.id}`;
    const nextFact = replaceCanonicalFact({
      fact,
      content: candidate.change.content,
      revisionId: nextRevisionId,
      commitId: commit.id,
      updatedAt: input.input.now,
    });
    await input.repositories.canonicalFacts.save(nextFact);
    resultingVersionSet.canonicalFact = createVersionReference(
      "CanonicalFact",
      nextFact.id,
      nextRevisionId,
    );
    eventName = "CanonicalFactChanged";
    objectId = nextFact.id;
    revisionId = nextRevisionId;
  } else {
    const record = await input.repositories.stateRecords.findById(candidate.change.stateRecordId);
    if (!record) throw new Error(`State record not found: ${candidate.change.stateRecordId}`);
    const nextRevisionId = `${record.currentRevisionId}:${commit.id}`;
    const nextRecord = replaceStateRecord({
      record,
      content: candidate.change.content,
      revisionId: nextRevisionId,
      commitId: commit.id,
      updatedAt: input.input.now,
    });
    await input.repositories.stateRecords.save(nextRecord);
    resultingVersionSet.stateRecord = createVersionReference(
      "StateRecord",
      nextRecord.id,
      nextRevisionId,
    );
    eventName =
      nextRecord.type === "character_state"
        ? "CharacterStateChanged"
        : nextRecord.type === "world_state"
          ? "WorldStateChanged"
          : "PlotStateChanged";
    objectId = nextRecord.id;
    revisionId = nextRevisionId;
  }

  commit = markNarrativeCommitCommitted({
    commit,
    resultingVersionSet: Object.freeze(resultingVersionSet),
    committedAt: input.input.now,
  });
  await input.repositories.narrativeCommits.save(commit);
  await input.eventStore.append(
    createDomainEvent({
      eventId: `event:${commit.id}:${objectId}`,
      name: eventName,
      context: eventName === "SceneCommitted" ? "manuscript" : "narrative_state",
      novelId: candidate.novelId,
      objectId,
      revisionId,
      commitId: commit.id,
      payload: { candidateId: candidate.id },
      occurredAt: input.input.now,
    }),
  );

  return commit;
}
