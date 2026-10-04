import type { DependencyImpactPersistence } from "../../src/dependency/application/dependencyImpactPersistence";
import {
  createDependencyIdentity,
  createDependencyRevisionProvenance,
  createDependencyRelationFact,
  type DependencyIdentity,
  type DependencyRelationFact,
} from "../../src/dependency/domain/dependencyRegistry";
import {
  createImpactClassificationFact,
  type ImpactClassificationFact,
} from "../../src/dependency/domain/impactAnalysis";
import { createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import type { ValidationEvidence } from "../../src/production/domain/validationRun";
import {
  createObservation,
  createObservationSnapshot,
  createSourceReference,
  type ObservationSource,
} from "../../src/shared/domain/observationSource";
import {
  createVersionReference,
  createVersionSet,
  type VersionSet,
} from "../../src/shared/domain/versioning";

const computedAt = new Date("2026-10-04T02:00:00.000Z");

export interface DependencyImpactVerificationEnvironment {
  readonly persistence: DependencyImpactPersistence;
  readonly subject: DependencyIdentity;
  readonly directTarget: DependencyIdentity;
  readonly indirectTarget: DependencyIdentity;
  readonly currentVersionSet: VersionSet;
  readonly directRelation: DependencyRelationFact;
  readonly indirectRelation: DependencyRelationFact;
  readonly evidenceSource: ObservationSource<ValidationEvidence>;
  readonly classificationFacts: readonly ImpactClassificationFact[];
  readonly mismatchedEvidenceSource: ObservationSource<ValidationEvidence>;
}

function identity(
  objectId: string,
  aggregateType: DependencyIdentity["aggregateType"],
  revisionId = `${objectId}-rev-1`,
): DependencyIdentity {
  return createDependencyIdentity({
    novelId: "novel-dependency-2.3",
    aggregateType,
    objectId,
    revisionId,
  });
}

function validationEvidence(id: string, hash = `hash-${id}`): ValidationEvidence {
  return {
    id,
    type: "dependency-provenance",
    sourceReference: {
      identity: `source-${id}`,
      version: "source-rev-1",
      hash,
    },
    observation: "Dependency provenance was observed.",
  };
}

function evidence(id: string, hash = `hash-${id}`, ordinal?: number) {
  const data = validationEvidence(id, hash);
  return createObservation<ValidationEvidence>({
    evidenceReference: `validation:${id}`,
    sourceReference: createSourceReference(data.sourceReference),
    ordinal: ordinal ?? (id === "relation-direct" ? 1 : 2),
    data,
  });
}

function observationSource(
  observations: ReturnType<typeof evidence>[],
): ObservationSource<ValidationEvidence> {
  const snapshot = createObservationSnapshot<ValidationEvidence>({
    sourceReference: createSourceReference({
      identity: "dependency-evidence-source",
      version: "snapshot-1",
      hash: `snapshot-hash-${observations.map(({ evidenceReference }) => evidenceReference).join("-")}`,
    }),
    observations,
  });
  return { snapshot: async () => snapshot };
}

function relation(input: {
  id: string;
  dependent: DependencyIdentity;
  dependency: DependencyIdentity;
  versionSet: VersionSet;
  impactClassification?: "direct" | "indirect" | "potential";
  lifecycle?: "proposed" | "active" | "superseded" | "retired";
}): DependencyRelationFact {
  const fact = createDependencyRelationFact({
    id: input.id,
    novelId: "novel-dependency-2.3",
    family: "narrative",
    inverseSemantics: "inverse",
    sourceKind: input.impactClassification === "potential" ? "ai_suggested" : input.lifecycle === "proposed" ? "explicit" : "commit-derived",
    lifecycle: input.lifecycle ?? (input.impactClassification === "potential" ? "suggested" : "active"),
    relationType: input.impactClassification === "indirect" ? "supports" : "causes",
    dependent: input.dependent,
    dependency: input.dependency,
    revisionProvenance: createDependencyRevisionProvenance({
      revision: createInitialChangeSetRevision({
        revisionId: `changeset-${input.id}:rev-1`,
        changeSetId: `changeset-${input.id}`,
        novelId: "novel-dependency-2.3",
        createdAt: computedAt,
      }),
      dependent: input.dependent,
      dependency: input.dependency,
      versionSet: input.versionSet,
      evidence: [evidence(input.id)],
    }),
    createdAt: computedAt,
  });
  return fact;
}

export function createDependencyImpactVerificationEnvironment(
  persistence: DependencyImpactPersistence,
): DependencyImpactVerificationEnvironment {
  const subject = identity("scene-impact", "Scene");
  const directTarget = identity("state-impact", "StateRecord");
  const indirectTarget = identity("fact-impact", "CanonicalFact");
  const currentVersionSet = createVersionSet({
    scene: createVersionReference("Scene", subject.objectId, subject.revisionId),
    state: createVersionReference(
      "StateRecord",
      directTarget.objectId,
      directTarget.revisionId,
    ),
    fact: createVersionReference(
      "CanonicalFact",
      indirectTarget.objectId,
      indirectTarget.revisionId,
    ),
  });
  const directRelation = relation({
    id: "relation-direct",
    dependent: directTarget,
    dependency: subject,
    versionSet: currentVersionSet,
  });
  const indirectRelation = relation({
    id: "relation-indirect",
    dependent: indirectTarget,
    dependency: directTarget,
    versionSet: currentVersionSet,
    impactClassification: "indirect",

  });

  return {
    persistence,
    subject,
    directTarget,
    indirectTarget,
    currentVersionSet,
    directRelation,
    indirectRelation,
    evidenceSource: observationSource([
      evidence("relation-direct"),
      evidence("relation-indirect"),
    ]),
    classificationFacts: [
      createImpactClassificationFact({
        relationId: "relation-direct",
        evidenceReference: "validation:relation-direct",
        evidenceClass: "definite_direct",
      }),
      createImpactClassificationFact({
        relationId: "relation-indirect",
        evidenceReference: "validation:relation-indirect",
        evidenceClass: "definite_indirect",
      }),
    ],
    mismatchedEvidenceSource: observationSource([
      evidence("relation-direct", "different-hash"),
      evidence("relation-indirect"),
    ]),
  };
}
