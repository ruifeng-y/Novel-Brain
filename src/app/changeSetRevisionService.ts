import { canonicalJson, hashContent } from "../shared/domain/contentHash";
import { CommitConflictError } from "../shared/application/commitConflict";
import {
  assertNoDuplicateTargets,
  createChange,
  type Change,
  type ChangeSourceType,
} from "../production/domain/change";
import type { Candidate, CandidateAtomicChange } from "../production/domain/candidate";
import {
  createChangeSetRevision,
  createInitialChangeSetRevision,
  type ChangeSetRevision,
} from "../production/domain/changeSetRevision";
import {
  changeSetRevisionOf,
  storedChangeSetRevision,
  type ChangeSetRevisionRepository,
} from "../production/application/changeSetPersistence";
import type { VersionSet } from "../shared/domain/versioning";

export interface AdoptCandidateInput {
  readonly candidate: Candidate;
  readonly changeSetId: string;
  readonly revisionId: string;
  readonly parentRevision?: ChangeSetRevision;
  /** Provenance recorded on every adopted change; defaults to the candidate's own revision. */
  readonly sourceReference?: { readonly version: string; readonly hash: string };
  readonly createdAt: Date;
}

export interface ChangeSetRevisionService {
  adoptCandidate(input: AdoptCandidateInput): Promise<ChangeSetRevision>;
  getRevision(input: {
    readonly changeSetId: string;
    readonly revisionId: string;
  }): Promise<ChangeSetRevision | undefined>;
  getCurrentRevision(input: { readonly changeSetId: string }): Promise<ChangeSetRevision | undefined>;
}

function candidateAtomicChanges(
  change: Candidate["change"],
): readonly CandidateAtomicChange[] {
  return change.type === "composite" ? change.changes : [change];
}

function candidateChangeToDomainChange(input: {
  change: CandidateAtomicChange;
  id: string;
  sourceType: ChangeSourceType;
  sourceReference: { identity: string; version: string; hash: string };
  basedOnVersionSet: VersionSet;
}): Change {
  const { change } = input;
  if (change.type === "text") {
    return createChange({
      id: input.id,
      sourceType: input.sourceType,
      sourceReference: input.sourceReference,
      targetAddress: { targetType: "manuscript", objectId: change.sceneId },
      payload: { text: change.text },
      basedOnVersionSet: input.basedOnVersionSet,
    });
  }
  if (change.type === "local_text") {
    return createChange({
      id: input.id,
      sourceType: input.sourceType,
      sourceReference: input.sourceReference,
      targetAddress: {
        targetType: "manuscript",
        objectId: change.sceneId,
        subAddress: change.targetSpan.anchorId,
      },
      payload: { targetSpan: change.targetSpan, replacement: change.replacement },
      basedOnVersionSet: input.basedOnVersionSet,
    });
  }
  if (change.type === "canonical_fact") {
    return createChange({
      id: input.id,
      sourceType: input.sourceType,
      sourceReference: input.sourceReference,
      targetAddress: { targetType: "canonical_fact", objectId: change.canonicalFactId },
      payload: change.content,
      basedOnVersionSet: input.basedOnVersionSet,
    });
  }
  return createChange({
    id: input.id,
    sourceType: input.sourceType,
    sourceReference: input.sourceReference,
    targetAddress: { targetType: "story_state", objectId: change.stateRecordId },
    payload: change.content,
    basedOnVersionSet: input.basedOnVersionSet,
  });
}

function adoptedChanges(input: AdoptCandidateInput): readonly Change[] {
  const source = input.sourceReference ?? {
    version: input.candidate.currentRevisionId,
    hash: hashContent(canonicalJson(input.candidate.change)),
  };
  return candidateAtomicChanges(input.candidate.change).map((change, index) =>
    candidateChangeToDomainChange({
      change,
      id: `change:${input.revisionId}:${index + 1}`,
      sourceType: "candidate",
      sourceReference: {
        identity: input.candidate.id,
        version: source.version,
        hash: source.hash,
      },
      basedOnVersionSet: input.candidate.basedOnVersionSet,
    }),
  );
}

function buildRevision(input: AdoptCandidateInput): ChangeSetRevision {
  const changes = adoptedChanges(input);
  try {
    assertNoDuplicateTargets(changes);
  } catch (error) {
    throw new CommitConflictError(
      "duplicate_target",
      error instanceof Error ? error.message : "Duplicate target address",
    );
  }

  if (input.parentRevision) {
    if (input.parentRevision.changeSetId !== input.changeSetId) {
      throw new Error("Parent revision belongs to another change set");
    }
    if (input.parentRevision.novelId !== input.candidate.novelId) {
      throw new Error("Parent revision belongs to another novel");
    }
    return createChangeSetRevision({
      parent: input.parentRevision,
      revisionId: input.revisionId,
      trigger: { type: "edit", references: [input.candidate.id] },
      changes,
      createdAt: input.createdAt,
    });
  }

  const base = createInitialChangeSetRevision({
    revisionId: input.revisionId,
    changeSetId: input.changeSetId,
    novelId: input.candidate.novelId,
    createdAt: input.createdAt,
  });
  return Object.freeze({ ...base, changes: Object.freeze([...changes]) });
}

/**
 * Revision identity excludes `createdAt`: a retry of the same adoption must
 * return the stored snapshot, not conflict because it was sent a new clock.
 */
function revisionIdentity(revision: ChangeSetRevision): string {
  return canonicalJson({
    revisionId: revision.revisionId,
    changeSetId: revision.changeSetId,
    novelId: revision.novelId,
    revisionNumber: revision.revisionNumber,
    parentRevisionId: revision.parentRevisionId ?? null,
    trigger: revision.trigger,
    changes: revision.changes,
  });
}

function alreadyExists(): CommitConflictError {
  return new CommitConflictError(
    "revision_history",
    "Change Set Revision already exists with different content",
  );
}

export function createChangeSetRevisionService(dependencies: {
  readonly changeSets: ChangeSetRevisionRepository;
}): ChangeSetRevisionService {
  return {
    async adoptCandidate(input) {
      const revision = buildRevision(input);
      const identity = revisionIdentity(revision);
      const existing = await dependencies.changeSets.getRevision(input.changeSetId, input.revisionId);
      if (existing) {
        if (revisionIdentity(changeSetRevisionOf(existing)) !== identity) throw alreadyExists();
        return changeSetRevisionOf(existing);
      }

      // Revision history is linear: a new revision may only extend the current one.
      if (input.parentRevision) {
        const current = await dependencies.changeSets.findById(input.changeSetId);
        if (current && current.revisionId !== input.parentRevision.revisionId) {
          throw new CommitConflictError(
            "revision_history",
            "Parent revision is not the current revision",
          );
        }
      }

      const stored = storedChangeSetRevision(revision);
      try {
        await dependencies.changeSets.save(stored);
      } catch {
        const raced = await dependencies.changeSets.getRevision(input.changeSetId, input.revisionId);
        if (!raced || revisionIdentity(changeSetRevisionOf(raced)) !== identity) throw alreadyExists();
        return changeSetRevisionOf(raced);
      }
      return changeSetRevisionOf(stored);
    },

    async getRevision({ changeSetId, revisionId }) {
      const stored = await dependencies.changeSets.getRevision(changeSetId, revisionId);
      return stored ? changeSetRevisionOf(stored) : undefined;
    },

    async getCurrentRevision({ changeSetId }) {
      const stored = await dependencies.changeSets.findById(changeSetId);
      return stored ? changeSetRevisionOf(stored) : undefined;
    },
  };
}
