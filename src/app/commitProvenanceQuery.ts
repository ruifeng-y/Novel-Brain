import type { Repository, RepositoryReadPort } from "../shared/application/repository";
import type { DomainEvent } from "../safety/domain/domainEvent";
import type { NarrativeCommit } from "../safety/domain/narrativeCommit";
import type { EventStore } from "../safety/infrastructure/eventStore";
import type { ValidationRun } from "../production/domain/validationRun";
import type { ReviewDecision } from "../production/domain/reviewDecision";
import { validationRunOf, type StoredValidationRun } from "./validationRunService";
import {
  reviewDecisionOf,
  type ReviewDecisionStore,
  type StoredReviewDecision,
} from "./reviewDecisionService";

/**
 * What a commit was made of: the commit itself, the revision it committed, the
 * validation runs and review decisions it referenced, and the audit events it
 * produced. Provenance is a read: it never re-derives the gate or the commit.
 */
export interface CommitProvenance {
  readonly commit: NarrativeCommit;
  /** The revision reference the commit carries. */
  readonly changeSetRevisionId: string;
  readonly validationRuns: readonly ValidationRun[];
  readonly reviewDecisions: readonly ReviewDecision[];
  readonly auditEvents: readonly DomainEvent[];
}

export interface CommitProvenanceQuery {
  get(input: { readonly novelId: string; readonly commitId: string }): Promise<CommitProvenance | undefined>;
}

export function createCommitProvenanceQuery(dependencies: {
  readonly commits: Repository<NarrativeCommit>;
  readonly validations: RepositoryReadPort<StoredValidationRun>;
  readonly reviews: ReviewDecisionStore;
  readonly eventStore: EventStore;
}): CommitProvenanceQuery {
  return {
    async get({ novelId, commitId }) {
      const commit = await dependencies.commits.findById(commitId);
      // A commit of another novel is not this novel's provenance.
      if (!commit || commit.novelId !== novelId) return undefined;

      const runs = await Promise.all(
        commit.validationRunIds.map(id => dependencies.validations.findById(id)),
      );
      const decisions = await Promise.all(
        commit.reviewDecisionIds.map(id => dependencies.reviews.findById(id)),
      );
      const events = (await dependencies.eventStore.listByNovel(novelId)).filter(
        event => event.commitId === commitId,
      );

      return Object.freeze({
        commit,
        changeSetRevisionId: commit.changeSetRevisionId,
        validationRuns: Object.freeze(
          runs.filter((run): run is StoredValidationRun => run !== undefined).map(validationRunOf),
        ),
        reviewDecisions: Object.freeze(
          decisions
            .filter((decision): decision is StoredReviewDecision => decision !== undefined)
            .map(reviewDecisionOf),
        ),
        auditEvents: Object.freeze([...events]),
      });
    },
  };
}
