import { describe, expect, it } from "vitest";
import {
  computeImpactAnalysis,
  createImpactClassificationFact,
  createImpactEvidenceSnapshotProvenance,
} from "../../src/dependency/domain/impactAnalysis";
import {
  createDependencyIdentity,
  createDependencyRelationFact,
  createDependencyRevisionProvenance,
  type DependencyIdentity,
  type DependencyRelationFact,
} from "../../src/dependency/domain/dependencyRegistry";
import { createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import type { ValidationEvidence } from "../../src/production/domain/validationRun";
import {
  createObservation,
  createObservationSnapshot,
  createSourceReference,
  type Observation,
  type ObservationSnapshot,
} from "../../src/shared/domain/observationSource";
import {
  createVersionReference,
  createVersionSet,
  type VersionSet,
} from "../../src/shared/domain/versioning";

const computedAt = new Date("2026-10-04T01:00:00.000Z");

function factsFor(relations: readonly DependencyRelationFact[], observations: readonly Observation<ValidationEvidence>[]) {
  return relations.flatMap((relation) => {
    const expected = relation.revisionProvenance.evidence[0]!;
    const observed = observations.find(({ evidenceReference }) => evidenceReference === expected.evidenceReference);
    if (!observed || JSON.stringify(observed.sourceReference) !== JSON.stringify(expected.sourceReference)) return [];
    return [
      createImpactClassificationFact({
        relationId: relation.id,
        evidenceReference: expected.evidenceReference,
        evidenceClass: relation.id.includes("indirect")
          ? "definite_indirect"
          : relation.id.includes("pending") || relation.id.includes("mismatch")
            ? "potential"
            : "definite_direct",
      }),
    ];
  });
}
function computeWithFacts(input: Record<string, unknown>) {
  return computeImpactAnalysis({
    ...input,
    classificationFacts: input.classificationFacts ?? factsFor(input.relations as readonly DependencyRelationFact[], (input.evidenceSnapshot as ObservationSnapshot<ValidationEvidence>).observations),
  } as never);
}
function identity(objectId: string, aggregateType: DependencyIdentity["aggregateType"] = "Scene", revisionId = `${objectId}-rev-1`) {
  return createDependencyIdentity({
    novelId: "novel-1",
    aggregateType,
    objectId,
    revisionId,
  });
}

function evidence(id: string, ordinal: number, hash = `hash-${id}`): Observation<ValidationEvidence> {
  const sourceReference = createSourceReference({
    identity: `source-${id}`,
    version: "source-rev-1",
    hash,
  });
  return createObservation<ValidationEvidence>({
    evidenceReference: `validation:${id}`,
    sourceReference,
    ordinal,
    data: {
      id,
      type: "impact-evidence",
      sourceReference: {
        identity: sourceReference.identity,
        version: sourceReference.version,
        hash: sourceReference.hash,
      },
      observation: "Impact evidence.",
    },
  });
}

function snapshot(observations: readonly Observation<ValidationEvidence>[]): ObservationSnapshot<ValidationEvidence> {
  return createObservationSnapshot<ValidationEvidence>({
    sourceReference: createSourceReference({
      identity: "snapshot",
      version: "snapshot-1",
      hash: "snapshot-hash",
    }),
    observations,
  });
}

function versionSet(...identities: DependencyIdentity[]): VersionSet {
  return createVersionSet(
    Object.fromEntries(
      identities.map((identity) => [
        identity.objectId,
        createVersionReference(identity.aggregateType, identity.objectId, identity.revisionId),
      ]),
    ),
  );
}

function relation(input: {
  id: string;
  dependent: DependencyIdentity;
  dependency: DependencyIdentity;
  impactClassification?: "direct" | "indirect" | "potential";
  lifecycle?: "active" | "proposed";
  evidenceId?: string;
}): DependencyRelationFact {
  const evidenceId = input.evidenceId ?? input.id;
  return createDependencyRelationFact({
    id: input.id,
    novelId: "novel-1",
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
        novelId: "novel-1",
        createdAt: computedAt,
      }),
      dependent: input.dependent,
      dependency: input.dependency,
      versionSet: versionSet(input.dependent, input.dependency),
      evidence: [evidence(evidenceId, 1)],
    }),
    createdAt: computedAt,
  });
}

