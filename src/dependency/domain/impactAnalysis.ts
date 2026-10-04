import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";
import {
  createObservationSnapshot,
  createSourceReference,
  resolveObservation,
  type EvidenceReference,
  type Observation,
  type ObservationSnapshot,
  type SourceReference
} from "../../shared/domain/observationSource";
import type { ValidationEvidence } from "../../production/domain/validationRun";
import type { VersionSet } from "../../shared/domain/versioning";
import {
  assessDependencyFactStaleness,
  canonicalDependencyObjectKey,
  compareCodeUnits,
  dependencyObjectKey,
  type DependencyImpactClassification,
  type DependencyObjectKey,
  type DependencyIdentity,
  type DependencyRelationFact,
  type DependencyRelationType,
  type DependencyStalenessStatus
} from "./dependencyRegistry";

export type ImpactClassification = DependencyImpactClassification;
export type ImpactEvidenceClass =
  | "definite_direct"
  | "definite_indirect"
  | "potential";
export type ImpactEvidenceStatus =
  | "verified"
  | "missing"
  | "identity_mismatch"
  | "version_mismatch"
  | "hash_mismatch";
export type ImpactEvidenceIntegrityStatus = "verified" | "degraded";

export interface ImpactClassificationFact {
  readonly relationId: string;
  readonly evidenceReference: EvidenceReference;
  readonly evidenceClass: ImpactEvidenceClass;
}

export interface ImpactEvidenceSnapshotProvenance {
  readonly sourceReference: SourceReference;
  readonly observations: readonly Observation<ValidationEvidence>[];
  readonly hash: string;
}

export interface ImpactReadSet {
  readonly version: string;
  readonly relations: readonly DependencyRelationFact[];
  readonly classificationFacts: readonly ImpactClassificationFact[];
  readonly basedOnVersionSet: VersionSet;
  readonly evidenceSnapshot: ImpactEvidenceSnapshotProvenance;
}

export interface ImpactRelationAssessment {
  readonly relation: DependencyRelationFact;
  readonly staleness: DependencyStalenessStatus;
  readonly evidenceStatus: ImpactEvidenceStatus;
  readonly evidenceClass: ImpactEvidenceClass;
  readonly classification: ImpactClassification;
}

export interface ImpactPathStep {
  readonly relationId: string;
  readonly relationType: DependencyRelationType;
  readonly from: DependencyIdentity;
  readonly to: DependencyIdentity;
  readonly classification: ImpactClassification;
  readonly evidenceClass: ImpactEvidenceClass;
  readonly staleness: DependencyStalenessStatus;
  readonly evidenceStatus: ImpactEvidenceStatus;
}

export type ImpactProvenancePath = readonly ImpactPathStep[];

export interface ImpactFrontierEntry {
  readonly classification: ImpactClassification;
  readonly object: DependencyIdentity;
  readonly objectKey: DependencyObjectKey;
  readonly depth: number;
  readonly path: ImpactProvenancePath;
  readonly provenancePaths: readonly ImpactProvenancePath[];
  readonly relationIds: readonly string[];
  readonly staleness: DependencyStalenessStatus;
  readonly evidenceStatus: ImpactEvidenceStatus;
}

export interface ImpactFrontier {
  readonly direct: readonly ImpactFrontierEntry[];
  readonly indirect: readonly ImpactFrontierEntry[];
  readonly potential: readonly ImpactFrontierEntry[];
  readonly boundary: readonly ImpactFrontierEntry[];
}

export interface ImpactEvidenceIssue {
  readonly relationId: string;
  readonly status: Exclude<ImpactEvidenceStatus, "verified">;
}

