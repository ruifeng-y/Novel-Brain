import type { DomainId, RevisionId } from "../../shared/domain/ids";

export type ReviewDecisionType = "approve" | "reject" | "request_regeneration";
export type ReviewDecisionMaker = "human" | "policy";

export interface ReviewDecision {
  readonly id: DomainId;
  readonly candidateId: DomainId;
  readonly candidateRevisionId: RevisionId;
  readonly decision: ReviewDecisionType;
  readonly decidedBy: ReviewDecisionMaker;
  readonly actorId: DomainId;
  readonly reason?: string;
  readonly createdAt: Date;
}

export function createReviewDecision(input: {
  id: DomainId;
  candidateId: DomainId;
  candidateRevisionId: RevisionId;
  decision: ReviewDecisionType;
  decidedBy: ReviewDecisionMaker;
  actorId: DomainId;
  reason: string;
  createdAt: Date;
}): ReviewDecision {
  if (!input.id) throw new Error("id is required");
  if (!input.candidateId) throw new Error("candidateId is required");
  if (!input.candidateRevisionId) throw new Error("candidateRevisionId is required");
  if (!input.actorId) throw new Error("actorId is required");
  if (input.decision === "reject" && !input.reason.trim()) {
    throw new Error("A rejection requires a reason");
  }

  return Object.freeze({
    id: input.id,
    candidateId: input.candidateId,
    candidateRevisionId: input.candidateRevisionId,
    decision: input.decision,
    decidedBy: input.decidedBy,
    actorId: input.actorId,
    reason: input.reason.trim() || undefined,
    createdAt: input.createdAt,
  });
}