describe("ImpactAnalysis contracts [task:2.3]", () => {
  it("[domain] derives classes from classification and evidence facts rather than depth", () => {
    const relations = [
      relation({ id: "direct", dependent: identity("direct-target"), dependency: identity("subject") }),
      relation({
        id: "indirect",
        impactClassification: "indirect",
        dependent: identity("indirect-target"),
        dependency: identity("subject"),

      }),
      relation({
        id: "pending",
        dependent: identity("pending-target"),
        dependency: identity("subject"),
        lifecycle: "proposed",
      }),
    ];
    const result = computeWithFacts({
      id: "impact-classification",
      novelId: "novel-1",
      subject: identity("subject"),
      relations,
      currentVersionSet: versionSet(identity("subject"), identity("direct-target"), identity("indirect-target"), identity("pending-target")),
      evidenceSnapshot: snapshot([
        evidence("direct", 1),
        evidence("indirect", 2),
        evidence("pending", 3),
      ]),
      maxDepth: 1,
      computedAt,
    });

    expect(result.frontier.direct.map(({ object }) => object.objectId)).toEqual(["direct-target"]);
    expect(result.frontier.indirect.map(({ object }) => object.objectId)).toEqual(["indirect-target"]);
    expect(result.frontier.potential.map(({ object }) => object.objectId)).toEqual(["pending-target"]);
  });

  it("[domain] preserves immutable evidence provenance and a versioned read set", () => {
    const relationFact = relation({
      id: "direct",
      dependent: identity("direct-target"),
      dependency: identity("subject"),
    });
    const result = computeWithFacts({
      id: "impact-read-set",
      novelId: "novel-1",
      subject: identity("subject"),
      relations: [relationFact],
      currentVersionSet: versionSet(identity("subject"), identity("direct-target")),
      evidenceSnapshot: snapshot([evidence("direct", 1)]),
      maxDepth: 2,
      computedAt,
    });

    expect(result.readSet.version).toHaveLength(64);
    expect(result.evidenceSnapshot.hash).toHaveLength(64);
    expect(result.evidenceSnapshot).toEqual(result.readSet.evidenceSnapshot);
    expect(createImpactEvidenceSnapshotProvenance(result.evidenceSnapshot)).toEqual(
      result.evidenceSnapshot,
    );
  });

  it("[domain] aggregates only reachable horizon facts and keeps bounded cycle alternatives", () => {
    const relations = [
      relation({ id: "via-b", dependent: identity("b", "StateRecord"), dependency: identity("subject") }),
      relation({ id: "via-c", dependent: identity("c", "CanonicalFact"), dependency: identity("subject") }),
      relation({ id: "b-target", dependent: identity("target"), dependency: identity("b", "StateRecord") }),
      relation({ id: "c-target", dependent: identity("target"), dependency: identity("c", "CanonicalFact") }),
      relation({ id: "cycle", dependent: identity("subject"), dependency: identity("target") }),
      relation({ id: "unreachable", dependent: identity("unreachable-target", "StateRecord"), dependency: identity("unreachable-source"), evidenceId: "bad" }),
    ];
    const result = computeWithFacts({
      id: "impact-scope-cycle",
      novelId: "novel-1",
      subject: identity("subject"),
      relations,
      currentVersionSet: versionSet(
        identity("subject"),
        identity("b", "StateRecord"),
        identity("c", "CanonicalFact"),
        identity("target"),
        identity("unreachable-target", "StateRecord"),
        identity("unreachable-source"),
      ),
      evidenceSnapshot: snapshot([
        ...relations.slice(0, 5).map(({ id }, index) => evidence(id, index + 1)),
        evidence("bad", 6, "bad-hash"),
      ]),
      maxDepth: 3,
      computedAt,
    });

    expect(result.evidenceIssues).toEqual([]);
    const target = result.frontier.direct.find(({ object }) => object.objectId === "target");
    expect(target?.provenancePaths).toHaveLength(2);
    expect(result.readSet.relations.map(({ id }) => id)).toContain("cycle");
    expect(result.readSet.relations.map(({ id }) => id)).not.toContain("unreachable");
  });

  it("[domain] rejects invalid horizon contracts and replays content deterministically", () => {
    const relationFact = relation({
      id: "direct",
      dependent: identity("direct-target"),
      dependency: identity("subject"),
    });
    const input = {
      id: "impact-replay",
      novelId: "novel-1",
      subject: identity("subject"),
      relations: [relationFact],
      currentVersionSet: versionSet(identity("subject"), identity("direct-target")),
      evidenceSnapshot: snapshot([evidence("direct", 1)]),
      maxDepth: 2,
      computedAt,
    };
    const first = computeWithFacts(input);
    const replay = computeWithFacts({ ...input, relations: [relationFact] });

    expect(replay).toEqual(first);
    expect(() => computeWithFacts({ ...input, maxDepth: 0 })).toThrow(
      "maxDepth must be between 1 and 8",
    );
  });
});
