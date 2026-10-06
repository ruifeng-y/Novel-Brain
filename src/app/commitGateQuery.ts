import type { RepositoryReadPort } from "../shared/application/repository";
import type { ValidationRun } from "../production/domain/validationRun";
import {
  changeSetRevisionOf,
  type ChangeSetRevisionRepository,
} from "../production/application/changeSetPersistence";
import {
  aggregateApprovalState,
  approvalScopeFacts,
  validationOutcomeOf,
  type CommitChangeSetRevisionApprovalRequirement,
  type CommitChangeSetRevisionCurrentRevisionFacts,
} from "../safety/application/commitChangeSetRevision";
import {
  evaluateCommitGate,
  type CommitGateBlocker,
  type CommitGateBlockerType,
  type CommitGateInvariantViolation,
  type CommitGateRequiredAction,
} from "../safety/domain/commitGate";
import { ValidationBindingError } from "./validationRunService";
import { reviewDecisionOf, type ReviewDecisionStore } from "./reviewDecisionService";

/** One of the five gate conditions, reported on its own and never collapsed. */
export interface CommitGateCondition {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface CommitGatePresentation {
  readonly revisionValidity: CommitGateCondition;
  readonly concurrency: CommitGateCondition;
  readonly invariant: CommitGateCondition;
  readonly validation: CommitGateCondition;
  readonly approval: CommitGateCondition;
  readonly allowed: boolean;
  readonly blockers: readonly CommitGateBlocker[];
  readonly requiredActions: readonly CommitGateRequiredAction[];
}

/**
 * The five conditions group the existing blocker types. No blocker type is
 * invented here and none is reported under two conditions.
 */
const conditionBlockerTypes: Readonly<Record<keyof CommitGateConditions, readonly CommitGateBlockerType[]>> = {
  revisionValidity: ["invalid_revision", "stale_revision"],
  concurrency: ["occ_conflict"],
  invariant: ["invariant_violation"],
  validation: ["mandatory_validation_failed", "mandatory_needs_review"],
  approval: [
    "missing_required_approval",
    "review_rejected",
    "review_blocked",
    "regeneration_requested",
  ],
};

type CommitGateConditions = Pick<
  CommitGatePresentation,
  "revisionValidity" | "concurrency" | "invariant" | "validation" | "approval"
>;

function conditionOf(
  blockers: readonly CommitGateBlocker[],
  types: readonly CommitGateBlockerType[],
): CommitGateCondition {
  const matched = blockers.filter(blocker => types.includes(blocker.type));
  if (matched.length === 0) return Object.freeze({ ok: true });
  return Object.freeze({
    ok: false,
    reason: matched.map(blocker => blocker.reason).join("; "),
  });
}

function present(
  allowed: boolean,
  blockers: readonly CommitGateBlocker[],
  requiredActions: readonly CommitGateRequiredAction[],
) {
  return Object.freeze({
    revisionValidity: conditionOf(blockers, conditionBlockerTypes.revisionValidity),
    concurrency: conditionOf(blockers, conditionBlockerTypes.concurrency),
    invariant: conditionOf(blockers, conditionBlockerTypes.invariant),
    validation: conditionOf(blockers, conditionBlockerTypes.validation),
    approval: conditionOf(blockers, conditionBlockerTypes.approval),
    // Passed through from the single evaluation: this query never re-derives
    // the gate's own verdict, it only presents it.
    allowed,
    blockers: Object.freeze([...blockers]),
    requiredActions: Object.freeze([...requiredActions]),
  } satisfies CommitGatePresentation);
}

export interface EvaluateCommitGateInput {
  readonly changeSetId: string;
  readonly revisionId: string;
  /**
   * The validation runs the author intends to commit with. Each must exist and
   * belong to the addressed revision: a mismatch is a conflict, never a silent
   * substitution. Omitted means no validation evidence was supplied, which the
   * frozen outcome rule reads as a pass over an empty run set.
   */
  readonly validationRunIds?: readonly string[];
  readonly currentRevisionFacts: CommitChangeSetRevisionCurrentRevisionFacts;
  readonly occConflict?: boolean;
  readonly occConflictFacts?: readonly string[];
  readonly occConflictEvidenceReferences?: readonly string[];
  readonly targetInvariantViolations: readonly CommitGateInvariantViolation[];
  readonly approvalRequirements?: readonly CommitChangeSetRevisionApprovalRequirement[];
}

export interface CommitGateQuery {
  evaluate(input: EvaluateCommitGateInput): Promise<CommitGatePresentation | undefined>;
}

/**
 * The gate is evaluated by `evaluateCommitGate` and by nothing else: this query
 * assembles the facts and presents the result, so a preview and a commit over
 * the same artefacts report the same gate.
 */
export function createCommitGateQuery(dependencies: {
  readonly changeSets: ChangeSetRevisionRepository;
  readonly validations: RepositoryReadPort<ValidationRun>;
  readonly reviews: ReviewDecisionStore;
}): CommitGateQuery {
  return {
    async evaluate(input) {
      const stored = await dependencies.changeSets.getRevision(input.changeSetId, input.revisionId);
      if (!stored) return undefined;
      const revision = changeSetRevisionOf(stored);

      const runs: ValidationRun[] = [];
      for (const validationRunId of input.validationRunIds ?? []) {
        const run = await dependencies.validations.findById(validationRunId);
        if (!run || run.changeSetRevisionId !== revision.revisionId) {
          throw new ValidationBindingError(
            `Validation run ${validationRunId} does not belong to revision ${revision.revisionId}`,
          );
        }
        runs.push(run);
      }

      const decisions = (await dependencies.reviews.listByNovel(revision.novelId))
        .filter(decision => decision.changeSetRevisionId === revision.revisionId)
        .map(reviewDecisionOf);

      const requirements = input.approvalRequirements ?? [];
      const requiredApproval = requirements.some(
        requirement => requirement.requirementLevel !== "not_required",
      );

      const gate = evaluateCommitGate({
        unresolvedConflict: input.currentRevisionFacts.unresolvedConflict,
        unresolvedConflictEvidenceReferences:
          input.currentRevisionFacts.unresolvedConflictEvidenceReferences,
        stale: input.currentRevisionFacts.stale,
        staleEvidenceReferences: input.currentRevisionFacts.staleEvidenceReferences,
        occConflict: input.occConflict ?? false,
        occConflictFacts: input.occConflictFacts,
        occConflictEvidenceReferences: input.occConflictEvidenceReferences,
        invariantViolations: input.targetInvariantViolations,
        validationOutcome: validationOutcomeOf(runs),
        validationEvidenceReferences: runs.map(run => run.id),
        requiredApproval,
        approvalState: requiredApproval ? aggregateApprovalState(decisions) : "not_required",
        approvalScopes: approvalScopeFacts(revision, decisions, requirements),
      });

      return present(gate.allowed, gate.blockers, gate.requiredActions);
    },
  };
}