export interface ImpactAnalysisResult {
  readonly id: string;
  readonly novelId: string;
  readonly subject: DependencyIdentity;
  readonly maxDepth: number;
  readonly readSet: ImpactReadSet;
  readonly basedOnVersionSet: VersionSet;
  readonly evidenceSnapshot: ImpactEvidenceSnapshotProvenance;
  readonly frontier: ImpactFrontier;
  readonly affectedObjects: readonly DependencyIdentity[];
  readonly staleness: DependencyStalenessStatus;
  readonly evidenceIntegrityStatus: ImpactEvidenceIntegrityStatus;
  readonly evidenceIssues: readonly ImpactEvidenceIssue[];
  readonly computedAt: Date;
  readonly contentHash: string;
}

interface TraversalState {
  readonly current: DependencyIdentity;
  readonly depth: number;
  readonly path: ImpactProvenancePath;
}

interface ImpactPathCandidate {
  readonly object: DependencyIdentity;
  readonly objectKey: DependencyObjectKey;
  readonly depth: number;
  readonly path: ImpactProvenancePath;
  readonly classification: ImpactClassification;
  readonly evidenceClass: ImpactEvidenceClass;
  readonly staleness: DependencyStalenessStatus;
  readonly evidenceStatus: ImpactEvidenceStatus;
}

const MAX_IMPACT_PROVENANCE_PATHS = 4;

function requireNonEmpty(value: string, field: string): string {
  if (!value.trim()) throw new Error(`${field} is required`);
  return value;
}

function evidenceStatusPriority(status: ImpactEvidenceStatus): number {
  switch (status) {
    case "verified":
      return 0;
    case "hash_mismatch":
      return 1;
    case "version_mismatch":
      return 2;
    case "identity_mismatch":
      return 3;
    case "missing":
      return 4;
  }
}

function worstEvidenceStatus(
  values: readonly ImpactEvidenceStatus[],
): ImpactEvidenceStatus {
  return values.reduce<ImpactEvidenceStatus>(
    (worst, value) =>
      evidenceStatusPriority(value) > evidenceStatusPriority(worst) ? value : worst,
    "verified",
  );
}

function worstStaleness(values: readonly DependencyStalenessStatus[]): DependencyStalenessStatus {
  if (values.includes("missing")) return "missing";
  if (values.includes("stale")) return "stale";
  return "fresh";
}

function evidenceClassRank(evidenceClass: ImpactEvidenceClass): number {
  switch (evidenceClass) {
    case "definite_direct":
      return 0;
    case "definite_indirect":
      return 1;
    case "potential":
      return 2;
  }
}

function classificationRank(classification: ImpactClassification): number {
  switch (classification) {
    case "direct":
      return 0;
    case "indirect":
      return 1;
    case "potential":
      return 2;
  }
}

function classificationForEvidenceClass(evidenceClass: ImpactEvidenceClass): ImpactClassification {
  switch (evidenceClass) {
    case "definite_direct":
      return "direct";
    case "definite_indirect":
      return "indirect";
    case "potential":
      return "potential";
  }
}

function bestClassification(values: readonly ImpactClassification[]): ImpactClassification {
  return values.reduce<ImpactClassification>(
    (best, value) =>
      classificationRank(value) < classificationRank(best) ? value : best,
    "potential",
  );
}

function bestEvidenceClass(values: readonly ImpactEvidenceClass[]): ImpactEvidenceClass {
  return values.reduce<ImpactEvidenceClass>(
    (best, value) =>
      evidenceClassRank(value) < evidenceClassRank(best) ? value : best,
    "potential",
  );
}

function completePathClassification(path: ImpactProvenancePath): ImpactClassification {
  if (path.some((step) => step.staleness !== "fresh" || step.evidenceStatus !== "verified" || step.classification === "potential")) {
    return "potential";
  }
  if (path.some((step) => step.evidenceClass === "definite_indirect")) return "indirect";
  return path.length > 0 && path.every((step) => step.evidenceClass === "definite_direct")
    ? "direct"
    : "potential";
}

function completePathEvidenceClass(path: ImpactProvenancePath): ImpactEvidenceClass {
  if (path.some((step) => step.staleness !== "fresh" || step.evidenceStatus !== "verified" || step.evidenceClass === "potential")) {
    return "potential";
  }
  if (path.some((step) => step.evidenceClass === "definite_indirect")) return "definite_indirect";
  return path.length > 0 && path.every((step) => step.evidenceClass === "definite_direct")
    ? "definite_direct"
    : "potential";
}

