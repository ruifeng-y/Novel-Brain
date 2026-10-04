import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import type { DomainId, RevisionId } from "../../shared/domain/ids";
import { deepFreeze } from "../../shared/domain/immutable";
import type { Observation, SourceReference } from "../../shared/domain/observationSource";
import type { ChangeSetRevision } from "../../production/domain/changeSetRevision";
import type { ValidationEvidence } from "../../production/domain/validationRun";
import {
  createVersionReference,
  type AggregateType,
  type VersionReference,
  type VersionSet,
} from "../../shared/domain/versioning";

export type DependencyFamily =
  | "structural"
  | "participation"
  | "temporal"
  | "causal"
  | "knowledge"
  | "relationship"
  | "narrative"
  | "constraint";

export type DependencyRelationType =
  | "contains"
  | "belongsTo"
  | "precedes"
  | "appearsIn"
  | "appliesTo"
  | "causes"
  | "informs"
  | "knows"
  | "dependsOn"
  | "supports"
  | "contradicts"
  | "setsUp"
  | "paysOff"
  | "resolves"
  | "affects"
  | "follows"
  | "isSetupFor"
  | "isPayoffFor"
  | "updates"
  | "advances";

export type DependencyInverseSemantics =
  | "inverse"
  | "symmetric"
  | "none";

export type DependencySourceKind =
  | "structural"
  | "commit-derived"
  | "explicit"
  | "ai_suggested";

export type DependencyRelationLifecycle =
  | "derived"
  | "recomputed"
  | "produced"
  | "active"
  | "proposed"
  | "confirmed"
  | "revalidated"
  | "superseded"
  | "retired"
  | "suggested"
  | "rejected";

export type DependencyImpactClassification = "direct" | "indirect" | "potential";
export type DependencyStalenessStatus = "fresh" | "stale" | "missing";

export interface DependencyIdentity {
  readonly novelId: DomainId;
  readonly aggregateType: AggregateType;
  readonly objectId: DomainId;
  readonly revisionId: RevisionId;
}

export interface DependencyIdentityKey {
  readonly scope: "revision";
  readonly novelId: DomainId;
  readonly aggregateType: AggregateType;
  readonly objectId: DomainId;
  readonly revisionId: RevisionId;
}

export interface DependencyObjectKey {
  readonly scope: "object";
  readonly novelId: DomainId;
  readonly aggregateType: AggregateType;
  readonly objectId: DomainId;
}

export interface CanonicalDependencyIdentity {
  readonly key: DependencyIdentityKey;
  readonly objectKey: DependencyObjectKey;
  readonly revision: string;
  readonly object: string;
}

export interface ChangeSetRevisionIdentity {
  readonly novelId: DomainId;
  readonly changeSetId: DomainId;
  readonly revisionId: RevisionId;
  readonly revisionNumber: number;
  readonly parentChangeSetRevisionId?: RevisionId;
}

export interface ChangeSetRevisionProvenance {
  readonly identity: ChangeSetRevisionIdentity;
  readonly hash: string;
}

export interface DependencyRevisionProvenance {
  readonly changeSet: ChangeSetRevisionProvenance;
  readonly versionSet: VersionSet;
  readonly evidence: readonly Observation<ValidationEvidence>[];
}

export interface DependencyInverseDefinition {
  readonly semantics: DependencyInverseSemantics;
  readonly relationType?: DependencyRelationType;
}

export interface DependencyRelationFact {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly family: DependencyFamily;
  readonly relationType: DependencyRelationType;
  readonly inverseDefinition: DependencyInverseDefinition;
  readonly inverseSemantics: DependencyInverseSemantics;
  readonly inverseRelationType?: DependencyRelationType;
  readonly sourceKind: DependencySourceKind;
  readonly lifecycle: DependencyRelationLifecycle;
  readonly lastConfirmedAt?: Date;
  readonly lastRevalidatedAt?: Date;
  readonly dependent: DependencyIdentity;
  readonly dependency: DependencyIdentity;
  readonly revisionProvenance: DependencyRevisionProvenance;
  readonly createdAt: Date;
}

