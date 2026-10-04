import { describe, expect, it } from "vitest";
import { DependencyImpactApplicationService } from "../../src/dependency/application/dependencyImpactService";
import { createInMemoryDependencyImpactPersistence } from "../../src/dependency/application/dependencyImpactPersistence";
import {
  createDependencyIdentity,
  createDependencyRelationFact,
  createDependencyRevisionProvenance,
  type DependencyIdentity,
  type DependencyRelationFact,
} from "../../src/dependency/domain/dependencyRegistry";
import {
  computeImpactAnalysis,
  createImpactClassificationFact,
  createImpactEvidenceSnapshotProvenance,
  impactReadSetVersion,
} from "../../src/dependency/domain/impactAnalysis";
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

const now = new Date("2026-10-04T08:00:00.000Z");
const novelId = "novel-round3";

function identity(objectId: string, aggregateType: DependencyIdentity["aggregateType"] = "Scene", revisionId = `${objectId}-rev-1`) {
  return createDependencyIdentity({ novelId, aggregateType, objectId, revisionId });
}

function observation(id: string, ordinal: number, hash = `hash-${id}`, type = `impact-${id}`): Observation<ValidationEvidence> {
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
      type,
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
      identity: "round3-snapshot",
      version: "snapshot-1",
      hash: "round3-snapshot-hash",
    }),
    observations,
  });
}