function pathSignature(path: ImpactProvenancePath): string {
  return canonicalJson(path.map((step) => step.relationId));
}

export function createImpactClassificationFact(input: {
  readonly relationId: string;
  readonly evidenceReference: EvidenceReference;
  readonly evidenceClass: ImpactEvidenceClass;
}): ImpactClassificationFact {
  const supported = new Set<ImpactEvidenceClass>([
    "definite_direct",
    "definite_indirect",
    "potential",

  ]);
  if (!supported.has(input.evidenceClass)) {
    throw new Error(`Unsupported impact evidence class: ${String(input.evidenceClass)}`);
  }
  return deepFreeze({
    relationId: requireNonEmpty(input.relationId, "relationId"),
    evidenceReference: requireNonEmpty(input.evidenceReference, "evidenceReference"),
    evidenceClass: input.evidenceClass,
  });
}
function assertEvidenceSourceBinding(observation: Observation<ValidationEvidence>): void {
  const expected = observation.data.sourceReference;
  const actual = observation.sourceReference;
  if (
    expected.identity !== actual.identity ||
    expected.version !== actual.version ||
    expected.hash !== actual.hash
  ) {
    throw new Error("ValidationEvidence sourceReference must match Observation sourceReference");
  }
}

export function assertImpactEvidenceSnapshotBindings(
  snapshot: ObservationSnapshot<ValidationEvidence>,
): void {
  for (const observation of snapshot.observations) {
    assertEvidenceSourceBinding(observation);
  }
}

export function createImpactEvidenceSnapshotProvenance(input: {
  readonly sourceReference: SourceReference;
  readonly observations: readonly Observation<ValidationEvidence>[];
}): ImpactEvidenceSnapshotProvenance {
  const snapshot = createObservationSnapshot<ValidationEvidence>({
    sourceReference: input.sourceReference,
    observations: input.observations,
  });
  assertImpactEvidenceSnapshotBindings(snapshot);
  return deepFreeze({
    sourceReference: snapshot.sourceReference,
    observations: snapshot.observations,
    hash: hashContent(canonicalJson(snapshot)),
  });
}

export function resolveImpactEvidenceStatus(
  relation: DependencyRelationFact,
  evidenceSnapshot: ObservationSnapshot<ValidationEvidence>,
): ImpactEvidenceStatus {
  assertImpactEvidenceSnapshotBindings(evidenceSnapshot);
  const statuses = relation.revisionProvenance.evidence.map((expected) => {
    const resolution = resolveObservation(evidenceSnapshot, expected);
    return resolution.status === "observed"
      ? ("verified" as const)
      : resolution.status;
  });
  return worstEvidenceStatus(statuses);
}

function defaultEvidenceClass(relation: DependencyRelationFact): ImpactEvidenceClass {
  if (relation.sourceKind === "ai_suggested") return "potential";
  if (
    relation.lifecycle !== "active" &&
    relation.lifecycle !== "confirmed" &&
    relation.lifecycle !== "revalidated" &&
    relation.lifecycle !== "produced"
  ) {
    return "potential";
  }
  return "potential";
}

function assertImpactClassificationFactBindings(
  relations: readonly DependencyRelationFact[],
  evidenceSnapshot: ObservationSnapshot<ValidationEvidence>,
  classificationFacts: readonly ImpactClassificationFact[],
): void {
  for (const fact of classificationFacts) {
    createImpactClassificationFact(fact);
    const relation = relations.find(({ id }) => id === fact.relationId);
    if (!relation) {
      throw new Error(`Impact classification fact relation is unbound: ${fact.relationId}`);
    }
    const expected = relation.revisionProvenance.evidence.find(
      ({ evidenceReference }) => evidenceReference === fact.evidenceReference,
    );
    if (!expected) {
      throw new Error(`Impact classification fact evidence is unbound: ${fact.evidenceReference}`);
    }
    const resolution = resolveObservation(evidenceSnapshot, expected);
    if (resolution.status !== "observed") {
      throw new Error("Impact classification fact Observation source/hash mismatch");
    }
  }
}