export interface DependencyRegistryView {
  readonly subject: DependencyIdentity;
  readonly objectKey: DependencyObjectKey;
  readonly outgoing: readonly DependencyRelationFact[];
  readonly incoming: readonly DependencyRelationFact[];
}

const dependencyFamilies = new Set<DependencyFamily>([
  "structural",
  "participation",
  "temporal",
  "causal",
  "knowledge",
  "relationship",
  "narrative",
  "constraint",
]);
const dependencyRelationTypes = new Set<DependencyRelationType>([
  "contains",
  "belongsTo",
  "precedes",
  "appearsIn",
  "appliesTo",
  "causes",
  "informs",
  "knows",
  "dependsOn",
  "supports",
  "contradicts",
  "setsUp",
  "paysOff",
  "resolves",
  "affects",
  "follows",
  "isSetupFor",
  "isPayoffFor",
  "updates",
  "advances",
]);
const dependencyInverseSemantics = new Set<DependencyInverseSemantics>([
  "inverse",
  "symmetric",
  "none",
]);
const dependencySourceKinds = new Set<DependencySourceKind>([
  "structural",
  "commit-derived",
  "explicit",
  "ai_suggested",
]);
const dependencyLifecycles = new Set<DependencyRelationLifecycle>([
  "derived",
  "recomputed",
  "produced",
  "active",
  "proposed",
  "confirmed",
  "revalidated",
  "superseded",
  "retired",
  "suggested",
  "rejected",
]);
const dependencyImpactClassifications = new Set<DependencyImpactClassification>([
  "direct",
  "indirect",
  "potential",
]);

function requireNonEmpty(value: string, field: string): string {
  if (!value.trim()) throw new Error(`${field} is required`);
  return value;
}

function requireEnum<T>(
  value: T,
  supported: ReadonlySet<T>,
  label: string,
): T {
  if (!supported.has(value)) throw new Error(`Unsupported ${label}: ${String(value)}`);
  return value;
}


const dependencySourceLifecycles: Readonly<Record<DependencySourceKind, ReadonlySet<DependencyRelationLifecycle>>> = {
  structural: new Set<DependencyRelationLifecycle>(["derived", "recomputed"]),
  "commit-derived": new Set<DependencyRelationLifecycle>(["produced", "active"]),
  explicit: new Set<DependencyRelationLifecycle>([
    "proposed",
    "confirmed",
    "active",
    "revalidated",
    "superseded",
    "retired",
  ]),
  ai_suggested: new Set<DependencyRelationLifecycle>(["suggested", "confirmed", "rejected"]),
};

function assertSourceSpecificLifecycle(
  sourceKind: DependencySourceKind,
  lifecycle: DependencyRelationLifecycle,
  lastConfirmedAt: Date | undefined,
  lastRevalidatedAt: Date | undefined,
): void {
  if (!dependencySourceLifecycles[sourceKind].has(lifecycle)) {
    throw new Error("source-specific dependency lifecycle is not allowed");
  }
  if (lifecycle === "confirmed" && lastConfirmedAt === undefined) {
    throw new Error("confirmed dependency requires lastConfirmedAt");
  }
  if (lifecycle === "revalidated" && (lastConfirmedAt === undefined || lastRevalidatedAt === undefined)) {
    throw new Error("revalidated dependency requires confirmed/revalidated provenance");
  }
  if (
    sourceKind === "explicit" &&
    ["active", "superseded", "retired"].includes(lifecycle) &&
    lastConfirmedAt === undefined
  ) {
    throw new Error("explicit dependency lifecycle requires lastConfirmedAt");
  }
  if (sourceKind === "ai_suggested" && lifecycle === "confirmed" && lastConfirmedAt === undefined) {
    throw new Error("confirmed dependency requires lastConfirmedAt");
  }
  if (lastRevalidatedAt !== undefined && lastConfirmedAt === undefined) {
    throw new Error("revalidated provenance requires lastConfirmedAt");
  }
}
function dependencyIdentity(input: DependencyIdentity): DependencyIdentity {
  return deepFreeze({
    novelId: requireNonEmpty(input.novelId, "novelId"),
    aggregateType: input.aggregateType,
    objectId: requireNonEmpty(input.objectId, "objectId"),
    revisionId: requireNonEmpty(input.revisionId, "revisionId"),
  });
}

