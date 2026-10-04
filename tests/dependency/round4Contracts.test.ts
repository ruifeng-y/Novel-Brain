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
} from "../../src/shared/domain/observationSource";
import {
  createVersionReference,
  createVersionSet,
  type VersionSet,
} from "../../src/shared/domain/versioning";

const now = new Date("2026-10-04T09:00:00.000Z");
const novelId = "novel-round4";

function identity(objectId: string, aggregateType: DependencyIdentity["aggregateType"] = "Scene", revisionId = `${objectId}-rev-1`) {
  return createDependencyIdentity({ novelId, aggregateType, objectId, revisionId });
}

function observation(id: string, ordinal: number): Observation<ValidationEvidence> {
  const sourceReference = createSourceReference({
    identity: `source-${id}`,
    version: "source-rev-1",
    hash: `hash-${id}`,
  });
  return createObservation<ValidationEvidence>({
    evidenceReference: `validation:${id}`,
    sourceReference,
    ordinal,
    data: {
      id,
      type: `evidence-${id}`,
      sourceReference: {
        identity: sourceReference.identity,
        version: sourceReference.version,
        hash: sourceReference.hash,
      },
      observation: "Evidence.",
    },
  });
}

function snapshot(observations: readonly Observation<ValidationEvidence>[]) {
  return createObservationSnapshot<ValidationEvidence>({
    sourceReference: createSourceReference({
      identity: "round4-snapshot",
      version: "snapshot-1",
      hash: "round4-snapshot-hash",
    }),
    observations,
  });
}

function versionSet(...identities: DependencyIdentity[]): VersionSet {
  return createVersionSet(
    Object.fromEntries(
      identities.map((entry) => [
        `${entry.objectId}-${entry.revisionId}`,
        createVersionReference(entry.aggregateType, entry.objectId, entry.revisionId),
      ]),
    ),
  );
}

function relation(input: {
  id: string;
  dependent: DependencyIdentity;
  dependency: DependencyIdentity;
  lifecycle?: "active" | "proposed";
  sourceKind?: "commit-derived" | "explicit";
}): DependencyRelationFact {
  return createDependencyRelationFact({
    id: input.id,
    novelId,
    family: "causal",
    relationType: "causes",
    inverseSemantics: "inverse",
    inverseRelationType: "affects",
    sourceKind: input.sourceKind ?? "commit-derived",
    lifecycle: input.lifecycle ?? "active",
    dependent: input.dependent,
    dependency: input.dependency,
    revisionProvenance: createDependencyRevisionProvenance({
      revision: createInitialChangeSetRevision({
        revisionId: `changeset-${input.id}:rev-1`,
        changeSetId: `changeset-${input.id}`,
        novelId,
        createdAt: now,
      }),
      dependent: input.dependent,
      dependency: input.dependency,
      versionSet: versionSet(input.dependent, input.dependency),
      evidence: [observation(input.id, 1)],
    }),
    createdAt: now,
  });
}

