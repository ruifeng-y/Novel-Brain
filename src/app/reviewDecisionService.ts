import type { PrismaClient } from "@prisma/client";
import { CommitConflictError } from "../shared/application/commitConflict";
import type { RevisionedRepository, UniqueCreatePort } from "../shared/application/repository";
import { canonicalJson } from "../shared/domain/contentHash";
import { capabilityPersistencePayloadCodec } from "../shared/domain/persistencePayload";
import { PrismaRepository } from "../shared/infrastructure/prismaRepositories";
import {
  createReviewDecision,
  type ApprovalScope,
  type ReviewDecision,
  type ReviewDecisionMaker,
  type ReviewDecisionType,
} from "../production/domain/reviewDecision";
import {
  changeSetRevisionOf,
  type ChangeSetRevisionRepository,
} from "../production/application/changeSetPersistence";
import { InMemoryRepository } from "./inMemoryRepositories";

/**
 * A ReviewDecision is an immutable Decision Event bound to the Change Set
 * Revision it decides about and to an Approval Scope. It is not a revisioned
 * aggregate, so it is created once under its own id. The stored payload adds
 * the workspace of the reviewed revision so decisions can be enumerated for
 * that workspace; the enumeration dimension is not a second relationship, and
 * the revision binding stays the only decision subject.
 */
export interface StoredReviewDecision extends ReviewDecision {
  /** The workspace of the reviewed revision; the store's enumeration dimension. */
  readonly novelId: string;
}

export type ReviewDecisionStore = UniqueCreatePort<StoredReviewDecision>;

export function createInMemoryReviewDecisionStore(): ReviewDecisionStore {
  return new InMemoryRepository<StoredReviewDecision>(capabilityPersistencePayloadCodec);
}

export function createPrismaReviewDecisionStore(
  prisma: PrismaClient,
  aggregateType = "ReviewDecision",
): ReviewDecisionStore {
  return new PrismaRepository<StoredReviewDecision>(
    prisma,
    aggregateType,
    payload => payload as unknown as StoredReviewDecision,
    capabilityPersistencePayloadCodec,
  );
}

/**
 * The decision as the domain defines it: the enumeration dimension is dropped,
 * and absent optional fields stay absent so the payload codec never sees an
 * `undefined` value.
 */
export function reviewDecisionOf(stored: ReviewDecision): ReviewDecision {
  return Object.freeze({
    id: stored.id,
    changeSetRevisionId: stored.changeSetRevisionId,
    approvalScope: Object.freeze({ ...stored.approvalScope }),
    decision: stored.decision,
    decidedBy: stored.decidedBy,
    actorId: stored.actorId,
    ...(stored.reason === undefined ? {} : { reason: stored.reason }),
    ...(stored.policyVersion === undefined ? {} : { policyVersion: stored.policyVersion }),
    ...(stored.decisionRule === undefined ? {} : { decisionRule: stored.decisionRule }),
    evidenceReferences: Object.freeze([...stored.evidenceReferences]),
    createdAt: new Date(stored.createdAt.getTime()),
  });
}

export interface RecordReviewInput {
  readonly reviewDecisionId: string;
  readonly changeSetId: string;
  readonly revisionId: string;
  readonly approvalScope: ApprovalScope;
  readonly decision: ReviewDecisionType;
  readonly decidedBy: ReviewDecisionMaker;
  readonly actorId: string;
  readonly reason: string;
  readonly evidenceReferences: readonly string[];
  readonly policyVersion?: string;
  readonly decisionRule?: string;
  readonly createdAt: Date;
}

export interface ListForRevisionInput {
  readonly changeSetId: string;
  readonly revisionId: string;
}

export interface ReviewDecisionService {
  recordReview(input: RecordReviewInput): Promise<ReviewDecision>;
  listForRevision(input: ListForRevisionInput): Promise<readonly ReviewDecision[]>;
}

/**
 * Raised when the addressed Change Set Revision does not exist: a decision is
 * always recorded for a revision, so a missing revision is never answered with
 * a decision recorded against something else.
 */
export class ReviewDecisionBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewDecisionBindingError";
  }
}

/** Decision identity excludes `createdAt`, so a retry is idempotent, not a conflict. */
function decisionIdentity(decision: ReviewDecision): string {
  return canonicalJson({
    id: decision.id,
    changeSetRevisionId: decision.changeSetRevisionId,
    approvalScope: decision.approvalScope,
    decision: decision.decision,
    decidedBy: decision.decidedBy,
    actorId: decision.actorId,
    reason: decision.reason ?? null,
    policyVersion: decision.policyVersion ?? null,
    decisionRule: decision.decisionRule ?? null,
    evidenceReferences: decision.evidenceReferences,
  });
}

function alreadyExists(): CommitConflictError {
  return new CommitConflictError(
    "unique_record",
    "Review decision already exists with different content",
  );
}

/** Decisions are events: a deterministic order keeps the read reproducible. */
function byRecordedOrder(left: ReviewDecision, right: ReviewDecision): number {
  const delta = left.createdAt.getTime() - right.createdAt.getTime();
  return delta !== 0 ? delta : left.id.localeCompare(right.id);
}

export function createReviewDecisionService(dependencies: {
  readonly reviews: ReviewDecisionStore;
  readonly changeSets: ChangeSetRevisionRepository;
}): ReviewDecisionService {
  async function revisionOf(input: ListForRevisionInput) {
    const stored = await dependencies.changeSets.getRevision(input.changeSetId, input.revisionId);
    if (!stored) {
      throw new ReviewDecisionBindingError(
        `Change Set Revision not found: ${input.changeSetId}:${input.revisionId}`,
      );
    }
    return changeSetRevisionOf(stored);
  }

  return {
    async recordReview(input) {
      const revision = await revisionOf(input);
      const decision = createReviewDecision({
        id: input.reviewDecisionId,
        changeSetRevisionId: revision.revisionId,
        approvalScope: input.approvalScope,
        decision: input.decision,
        decidedBy: input.decidedBy,
        actorId: input.actorId,
        reason: input.reason,
        evidenceReferences: input.evidenceReferences,
        ...(input.policyVersion === undefined ? {} : { policyVersion: input.policyVersion }),
        ...(input.decisionRule === undefined ? {} : { decisionRule: input.decisionRule }),
        createdAt: input.createdAt,
      });
      const stored: StoredReviewDecision = Object.freeze({
        ...reviewDecisionOf(decision),
        novelId: revision.novelId,
      });

      const existing = await dependencies.reviews.findById(decision.id);
      if (existing) {
        if (decisionIdentity(existing) !== decisionIdentity(decision)) throw alreadyExists();
        return reviewDecisionOf(existing);
      }
      try {
        await dependencies.reviews.saveIfAbsent(stored);
      } catch {
        const raced = await dependencies.reviews.findById(decision.id);
        if (!raced || decisionIdentity(raced) !== decisionIdentity(decision)) throw alreadyExists();
        return reviewDecisionOf(raced);
      }
      return reviewDecisionOf(stored);
    },

    async listForRevision(input) {
      const revision = await revisionOf(input);
      const stored = await dependencies.reviews.listByNovel(revision.novelId);
      // A decision recorded for one revision is never returned for another.
      return Object.freeze(
        stored
          .filter(decision => decision.changeSetRevisionId === revision.revisionId)
          .map(reviewDecisionOf)
          .sort(byRecordedOrder),
      );
    },
  };
}