export function createDependencyIdentity(input: DependencyIdentity): DependencyIdentity {
  return dependencyIdentity(input);
}

export function dependencyIdentityKey(identity: DependencyIdentity): DependencyIdentityKey {
  return deepFreeze({
    scope: "revision",
    novelId: identity.novelId,
    aggregateType: identity.aggregateType,
    objectId: identity.objectId,
    revisionId: identity.revisionId,
  });
}

export function dependencyObjectKey(identity: DependencyIdentity): DependencyObjectKey {
  return deepFreeze({
    scope: "object",
    novelId: identity.novelId,
    aggregateType: identity.aggregateType,
    objectId: identity.objectId,
  });
}

export function canonicalDependencyIdentity(identity: DependencyIdentity): CanonicalDependencyIdentity {
  const key = dependencyIdentityKey(identity);
  const objectKey = dependencyObjectKey(identity);
  return deepFreeze({
    key,
    objectKey,
    revision: hashContent(canonicalJson(key)),
    object: hashContent(canonicalJson(objectKey)),
  });
}

export function canonicalDependencyObjectKey(key: DependencyObjectKey): string {
  return hashContent(canonicalJson(key));
}

function sameObjectKey(left: DependencyIdentity, right: DependencyIdentity): boolean {
  return canonicalDependencyObjectKey(dependencyObjectKey(left)) ===
    canonicalDependencyObjectKey(dependencyObjectKey(right));
}

function findVersionReference(
  versionSet: VersionSet,
  identity: DependencyIdentity,
): VersionReference | undefined {
  return Object.values(versionSet).find((reference) =>
    reference.aggregateType === identity.aggregateType &&
    reference.objectId === identity.objectId,
  );
}

function assertEvidenceSourceBinding(
  observation: Observation<ValidationEvidence>,
): void {
  const expected: SourceReference = observation.data.sourceReference;
  const actual = observation.sourceReference;
  if (
    expected.identity !== actual.identity ||
    expected.version !== actual.version ||
    expected.hash !== actual.hash
  ) {
    throw new Error(
      "ValidationEvidence sourceReference must match Observation sourceReference",
    );
  }
}

function changeSetRevisionProvenance(revision: ChangeSetRevision): ChangeSetRevisionProvenance {
  const identity: ChangeSetRevisionIdentity = {
    novelId: revision.novelId,
    changeSetId: revision.changeSetId,
    revisionId: revision.revisionId,
    revisionNumber: revision.revisionNumber,
    ...(revision.parentRevisionId === undefined
      ? {}
      : { parentChangeSetRevisionId: revision.parentRevisionId }),
  };
  const hashPayload = {
    ...identity,
    trigger: revision.trigger,
    changes: revision.changes,
    createdAt: revision.createdAt,
  };
  return deepFreeze({
    identity,
    hash: hashContent(canonicalJson(hashPayload)),
  });
}
export function createDependencyRevisionProvenance(input: {
  readonly revision: ChangeSetRevision;
  readonly dependent: DependencyIdentity;
  readonly dependency: DependencyIdentity;
  readonly versionSet: VersionSet;
  readonly evidence: readonly Observation<ValidationEvidence>[];
}): DependencyRevisionProvenance {
  const dependent = dependencyIdentity(input.dependent);
  const dependency = dependencyIdentity(input.dependency);
  if (
    input.revision.novelId !== dependent.novelId ||
    input.revision.novelId !== dependency.novelId
  ) {
    throw new Error("ChangeSet revision novelId must match dependency identities");
  }
  if (Object.keys(input.versionSet).length === 0) {
    throw new Error("revision provenance VersionSet is required");
  }
  for (const identity of [dependent, dependency]) {
    const reference = findVersionReference(input.versionSet, identity);
    if (!reference) {
      throw new Error("VersionSet must bind dependent and dependency revisions");
    }
    if (reference.revisionId !== identity.revisionId) {
      throw new Error("VersionSet revision must match dependency identity");
    }
  }
  if (input.evidence.length === 0) {
    throw new Error("revision provenance evidence is required");
  }
  for (const observation of input.evidence) {
    assertEvidenceSourceBinding(observation);
  }

  return deepFreeze({
    changeSet: changeSetRevisionProvenance(input.revision),
    versionSet: Object.freeze({ ...input.versionSet }),
    evidence: Object.freeze([...input.evidence]),
  });
}

