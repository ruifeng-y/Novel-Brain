import { describe, expect, it } from "vitest";
import {
  computeImpactAnalysis,
  createImpactClassificationFact,
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

const computedAt = new Date("2026-10-04T04:00:00.000Z");
const novelId = "novel-impact-review";

function identity(
  objectId: string,
  aggregateType: DependencyIdentity["aggregateType"] = "Scene",
  revisionId = `${objectId}-rev-1`,
): DependencyIdentity {
  return createDependencyIdentity({ novelId, aggregateType, objectId, revisionId });
}

function validationData(
  id: string,
  sourceReference: ReturnType<typeof createSourceReference>,
): ValidationEvidence {
  return {
    id,
    type: "impact-evidence",
    sourceReference: {
      identity: sourceReference.identity,
      version: sourceReference.version,
      hash: sourceReference.hash,
    },
    observation: "Impact evidence.",
  };
}

function observation(
  id: string,
  options: { ordinal: number; hash?: string },
): Observation<ValidationEvidence> {
  const sourceReference = createSourceReference({
    identity: `source-${id}`,
    version: "source-rev-1",
    hash: options.hash ?? `hash-${id}`,
  });
  return createObservation<ValidationEvidence>({
    evidenceReference: `validation:${id}`,
    sourceReference,
    ordinal: options.ordinal,
    data: validationData(id, sourceReference),
  });
}

function snapshot(observations: readonly Observation<ValidationEvidence>[]): ObservationSnapshot<ValidationEvidence> {
  return createObservationSnapshot<ValidationEvidence>({
    sourceReference: createSourceReference({
      identity: "impact-evidence-snapshot",
      version: "snapshot-1",
      hash: `snapshot-${observations.map(({ evidenceReference }) => evidenceReference).join("_")}`,
    }),
    observations,
  });
}

function versionSet(...entries: DependencyIdentity[]): VersionSet {
  return createVersionSet(
    Object.fromEntries(
      entries.map((entry) => [
        entry.objectId,
        createVersionReference(entry.aggregateType, entry.objectId, entry.revisionId),
      ]),
    ),
  );
}

function relation(input: {
  id: string;
  dependent: DependencyIdentity;
  dependency: DependencyIdentity;
  impactClassification?: "direct" | "indirect" | "potential";
  lifecycle?: "proposed" | "active" | "superseded" | "retired";
  versionSet?: VersionSet;
  evidenceId?: string;
}): DependencyRelationFact {
  const evidenceId = input.evidenceId ?? input.id;
  const evidence = observation(evidenceId, { ordinal: 1 });
  return createDependencyRelationFact({
    id: input.id,
    novelId,
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
        novelId,
        createdAt: computedAt,
      }),
      dependent: input.dependent,
      dependency: input.dependency,
      versionSet: input.versionSet ?? versionSet(input.dependent, input.dependency),
      evidence: [evidence],
    }),
    createdAt: computedAt,
  });
}

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
function analysisInput(relations: DependencyRelationFact[], observations: readonly Observation<ValidationEvidence>[]) {
  return {
    id: "impact-review",
    novelId,
    subject: identity("subject"),
    relations,
    currentVersionSet: versionSet(
      identity("subject"),
      ...relations.flatMap(({ dependent, dependency }) => [dependent, dependency]),
    ),
    evidenceSnapshot: snapshot(observations),
    classificationFacts: factsFor(relations, observations),
    maxDepth: 3,
    computedAt,
  };
}

