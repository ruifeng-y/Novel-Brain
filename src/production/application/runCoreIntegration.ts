import type { Candidate, CandidateAtomicChange } from "../domain/candidate";
import { createChange, type Change, type TargetAddress } from "../domain/change";
import {
  createChangeSetRevision,
  type ChangeSetRevision,
} from "../domain/changeSetRevision";
import type { ChangeSet } from "../domain/changeSet";
import { replaceChangeSetChanges } from "../domain/changeSet";
import type { ReviewDecision, ReviewDecisionMaker } from "../domain/reviewDecision";
import { createReviewDecision } from "../domain/reviewDecision";
import type { ValidationRun } from "../domain/validationRun";
import type { GenerationTask } from "../domain/generationTask";
import type { ExecutionAttempt } from "../domain/executionAttempt";
import { candidateSourceReference } from "../domain/executionAttempt";
import type { ExecutionAttemptPersistence } from "./executionAttemptPersistence";
import { recordExecutionAttemptFromRuntimeResult } from "./executionAttemptService";
import { validateCandidate } from "./validateCandidate";
import type { Scene } from "../../manuscript/domain/scene";
import type { RuntimeRequest, RuntimeResult } from "../runtime/runtimeAdapter";
import {
  commitChangeSetRevision,
  type CommitChangeSetRevisionCurrentRevisionFacts,
  type CommitChangeSetRevisionTransaction,
  type CommitChangeSetRevisionApprovalRequirement,
} from "../../safety/application/commitChangeSetRevision";
import type { CommitGateInvariantViolation } from "../../safety/domain/commitGate";

export interface RunCoreApprovalInput {
  readonly idPrefix: string;
  readonly decidedBy: ReviewDecisionMaker;
  readonly actorId: string;
  readonly reason: string;
  readonly evidenceReferences: readonly string[];
  readonly policyVersion?: string;
  readonly decisionRule?: string;
}

export interface PrepareRunCoreExecutionInput {
  readonly persistence: ExecutionAttemptPersistence;
  readonly executionKey: string;
  readonly attemptOrdinal?: number;
  readonly relation: "initial" | "retry" | "fallback";
  readonly generationTask: GenerationTask;
  readonly routingDecision: {
    readonly routingDecisionId: string;
    readonly resolverVersion: string;
    readonly routingPolicyVersion: string;
    readonly provider: string;
    readonly model: string;
    readonly reason: string;
    readonly fallbackFromAttemptId?: string;
  };
  readonly runtimeRequest: RuntimeRequest;
  readonly runtimeResult: RuntimeResult;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly candidate: Candidate;
  readonly scene?: Scene;
  readonly mustPreserve?: readonly string[];
  readonly changeSet: ChangeSet;
  readonly parentRevision: ChangeSetRevision;
  readonly changeSetRevisionId: string;
  readonly validationId: string;
  readonly planVersionId: string;
  readonly approval: RunCoreApprovalInput;
}

export interface RunCoreExecutionPreparation {
  readonly generationTask: GenerationTask;
  readonly attempt: ExecutionAttempt;
  readonly candidate: Candidate;
  readonly changeSet: ChangeSet;
  readonly changeSetRevision: ChangeSetRevision;
  readonly validationRun: ValidationRun;
  readonly reviewDecisions: readonly ReviewDecision[];
}

function atomicChanges(candidate: Candidate): readonly CandidateAtomicChange[] {
  return candidate.change.type === "composite" ? candidate.change.changes : [candidate.change];
}

function targetAddress(change: CandidateAtomicChange): TargetAddress {
  if (change.type === "text" || change.type === "local_text") {
    return {
      targetType: "manuscript",
      objectId: change.sceneId,
      ...(change.type === "local_text" ? { subAddress: change.targetSpan.anchorId } : {}),
    };
  }
  if (change.type === "canonical_fact") {
    return { targetType: "canonical_fact", objectId: change.canonicalFactId };
  }
  return { targetType: "story_state", objectId: change.stateRecordId };
}

function payloadFor(change: CandidateAtomicChange): Readonly<Record<string, unknown>> {
  if (change.type === "text") return { text: change.text };
  if (change.type === "local_text") {
    return { targetSpan: change.targetSpan, replacement: change.replacement };
  }
  return { ...change.content };
}

export function createCandidateChanges(candidate: Candidate): readonly Change[] {
  return atomicChanges(candidate).map((change, index) =>
    createChange({
      id: `${candidate.id}:change:${index + 1}`,
      sourceType: "candidate",
      sourceReference: candidateSourceReference(candidate),
      targetAddress: targetAddress(change),
      payload: payloadFor(change),
      basedOnVersionSet: candidate.basedOnVersionSet,
    }),
  );
}