describe("Task2.3 round4 frontier and cap contracts [task:2.3]", () => {
  it("[domain] exposes exact Direct/Indirect/Potential frontier and covers every affected object", () => {
    const definite = relation({
      id: "definite",
      dependent: identity("direct-target"),
      dependency: identity("subject"),
    });
    const indeterminate = relation({
      id: "indeterminate",
      dependent: identity("potential-target"),
      dependency: identity("subject"),
      lifecycle: "proposed",
      sourceKind: "explicit",
    });
    const result = computeImpactAnalysis({
      id: "impact-round4-coverage",
      novelId,
      subject: identity("subject"),
      relations: [definite, indeterminate],
      classificationFacts: [
        createImpactClassificationFact({
          relationId: "definite",
          evidenceReference: "validation:definite",
          evidenceClass: "definite_direct",
        }),
      ],
      currentVersionSet: versionSet(
        identity("subject"),
        identity("direct-target"),
        identity("potential-target"),
      ),
      evidenceSnapshot: snapshot([observation("definite", 1), observation("indeterminate", 2)]),
      maxDepth: 1,
      computedAt: now,
    });

    expect(Object.keys(result.frontier).sort()).toEqual([
      "boundary",
      "direct",
      "indirect",
      "potential",
    ]);
    expect(result.frontier.direct.map(({ object }) => object.objectId)).toEqual([
      "direct-target",
    ]);
    expect(result.frontier.potential.map(({ object }) => object.objectId)).toEqual([
      "potential-target",
    ]);
    const bucketObjects = [
      ...result.frontier.direct,
      ...result.frontier.indirect,
      ...result.frontier.potential,
    ].map(({ object }) => object.objectId);
    expect(result.affectedObjects.map(({ objectId }) => objectId).sort()).toEqual(
      bucketObjects.sort(),
    );
    expect(result.affectedObjects.map(({ objectId }) => objectId).sort()).toEqual(
      ["direct-target", "potential-target"],
    );
  });

  it("[domain] uses potential for missing classification facts and rejects non-spec evidence enums", () => {
    const fact = relation({
      id: "no-fact",
      dependent: identity("no-fact-target"),
      dependency: identity("subject"),
    });
    const result = computeImpactAnalysis({
      id: "impact-round4-no-fact",
      novelId,
      subject: identity("subject"),
      relations: [fact],
      currentVersionSet: versionSet(identity("subject"), identity("no-fact-target")),
      evidenceSnapshot: snapshot([observation("no-fact", 1)]),
      maxDepth: 1,
      computedAt: now,
    });

    expect(result.frontier.potential.map(({ object }) => object.objectId)).toEqual([
      "no-fact-target",
    ]);
    expect(result.affectedObjects.map(({ objectId }) => objectId)).toEqual([
      "no-fact-target",
    ]);
    expect(() =>
      createImpactClassificationFact({
        relationId: "no-fact",
        evidenceReference: "validation:no-fact",
        evidenceClass: "unknown" as never,
      }),
    ).toThrow("Unsupported impact evidence class");
  });

  it("[domain] keeps deeper definite paths before shallow potential cap alternatives", () => {
    const shallowPotential: DependencyRelationFact[] = [];
    const observations: Observation<ValidationEvidence>[] = [];
    for (let index = 0; index < 4; index += 1) {
      const id = `shallow-${index}`;
      shallowPotential.push(
        relation({
          id,
          dependent: identity("target"),
          dependency: identity("subject"),
          lifecycle: "proposed",
          sourceKind: "explicit",
        }),
      );
      observations.push(observation(id, index + 1));
    }
    const deepPrefix = relation({
      id: "deep-prefix",
      dependent: identity("mid", "StateRecord"),
      dependency: identity("subject"),
    });
    const deepDefinite = relation({
      id: "deep-definite",
      dependent: identity("target"),
      dependency: identity("mid", "StateRecord"),
    });
    observations.push(observation("deep-prefix", 5), observation("deep-definite", 6));

    const result = computeImpactAnalysis({
      id: "impact-round4-cap",
      novelId,
      subject: identity("subject"),
      relations: [...shallowPotential, deepPrefix, deepDefinite],
      classificationFacts: [
        ...shallowPotential.map(({ id }) =>
          createImpactClassificationFact({
            relationId: id,
            evidenceReference: `validation:${id}`,
            evidenceClass: "potential",
          }),
        ),
        createImpactClassificationFact({
          relationId: "deep-prefix",
          evidenceReference: "validation:deep-prefix",
          evidenceClass: "definite_direct",
        }),
        createImpactClassificationFact({
          relationId: "deep-definite",
          evidenceReference: "validation:deep-definite",
          evidenceClass: "definite_direct",
        }),
      ],
      currentVersionSet: versionSet(
        identity("subject"),
        identity("mid", "StateRecord"),
        identity("target"),
        ...shallowPotential.map(({ dependent }) => dependent),
      ),
      evidenceSnapshot: snapshot(observations),
      maxDepth: 2,
      computedAt: now,
    });

    const target = result.frontier.direct.find(({ object }) => object.objectId === "target");
    expect(target?.classification).toBe("direct");
    expect(
      target?.provenancePaths.some((path) =>
        path.map(({ relationId }) => relationId).join(",") === "deep-prefix,deep-definite",
      ),
    ).toBe(true);
    expect(target?.provenancePaths.length).toBeGreaterThan(4);
  });
});