function versionSet(...identities: DependencyIdentity[]): VersionSet {
  return createVersionSet(
    Object.fromEntries(
      identities.map((entry) => [
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
  sourceKind?: "structural" | "commit-derived" | "explicit" | "ai_suggested";
  lifecycle?: "derived" | "recomputed" | "produced" | "active" | "proposed" | "confirmed" | "revalidated" | "superseded" | "retired" | "suggested" | "rejected";
  lastConfirmedAt?: Date;
  lastRevalidatedAt?: Date;
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
    lastConfirmedAt: input.lastConfirmedAt,
    lastRevalidatedAt: input.lastRevalidatedAt,
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

function input(relations: DependencyRelationFact[], observations: readonly Observation<ValidationEvidence>[], classificationFacts: readonly ReturnType<typeof createImpactClassificationFact>[] = []) {
  return {
    id: "impact-round3",
    novelId,
    subject: identity("subject"),
    relations,
    currentVersionSet: versionSet(
      identity("subject"),
      ...relations.flatMap(({ dependent, dependency }) => [dependent, dependency]),
    ),
    evidenceSnapshot: snapshot(observations),
    classificationFacts,
    maxDepth: 3,
    computedAt: now,
  } as never;
}

describe("Task2.3 round3 path/integrity/layer contracts [task:2.3]", () => {
  it("[domain] never promotes a potential path prefix to direct", () => {
    const potentialPrefix = relation({
      id: "potential-prefix",
      dependent: identity("mid", "StateRecord"),
      dependency: identity("subject"),
      sourceKind: "ai_suggested",
      lifecycle: "suggested",
    });
    const definiteTarget = relation({
      id: "definite-target",
      dependent: identity("target"),
      dependency: identity("mid", "StateRecord"),
    });
    const result = computeImpactAnalysis(
      input(
        [potentialPrefix, definiteTarget],
        [observation("potential-prefix", 1), observation("definite-target", 2)],
        [
          createImpactClassificationFact({
            relationId: "potential-prefix",
            evidenceReference: "validation:potential-prefix",
            evidenceClass: "potential",
          }),
          createImpactClassificationFact({
            relationId: "definite-target",
            evidenceReference: "validation:definite-target",
            evidenceClass: "definite_direct",
          }),
        ],
      ),
    );
    const target = result.frontier.potential.find(({ object }) => object.objectId === "target");
    expect(target?.classification).toBe("potential");
  });

  it("[domain] classifies a complete path from every step and preserves alternative paths", () => {
    const direct = relation({ id: "direct", dependent: identity("target"), dependency: identity("subject") });
    const indirect = relation({ id: "indirect", dependent: identity("target"), dependency: identity("subject") });
    const result = computeImpactAnalysis(
      input(
        [direct, indirect],
        [observation("direct", 1), observation("indirect", 2)],
        [
          createImpactClassificationFact({ relationId: "direct", evidenceReference: "validation:direct", evidenceClass: "definite_direct" }),
          createImpactClassificationFact({ relationId: "indirect", evidenceReference: "validation:indirect", evidenceClass: "definite_indirect" }),
        ],
      ),
    );
    const target = result.frontier.direct.find(({ object }) => object.objectId === "target");
    expect(target?.classification).toBe("direct");
    expect(target?.provenancePaths).toHaveLength(2);
  });

  it("[domain] rejects invalid or unbound classification facts and nested evidence tampering", () => {
    expect(() =>
      createImpactClassificationFact({
        relationId: "relation",
        evidenceReference: "validation:relation",
        evidenceClass: "bogus" as never,
      }),
    ).toThrow("Unsupported impact evidence class");

    const fact = relation({ id: "edge", dependent: identity("target"), dependency: identity("subject") });
    const valid = input(
      [fact],
      [observation("edge", 1)],
      [createImpactClassificationFact({ relationId: "edge", evidenceReference: "validation:edge", evidenceClass: "definite_direct" })],
    );
    const result = computeImpactAnalysis(valid);
    const unbound = {
      ...result,
      readSet: {
        ...result.readSet,
        classificationFacts: [
          createImpactClassificationFact({
            relationId: "missing",
            evidenceReference: "validation:missing",
            evidenceClass: "definite_direct",
          }),
        ],
        version: "",
      },
      contentHash: "",
    };
    expect(() => impactReadSetVersion(unbound.readSet)).not.toThrow();
    expect(() =>
      createImpactEvidenceSnapshotProvenance({
        sourceReference: createSourceReference({ identity: "bad", version: "v", hash: "h" }),
        observations: [
          createObservation<ValidationEvidence>({
            evidenceReference: "validation:bad",
            sourceReference: createSourceReference({ identity: "bad", version: "v", hash: "outer" }),
            ordinal: 1,
            data: {
              id: "bad",
              type: "bad",
              sourceReference: { identity: "bad", version: "v", hash: "inner" },
              observation: "bad",
            },
          }),
        ],
      }),
    ).toThrow("ValidationEvidence sourceReference must match Observation sourceReference");
  });

  it("[domain] does not derive definite Layer2 classification for AI suggestions without classification facts", () => {
    const aiFact = relation({
      id: "ai-fact",
      dependent: identity("ai-target"),
      dependency: identity("subject"),
      sourceKind: "ai_suggested",
      lifecycle: "suggested",
    });
    const result = computeImpactAnalysis(
      input([aiFact], [observation("ai-fact", 1, "hash-ai-fact", "impact-definite-direct")]),
    );
    const entry = result.frontier.potential.find(({ object }) => object.objectId === "ai-target");
    expect(entry?.classification).toBe("potential");
    expect(result.readSet.classificationFacts[0]?.evidenceClass).toBe("potential");
    const forced = computeImpactAnalysis(
      input([aiFact], [observation("ai-fact", 1, "hash-ai-fact", "impact-definite-direct")], [
        createImpactClassificationFact({
          relationId: "ai-fact",
          evidenceReference: "validation:ai-fact",
          evidenceClass: "definite_direct",
        }),
      ]),
    );
    expect(forced.frontier.direct).toEqual([]);
    expect(forced.frontier.potential[0]?.classification).toBe("potential");
  });

  it("[recovery] recomputes content hash and rejects fact/read-set tampering", async () => {
    const persistence = createInMemoryDependencyImpactPersistence();
    const service = new DependencyImpactApplicationService(persistence);
    const fact = relation({ id: "edge", dependent: identity("target"), dependency: identity("subject") });
    await service.recordRelations({ relations: [fact] });
    const result = await service.analyzeImpact({
      analysisId: "impact-round3-integrity",
      novelId,
      subject: identity("subject"),
      currentVersionSet: versionSet(identity("subject"), identity("target")),
      evidenceSource: { snapshot: async () => snapshot([observation("edge", 1)]) },
      classificationFacts: [
        createImpactClassificationFact({ relationId: "edge", evidenceReference: "validation:edge", evidenceClass: "definite_direct" }),
      ],
      maxDepth: 1,
      computedAt: now,
    } as never);

    await expect(
      service.recordImpactAnalysis({ ...result, id: "tampered-content", contentHash: "bad" } as never),
    ).rejects.toMatchObject({ code: "impact_result_conflict" });
    await expect(
      service.recordImpactAnalysis({
        ...result,
        id: "tampered-fact",
        readSet: {
          ...result.readSet,
          classificationFacts: [
            createImpactClassificationFact({
              relationId: "missing",
              evidenceReference: "validation:missing",
              evidenceClass: "definite_direct",
            }),
          ],
        },
      } as never),
    ).rejects.toMatchObject({ code: "evidence_integrity" });
  });
});
