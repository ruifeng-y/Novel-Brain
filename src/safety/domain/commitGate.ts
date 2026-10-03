export type CommitGateBlockerType =
  | "invalid_revision"
  | "stale_revision"
  | "occ_conflict"
  | "invariant_violation"
  | "mandatory_validation_failed"
  | "mandatory_needs_review"
  | "missing_required_approval"
  | "review_rejected"
  | "review_blocked"
  | "regeneration_requested";

export interface CommitGateBlocker {
  readonly type: CommitGateBlockerType;
  readonly reason: string;
  readonly facts: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly approvalScope?: string;
}

export type CommitGateRequiredAction =
  | "resolve_conflict"
  | "rebase"
  | "reconcile_version"
  | "fix_invariant"
  | "fix_validation"
  | "obtain_review_decision"
  | "revise_revision"
  | "regenerate";

export interface CommitGateResult {
  readonly allowed: boolean;
  readonly blockers: readonly CommitGateBlocker[];
  readonly requiredActions: readonly CommitGateRequiredAction[];
}

export type CommitGateApprovalState =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected"
  | "blocked"
  | "regeneration_requested";

export type CommitGateReviewDecision =
  | "approve"
  | "reject"
  | "request_regeneration"
  | "blocked";

export type CommitGateDecisionMaker = "human" | "policy";

export type CommitGateApprovalRequirementLevel =
  | "not_required"
  | "policy"
  | "human";

export type CommitGateDecisionProvenance =
  | {
      readonly kind: "human";
      readonly actorId: string;
    }
  | {
      readonly kind: "policy";
      readonly actorId: string;
      readonly policyVersion: string;
      readonly decisionRule: string;
    }
  | {
      readonly kind: "legacy";
    };

export interface CommitGateApprovalRequirementFact {
  readonly requirement: string;
  readonly requirementLevel: CommitGateApprovalRequirementLevel;
}

export interface CommitGateReviewFact {
  readonly id: string;
  readonly decision: CommitGateReviewDecision;
  readonly decidedBy: CommitGateDecisionMaker;
  readonly decidedAt: Date;
  readonly evidenceReferences: readonly string[];
  readonly provenance?: CommitGateDecisionProvenance;
  readonly policyVersion?: string;
  readonly decisionRule?: string;
  readonly requirement?: string;
  readonly requirementLevel?: CommitGateApprovalRequirementLevel;
}

export interface CommitGateApprovalScopeFact {
  readonly key: string;
  readonly requirement?: string;
  readonly requirementLevel?: CommitGateApprovalRequirementLevel;
  readonly requirements?: readonly CommitGateApprovalRequirementFact[];
  readonly requiredApproval?: boolean;
  readonly state?: CommitGateApprovalState;
  readonly stateProvenance?: CommitGateDecisionProvenance;
  readonly decisions?: readonly CommitGateReviewFact[];
}

export type CommitGateInvariantViolation =
  | string
  | {
      readonly message: string;
      readonly evidenceReferences?: readonly string[];
    };

export interface CommitGateInput {
  readonly unresolvedConflict: boolean;
  readonly unresolvedConflictEvidenceReferences?: readonly string[];
  readonly stale: boolean;
  readonly staleEvidenceReferences?: readonly string[];
  readonly occConflict: boolean;
  readonly occConflictFacts?: readonly string[];
  readonly occConflictEvidenceReferences?: readonly string[];
  readonly invariantViolations: readonly CommitGateInvariantViolation[];
  readonly validationOutcome?: "pass" | "fail" | "needs_review";
  readonly validationEvidenceReferences?: readonly string[];
  readonly requiredApproval: boolean;
  readonly approvalState: CommitGateApprovalState;
  readonly approvalStateProvenance?: CommitGateDecisionProvenance;
  readonly approvalScopes?: readonly CommitGateApprovalScopeFact[];
}

interface EffectiveReview {
  readonly scopeKey: string;
  readonly requirement: string;
  readonly requirementLevel?: CommitGateApprovalRequirementLevel;
  readonly requiredApproval: boolean;
  readonly state: CommitGateApprovalState;
  readonly decision?: CommitGateReviewFact;
  readonly provenance?: CommitGateDecisionProvenance;
  readonly humanApproved: boolean;
  readonly provenanceApproved: boolean;
}

const requirementRank: Readonly<Record<CommitGateApprovalRequirementLevel, number>> = {
  not_required: 0,
  policy: 1,
  human: 2,
};

function freezeBlocker(input: CommitGateBlocker): CommitGateBlocker {
  return Object.freeze({
    type: input.type,
    reason: input.reason,
    facts: Object.freeze([...input.facts]),
    evidenceReferences: Object.freeze([...input.evidenceReferences]),
    ...(input.approvalScope === undefined ? {} : { approvalScope: input.approvalScope }),
  });
}

function makeBlocker(
  type: CommitGateBlockerType,
  reason: string,
  facts: readonly string[],
  evidenceReferences: readonly string[] = [],
  approvalScope?: string,
): CommitGateBlocker {
  return freezeBlocker({
    type,
    reason,
    facts,
    evidenceReferences: [...new Set(evidenceReferences)],
    ...(approvalScope === undefined ? {} : { approvalScope }),
  });
}