function evidenceClassForRelation(
  relation: DependencyRelationFact,
  classificationFacts: readonly ImpactClassificationFact[],
  evidenceStatus: ImpactEvidenceStatus,
): ImpactEvidenceClass {
  if (relation.sourceKind === "ai_suggested") return "potential";
  if (evidenceStatus !== "verified") return "potential";
  const evidenceReferences = new Set(
    relation.revisionProvenance.evidence.map(({ evidenceReference }) => evidenceReference),
  );
  const facts = classificationFacts.filter(
    (fact) => fact.relationId === relation.id && evidenceReferences.has(fact.evidenceReference),
  );
  return facts.length > 0 ? bestEvidenceClass(facts.map(({ evidenceClass }) => evidenceClass)) : defaultEvidenceClass(relation);
}

export function createImpactRelationAssessment(input: {
  readonly relation: DependencyRelationFact;
  readonly currentVersionSet: VersionSet;
  readonly evidenceSnapshot: ObservationSnapshot<ValidationEvidence>;
  readonly classificationFacts?: readonly ImpactClassificationFact[];
}): ImpactRelationAssessment {
  const staleness = assessDependencyFactStaleness(input.relation, input.currentVersionSet);
  const evidenceStatus = resolveImpactEvidenceStatus(input.relation, input.evidenceSnapshot);
  const evidenceClass = evidenceClassForRelation(
    input.relation,
    input.classificationFacts ?? [],
    evidenceStatus,
  );
  const classification: ImpactClassification =
    staleness === "fresh" && evidenceStatus === "verified"
      ? classificationForEvidenceClass(evidenceClass)
      : "potential";
  return deepFreeze({
    relation: input.relation,
    staleness,
    evidenceStatus,
    evidenceClass,
    classification,
  });
}
function compareEntries(left: ImpactFrontierEntry, right: ImpactFrontierEntry): number {
  return (
    compareCodeUnits(left.object.novelId, right.object.novelId) ||
    compareCodeUnits(left.object.aggregateType, right.object.aggregateType) ||
    compareCodeUnits(left.object.objectId, right.object.objectId) ||
    compareCodeUnits(left.object.revisionId, right.object.revisionId)
  );
}

function compareCandidates(left: ImpactPathCandidate, right: ImpactPathCandidate): number {
  return (
    left.depth - right.depth ||
    classificationRank(left.classification) - classificationRank(right.classification) ||
    compareCodeUnits(pathSignature(left.path), pathSignature(right.path))
  );
}

function capCandidates(candidates: readonly ImpactPathCandidate[]): ImpactPathCandidate[] {
  return [...candidates].sort(compareCandidates).slice(0, MAX_IMPACT_PROVENANCE_PATHS);
}

function capCandidatesByClassification(candidates: readonly ImpactPathCandidate[]): ImpactPathCandidate[] {
  const groups = new Map<ImpactClassification, ImpactPathCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.classification) ?? [];
    group.push(candidate);
    groups.set(candidate.classification, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => classificationRank(left) - classificationRank(right))
    .flatMap(([, group]) => capCandidates(group));
}

function stepFor(
  relation: DependencyRelationFact,
  assessment: ImpactRelationAssessment,
): ImpactPathStep {
  return {
    relationId: relation.id,
    relationType: relation.relationType,
    from: relation.dependency,
    to: relation.dependent,
    classification: assessment.classification,
    evidenceClass: assessment.evidenceClass,
    staleness: assessment.staleness,
    evidenceStatus: assessment.evidenceStatus,
  };
}