describe("Impact classification and provenance review contracts [task:2.3]", () => {
  it("[domain] classifies same-depth facts by relation classification, lifecycle, and evidence", () => {
    const direct = relation({
      id: "relation-direct",
      dependent: identity("direct-target"),
      dependency: identity("subject"),

    });
    const indirect = relation({
      id: "relation-indirect",
      impactClassification: "indirect",
      dependent: identity("indirect-target"),
      dependency: identity("subject"),

    });
    const pending = relation({
      id: "relation-pending",
      dependent: identity("pending-target"),
      dependency: identity("subject"),

      lifecycle: "proposed",
    });
    const mismatched = relation({
      id: "relation-mismatch",
      dependent: identity("mismatch-target"),
      dependency: identity("subject"),

      evidenceId: "mismatch",
    });
    const evidenceSnapshot = snapshot([
      observation("relation-direct", { ordinal: 1 }),
      observation("relation-indirect", { ordinal: 2 }),
      observation("relation-pending", { ordinal: 3 }),
      observation("mismatch", { ordinal: 4, hash: "different-hash" }),
    ]);

    const result = computeImpactAnalysis(
      analysisInput([direct, indirect, pending, mismatched], evidenceSnapshot.observations),
    );

    expect(result.frontier.direct.map(({ object }) => object.objectId)).toEqual(["direct-target"]);
    expect(result.frontier.indirect.map(({ object }) => object.objectId)).toEqual(["indirect-target"]);
    expect(result.frontier.potential.map(({ object }) => object.objectId).sort()).toEqual(
      ["mismatch-target", "pending-target"].sort(),
    );
  });

  it("[domain] stores immutable evidence snapshot provenance and versioned read set", () => {
    const direct = relation({
      id: "relation-direct",
      dependent: identity("direct-target"),
      dependency: identity("subject"),
    });
    const evidenceSnapshot = snapshot([observation("relation-direct", { ordinal: 1 })]);
    const result = computeImpactAnalysis(
      analysisInput([direct], evidenceSnapshot.observations),
    );

    expect(result.evidenceSnapshot.sourceReference).toEqual(evidenceSnapshot.sourceReference);
    expect(result.evidenceSnapshot.observations).toEqual(evidenceSnapshot.observations);
    expect(result.evidenceSnapshot.hash).toHaveLength(64);
    expect(result.readSet.version).toHaveLength(64);
    expect(result.readSet.evidenceSnapshot).toEqual(result.evidenceSnapshot);
    expect(Object.isFrozen(result.evidenceSnapshot)).toBe(true);
    expect(Object.isFrozen(result.evidenceSnapshot.observations)).toBe(true);
    expect(result.evidenceIntegrityStatus).toBe("verified");
  });

  it("[domain] excludes unreachable and over-horizon relation evidence from staleness and issues", () => {
    const reachable = relation({
      id: "reachable",
      dependent: identity("reachable-target"),
      dependency: identity("subject"),
    });
    const overHorizon = relation({
      id: "over-horizon",
      dependent: identity("over-horizon-target", "StateRecord"),
      dependency: identity("reachable-target"),
      evidenceId: "over-horizon",
    });
    const unreachable = relation({
      id: "unreachable",
      dependent: identity("unreachable-target", "StateRecord"),
      dependency: identity("unreachable-source"),
      evidenceId: "unreachable",
    });
    const evidenceSnapshot = snapshot([
      observation("reachable", { ordinal: 1 }),
      observation("over-horizon", { ordinal: 2, hash: "bad-over-horizon" }),
      observation("unreachable", { ordinal: 3, hash: "bad-unreachable" }),
    ]);

    const result = computeImpactAnalysis({
      ...analysisInput([reachable, overHorizon, unreachable], evidenceSnapshot.observations),
      currentVersionSet: versionSet(
        identity("subject"),
        identity("reachable-target"),
        identity("over-horizon-target", "StateRecord", "over-horizon-target-rev-2"),
        identity("unreachable-target", "StateRecord", "unreachable-target-rev-2"),
        identity("unreachable-source"),
      ),
      maxDepth: 1,
    });

    expect(result.evidenceIssues).toEqual([]);
    expect(result.staleness).toBe("fresh");
    expect(result.readSet.relations.map(({ id }) => id)).toEqual(["reachable"]);
  });

  it("[domain] sorts relation provenance and frontier with stable UTF-8 code-unit order", () => {
    const targetB = identity("B");
    const targetLowerA = identity("a");
    const targetAccented = identity("Á");
    const relationB = relation({
      id: "B",
      dependent: targetB,
      dependency: identity("subject"),
    });
    const relationLowerA = relation({
      id: "a",
      dependent: targetLowerA,
      dependency: identity("subject"),
    });
    const relationAccented = relation({
      id: "Á",
      dependent: targetAccented,
      dependency: identity("subject"),
    });

    const result = computeImpactAnalysis(
      analysisInput(
        [relationAccented, relationLowerA, relationB],
        [
          observation("Á", { ordinal: 1 }),
          observation("a", { ordinal: 2 }),
          observation("B", { ordinal: 3 }),
        ],
      ),
    );

    expect(result.frontier.direct.map(({ object }) => object.objectId)).toEqual(["B", "a", "Á"]);
    expect(result.readSet.relations.map(({ id }) => id)).toEqual(["B", "a", "Á"]);
  });

  it("[domain] keeps bounded alternative provenance paths through cycles without path explosion", () => {
    const viaB = relation({
      id: "via-b",
      dependent: identity("b", "StateRecord"),
      dependency: identity("subject"),
    });
    const viaC = relation({
      id: "via-c",
      dependent: identity("c", "CanonicalFact"),
      dependency: identity("subject"),
    });
    const bToTarget = relation({
      id: "b-to-target",
      dependent: identity("target"),
      dependency: identity("b", "StateRecord"),
    });
    const cToTarget = relation({
      id: "c-to-target",
      dependent: identity("target"),
      dependency: identity("c", "CanonicalFact"),
    });
    const cycle = relation({
      id: "cycle",
      dependent: identity("subject"),
      dependency: identity("target"),
    });
    const relations = [viaB, viaC, bToTarget, cToTarget, cycle];
    const result = computeImpactAnalysis(
      analysisInput(
        relations,
        relations.map(({ id }, index) => observation(id, { ordinal: index + 1 })),
      ),
    );

    const target = result.frontier.direct.find(({ object }) => object.objectId === "target");
    expect(target?.provenancePaths.map((path) => path.map(({ relationId }) => relationId))).toEqual([
      ["via-b", "b-to-target"],
      ["via-c", "c-to-target"],
    ]);
    expect(target?.provenancePaths.length).toBeLessThanOrEqual(4);
    expect(result.readSet.relations.map(({ id }) => id)).toContain("cycle");
  });

  it("[domain] replays read-set version, evidence provenance, and paths deterministically", () => {
    const first = relation({
      id: "first",
      dependent: identity("first-target"),
      dependency: identity("subject"),
    });
    const second = relation({
      id: "second",
      dependent: identity("second-target"),
      dependency: identity("subject"),

    });
    const observations = [
      observation("first", { ordinal: 1 }),
      observation("second", { ordinal: 2 }),
    ];
    const input = analysisInput([first, second], observations);
    const replay = computeImpactAnalysis(input);
    const reordered = computeImpactAnalysis({
      ...input,
      relations: [second, first],
      evidenceSnapshot: snapshot(observations),
    });

    expect(replay).toEqual(reordered);
    expect(replay.readSet.version).toBe(reordered.readSet.version);
  });
});