function invariantViolationFact(violation: CommitGateInvariantViolation): {
  readonly fact: string;
  readonly reason: string;
  readonly evidenceReferences: readonly string[];
} {
  if (typeof violation === "string") {
    return {
      fact: `targetInvariantViolation=${violation}`,
      reason: violation,
      evidenceReferences: [],
    };
  }
  return {
    fact: `targetInvariantViolation=${violation.message}`,
    reason: violation.message,
    evidenceReferences: violation.evidenceReferences ?? [],
  };
}

function stateForDecision(decision: CommitGateReviewDecision): CommitGateApprovalState {
  if (decision === "approve") return "approved";
  if (decision === "reject") return "rejected";
  if (decision === "request_regeneration") return "regeneration_requested";
  return "blocked";
}

function compareReviewFacts(left: CommitGateReviewFact, right: CommitGateReviewFact): number {
  const byDate = left.decidedAt.getTime() - right.decidedAt.getTime();
  return byDate !== 0 ? byDate : left.id.localeCompare(right.id);
}

function isHumanProvenance(provenance: CommitGateDecisionProvenance | undefined): boolean {
  return provenance?.kind === "human" && provenance.actorId.trim().length > 0;
}

function isProvenanceApproved(provenance: CommitGateDecisionProvenance | undefined): boolean {
  return provenance !== undefined && provenance.kind !== "legacy";
}

function strictestRequirement(
  scope: CommitGateApprovalScopeFact,
): CommitGateApprovalRequirementFact | undefined {
  const rules = scope.requirements?.length
    ? scope.requirements
    : scope.requirementLevel === undefined
      ? []
      : [{
          requirement: scope.requirement ?? "",
          requirementLevel: scope.requirementLevel,
        }];
  return [...rules].sort((left, right) => {
    const byLevel = requirementRank[right.requirementLevel] - requirementRank[left.requirementLevel];
    return byLevel !== 0 ? byLevel : left.requirement.localeCompare(right.requirement);
  })[0];
}

function effectiveReview(
  scope: CommitGateApprovalScopeFact,
  globalRequired: boolean,
  suppliedDecision: CommitGateReviewFact | undefined,
  suppliedState: CommitGateApprovalState,
  suppliedProvenance: CommitGateDecisionProvenance | undefined,
): EffectiveReview {
  const requirement = strictestRequirement(scope);
  const requiredApproval =
    requirement === undefined
      ? scope.requiredApproval ?? globalRequired
      : requirement.requirementLevel !== "not_required";
  const state = suppliedDecision
    ? stateForDecision(suppliedDecision.decision)
    : suppliedState;
  const provenance = suppliedDecision?.provenance ?? suppliedProvenance;
  return {
    scopeKey: scope.key,
    requirement: requirement?.requirement ?? scope.requirement ?? "",
    ...(requirement?.requirementLevel === undefined && scope.requirementLevel === undefined
      ? {}
      : { requirementLevel: requirement?.requirementLevel ?? scope.requirementLevel }),
    requiredApproval,
    state,
    ...(suppliedDecision === undefined ? {} : { decision: suppliedDecision }),
    ...(provenance === undefined ? {} : { provenance }),
    humanApproved:
      state === "approved" &&
      (suppliedDecision?.decision ?? "approve") === "approve" &&
      isHumanProvenance(provenance),
    provenanceApproved:
      state === "approved" &&
      (suppliedDecision?.decision ?? "approve") === "approve" &&
      isProvenanceApproved(provenance),
  };
}

function effectiveReviews(
  scope: CommitGateApprovalScopeFact,
  globalRequired: boolean,
): EffectiveReview[] {
  const decisions = scope.decisions ?? [];
  const effective = [...decisions].sort(compareReviewFacts).at(-1);
  return [
    effectiveReview(
      scope,
      globalRequired,
      effective,
      scope.state ?? "pending",
      scope.stateProvenance,
    ),
  ];
}

function reviewFacts(review: EffectiveReview): readonly string[] {
  return [
    `approval:${review.scopeKey}=${review.state}`,
    ...(review.requirement ? [`requirement=${review.requirement}`] : []),
    ...(review.requirementLevel ? [`requirementLevel=${review.requirementLevel}`] : []),
    ...(review.decision
      ? [
          `decisionId=${review.decision.id}`,
          `decidedBy=${review.decision.decidedBy}`,
          `decidedAt=${review.decision.decidedAt.toISOString()}`,
          ...(review.provenance?.kind ? [`provenance=${review.provenance.kind}`] : []),
          ...(review.provenance?.kind === "human" ? [`actorId=${review.provenance.actorId}`] : []),
          ...(review.decision.policyVersion ? [`policyVersion=${review.decision.policyVersion}`] : []),
          ...(review.decision.decisionRule ? [`decisionRule=${review.decision.decisionRule}`] : []),
        ]
      : []),
  ];
}

