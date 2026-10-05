import {
  createInMemoryDependencyImpactPersistence,
  type DependencyImpactPersistence,
} from "../../src/dependency/application/dependencyImpactPersistence";
import {
  createDependencyIdentity,
  createDependencyRevisionProvenance,
  createDependencyRelationFact,
  type DependencyIdentity,
} from "../../src/dependency/domain/dependencyRegistry";
import {
  computeImpactAnalysis,
  type ImpactAnalysisResult,
} from "../../src/dependency/domain/impactAnalysis";
import { createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import type { ValidationEvidence } from "../../src/production/domain/validationRun";
import {
  createObservation,
  createObservationSnapshot,
  createSourceReference,
  type Observation,
  type ObservationSource,
} from "../../src/shared/domain/observationSource";
import {
  createVersionReference,
  createVersionSet,
} from "../../src/shared/domain/versioning";

const computedAt = new Date("2026-10-05T00:00:00.000Z");

function identity(
  novelId: string,
  objectId: string,
  aggregateType: DependencyIdentity["aggregateType"],
): DependencyIdentity {
  return createDependencyIdentity({
    novelId,
    aggregateType,
    objectId,
    revisionId: `${objectId}:rev-1`,
  });
}

function validationEvidence(id: string): ValidationEvidence {
  return {
    id,
    type: "dependency-provenance",
    sourceReference: {
      identity: `source-${id}`,
      version: "source-rev-1",
      hash: `hash-${id}`,
    },
    observation: "Dependency provenance was observed.",
  };
}

function evidenceSource(
  evidence: readonly Observation<ValidationEvidence>[],
): ObservationSource<ValidationEvidence> {
  return {
    snapshot: async () =>
      createObservationSnapshot<ValidationEvidence>({
        sourceReference: createSourceReference({
          identity: "recall-attention-evidence-source",
          version: "snapshot-1",
          hash: "recall-attention-snapshot-hash",
        }),
        observations: evidence,
      }),
  };
}

/**
 * Builds a real dependency relation plus a genuinely stale ImpactAnalysisResult
 * for the given novel. Staleness is produced legitimately: the current
 * VersionSet has advanced past the revisions the relation was recorded
 * against, so the frozen staleness assessment reports "stale" without any
 * hand-mutated result payload.
 */
export async function computeStaleImpactResult(
  novelId: string,
  id = "impact-attention-1",
): Promise<ImpactAnalysisResult> {
  const subject = identity(novelId, "scene-attention", "Scene");
  const target = identity(novelId, "state-attention", "StateRecord");
  const recordedVersionSet = createVersionSet({
    scene: createVersionReference("Scene", subject.objectId, subject.revisionId),
    state: createVersionReference("StateRecord", target.objectId, target.revisionId),
  });
  const evidence: Observation<ValidationEvidence>[] = [
    createObservation<ValidationEvidence>({
      evidenceReference: "validation:relation-attention",
      sourceReference: createSourceReference(validationEvidence("relation-attention").sourceReference),
      ordinal: 1,
      data: validationEvidence("relation-attention"),
    }),
  ];
  const relation = createDependencyRelationFact({
    id: "relation-attention",
    novelId,
    family: "narrative",
    inverseSemantics: "inverse",
    sourceKind: "commit-derived",
    lifecycle: "active",
    relationType: "causes",
    dependent: target,
    dependency: subject,
    revisionProvenance: createDependencyRevisionProvenance({
      revision: createInitialChangeSetRevision({
        revisionId: "changeset-relation-attention:rev-1",
        changeSetId: "changeset-relation-attention",
        novelId,
        createdAt: computedAt,
      }),
      dependent: target,
      dependency: subject,
      versionSet: recordedVersionSet,
      evidence,
    }),
    createdAt: computedAt,
  });
  const advancedVersionSet = createVersionSet({
    scene: createVersionReference("Scene", subject.objectId, `${subject.objectId}:rev-2`),
    state: createVersionReference("StateRecord", target.objectId, target.revisionId),
  });

  return computeImpactAnalysis({
    id,
    novelId,
    subject,
    relations: [relation],
    currentVersionSet: advancedVersionSet,
    evidenceSnapshot: await evidenceSource(evidence).snapshot(),
    maxDepth: 1,
    computedAt,
  });
}

export interface SeededRecallImpactFixture {
  readonly persistence: DependencyImpactPersistence;
  readonly novelId: string;
  readonly impactResult: ImpactAnalysisResult;
}

/** Persists a stale impact result through the real dependency/impact repository. */
export async function seedStaleImpactRecallFixture(
  novelId = "novel-1",
): Promise<SeededRecallImpactFixture> {
  const persistence = createInMemoryDependencyImpactPersistence();
  const impactResult = await computeStaleImpactResult(novelId);
  await persistence.impactResults.saveIfAbsent(impactResult);
  return { persistence, novelId, impactResult };
}