export function createDependencyRelationFact(input: {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly family: DependencyFamily;
  readonly relationType: DependencyRelationType;
  readonly inverseDefinition?: DependencyInverseDefinition;
  readonly inverseSemantics: DependencyInverseSemantics;
  readonly inverseRelationType?: DependencyRelationType;
  readonly sourceKind: DependencySourceKind;
  readonly lifecycle: DependencyRelationLifecycle;
  readonly lastConfirmedAt?: Date;
  readonly lastRevalidatedAt?: Date;
  readonly dependent: DependencyIdentity;
  readonly dependency: DependencyIdentity;
  readonly revisionProvenance: DependencyRevisionProvenance;
  readonly createdAt: Date;
}): DependencyRelationFact {
  const id = requireNonEmpty(input.id, "id");
  const novelId = requireNonEmpty(input.novelId, "novelId");
  const dependent = dependencyIdentity(input.dependent);
  const dependency = dependencyIdentity(input.dependency);
  if (dependent.novelId !== novelId || dependency.novelId !== novelId) {
    throw new Error("dependency relation identities must share novelId");
  }
  if (input.revisionProvenance.changeSet.identity.novelId !== novelId) {
    throw new Error("ChangeSet revision novelId must match dependency relation");
  }
  if (sameObjectKey(dependent, dependency)) {
    throw new Error("self dependency relation is not allowed");
  }
  const family = requireEnum(input.family, dependencyFamilies, "dependency family");
  const relationType = requireEnum(
    input.relationType,
    dependencyRelationTypes,
    "dependency relation type",
  );
  const inverseSemantics = requireEnum(
    input.inverseSemantics,
    dependencyInverseSemantics,
    "dependency inverse semantics",
  );
  const inverseRelationType =
    input.inverseRelationType === undefined
      ? undefined
      : requireEnum(
          input.inverseRelationType,
          dependencyRelationTypes,
          "dependency inverse relation type",
        );
  const inverseDefinition: DependencyInverseDefinition =
    input.inverseDefinition ?? {
      semantics: inverseSemantics,
      ...(inverseRelationType === undefined ? {} : { relationType: inverseRelationType }),
    };
  if (inverseDefinition.semantics !== inverseSemantics) {
    throw new Error("inverse definition semantics must match inverseSemantics");
  }
  if (
    inverseDefinition.relationType !== undefined &&
    inverseRelationType !== undefined &&
    inverseDefinition.relationType !== inverseRelationType
  ) {
    throw new Error("inverse definition relation type must match inverseRelationType");
  }
  if (inverseSemantics === "none" && (inverseRelationType !== undefined || inverseDefinition.relationType !== undefined)) {
    throw new Error("inverse relation type is not allowed for none inverse semantics");
  }
  if (inverseSemantics === "inverse" && inverseRelationType !== undefined) {
    const expectedInverse: Partial<Record<DependencyRelationType, DependencyRelationType>> = {
      contains: "belongsTo",
      belongsTo: "contains",
      precedes: "follows",
      follows: "precedes",
      setsUp: "isSetupFor",
      isSetupFor: "setsUp",
      paysOff: "isPayoffFor",
      isPayoffFor: "paysOff",
    };
    const expected = expectedInverse[relationType];
    if (expected !== undefined && inverseRelationType !== expected) {
      throw new Error("inverse relation type must match relation semantics");
    }
  }
  if (
    inverseSemantics === "symmetric" &&
    inverseRelationType !== undefined &&
    inverseRelationType !== relationType
  ) {
    throw new Error("symmetric inverse relation type must match relation type");
  }
  const sourceKind = requireEnum(input.sourceKind, dependencySourceKinds, "dependency source kind");
  const lifecycle = requireEnum(input.lifecycle, dependencyLifecycles, "dependency lifecycle");
  assertSourceSpecificLifecycle(
    sourceKind,
    lifecycle,
    input.lastConfirmedAt,
    input.lastRevalidatedAt,
  );
  return deepFreeze({
    id,
    novelId,
    family,
    relationType,
    inverseDefinition: deepFreeze({
      semantics: inverseDefinition.semantics,
      ...(inverseDefinition.relationType === undefined
        ? {}
        : { relationType: inverseDefinition.relationType }),
    }),
    inverseSemantics,
    ...(inverseRelationType === undefined ? {} : { inverseRelationType }),
    sourceKind,
    lifecycle,
    ...(input.lastConfirmedAt === undefined
      ? {}
      : { lastConfirmedAt: new Date(input.lastConfirmedAt.getTime()) }),
    ...(input.lastRevalidatedAt === undefined
      ? {}
      : { lastRevalidatedAt: new Date(input.lastRevalidatedAt.getTime()) }),
    dependent,
    dependency,
    revisionProvenance: input.revisionProvenance,
    createdAt: new Date(input.createdAt.getTime()),
  });
}
function revisionStatus(
  expected: VersionReference,
  currentVersionSet: VersionSet,
): DependencyStalenessStatus {
  const current = Object.values(currentVersionSet).find(
    (reference) =>
      reference.aggregateType === expected.aggregateType &&
      reference.objectId === expected.objectId,
  );
  if (!current) return "missing";
  return current.revisionId === expected.revisionId ? "fresh" : "stale";
}

