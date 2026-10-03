import type { DomainId, RevisionId } from "../../shared/domain/ids";
import type { TargetType } from "./change";

export type ReviewDecisionType = "approve" | "reject" | "request_regeneration";
export type ReviewDecisionMaker = "human" | "policy";
export type RequirementDomain = "canon" | "plan" | "structure" | "manuscript" | "story_state";

export interface ApprovalScope {
  readonly requirementDomain: RequirementDomain;
  readonly targetType: TargetType;
  readonly objectId: DomainId;
  readonly subAddress?: string;
}

export interface ReviewDecision {
  readonly id: DomainId;
  readonly changeSetRevisionId: RevisionId;
  readonly approvalScope: ApprovalScope;
  readonly decision: ReviewDecisionType;
  readonly decidedBy: ReviewDecisionMaker;
  readonly actorId: DomainId;
  readonly reason?: string;
  readonly policyVersion?: string;
  readonly decisionRule?: string;
  readonly evidenceReferences: readonly string[];
  readonly createdAt: Date;
}

export function approvalScopeKey(scope: ApprovalScope): string {
  if (scope.objectId.includes("#")) {
    throw new Error("approvalScope.objectId must not contain '#'");
  }
  if (scope.subAddress !== undefined && scope.subAddress.length === 0) {
    throw new Error("approvalScope.subAddress must not be empty");
  }
  if (scope.subAddress?.includes("#")) {
    throw new Error("approvalScope.subAddress must not contain '#'");
  }

  const base = `${scope.requirementDomain}:${scope.targetType}:${scope.objectId}`;
  return scope.subAddress !== undefined ? `${base}#${scope.subAddress}` : base;
}

export function createReviewDecision(input: {
  id: DomainId;
  changeSetRevisionId: RevisionId;
  approvalScope: ApprovalScope;
  decision: ReviewDecisionType;
  decidedBy: ReviewDecisionMaker;
  actorId: DomainId;
  reason: string;
  evidenceReferences: readonly string[];
  policyVersion?: string;
  decisionRule?: string;
  createdAt: Date;
}): ReviewDecision {
  if (!input.id) throw new Error("id is required");
  if (!input.changeSetRevisionId) throw new Error("changeSetRevisionId is required");
  if (!input.approvalScope) throw new Error("approvalScope is required");
  if (!input.approvalScope.objectId) throw new Error("approvalScope.objectId is required");
  approvalScopeKey(input.approvalScope);
  if (!input.actorId) throw new Error("actorId is required");
  if (input.decision === "reject" && !input.reason.trim()) {
    throw new Error("A rejection requires a reason");
  }
  if (input.decidedBy === "policy" && !input.policyVersion) {
    throw new Error("A policy decision requires policyVersion");
  }
  if (input.decidedBy === "policy" && !input.decisionRule) {
    throw new Error("A policy decision requires decisionRule");
  }

  return Object.freeze({
    id: input.id,
    changeSetRevisionId: input.changeSetRevisionId,
    approvalScope: Object.freeze({ ...input.approvalScope }),
    decision: input.decision,
    decidedBy: input.decidedBy,
    actorId: input.actorId,
    reason: input.reason.trim() || undefined,
    policyVersion: input.policyVersion,
    decisionRule: input.decisionRule,
    evidenceReferences: Object.freeze([...input.evidenceReferences]),
    createdAt: new Date(input.createdAt.getTime()),
  });
}