function entryFromCandidates(
  object: DependencyIdentity,
  candidates: readonly ImpactPathCandidate[],
): ImpactFrontierEntry {
  const ordered = capCandidatesByClassification(candidates);
  const provenancePaths = deepFreeze(ordered.map((candidate) => candidate.path));
  const representative = ordered[0];
  if (!representative) throw new Error("Impact frontier entry requires a provenance path");
  return deepFreeze({
    classification: bestClassification(candidates.map((candidate) => candidate.classification)),
    object,
    objectKey: dependencyObjectKey(object),
    depth: representative.depth,
    path: representative.path,
    provenancePaths,
    relationIds: deepFreeze(
      [...new Set(ordered.flatMap((candidate) => candidate.path.map((step) => step.relationId)))].sort(
        compareCodeUnits,
      ),
    ),
    staleness: worstStaleness(ordered.map((candidate) => candidate.staleness)),
    evidenceStatus: worstEvidenceStatus(ordered.map((candidate) => candidate.evidenceStatus)),
  });
}

function selectEvidenceObservations(
  snapshot: ObservationSnapshot<ValidationEvidence>,
  relations: readonly DependencyRelationFact[],
): ImpactEvidenceSnapshotProvenance {
  const references = new Set(
    relations.flatMap((relation) =>
      relation.revisionProvenance.evidence.map(({ evidenceReference }) => evidenceReference),
    ),
  );
  return createImpactEvidenceSnapshotProvenance({
    sourceReference: snapshot.sourceReference,
    observations: snapshot.observations.filter(({ evidenceReference }) =>
      references.has(evidenceReference),
    ),
  });
}

function buildReadSet(input: {
  readonly relations: readonly DependencyRelationFact[];
  readonly classificationFacts: readonly ImpactClassificationFact[];
  readonly basedOnVersionSet: VersionSet;
  readonly evidenceSnapshot: ObservationSnapshot<ValidationEvidence>;
}): ImpactReadSet {
  const relations = [...input.relations].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  );
  const evidenceSnapshot = selectEvidenceObservations(input.evidenceSnapshot, relations);
  const relationIds = new Set(relations.map(({ id }) => id));
  const evidenceReferences = new Set(
    relations.flatMap((relation) =>
      relation.revisionProvenance.evidence.map(({ evidenceReference }) => evidenceReference),
    ),
  );
  const classificationFacts = [...input.classificationFacts]
    .filter((fact) => relationIds.has(fact.relationId) && evidenceReferences.has(fact.evidenceReference))
    .sort((left, right) =>
      compareCodeUnits(left.relationId, right.relationId) ||
      compareCodeUnits(left.evidenceReference, right.evidenceReference) ||
      compareCodeUnits(left.evidenceClass, right.evidenceClass),
    );
  const readSetCore = {
    relations,
    classificationFacts,
    basedOnVersionSet: Object.freeze({ ...input.basedOnVersionSet }),
    evidenceSnapshot,
  };
  return deepFreeze({
    ...readSetCore,
    version: hashContent(canonicalJson(readSetCore)),
  });
}