export function assessDependencyFactStaleness(
  fact: DependencyRelationFact,
  currentVersionSet: VersionSet,
): DependencyStalenessStatus {
  const statuses: DependencyStalenessStatus[] = [];
  for (const identity of [fact.dependent, fact.dependency]) {
    const current = findVersionReference(currentVersionSet, identity);
    if (!current) statuses.push("missing");
    else if (current.revisionId !== identity.revisionId) statuses.push("stale");
  }
  for (const expected of Object.values(fact.revisionProvenance.versionSet)) {
    statuses.push(revisionStatus(expected, currentVersionSet));
  }

  if (statuses.includes("missing")) return "missing";
  if (statuses.includes("stale")) return "stale";
  return "fresh";
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareFacts(left: DependencyRelationFact, right: DependencyRelationFact): number {
  return compareCodeUnits(left.id, right.id);
}

export function buildDependencyRegistryView(input: {
  readonly subject: DependencyIdentity;
  readonly relations: readonly DependencyRelationFact[];
}): DependencyRegistryView {
  const subject = dependencyIdentity(input.subject);
  const subjectKey = canonicalDependencyObjectKey(dependencyObjectKey(subject));
  const relations = [...input.relations];

  return deepFreeze({
    subject,
    objectKey: dependencyObjectKey(subject),
    outgoing: relations
      .filter((fact) => canonicalDependencyObjectKey(dependencyObjectKey(fact.dependent)) === subjectKey)
      .sort(compareFacts),
    incoming: relations
      .filter((fact) => canonicalDependencyObjectKey(dependencyObjectKey(fact.dependency)) === subjectKey)
      .sort(compareFacts),
  });
}

export function dependencyVersionReference(identity: DependencyIdentity): VersionReference {
  return createVersionReference(
    identity.aggregateType,
    identity.objectId,
    identity.revisionId,
  );
}