function reviewEvidence(review: EffectiveReview): readonly string[] {
  return review.decision
    ? [review.decision.id, ...review.decision.evidenceReferences]
    : [];
}

function approvalIsSatisfied(review: EffectiveReview): boolean {
  if (review.state !== "approved") return false;
  if (review.requirementLevel === "human") return review.humanApproved;
  if (review.requirementLevel === "policy") return review.provenanceApproved;
  return true;
}

function approvalBlocker(review: EffectiveReview): CommitGateBlocker | undefined {
  const facts = reviewFacts(review);
  const evidence = reviewEvidence(review);
  if (review.state === "not_required") return undefined;
  if (review.state === "rejected") {
    return makeBlocker(
      "review_rejected",
      `Approval scope ${review.scopeKey} was rejected`,
      facts,
      evidence,
      review.scopeKey,
    );
  }
  if (review.state === "blocked") {
    return makeBlocker(
      "review_blocked",
      `Approval scope ${review.scopeKey} is blocked`,
      facts,
      evidence,
      review.scopeKey,
    );
  }
  if (review.state === "regeneration_requested") {
    return makeBlocker(
      "regeneration_requested",
      `Approval scope ${review.scopeKey} requests regeneration`,
      facts,
      evidence,
      review.scopeKey,
    );
  }
  if (!review.requiredApproval || approvalIsSatisfied(review)) return undefined;
  return makeBlocker(
    "missing_required_approval",
    `Approval scope ${review.scopeKey} has no effective approval`,
    facts,
    evidence,
    review.scopeKey,
  );
}
export function evaluateCommitGate(input: CommitGateInput): CommitGateResult {
  const blockers: CommitGateBlocker[] = [];
  const actionSet = new Set<CommitGateRequiredAction>();

  if (input.unresolvedConflict) {
    blockers.push(makeBlocker(
      "invalid_revision",
      "The current revision has an unresolved conflict",
      ["unresolvedConflict=true"],
      input.unresolvedConflictEvidenceReferences ?? [],
    ));
    actionSet.add("resolve_conflict");
  }

  if (input.stale) {
    blockers.push(makeBlocker(
      "stale_revision",
      "The current revision facts report a stale revision",
      ["stale=true"],
      input.staleEvidenceReferences ?? [],
    ));
    actionSet.add("rebase");
  }

  if (input.occConflict) {
    blockers.push(makeBlocker(
      "occ_conflict",
      "One or more based-on version references no longer match current object revisions",
      ["occConflict=true", ...(input.occConflictFacts ?? [])],
      input.occConflictEvidenceReferences ?? [],
    ));
    actionSet.add("reconcile_version");
  }

  for (const violation of input.invariantViolations) {
    const normalized = invariantViolationFact(violation);
    blockers.push(makeBlocker(
      "invariant_violation",
      normalized.reason,
      [normalized.fact],
      normalized.evidenceReferences,
    ));
    actionSet.add("fix_invariant");
  }

  const effective = input.approvalScopes?.length
    ? input.approvalScopes.flatMap(scope => effectiveReviews(scope, input.requiredApproval))
    : [
        effectiveReview(
          {
            key: "required-approval",
            state: input.approvalState,
            ...(input.approvalStateProvenance === undefined
              ? {}
              : { stateProvenance: input.approvalStateProvenance }),
          },
          input.requiredApproval,
          undefined,
          input.approvalState,
          input.approvalStateProvenance,
        ),
      ];

  const mandatoryNeedsReview =
    input.validationOutcome === "needs_review" &&
    !effective.some(review => review.humanApproved);

  if (input.validationOutcome === "fail") {
    blockers.push(makeBlocker(
      "mandatory_validation_failed",
      "Mandatory validation reported a failed outcome",
      ["validationOutcome=fail"],
      input.validationEvidenceReferences ?? [],
    ));
    actionSet.add("fix_validation");
  } else if (mandatoryNeedsReview) {
    blockers.push(makeBlocker(
      "mandatory_needs_review",
      "Mandatory validation requires a human approval decision",
      ["validationOutcome=needs_review", "mandatoryNeedsReviewHumanFloor=true"],
      input.validationEvidenceReferences ?? [],
    ));
    actionSet.add("obtain_review_decision");
  }

  for (const review of effective) {
    const blocker = approvalBlocker(review);
    if (!blocker) continue;
    blockers.push(blocker);
    if (blocker.type === "review_rejected" || blocker.type === "review_blocked") {
      actionSet.add("revise_revision");
    } else if (blocker.type === "regeneration_requested") {
      actionSet.add("regenerate");
    } else {
      actionSet.add("obtain_review_decision");
    }
  }

  const actionOrder: readonly CommitGateRequiredAction[] = [
    "resolve_conflict",
    "rebase",
    "reconcile_version",
    "fix_invariant",
    "fix_validation",
    "revise_revision",
    "regenerate",
    "obtain_review_decision",
  ];

  return Object.freeze({
    allowed: blockers.length === 0,
    blockers: Object.freeze([...blockers]),
    requiredActions: Object.freeze(actionOrder.filter(action => actionSet.has(action))),
  });
}