export function computeImpactAnalysis(input: {
  readonly id: string;
  readonly novelId: string;
  readonly subject: DependencyIdentity;
  readonly relations: readonly DependencyRelationFact[];
  readonly classificationFacts?: readonly ImpactClassificationFact[];
  readonly currentVersionSet: VersionSet;
  readonly evidenceSnapshot: ObservationSnapshot<ValidationEvidence>;
  readonly maxDepth: number;
  readonly computedAt: Date;
}): ImpactAnalysisResult {
  const id = requireNonEmpty(input.id, "id");
  const novelId = requireNonEmpty(input.novelId, "novelId");
  if (!input.subject) throw new Error("subject is required");
  if (!Number.isInteger(input.maxDepth) || input.maxDepth < 1 || input.maxDepth > 8) {
    throw new Error("maxDepth must be between 1 and 8");
  }
  assertImpactEvidenceSnapshotBindings(input.evidenceSnapshot);
  for (const relation of input.relations) {
    if (relation.novelId !== novelId || relation.dependent.novelId !== novelId) {
      throw new Error("impact analysis relations must belong to novelId");
    }
  }
  const classificationFacts = input.classificationFacts ?? [];
  const orderedRelations = [...input.relations].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  );
  for (const fact of classificationFacts) createImpactClassificationFact(fact);
  const boundClassificationFacts = classificationFacts;
  assertImpactClassificationFactBindings(orderedRelations, input.evidenceSnapshot, classificationFacts);
  const relationAssessments = new Map(
    orderedRelations.map((relation) => [
      relation.id,
      createImpactRelationAssessment({
        relation,
        currentVersionSet: input.currentVersionSet,
        evidenceSnapshot: input.evidenceSnapshot,
        classificationFacts,
      }),
    ]),
  );
  const reachableRelationIds = new Set<string>();
  const candidatesByObject = new Map<string, ImpactPathCandidate[]>();
  let states: TraversalState[] = [{ current: input.subject, depth: 0, path: [] }];

  for (let depth = 0; depth < input.maxDepth && states.length > 0; depth += 1) {
    const nextByObject = new Map<string, ImpactPathCandidate[]>();
    for (const state of [...states].sort((left, right) =>
      compareCodeUnits(pathSignature(left.path), pathSignature(right.path)),
    )) {
      const currentObjectHash = canonicalDependencyObjectKey(
        dependencyObjectKey(state.current),
      );
      for (const relation of orderedRelations) {
        if (
          canonicalDependencyObjectKey(dependencyObjectKey(relation.dependency)) !==
          currentObjectHash
        ) {
          continue;
        }
        reachableRelationIds.add(relation.id);
        const nextKey = dependencyObjectKey(relation.dependent);
        const nextObjectHash = canonicalDependencyObjectKey(nextKey);
        if (
          state.path.some(
            (step) =>
              canonicalDependencyObjectKey(dependencyObjectKey(step.to)) === nextObjectHash,
          )
        ) {
          continue;
        }
        const assessment = relationAssessments.get(relation.id);
        if (!assessment) throw new Error(`Missing relation assessment: ${relation.id}`);
        const path = [...state.path, stepFor(relation, assessment)];
        const candidate: ImpactPathCandidate = {
          object: relation.dependent,
          objectKey: nextKey,
          depth: state.depth + 1,
          path: deepFreeze(path),
          classification: completePathClassification(path),
          evidenceClass: completePathEvidenceClass(path),
          staleness: worstStaleness(path.map((step) => step.staleness)),
          evidenceStatus: worstEvidenceStatus(path.map((step) => step.evidenceStatus)),
        };
        const candidates = nextByObject.get(nextObjectHash) ?? [];
        candidates.push(candidate);
        nextByObject.set(nextObjectHash, candidates);
        const objectCandidates = candidatesByObject.get(nextObjectHash) ?? [];
        objectCandidates.push(candidate);
        candidatesByObject.set(nextObjectHash, objectCandidates);
      }
    }
    states = [...nextByObject.entries()]
      .flatMap(([objectHash, candidates]) =>
        capCandidatesByClassification(candidates).map((candidate) => ({
          objectHash,
          candidate,
        })),
      )
      .sort((left, right) =>
        compareCodeUnits(left.objectHash, right.objectHash) ||
        compareCandidates(left.candidate, right.candidate),
      )
      .map(({ candidate }) => ({
        current: candidate.object,
        depth: candidate.depth,
        path: candidate.path,
      }));
  }
  const entries = [...candidatesByObject.entries()]
    .map(([objectHash, candidates]) => ({
      objectHash,
      entry: entryFromCandidates(candidates[0]?.object ?? input.subject, candidates),
    }))
    .sort((left, right) => compareCodeUnits(left.objectHash, right.objectHash))
    .map(({ entry }) => entry);
  const frontier: ImpactFrontier = {
    direct: entries.filter((entry) => entry.classification === "direct").sort(compareEntries),
    indirect: entries.filter((entry) => entry.classification === "indirect").sort(compareEntries),
    potential: entries.filter((entry) => entry.classification === "potential").sort(compareEntries),

    boundary: entries.filter((entry) => entry.depth === input.maxDepth).sort(compareEntries),
  };
  const usedRelations = orderedRelations.filter(({ id }) => reachableRelationIds.has(id));
  const usedAssessments = usedRelations.map(
    (relation) => relationAssessments.get(relation.id) ?? createImpactRelationAssessment({
      relation,
      currentVersionSet: input.currentVersionSet,
      evidenceSnapshot: input.evidenceSnapshot,
      classificationFacts,
    }),
  );
  const evidenceIssues: ImpactEvidenceIssue[] = usedAssessments
    .filter(({ evidenceStatus }) => evidenceStatus !== "verified")
    .map(({ relation, evidenceStatus }) => ({
      relationId: relation.id,
      status: evidenceStatus as Exclude<ImpactEvidenceStatus, "verified">,
    }))
    .sort((left, right) => compareCodeUnits(left.relationId, right.relationId));
  const effectiveClassificationFacts: ImpactClassificationFact[] = [];
  for (const assessment of usedAssessments) {
    const supplied = boundClassificationFacts.filter(({ relationId }) => relationId === assessment.relation.id);
    const normalized = supplied.map((fact) =>
      fact.evidenceClass === assessment.evidenceClass
        ? fact
        : createImpactClassificationFact({
            ...fact,
            evidenceClass: assessment.evidenceClass,
          }),
    );
    if (normalized.length > 0) {
      effectiveClassificationFacts.push(...normalized);
      continue;
    }
    const evidenceReference = assessment.relation.revisionProvenance.evidence[0]?.evidenceReference;
    if (evidenceReference !== undefined) {
      effectiveClassificationFacts.push(
        createImpactClassificationFact({
          relationId: assessment.relation.id,
          evidenceReference,
          evidenceClass: assessment.evidenceClass,
        }),
      );
    }
  }
  const readSet = buildReadSet({
    relations: usedRelations,
    classificationFacts: effectiveClassificationFacts,
    basedOnVersionSet: input.currentVersionSet,
    evidenceSnapshot: input.evidenceSnapshot,
  });
  const evidenceIntegrityStatus: ImpactEvidenceIntegrityStatus =
    evidenceIssues.length === 0 ? "verified" : "degraded";
  const resultCore = {
    id,
    novelId,
    subject: input.subject,
    maxDepth: input.maxDepth,
    readSet,
    basedOnVersionSet: readSet.basedOnVersionSet,
    evidenceSnapshot: readSet.evidenceSnapshot,
    frontier,
    affectedObjects: deepFreeze(
      [...frontier.direct, ...frontier.indirect, ...frontier.potential].map(
        (entry) => entry.object,
      ),
    ),
    staleness: worstStaleness(usedAssessments.map(({ staleness }) => staleness)),
    evidenceIntegrityStatus,
    evidenceIssues: deepFreeze(evidenceIssues),
    computedAt: new Date(input.computedAt.getTime()),
  };
  return deepFreeze({
    ...resultCore,
    contentHash: hashContent(canonicalJson(resultCore)),
  });
}

