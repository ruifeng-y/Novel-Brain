import type { Change, ChangePayload, TargetAddress, TargetType } from "../../production/domain/change";
import { createChange } from "../../production/domain/change";
import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";
import type { DomainId } from "../../shared/domain/ids";
import {
  createImmutableTimestamp,
  createObservation,
  createSourceReference,
  isImmutableTimestamp,
  type ImmutableTimestamp,
  type Observation,
  type SourceReference,
} from "../../shared/domain/observationSource";
import type { VersionSet } from "../../shared/domain/versioning";
import {
  narrativeProposalSourceReference,
  proposalSectionHash,
  reviseNarrativeProposalFromAdoptionDecision,
  type NarrativeProposal,
  type ProposalSectionAdoptionDisposition,
} from "./narrativeProposal";




export type AdoptionDecisionType = "adopt" | "reject" | "defer" | "reopen";
export interface AdoptionActor { readonly type: "author" | "policy"; readonly identity: string }
export interface AdoptionTargetScope {
  readonly proposalIdentity: DomainId;
  readonly proposalRevision: string;
  readonly sectionIdentity: DomainId;
}
export interface AdoptedContentReference {
  readonly contentReference: SourceReference;
  readonly contentHash: string;
}
export interface AdoptionTarget {
  readonly id: DomainId;
  readonly sourceDisposition?: ProposalSectionAdoptionDisposition;
  readonly scope: AdoptionTargetScope;
  readonly targetType: TargetType;
  readonly objectId: DomainId;
  readonly subAddress?: string;
  readonly proposedChangeId?: DomainId;
  readonly adoptedContent?: AdoptedContentReference;
  readonly payload?: ChangePayload;
  readonly basedOnVersionSet?: VersionSet;
}
export interface AdoptionDecisionEvidence {
  readonly proposalReference: SourceReference;
  readonly decisionType: AdoptionDecisionType;
  readonly targetScopes: readonly AdoptionTargetScope[];
  readonly actor: AdoptionActor;
  readonly reason: string;
  readonly decidedAt: ImmutableTimestamp;
}
export interface AdoptionDecision {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly proposalReference: SourceReference;
  readonly decisionType: AdoptionDecisionType;
  readonly targets: readonly AdoptionTarget[];
  readonly actor: AdoptionActor;
  readonly reason: string;
  readonly decidedAt: ImmutableTimestamp;
  readonly evidence: Observation<AdoptionDecisionEvidence>;
}
export interface CreateAdoptionDecisionInput {
  readonly proposal: NarrativeProposal;
  readonly id: DomainId;
  readonly decisionType: AdoptionDecisionType;
  readonly targets: readonly AdoptionTarget[];
  readonly actor: AdoptionActor;
  readonly reason: string;
  readonly decidedAt: Date | ImmutableTimestamp;
}
export interface ProposedChange {
  readonly decisionReference: SourceReference;
  readonly targetId: DomainId;
  readonly scope: AdoptionTargetScope;
  readonly change: Change;
}
export interface AdoptionChangeSetInput {
  readonly proposalReference: SourceReference;
  readonly changes: readonly Change[];
  readonly proposedChanges: readonly ProposedChange[];
}

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}
function timestamp(value: Date | ImmutableTimestamp, name: string): ImmutableTimestamp {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${name} must be a valid Date`);
    return createImmutableTimestamp({ iso: value.toISOString(), epochMilliseconds: value.getTime() });
  }
  if (!isImmutableTimestamp(value)) throw new Error(`${name} must be an ImmutableTimestamp`);
  return createImmutableTimestamp(value);
}
function source(value: SourceReference): SourceReference {
  return createSourceReference(value);
}
function assertAllowedKeys(value: object, allowedKeys: readonly string[], message: string): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(message);
}
function assertExactKeys(
  value: object,
  expectedKeys: readonly string[],
  message: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(message);
  }
}
function assertActorShape(actor: AdoptionActor): void {
  assertExactKeys(actor, ["type", "identity"], "Adoption Decision actor has unexpected fields");
  if (actor.type !== "author" && actor.type !== "policy") {
    throw new Error("Adoption Decision actor type is invalid");
  }
  required(actor.identity, "actor identity");
}
function assertSourceReferenceShape(value: SourceReference): void {
  assertExactKeys(value, ["identity", "version", "hash"], "SourceReference has unexpected fields");
  source(value);
}
function normalizedTarget(target: AdoptionTarget): Record<string, unknown> {
  return {
    id: target.id,
    ...(target.sourceDisposition === undefined ? {} : { sourceDisposition: target.sourceDisposition }),
    scope: target.scope,
    targetType: target.targetType,
    objectId: target.objectId,
    ...(target.subAddress === undefined ? {} : { subAddress: target.subAddress }),
    ...(target.proposedChangeId === undefined ? {} : { proposedChangeId: target.proposedChangeId }),
    ...(target.adoptedContent === undefined ? {} : { adoptedContent: target.adoptedContent }),
    ...(target.payload === undefined ? {} : { payload: target.payload }),
    ...(target.basedOnVersionSet === undefined ? {} : { basedOnVersionSet: target.basedOnVersionSet }),
  };
}
function validateTarget(
  proposal: NarrativeProposal,
  decisionType: AdoptionDecisionType,
  input: AdoptionTarget,
): AdoptionTarget {
  assertAllowedKeys(
    input,
    [
      "id", "sourceDisposition", "scope", "targetType", "objectId", "subAddress", "proposedChangeId",
      "adoptedContent", "payload", "basedOnVersionSet",
    ],
    "Adoption Target has unexpected fields",
  );
  assertExactKeys(
    input.scope,
    ["proposalIdentity", "proposalRevision", "sectionIdentity"],
    "Adoption target scope has unexpected fields",
  );
  required(input.id, "adoption target id");
  const parentDisposition = proposal.sections.find((entry) => entry.id === input.scope.sectionIdentity)?.adoptionDisposition;
  if (input.sourceDisposition !== undefined && input.sourceDisposition !== parentDisposition) {
    throw new Error("Adoption target sourceDisposition must match parent Section");
  }
  if (
    input.scope.proposalIdentity !== proposal.id ||
    input.scope.proposalRevision !== proposal.currentRevisionId
  ) {
    throw new Error("Adoption target scope must bind the exact Proposal Revision");
  }
  const section = proposal.sections.find((entry) => entry.id === input.scope.sectionIdentity);
  if (!section) throw new Error("Adoption target section must exist in Proposal");
  required(input.objectId, "adoption target objectId");
  if (decisionType === "adopt") {
    if (!input.adoptedContent) throw new Error("Adopt target requires adopted content");
    assertExactKeys(
      input.adoptedContent,
      ["contentReference", "contentHash"],
      "Adopted content has unexpected fields",
    );
    assertSourceReferenceShape(input.adoptedContent.contentReference);
    const expectedHash = proposalSectionHash(section);
    const reference = input.adoptedContent.contentReference;
    if (
      input.adoptedContent.contentHash !== expectedHash ||
      reference.hash !== expectedHash ||
      reference.identity !== section.id ||
      reference.version !== proposal.currentRevisionId
    ) {
      throw new Error("Adopted content hash must match Proposal Section");
    }
    if (!input.payload || !input.basedOnVersionSet || !input.proposedChangeId) {
      throw new Error("Adopt target requires proposed Change inputs");
    }
  } else if (input.adoptedContent || input.payload || input.basedOnVersionSet || input.proposedChangeId) {
    throw new Error("Only Adopt targets can produce proposed Changes");
  }
  return deepFreeze({
    ...input,
    sourceDisposition: input.sourceDisposition ?? parentDisposition ?? "pending",
    scope: { ...input.scope },
    ...(input.adoptedContent
      ? { adoptedContent: { contentReference: source(input.adoptedContent.contentReference), contentHash: input.adoptedContent.contentHash } }
      : {}),
    ...(input.payload ? { payload: { ...input.payload } } : {}),
    ...(input.basedOnVersionSet ? { basedOnVersionSet: { ...input.basedOnVersionSet } } : {}),
  });
}
export function adoptionTargetScopeKey(scope: AdoptionTargetScope): string {
  return canonicalJson([scope.proposalIdentity, scope.proposalRevision, scope.sectionIdentity]);
}

export function adoptionTargetAddressKey(target: AdoptionTarget): string {
  return canonicalJson([target.targetType, target.objectId, target.subAddress ?? null]);
}

function assertDecisionType(value: AdoptionDecisionType): void {
  if (!["adopt", "reject", "defer", "reopen"].includes(value)) {
    throw new Error("Adoption Decision type is invalid");
  }
}
function assertDecisionBaseFields(input: {
  readonly id: string;
  readonly reason: string;
  readonly actor: AdoptionActor;
  readonly targets: readonly AdoptionTarget[];
  readonly decisionType: AdoptionDecisionType;
}): void {
  required(input.id, "decision id");
  required(input.reason, "decision reason");
  assertActorShape(input.actor);
  assertDecisionType(input.decisionType);
  if (input.targets.length === 0) throw new Error("Adoption Decision requires at least one target");
}

export function createAdoptionDecision(input: CreateAdoptionDecisionInput): AdoptionDecision {
  assertDecisionBaseFields(input);

  const scopes = new Set<string>();
  const addresses = new Set<string>();
  const targetIds = new Set<string>();
  const proposedChangeIds = new Set<string>();
  const targets = input.targets.map((target) => {
    const scopeKey = adoptionTargetScopeKey(target.scope);
    const addressKey = adoptionTargetAddressKey(target);
    if (scopes.has(scopeKey)) throw new Error("Adoption target scope must be unique");
    if (addresses.has(addressKey)) throw new Error("Adoption target address must be unique");
    if (targetIds.has(target.id)) throw new Error("Adoption target id must be unique");
    if (target.proposedChangeId !== undefined) {
      if (proposedChangeIds.has(target.proposedChangeId)) {
        throw new Error("proposedChange id must be unique");
      }
      proposedChangeIds.add(target.proposedChangeId);
    }
    scopes.add(scopeKey);
    addresses.add(addressKey);
    targetIds.add(target.id);
    return validateTarget(input.proposal, input.decisionType, target);
  });
  const decidedAt = timestamp(input.decidedAt, "decidedAt");
  const proposalReference = narrativeProposalSourceReference(input.proposal);
  const evidence = createObservation<AdoptionDecisionEvidence>({
    evidenceReference: input.id,
    sourceReference: proposalReference,
    ordinal: 1,
    data: {
      proposalReference,
      decisionType: input.decisionType,
      targetScopes: targets.map((target) => ({ ...target.scope })),
      actor: { ...input.actor },
      reason: input.reason,
      decidedAt,
    },
  });
  const decision = deepFreeze({
    id: input.id,
    novelId: input.proposal.novelId,
    proposalReference,
    decisionType: input.decisionType,
    targets,
    actor: { ...input.actor },
    reason: input.reason,
    decidedAt,
    evidence,
  });
  assertAdoptionDecisionMatchesProposal(decision, input.proposal);
  return decision;
}
export function assertAdoptionDecisionMatchesProposal(
  decision: AdoptionDecision,
  proposal: NarrativeProposal,
): void {
  if (!decision || typeof decision !== "object") throw new Error("Adoption Decision is required");
  assertExactKeys(
    decision,
    ["id", "novelId", "proposalReference", "decisionType", "targets", "actor", "reason", "decidedAt", "evidence"],
    "exact Adoption Decision fields must be present",
  );
  assertDecisionBaseFields(decision);
  assertSourceReferenceShape(decision.proposalReference);
  assertExactKeys(
    decision.evidence,
    ["evidenceReference", "sourceReference", "ordinal", "data"],
    "Adoption Decision evidence has unexpected fields",
  );
  assertSourceReferenceShape(decision.evidence.sourceReference);
  assertExactKeys(
    decision.evidence.data,
    ["proposalReference", "decisionType", "targetScopes", "actor", "reason", "decidedAt"],
    "Adoption Decision evidence has unexpected fields",
  );
  assertSourceReferenceShape(decision.evidence.data.proposalReference);
  if (!isImmutableTimestamp(decision.decidedAt) || !isImmutableTimestamp(decision.evidence.data.decidedAt)) {
    throw new Error("Adoption Decision timestamps must be immutable");
  }
  if (decision.evidence.data.targetScopes.length !== decision.targets.length) {
    throw new Error("Adoption Decision evidence must match top-level decision fields");
  }
  for (const scope of decision.evidence.data.targetScopes) {
    assertExactKeys(
      scope,
      ["proposalIdentity", "proposalRevision", "sectionIdentity"],
      "Adoption Decision evidence has unexpected fields",
    );
  }
  const expectedScopes = decision.targets.map((target) => ({ ...target.scope }));
  const matchesEvidenceShape =
    decision.evidence.evidenceReference === decision.id &&
    decision.evidence.ordinal === 1 &&
    canonicalJson(decision.evidence.data.targetScopes) === canonicalJson(expectedScopes) &&
    decision.evidence.data.decisionType === decision.decisionType &&
    canonicalJson(decision.evidence.data.actor) === canonicalJson(decision.actor) &&
    decision.evidence.data.reason === decision.reason &&
    canonicalJson(decision.evidence.data.decidedAt) === canonicalJson(decision.decidedAt);
  if (!matchesEvidenceShape) {
    throw new Error("Adoption Decision evidence must match top-level decision fields");
  }
  const expectedReference = narrativeProposalSourceReference(proposal);
  const matchesReference =
    decision.proposalReference.identity === expectedReference.identity &&
    decision.proposalReference.version === expectedReference.version &&
    decision.proposalReference.hash === expectedReference.hash;
  const matchesEvidence =
    decision.evidence.sourceReference.identity === expectedReference.identity &&
    decision.evidence.sourceReference.version === expectedReference.version &&
    decision.evidence.sourceReference.hash === expectedReference.hash &&
    decision.evidence.data.proposalReference.identity === expectedReference.identity &&
    decision.evidence.data.proposalReference.version === expectedReference.version &&
    decision.evidence.data.proposalReference.hash === expectedReference.hash;
  if (decision.novelId !== proposal.novelId || !matchesReference || !matchesEvidence) {
    throw new Error("Adoption Decision evidence must match retained Proposal Revision");
  }
  const seenScopes = new Set<string>();
  const seenAddresses = new Set<string>();
  const seenTargetIds = new Set<string>();
  const seenChangeIds = new Set<string>();
  for (const target of decision.targets) {
    const scopeKey = adoptionTargetScopeKey(target.scope);
    const addressKey = adoptionTargetAddressKey(target);
    if (seenScopes.has(scopeKey)) throw new Error("Adoption target scope must be unique");
    if (seenAddresses.has(addressKey)) throw new Error("Adoption target address must be unique");
    if (seenTargetIds.has(target.id)) throw new Error("Adoption target id must be unique");
    if (target.proposedChangeId !== undefined) {
      if (seenChangeIds.has(target.proposedChangeId)) {
        throw new Error("proposedChange id must be unique");
      }
      seenChangeIds.add(target.proposedChangeId);
    }
    seenScopes.add(scopeKey);
    seenAddresses.add(addressKey);
    seenTargetIds.add(target.id);
    validateTarget(proposal, decision.decisionType, target);
  }
}


export function adoptionDecisionSourceReference(decision: AdoptionDecision): SourceReference {
  return source({
    identity: decision.id,
    version: "1",
    hash: hashContent(canonicalJson(decision)),
  });
}

export function validateAdoptionDecision(
  decision: AdoptionDecision,
  proposal: NarrativeProposal,
): AdoptionDecision {
  assertAdoptionDecisionMatchesProposal(decision, proposal);
  return decision;
}
export function adoptionTargetAddress(target: AdoptionTarget): TargetAddress {
  return deepFreeze({
    targetType: target.targetType,
    objectId: target.objectId,
    ...(target.subAddress === undefined ? {} : { subAddress: target.subAddress }),
  });
}
export function applyAdoptionDecisionToProposal(input: {
  readonly proposal: NarrativeProposal;
  readonly decision: AdoptionDecision;
  readonly revisedAt: Date | ImmutableTimestamp;
}): NarrativeProposal {
  assertAdoptionDecisionMatchesProposal(input.decision, input.proposal);
  const dispositionBySection = new Map<DomainId, ProposalSectionAdoptionDisposition>();
  for (const target of input.decision.targets) {
    dispositionBySection.set(
      target.scope.sectionIdentity,
      input.decision.decisionType === "adopt"
        ? "adopted"
        : input.decision.decisionType === "reject"
          ? "rejected"
          : input.decision.decisionType === "defer"
            ? "deferred"
            : "pending",
    );
  }
  return reviseNarrativeProposalFromAdoptionDecision({
    proposal: input.proposal,
    decision: input.decision,
    revisedAt: input.revisedAt,
  });
}

export function createAdoptionChangeSetInputs(decision: AdoptionDecision): AdoptionChangeSetInput {
  const decisionReference = adoptionDecisionSourceReference(decision);
  const changes: Change[] = [];
  const proposedChanges: ProposedChange[] = [];
  if (decision.decisionType === "adopt") {
    for (const target of decision.targets) {
      const change = createChange({
        id: target.proposedChangeId!,
        sourceType: "proposal_adoption",
        sourceReference: decision.proposalReference,
        targetAddress: adoptionTargetAddress(target),
        payload: target.payload!,
        basedOnVersionSet: target.basedOnVersionSet!,
      });
      changes.push(change);
      proposedChanges.push({
        decisionReference,
        targetId: target.id,
        scope: { ...target.scope },
        change,
      });
    }
  }
  return deepFreeze({ proposalReference: decision.proposalReference, changes, proposedChanges });
}
