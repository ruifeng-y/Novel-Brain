import type { Repository, RevisionedRepository } from "../../shared/application/repository";
import {
  createVersionReference,
  mergeVersionSets,
  type VersionReference,
  type VersionSet,
} from "../../shared/domain/versioning";
import {
  targetAddressKey,
  type TargetAddress,
  type TargetType,
} from "../../production/domain/change";
import type { ChangeSetRevision } from "../../production/domain/changeSetRevision";
import type { ValidationRun } from "../../production/domain/validationRun";
import {
  approvalScopeKey,
  type ApprovalScope,
  type ReviewDecision,
} from "../../production/domain/reviewDecision";
import {
  commitSceneText,
  type Scene,
  type SceneSpanAnchorInput,
} from "../../manuscript/domain/scene";
import {
  rebaseSpanAnchors,
  replaceTargetSpan,
  type TargetSpan,
} from "../../manuscript/domain/targetSpan";
import type { CanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import { replaceCanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../narrative/state/domain/stateRecord";
import { replaceStateRecord } from "../../narrative/state/domain/stateRecord";
import {
  createNarrativeCommit,
  markNarrativeCommitCommitted,
  markNarrativeCommitFailed,
  type NarrativeCommit,
} from "../domain/narrativeCommit";
import type { DomainEvent } from "../domain/domainEvent";
import type { EventStore } from "../infrastructure/eventStore";
import {
  evaluateCommitGate,
  type CommitGateApprovalScopeFact,
  type CommitGateApprovalState,
  type CommitGateInvariantViolation,
  type CommitGateResult,
  type CommitGateReviewDecision,
  type CommitGateReviewFact,
} from "../domain/commitGate";
import { createSceneCommittedEvent } from "../../manuscript/domain/manuscriptEvents";
import {
  createCanonicalFactChangedEvent,
  createCharacterStateChangedEvent,
  createPlotStateChangedEvent,
  createWorldStateChangedEvent,
} from "../../narrative/state/domain/narrativeStateEvents";
import { createNarrativeCommitRecordedEvent } from "../../production/domain/aiProductionEvents";

export interface CommitSceneReadPort {
  findById(id: string): Promise<Scene | undefined>;
  getRevision(id: string, revisionId: string): Promise<Scene | undefined>;
}

export interface CommitCanonicalFactReadPort {
  findById(id: string): Promise<CanonicalFact | undefined>;
  getRevision(id: string, revisionId: string): Promise<CanonicalFact | undefined>;
}

export interface CommitStateRecordReadPort {
  findById(id: string): Promise<StateRecord | undefined>;
  getRevision(id: string, revisionId: string): Promise<StateRecord | undefined>;
}

/**
 * Write ports are deliberately CAS/atomic-only. Implementations must compare
 * `expectedRevisionId` at write time, reserve NarrativeCommit identity and
 * `changeSetRevisionId` uniqueness atomically, and expose no naked save/update.
 */
export interface CommitChangeSetRevisionRepositories {
  readonly scenes: CommitSceneReadPort & {
    saveSceneIfCurrent(expectedRevisionId: string, scene: Scene): Promise<void>;
  };
  readonly canonicalFacts: CommitCanonicalFactReadPort & {
    saveCanonicalFactIfCurrent(expectedRevisionId: string, fact: CanonicalFact): Promise<void>;
  };
  readonly stateRecords: CommitStateRecordReadPort & {
    saveStateRecordIfCurrent(expectedRevisionId: string, record: StateRecord): Promise<void>;
  };
  readonly narrativeCommits: {
    findById(id: string): Promise<NarrativeCommit | undefined>;
    listByNovel(novelId: string): Promise<readonly NarrativeCommit[]>;
    saveNarrativeCommitIfAbsent(commit: NarrativeCommit): Promise<void>;
    saveNarrativeCommitIfCurrent(
      expectedStatus: NarrativeCommit["status"],
      commit: NarrativeCommit,
    ): Promise<void>;
  };
}

/** Event writes must reserve every eventId atomically and reject duplicates. */
export interface CommitChangeSetRevisionEventStore {
  listByNovel(novelId: string): Promise<readonly DomainEvent[]>;
  appendEventsIfAbsent(events: readonly DomainEvent[]): Promise<void>;
}

export interface CommitChangeSetRevisionTransactionWork {
  readonly repositories: CommitChangeSetRevisionRepositories;
  readonly eventStore: CommitChangeSetRevisionEventStore;
}

/**
 * Commit-specific transaction boundary. Implementations must bind every
 * repository and event-store read/write in `operation` to one atomic unit.
 */
export interface CommitChangeSetRevisionTransaction {
  run<T>(
    operation: (work: CommitChangeSetRevisionTransactionWork) => Promise<T>,
  ): Promise<T>;
}

export interface CommitChangeSetRevisionCurrentRevisionFacts {
  readonly unresolvedConflict: boolean;
  readonly unresolvedConflictEvidenceReferences?: readonly string[];
  readonly stale: boolean;
  readonly staleEvidenceReferences?: readonly string[];
}

export type CommitChangeSetRevisionApprovalRequirementLevel =
  | "not_required"
  | "policy"
  | "human";

export interface CommitChangeSetRevisionApprovalRequirement {
  readonly approvalScope: ApprovalScope;
  readonly requirement: string;
  readonly requirementLevel: CommitChangeSetRevisionApprovalRequirementLevel;
}

export interface CommitChangeSetRevisionInput {
  readonly commitId: string;
  readonly changeSetRevision: ChangeSetRevision;
  readonly validationRuns: readonly ValidationRun[];
  readonly reviewDecisions: readonly ReviewDecision[];
  readonly currentRevisionFacts: CommitChangeSetRevisionCurrentRevisionFacts;
  readonly targetInvariantViolations: readonly CommitGateInvariantViolation[];
  readonly requiredApproval: boolean;
  readonly approvalScopeRequirements?: readonly CommitChangeSetRevisionApprovalRequirement[];
  readonly now: Date;
}

export class CommitGateBlockedError extends Error {
  constructor(public readonly gate: CommitGateResult) {
    super(gate.blockers.map(blocker => blocker.type).join(","));
    this.name = "CommitGateBlockedError";
  }
}

class StaleDependencyError extends Error {
  constructor(public readonly reference: string) {
    super(`Stale dependency: ${reference}`);
    this.name = "StaleDependencyError";
  }
}

type SupportedTargetType = "manuscript" | "canonical_fact" | "story_state";
type SupportedAggregateType = "Scene" | "CanonicalFact" | "StateRecord";

type TargetObject =
  | { readonly kind: "manuscript"; readonly value: Scene }
  | { readonly kind: "canonical_fact"; readonly value: CanonicalFact }
  | { readonly kind: "story_state"; readonly value: StateRecord };

type TargetEntity = Scene | CanonicalFact | StateRecord;

interface PreparedTarget {
  readonly kind: "manuscript" | "canonical_fact" | "story_state";
  readonly original: TargetEntity;
  readonly next: TargetEntity;
  readonly events: readonly DomainEvent[];
  readonly resultEntries: readonly (readonly [string, VersionReference])[];
}

interface InvariantInspection {
  readonly violations: readonly CommitGateInvariantViolation[];
  readonly occConflictFacts: readonly string[];
  readonly occConflictEvidenceReferences: readonly string[];
  readonly targets: ReadonlyMap<string, TargetObject>;
}

function isSupportedTargetType(value: TargetType): value is SupportedTargetType {
  return value === "manuscript" || value === "canonical_fact" || value === "story_state";
}

function aggregateTypeForTarget(targetType: SupportedTargetType): SupportedAggregateType {
  if (targetType === "manuscript") return "Scene";
  if (targetType === "canonical_fact") return "CanonicalFact";
  return "StateRecord";
}

function underlyingTargetKey(address: TargetAddress): string {
  return `${address.targetType}:${address.objectId}`;
}


function scopeMatchesTarget(scope: ApprovalScope, address: TargetAddress): boolean {
  return (
    scope.targetType === address.targetType &&
    scope.objectId === address.objectId &&
    scope.subAddress === address.subAddress
  );
}

/**
 * Shared with the commit gate query so a preview and a commit derive the same
 * facts from the same runs. Not a second gate evaluation: the gate itself is
 * still evaluated only by `evaluateCommitGate`.
 */
export function validationOutcomeOf(runs: readonly ValidationRun[]): "pass" | "fail" | "needs_review" {
  if (runs.some(run => run.outcome === "fail")) return "fail";
  if (runs.some(run => run.outcome === "needs_review")) return "needs_review";
  return "pass";
}

function reviewDecisionFact(decision: ReviewDecision["decision"]): CommitGateReviewDecision {
  return decision;
}

/** Shared with the commit gate query; see `validationOutcomeOf`. */
export function aggregateApprovalState(decisions: readonly ReviewDecision[]): CommitGateApprovalState {
  const effective = [...decisions].sort((left, right) => {
    const byDate = left.createdAt.getTime() - right.createdAt.getTime();
    return byDate !== 0 ? byDate : left.id.localeCompare(right.id);
  }).at(-1);
  if (!effective) return "pending";
  return reviewDecisionFact(effective.decision) === "approve"
    ? "approved"
    : reviewDecisionFact(effective.decision) === "reject"
      ? "rejected"
      : "regeneration_requested";
}

type CommitTargetReadPort =
  | CommitSceneReadPort
  | CommitCanonicalFactReadPort
  | CommitStateRecordReadPort;

function repositoryFor(
  repositories: CommitChangeSetRevisionRepositories,
  aggregateType: SupportedAggregateType,
): CommitTargetReadPort {
  if (aggregateType === "Scene") return repositories.scenes;
  if (aggregateType === "CanonicalFact") return repositories.canonicalFacts;
  return repositories.stateRecords;
}

async function findTarget(
  repositories: CommitChangeSetRevisionRepositories,
  targetType: SupportedTargetType,
  objectId: string,
): Promise<TargetObject | undefined> {
  if (targetType === "manuscript") {
    const value = await repositories.scenes.findById(objectId);
    return value ? { kind: "manuscript", value } : undefined;
  }
  if (targetType === "canonical_fact") {
    const value = await repositories.canonicalFacts.findById(objectId);
    return value ? { kind: "canonical_fact", value } : undefined;
  }
  const value = await repositories.stateRecords.findById(objectId);
  return value ? { kind: "story_state", value } : undefined;
}

async function inspectTargetInvariants(
  repositories: CommitChangeSetRevisionRepositories,
  revision: ChangeSetRevision,
): Promise<InvariantInspection> {
  const violations: CommitGateInvariantViolation[] = [];
  const occConflictFacts: string[] = [];
  const occConflictEvidenceReferences: string[] = [];
  const targets = new Map<string, TargetObject>();

  if (revision.changes.length === 0) {
    violations.push({
      message: "change set revision has no changes",
      evidenceReferences: [`changeSetRevision:${revision.revisionId}`],
    });
  }

  const seenTargets = new Set<string>();
  for (const change of revision.changes) {
    const key = targetAddressKey(change.targetAddress);
    if (seenTargets.has(key)) {
      violations.push({
        message: `duplicate target address: ${key}`,
        evidenceReferences: [change.id],
      });
    }
    seenTargets.add(key);

    const objectKey = underlyingTargetKey(change.targetAddress);
    if (!isSupportedTargetType(change.targetAddress.targetType)) {
      violations.push({
        message: `unsupported target type: ${change.targetAddress.targetType}`,
        evidenceReferences: [change.id],
      });
    } else {
      const target = await findTarget(
        repositories,
        change.targetAddress.targetType,
        change.targetAddress.objectId,
      );
      if (!target) {
        violations.push({
          message: `missing target object: ${objectKey}`,
          evidenceReferences: [change.id, objectKey],
        });
      } else {
        if (target.value.novelId !== revision.novelId) {
          violations.push({
            message: `target novel mismatch: ${objectKey}`,
            evidenceReferences: [change.id, target.value.id],
          });
        }
        targets.set(objectKey, target);
      }
    }

    for (const [name, reference] of Object.entries(change.basedOnVersionSet)) {
      const referenceLabel =
        `${change.id}:${name}:${reference.aggregateType}:${reference.objectId}@${reference.revisionId}`;
      if (
        reference.aggregateType !== "Scene" &&
        reference.aggregateType !== "CanonicalFact" &&
        reference.aggregateType !== "StateRecord"
      ) {
        violations.push({
          message: `unsupported based-on dependency type: ${referenceLabel}`,
          evidenceReferences: [change.id, name],
        });
        occConflictFacts.push(`${referenceLabel}=unsupported`);
        continue;
      }

      const repository = repositoryFor(repositories, reference.aggregateType);
      const current = await repository.findById(reference.objectId);
      const expectedEvidence = `${reference.aggregateType}:${reference.objectId}@${reference.revisionId}`;
      if (!current) {
        occConflictFacts.push(`${referenceLabel}=missing`);
        occConflictEvidenceReferences.push(expectedEvidence, `current:${reference.aggregateType}:${reference.objectId}@missing`);
        continue;
      }
      if (current.currentRevisionId !== reference.revisionId) {
        occConflictFacts.push(`${referenceLabel}=current:${current.currentRevisionId}`);
        occConflictEvidenceReferences.push(
          expectedEvidence,
          `current:${reference.aggregateType}:${reference.objectId}@${current.currentRevisionId}`,
        );
      }
    }
  }

  violations.push(
    ...inspectManuscriptComposition(revision, targets),
  );

  return {
    violations,
    occConflictFacts,
    occConflictEvidenceReferences: [...new Set(occConflictEvidenceReferences)],
    targets,
  };
}

function inspectManuscriptComposition(
  revision: ChangeSetRevision,
  targets: ReadonlyMap<string, TargetObject>,
): readonly CommitGateInvariantViolation[] {
  const violations: CommitGateInvariantViolation[] = [];
  for (const [objectKey, changes] of groupChangesByTarget(revision)) {
    const target = targets.get(objectKey);
    if (!target || target.kind !== "manuscript") continue;
    let scene = target.value;
    for (const change of changes) {
      const subAddress = change.targetAddress.subAddress;
      try {
        if (subAddress !== undefined) {
          const targetSpan = targetSpanFromPayload(change.payload);
          const replacement = change.payload.replacement;
          if (!targetSpan || typeof replacement !== "string") {
            throw new Error("targetSpan and replacement are required");
          }
          scene = commitSceneText({
            scene,
            text: replaceTargetSpan({ scene, target: targetSpan, replacement }),
            spanAnchors: rebaseSpanAnchors(scene, targetSpan, replacement),
            revisionId: scene.currentRevisionId,
            commitId: scene.lastCommitId,
            updatedAt: scene.updatedAt,
          });
        } else {
          const text = change.payload.text;
          if (typeof text !== "string") throw new Error("text is required");
          scene = commitSceneText({
            scene,
            text,
            ...(change.payload.spanAnchors && typeof change.payload.spanAnchors === "object"
              ? {
                  spanAnchors:
                    change.payload.spanAnchors as Readonly<Record<string, SceneSpanAnchorInput>>,
                }
              : {}),
            revisionId: scene.currentRevisionId,
            commitId: scene.lastCommitId,
            updatedAt: scene.updatedAt,
          });
        }
      } catch (error) {
        violations.push({
          message:
            `invalid manuscript change payload ${change.id}: ` +
            (error instanceof Error ? error.message : "unknown error"),
          evidenceReferences: [change.id, targetAddressKey(change.targetAddress)],
        });
      }
    }
  }
  return violations;
}

function inspectBindingInvariants(
  revision: ChangeSetRevision,
  validationRuns: readonly ValidationRun[],
  reviewDecisions: readonly ReviewDecision[],
): readonly CommitGateInvariantViolation[] {
  const violations: CommitGateInvariantViolation[] = [];
  if (validationRuns.length === 0) {
    violations.push({
      message: "at least one validation run is required",
      evidenceReferences: [`changeSetRevision:${revision.revisionId}`],
    });
  }
  for (const run of validationRuns) {
    if (run.changeSetRevisionId !== revision.revisionId) {
      violations.push({
        message:
          `validation run ${run.id} is bound to ${run.changeSetRevisionId}, expected ${revision.revisionId}`,
        evidenceReferences: [run.id],
      });
    }
    if (run.executionState !== "completed" || run.outcome === undefined) {
      violations.push({
        message: `validation run ${run.id} is not completed`,
        evidenceReferences: [run.id],
      });
    }
  }
  for (const decision of reviewDecisions) {
    if (decision.changeSetRevisionId !== revision.revisionId) {
      violations.push({
        message:
          `review decision ${decision.id} is bound to ${decision.changeSetRevisionId}, expected ${revision.revisionId}`,
        evidenceReferences: [decision.id],
      });
    }
  }
  if (!reviewDecisions.some(decision => decision.decision === "approve")) {
    violations.push({
      message: "NarrativeCommit binding requires an approving review decision",
      evidenceReferences: [
        `changeSetRevision:${revision.revisionId}`,
        ...reviewDecisions.map(decision => decision.id),
      ],
    });
  }
  return violations;
}

const requirementRank: Readonly<Record<CommitChangeSetRevisionApprovalRequirementLevel, number>> = {
  not_required: 0,
  policy: 1,
  human: 2,
};

function decisionFact(
  decision: ReviewDecision,
  requirement?: string,
  requirementLevel?: CommitChangeSetRevisionApprovalRequirementLevel,
): CommitGateReviewFact {
  return {
    id: decision.id,
    decision: reviewDecisionFact(decision.decision),
    decidedBy: decision.decidedBy,
    decidedAt: decision.createdAt,
    evidenceReferences: decision.evidenceReferences,
    provenance: decision.decidedBy === "human"
      ? { kind: "human", actorId: decision.actorId }
      : {
          kind: "policy",
          actorId: decision.actorId,
          policyVersion: decision.policyVersion!,
          decisionRule: decision.decisionRule!,
        },
    ...(decision.policyVersion === undefined ? {} : { policyVersion: decision.policyVersion }),
    ...(decision.decisionRule === undefined ? {} : { decisionRule: decision.decisionRule }),
    ...(requirement === undefined ? {} : { requirement }),
    ...(requirementLevel === undefined ? {} : { requirementLevel }),
  };
}

function strictestRequirement(
  requirements: readonly CommitChangeSetRevisionApprovalRequirement[],
): CommitChangeSetRevisionApprovalRequirement {
  return [...requirements].sort((left, right) => {
    const byLevel =
      requirementRank[right.requirementLevel] - requirementRank[left.requirementLevel];
    return byLevel !== 0
      ? byLevel
      : left.requirement.localeCompare(right.requirement);
  })[0]!;
}

/** Shared with the commit gate query; see `validationOutcomeOf`. */
export function approvalScopeFacts(
  revision: ChangeSetRevision,
  reviewDecisions: readonly ReviewDecision[],
  requirements: readonly CommitChangeSetRevisionApprovalRequirement[],
): readonly CommitGateApprovalScopeFact[] {
  const facts: CommitGateApprovalScopeFact[] = [];
  const requirementsByScope = new Map<string, CommitChangeSetRevisionApprovalRequirement[]>();
  for (const requirement of requirements) {
    const key = approvalScopeKey(requirement.approvalScope);
    requirementsByScope.set(key, [...(requirementsByScope.get(key) ?? []), requirement]);
  }

  for (const [key, scopeRequirements] of requirementsByScope) {
    const strictest = strictestRequirement(scopeRequirements);
    const decisions = reviewDecisions
      .filter(decision => approvalScopeKey(decision.approvalScope) === key)
      .map(decision =>
        decisionFact(decision, strictest.requirement, strictest.requirementLevel),
      );
    facts.push({
      key,
      requirement: strictest.requirement,
      requirementLevel: strictest.requirementLevel,
      requirements: scopeRequirements.map(requirement => ({
        requirement: requirement.requirement,
        requirementLevel: requirement.requirementLevel,
      })),
      requiredApproval: strictest.requirementLevel !== "not_required",
      decisions,
    });
  }

  const decidedScopeKeys = new Set<string>();
  for (const decision of reviewDecisions) {
    const key = approvalScopeKey(decision.approvalScope);
    if (requirementsByScope.has(key)) continue;
    decidedScopeKeys.add(key);
    const existing = facts.find(fact => fact.key === key);
    const fact = decisionFact(decision);
    if (existing) {
      facts.splice(facts.indexOf(existing), 1, {
        ...existing,
        decisions: [...(existing.decisions ?? []), fact],
      });
    } else {
      facts.push({
        key,
        requiredApproval: false,
        decisions: [fact],
      });
    }
  }

  for (const change of revision.changes) {
    const targetKey = `target:${targetAddressKey(change.targetAddress)}`;
    const decisionScopeExists = reviewDecisions.some(decision =>
      scopeMatchesTarget(decision.approvalScope, change.targetAddress),
    );
    const requirementScopeExists = requirements.some(requirement =>
      scopeMatchesTarget(requirement.approvalScope, change.targetAddress),
    );
    if (!decisionScopeExists && !requirementScopeExists && !facts.some(fact => fact.key === targetKey)) {
      facts.push({
        key: targetKey,
        requirementLevel: "not_required",
        requiredApproval: false,
        decisions: [],
      });
    }
  }

  return facts;
}

function assertCurrent(
  original: TargetObject,
  current: TargetObject | undefined,
  reference: string,
): void {
  if (!current || current.value.currentRevisionId !== original.value.currentRevisionId) {
    throw new StaleDependencyError(reference);
  }
}

function mergeSubAddressContent(
  content: Readonly<Record<string, unknown>>,
  subAddress: string,
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const current = content[subAddress];
  const patch = payload.content && typeof payload.content === "object"
    ? payload.content as Readonly<Record<string, unknown>>
    : payload;
  const merged = current && typeof current === "object" && !Array.isArray(current)
    ? { ...(current as Readonly<Record<string, unknown>>), ...patch }
    : patch;
  return Object.freeze({ ...content, [subAddress]: merged });
}

function targetSpanFromPayload(payload: Readonly<Record<string, unknown>>): TargetSpan | undefined {
  const value = payload.targetSpan;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const target = value as Record<string, unknown>;
  if (
    typeof target.anchorId !== "string" ||
    typeof target.text !== "string" ||
    typeof target.sourceContentHash !== "string"
  ) {
    return undefined;
  }
  return {
    anchorId: target.anchorId,
    text: target.text,
    sourceContentHash: target.sourceContentHash,
  };
}
function applyChange(
  kind: PreparedTarget["kind"],
  current: TargetEntity,
  change: ChangeSetRevision["changes"][number],
  revisionId: string,
  commitId: string,
  now: Date,
): TargetEntity {
  const subAddress = change.targetAddress.subAddress;
  if (kind === "manuscript") {
    const scene = current as Scene;
    if (subAddress !== undefined) {
      const targetSpan = targetSpanFromPayload(change.payload);
      const replacement = change.payload.replacement;
      if (!targetSpan || typeof replacement !== "string") {
        throw new Error(`Invalid manuscript subAddress payload: ${change.id}`);
      }
      return commitSceneText({
        scene,
        text: replaceTargetSpan({ scene, target: targetSpan, replacement }),
        spanAnchors: rebaseSpanAnchors(scene, targetSpan, replacement),
        revisionId,
        commitId,
        updatedAt: now,
      });
    }
    const text = change.payload.text;
    if (typeof text !== "string") {
      throw new Error(`Invalid manuscript full-text payload: ${change.id}`);
    }
    return commitSceneText({
      scene,
      text,
      ...(change.payload.spanAnchors && typeof change.payload.spanAnchors === "object"
        ? { spanAnchors: change.payload.spanAnchors as Readonly<Record<string, SceneSpanAnchorInput>> }
        : {}),
      revisionId,
      commitId,
      updatedAt: now,
    });
  }

  if (kind === "canonical_fact") {
    const fact = current as CanonicalFact;
    return replaceCanonicalFact({
      fact,
      content: subAddress
        ? mergeSubAddressContent(fact.content, subAddress, change.payload)
        : change.payload,
      revisionId,
      commitId,
      updatedAt: now,
    });
  }

  const record = current as StateRecord;
  return replaceStateRecord({
    record,
    content: subAddress
      ? mergeSubAddressContent(record.content, subAddress, change.payload)
      : change.payload,
    revisionId,
    commitId,
    updatedAt: now,
  });
}

function eventForChange(
  kind: PreparedTarget["kind"],
  target: TargetEntity,
  change: ChangeSetRevision["changes"][number],
  revision: ChangeSetRevision,
  revisionId: string,
  commitId: string,
  now: Date,
): DomainEvent {
  const key = targetAddressKey(change.targetAddress);
  const common = {
    eventId: `event:${commitId}:${key}`,
    novelId: revision.novelId,
    objectId: target.id,
    revisionId,
    commitId,
    payload: { changeSetRevisionId: revision.revisionId },
    occurredAt: now,
  };
  if (kind === "manuscript") return createSceneCommittedEvent(common);
  if (kind === "canonical_fact") return createCanonicalFactChangedEvent(common);
  const record = target as StateRecord;
  const eventFactory =
    record.type === "world_state"
      ? createWorldStateChangedEvent
      : record.type === "plot_progress"
        ? createPlotStateChangedEvent
        : createCharacterStateChangedEvent;
  return eventFactory(common);
}

async function prepareTarget(
  work: CommitChangeSetRevisionTransactionWork,
  commitId: string,
  revision: ChangeSetRevision,
  changes: readonly ChangeSetRevision["changes"][number][],
  target: TargetObject,
  now: Date,
): Promise<PreparedTarget> {
  const objectKey = underlyingTargetKey(changes[0]!.targetAddress);
  const current = await findTarget(
    work.repositories,
    changes[0]!.targetAddress.targetType as SupportedTargetType,
    changes[0]!.targetAddress.objectId,
  );
  assertCurrent(target, current, objectKey);
  if (!current) throw new StaleDependencyError(objectKey);

  const nextRevisionId = `${target.value.currentRevisionId}:${commitId}`;
  let next = target.value;
  for (const change of changes) {
    next = applyChange(target.kind, next, change, nextRevisionId, commitId, now);
  }

  const aggregateType = aggregateTypeForTarget(target.kind);
  const resultReference = createVersionReference(
    aggregateType,
    next.id,
    nextRevisionId,
  );
  return {
    kind: target.kind,
    original: target.value,
    next,
    events: changes.map(change =>
      eventForChange(target.kind, next, change, revision, nextRevisionId, commitId, now),
    ),
    resultEntries: changes.map(change => [
      targetAddressKey(change.targetAddress),
      resultReference,
    ] as const),
  };
}

function groupChangesByTarget(
  revision: ChangeSetRevision,
): ReadonlyMap<string, readonly ChangeSetRevision["changes"][number][]> {
  const grouped = new Map<string, ChangeSetRevision["changes"][number][]>();
  for (const change of revision.changes) {
    const key = underlyingTargetKey(change.targetAddress);
    grouped.set(key, [...(grouped.get(key) ?? []), change]);
  }
  return grouped;
}

function basedOnVersionSetOf(revision: ChangeSetRevision): VersionSet {
  return mergeVersionSets(
    {},
    Object.freeze(
      Object.fromEntries(
        revision.changes.flatMap(change =>
          Object.entries(change.basedOnVersionSet).map(
            ([name, reference]) => [`${change.id}:${name}`, reference] as const,
          ),
        ),
      ),
    ),
  );
}

async function findCommittedByRevision(
  repositories: CommitChangeSetRevisionRepositories,
  revision: ChangeSetRevision,
): Promise<NarrativeCommit | undefined> {
  const commits = await repositories.narrativeCommits.listByNovel(revision.novelId);
  return commits.find(
    commit =>
      commit.status === "committed" &&
      commit.changeSetRevisionId === revision.revisionId,
  );
}

async function commitInTransaction(
  work: CommitChangeSetRevisionTransactionWork,
  input: CommitChangeSetRevisionInput,
  failureCommit: { value?: NarrativeCommit },
): Promise<NarrativeCommit> {
  const revision = input.changeSetRevision;
  const existing = await findCommittedByRevision(work.repositories, revision);
  if (existing) return existing;

  const invariantInspection = await inspectTargetInvariants(work.repositories, revision);
  const bindingViolations = inspectBindingInvariants(
    revision,
    input.validationRuns,
    input.reviewDecisions,
  );
  const gate = evaluateCommitGate({
    unresolvedConflict: input.currentRevisionFacts.unresolvedConflict,
    unresolvedConflictEvidenceReferences:
      input.currentRevisionFacts.unresolvedConflictEvidenceReferences,
    stale: input.currentRevisionFacts.stale,
    staleEvidenceReferences: input.currentRevisionFacts.staleEvidenceReferences,
    occConflict: invariantInspection.occConflictFacts.length > 0,
    occConflictFacts: invariantInspection.occConflictFacts,
    occConflictEvidenceReferences: invariantInspection.occConflictEvidenceReferences,
    invariantViolations: [
      ...invariantInspection.violations,
      ...input.targetInvariantViolations,
      ...bindingViolations,
    ],
    validationOutcome: validationOutcomeOf(input.validationRuns),
    validationEvidenceReferences: input.validationRuns.map(run => run.id),
    requiredApproval: input.requiredApproval,
    approvalState: input.requiredApproval
      ? aggregateApprovalState(input.reviewDecisions)
      : "not_required",
    approvalScopes: approvalScopeFacts(
      revision,
      input.reviewDecisions,
      input.approvalScopeRequirements ?? [],
    ),
  });

  if (!gate.allowed) throw new CommitGateBlockedError(gate);

  const prepared: PreparedTarget[] = [];
  for (const [objectKey, changes] of groupChangesByTarget(revision)) {
    const target = invariantInspection.targets.get(objectKey);
    if (!target) throw new Error(`Target was not prepared: ${objectKey}`);
    prepared.push(
      await prepareTarget(work, input.commitId, revision, changes, target, input.now),
    );
  }

  const resultingVersionSet = Object.freeze(
    Object.fromEntries(prepared.flatMap(target => target.resultEntries)),
  );
  const pending = createNarrativeCommit({
    id: input.commitId,
    novelId: revision.novelId,
    changeSetRevision: revision,
    validationRuns: input.validationRuns,
    reviewDecisions: input.reviewDecisions,
    basedOnVersionSet: basedOnVersionSetOf(revision),
    createdAt: input.now,
  });
  failureCommit.value = pending;
  await work.repositories.narrativeCommits.saveNarrativeCommitIfAbsent(pending);

  for (const target of prepared) {
    if (target.kind === "manuscript") {
      await work.repositories.scenes.saveSceneIfCurrent(
        target.original.currentRevisionId,
        target.next as Scene,
      );
    }
    if (target.kind === "canonical_fact") {
      await work.repositories.canonicalFacts.saveCanonicalFactIfCurrent(
        target.original.currentRevisionId,
        target.next as CanonicalFact,
      );
    }
    if (target.kind === "story_state") {
      await work.repositories.stateRecords.saveStateRecordIfCurrent(
        target.original.currentRevisionId,
        target.next as StateRecord,
      );
    }
  }

  const committed = markNarrativeCommitCommitted({
    commit: pending,
    resultingVersionSet,
    committedAt: input.now,
  });
  await work.repositories.narrativeCommits.saveNarrativeCommitIfCurrent("pending", committed);
  await work.eventStore.appendEventsIfAbsent([
    ...prepared.flatMap(target => target.events),
    createNarrativeCommitRecordedEvent({
      eventId: `event:${committed.id}:recorded`,
      novelId: committed.novelId,
      objectId: committed.id,
      revisionId: committed.changeSetRevisionId,
      commitId: committed.id,
      payload: {
        changeSetRevisionId: committed.changeSetRevisionId,
        resultingVersionSet: Object.fromEntries(
          Object.entries(resultingVersionSet).map(([key, reference]) => [
            key,
            { ...reference },
          ]),
        ),
      },
      occurredAt: input.now,
    }),
  ]);
  return committed;
}

export async function commitChangeSetRevision(input: {
  readonly transaction: CommitChangeSetRevisionTransaction;
  readonly input: CommitChangeSetRevisionInput;
}): Promise<NarrativeCommit> {
  const failureCommit: { value?: NarrativeCommit } = {};
  try {
    return await input.transaction.run(work => commitInTransaction(work, input.input, failureCommit));
  } catch (error) {
    if (failureCommit.value) {
      const terminal = markNarrativeCommitFailed({
        commit: failureCommit.value,
        reason: error instanceof Error ? error.message : "Unknown commit failure",
        failedAt: input.input.now,
      });
      await input.transaction
        .run(async work => {
          await work.repositories.narrativeCommits.saveNarrativeCommitIfAbsent(terminal);
        })
        .catch(() => {
          // Failure audit is best effort; atomic rollback remains authoritative.
        });
    }
    throw error;
  }
}