export function impactReadSetVersion(
  readSet: Omit<ImpactReadSet, "version">,
): string {
  const { version: _version, ...core } = readSet as ImpactReadSet;
  return hashContent(canonicalJson(core));
}

export function assertImpactAnalysisResultIntegrity(result: ImpactAnalysisResult): void {
  assertImpactEvidenceSnapshotBindings(result.evidenceSnapshot);
  assertImpactEvidenceSnapshotBindings(result.readSet.evidenceSnapshot);
  if (canonicalJson(result.evidenceSnapshot) !== canonicalJson(result.readSet.evidenceSnapshot)) {
    throw new Error("Impact evidence snapshot must match read set evidence snapshot");
  }
  for (const fact of result.readSet.classificationFacts) {
    createImpactClassificationFact(fact);
    const relation = result.readSet.relations.find(({ id }) => id === fact.relationId);
    if (!relation) {
      throw new Error(`Impact classification fact relation is unbound: ${fact.relationId}`);
    }
    const expected = relation.revisionProvenance.evidence.find(
      ({ evidenceReference }) => evidenceReference === fact.evidenceReference,
    );
    if (!expected) {
      throw new Error(`Impact classification fact evidence is unbound: ${fact.evidenceReference}`);
    }
    const resolution = resolveObservation(result.readSet.evidenceSnapshot, expected);
    if (resolution.status !== "observed") {
      throw new Error("Impact classification fact Observation source/hash mismatch");
    }
  }
  const assessments = result.readSet.relations.map((relation) =>
    createImpactRelationAssessment({
      relation,
      currentVersionSet: result.readSet.basedOnVersionSet,
      evidenceSnapshot: result.readSet.evidenceSnapshot,
      classificationFacts: result.readSet.classificationFacts,
    }),
  );
  const normalizedFacts: ImpactClassificationFact[] = [];
  for (const assessment of assessments) {
    const supplied = result.readSet.classificationFacts.filter(
      ({ relationId }) => relationId === assessment.relation.id,
    );
    if (supplied.length > 0) {
      normalizedFacts.push(
        ...supplied.map((fact) =>
          fact.evidenceClass === assessment.evidenceClass
            ? fact
            : createImpactClassificationFact({
                ...fact,
                evidenceClass: assessment.evidenceClass,
              }),
        ),
      );
      continue;
    }
    const evidenceReference = assessment.relation.revisionProvenance.evidence[0]?.evidenceReference;
    if (evidenceReference !== undefined) {
      normalizedFacts.push(
        createImpactClassificationFact({
          relationId: assessment.relation.id,
          evidenceReference,
          evidenceClass: assessment.evidenceClass,
        }),
      );
    }
  }
  normalizedFacts.sort(
    (left, right) =>
      compareCodeUnits(left.relationId, right.relationId) ||
      compareCodeUnits(left.evidenceReference, right.evidenceReference) ||
      compareCodeUnits(left.evidenceClass, right.evidenceClass),
  );
  if (canonicalJson(normalizedFacts) !== canonicalJson(result.readSet.classificationFacts)) {
    throw new Error("Impact classification facts are not normalized");
  }
  const assessmentByRelation = new Map(
    assessments.map((assessment) => [assessment.relation.id, assessment]),
  );
  for (const entry of [...result.frontier.direct, ...result.frontier.indirect, ...result.frontier.potential]) {
    if (entry.classification !== completePathClassification(entry.path)) {
      throw new Error("Impact frontier classification is not normalized");
    }
    for (const step of entry.path) {
      const assessment = assessmentByRelation.get(step.relationId);
      if (
        !assessment ||
        step.classification !== assessment.classification ||
        step.evidenceClass !== assessment.evidenceClass
      ) {
        throw new Error("Impact frontier path is not normalized");
      }
    }
  }
  const frontierObjects = [...result.frontier.direct, ...result.frontier.indirect, ...result.frontier.potential]
    .map(({ object }) => canonicalDependencyObjectKey(dependencyObjectKey(object)))
    .sort(compareCodeUnits);
  const affectedObjects = result.affectedObjects
    .map((object) => canonicalDependencyObjectKey(dependencyObjectKey(object)))
    .sort(compareCodeUnits);
  if (canonicalJson(frontierObjects) !== canonicalJson(affectedObjects)) {
    throw new Error("Impact affectedObjects do not match frontier");
  }
  const expectedVersion = impactReadSetVersion(result.readSet);
  if (result.readSet.version !== expectedVersion) {
    throw new Error("Impact read set version does not match read set content");
  }
  const { contentHash, ...resultCore } = result;
  const expectedContentHash = hashContent(canonicalJson(resultCore));
  if (contentHash !== expectedContentHash) {
    throw new Error("Impact result contentHash does not match result content");
  }
}