function requirementDomainFor(targetType: TargetAddress["targetType"]): "canon" | "plan" | "structure" | "manuscript" | "story_state" {
  if (targetType === "canonical_fact") return "canon";
  if (targetType === "plan") return "plan";
  if (targetType === "structure") return "structure";
  if (targetType === "manuscript") return "manuscript";
  return "story_state";
}

function approvalScopeFor(change: Change): {
  requirementDomain: "canon" | "plan" | "structure" | "manuscript" | "story_state";
  targetType: TargetAddress["targetType"];
  objectId: string;
  subAddress?: string;
} {
  return {
    requirementDomain: requirementDomainFor(change.targetAddress.targetType),
    targetType: change.targetAddress.targetType,
    objectId: change.targetAddress.objectId,
    ...(change.targetAddress.subAddress === undefined
      ? {}
      : { subAddress: change.targetAddress.subAddress }),
  };
}

export async function prepareRunCoreExecution(
  input: PrepareRunCoreExecutionInput,
): Promise<RunCoreExecutionPreparation> {
  const attempt = await recordExecutionAttemptFromRuntimeResult({
    persistence: input.persistence,
    executionKey: input.executionKey,
    ...(input.attemptOrdinal === undefined ? {} : { attemptOrdinal: input.attemptOrdinal }),
    relation: input.relation,
    generationTask: input.generationTask,
    routingDecision: input.routingDecision,
    runtimeRequest: input.runtimeRequest,
    runtimeResult: input.runtimeResult,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    candidate: input.candidate,
  });

  const changes = createCandidateChanges(input.candidate);
  const changeSetRevision = createChangeSetRevision({
    parent: input.parentRevision,
    revisionId: input.changeSetRevisionId,
    trigger: { type: "edit", references: [attempt.id, input.candidate.id] },
    changes,
    createdAt: input.completedAt,
  });
  const changeSet = replaceChangeSetChanges({
    changeSet: input.changeSet,
    changes,
    revisionId: input.changeSetRevisionId,
    updatedAt: input.completedAt,
  });
  const validationRun = validateCandidate({
    validationId: input.validationId,
    changeSetRevisionId: changeSetRevision.revisionId,
    planVersionId: input.planVersionId,
    candidate: input.candidate,
    ...(input.scene === undefined ? {} : { scene: input.scene }),
    mustPreserve: input.mustPreserve ?? [],
    createdAt: input.completedAt,
  }).run;
  const reviewDecisions = changes.map((change, index) =>
    createReviewDecision({
      id: `${input.approval.idPrefix}:${index + 1}`,
      changeSetRevisionId: changeSetRevision.revisionId,
      approvalScope: approvalScopeFor(change),
      decision: "approve",
      decidedBy: input.approval.decidedBy,
      actorId: input.approval.actorId,
      reason: input.approval.reason,
      evidenceReferences: input.approval.evidenceReferences,
      ...(input.approval.policyVersion === undefined
        ? {}
        : { policyVersion: input.approval.policyVersion }),
      ...(input.approval.decisionRule === undefined
        ? {}
        : { decisionRule: input.approval.decisionRule }),
      createdAt: input.completedAt,
    }),
  );

  return {
    generationTask: input.generationTask,
    attempt,
    candidate: input.candidate,
    changeSet,
    changeSetRevision,
    validationRun,
    reviewDecisions,
  };
}

export async function commitRunCoreExecution(input: {
  readonly transaction: CommitChangeSetRevisionTransaction;
  readonly preparation: RunCoreExecutionPreparation;
  readonly commitId: string;
  readonly currentRevisionFacts: CommitChangeSetRevisionCurrentRevisionFacts;
  readonly requiredApproval?: boolean;
  readonly approvalScopeRequirements?: readonly CommitChangeSetRevisionApprovalRequirement[];
  readonly targetInvariantViolations?: readonly CommitGateInvariantViolation[];
  readonly now: Date;
}) {
  return commitChangeSetRevision({
    transaction: input.transaction,
    input: {
      commitId: input.commitId,
      changeSetRevision: input.preparation.changeSetRevision,
      validationRuns: [input.preparation.validationRun],
      reviewDecisions: input.preparation.reviewDecisions,
      currentRevisionFacts: input.currentRevisionFacts,
      targetInvariantViolations: input.targetInvariantViolations ?? [],
      requiredApproval: input.requiredApproval ?? true,
      ...(input.approvalScopeRequirements === undefined
        ? {}
        : { approvalScopeRequirements: input.approvalScopeRequirements }),
      now: input.now,
    },
  });
}
