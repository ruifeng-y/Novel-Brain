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

const now = new Date("2026-10-04T06:00:00.000Z");
const novelId = "novel-round2";

function identity(objectId: string, aggregateType: DependencyIdentity["aggregateType"] = "Scene", revisionId = `${objectId}-rev-1`) {
  return createDependencyIdentity({ novelId, aggregateType, objectId, revisionId });
}

function observation(id: string, ordinal: number, hash = `hash-${id}`): Observation<ValidationEvidence> {
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
      type: `impact-${id}`,
      sourceReference: {
        identity: sourceReference.identity,
        version: sourceReference.version,
        hash: sourceReference.hash,
      },
      observation: "Impact evidence.",
    },
  });
}

function snapshot(observations: readonly Observation<ValidationEvidence>[]) {
  return createObservationSnapshot<ValidationEvidence>({
    sourceReference: createSourceReference({
      identity: "round2-snapshot",
      version: "snapshot-1",
      hash: "round2-snapshot-hash",
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

function relationInput(input: {
  id: string;
  dependent: DependencyIdentity;
  dependency: DependencyIdentity;
  sourceKind?: "structural" | "commit-derived" | "explicit" | "ai_suggested";
  lifecycle?: "derived" | "recomputed" | "produced" | "active" | "proposed" | "confirmed" | "revalidated" | "superseded" | "retired" | "suggested" | "rejected";
  lastConfirmedAt?: Date;
  lastRevalidatedAt?: Date;
}) {
  return {
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
  };
}

function relation(input: Parameters<typeof relationInput>[0]): DependencyRelationFact {
  return createDependencyRelationFact(relationInput(input) as never);
}

function analysis(relations: DependencyRelationFact[], observations: readonly Observation<ValidationEvidence>[], classificationFacts: readonly ReturnType<typeof createImpactClassificationFact>[] = []) {
  return {
    id: "impact-round2",
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

describe("Task2.3 round2 layering and evidence contracts [task:2.3]", () => {
  it("[domain] keeps impactClassification out of persistent dependency edges and validates source lifecycles", () => {
    const fact = relation({
      id: "edge",
      dependent: identity("target"),
      dependency: identity("subject"),
      sourceKind: "explicit",
      lifecycle: "confirmed",
      lastConfirmedAt: now,
    });
    expect(Object.prototype.hasOwnProperty.call(fact, "impactClassification")).toBe(false);
    expect(fact).toMatchObject({
      sourceKind: "explicit",
      lifecycle: "confirmed",
      lastConfirmedAt: now,
    });
    expect(fact.inverseDefinition).toEqual({
      semantics: "inverse",
      relationType: "affects",
    });
    const revalidated = relation({
      id: "revalidated-edge",
      dependent: identity("revalidated-target"),
      dependency: identity("subject"),
      sourceKind: "explicit",
      lifecycle: "revalidated",
      lastConfirmedAt: now,
      lastRevalidatedAt: now,
    });
    expect(revalidated.lastRevalidatedAt).toEqual(now);

    expect(() =>
      relation({
        id: "bad-lifecycle",
        dependent: identity("bad-target"),
        dependency: identity("subject"),
        sourceKind: "structural",
        lifecycle: "confirmed",
        lastConfirmedAt: now,
      }),
    ).toThrow("source-specific dependency lifecycle");
    expect(() =>
      relation({
        id: "bad-confirm",
        dependent: identity("bad-confirm-target"),
        dependency: identity("subject"),
        sourceKind: "explicit",
        lifecycle: "confirmed",
      }),
    ).toThrow("confirmed dependency requires lastConfirmedAt");
  });

  it("[domain] rejects nested ValidationEvidence source tampering and freezes snapshot provenance", () => {
    const nestedTampered = createObservation<ValidationEvidence>({
      evidenceReference: "validation:tampered",
      sourceReference: createSourceReference({
        identity: "source-tampered",
        version: "source-rev-1",
        hash: "outer-hash",
      }),
      ordinal: 1,
      data: {
        id: "tampered",
        type: "impact-tampered",
        sourceReference: {
          identity: "source-tampered",
          version: "source-rev-1",
          hash: "inner-hash",
        },
        observation: "Tampered nested source.",
      },
    });

    expect(() =>
      createImpactEvidenceSnapshotProvenance({
        sourceReference: createSourceReference({
          identity: "round2-snapshot",
          version: "snapshot-1",
          hash: "snapshot-hash",
        }),
        observations: [nestedTampered],
      }),
    ).toThrow("ValidationEvidence sourceReference must match Observation sourceReference");

    const valid = snapshot([observation("valid", 1)]);
    expect(Object.isFrozen(valid.observations[0]?.data)).toBe(true);
  });

  it("[domain] aggregates mixed provenance by definite evidence precedence and keeps alternative paths", () => {
    const direct = relation({
      id: "direct-path",
      dependent: identity("mixed-target"),
      dependency: identity("subject"),
    });
    const potential = relation({
      id: "potential-path",
      dependent: identity("mixed-target"),
      dependency: identity("subject"),
      sourceKind: "ai_suggested",
      lifecycle: "suggested",
    });
    const result = computeImpactAnalysis(
      analysis(
        [direct, potential],
        [observation("direct-path", 1), observation("potential-path", 2)],
        [
          createImpactClassificationFact({
            relationId: "direct-path",
            evidenceReference: "validation:direct-path",
            evidenceClass: "definite_direct",
          }),
          createImpactClassificationFact({
            relationId: "potential-path",
            evidenceReference: "validation:potential-path",
            evidenceClass: "potential",
          }),
        ],
      ),
    );
    const target = result.frontier.direct.find(({ object }) => object.objectId === "mixed-target");
    expect(target?.classification).toBe("direct");
    expect(target?.provenancePaths).toHaveLength(2);
  });

  it("[integration] serializes concurrent analyzeImpact races into consistent winner or stable conflict", async () => {
    const persistence = createInMemoryDependencyImpactPersistence();
    const service = new DependencyImpactApplicationService(persistence);
    const fact = relation({
      id: "race-edge",
      dependent: identity("race-target"),
      dependency: identity("subject"),
    });
    await service.recordRelations({ relations: [fact] });
    const base = {
      analysisId: "impact-race",
      novelId,
      subject: identity("subject"),
      currentVersionSet: versionSet(identity("subject"), identity("race-target")),
      evidenceSource: { snapshot: async () => snapshot([observation("race-edge", 1)]) },
      classificationFacts: [
        createImpactClassificationFact({
          relationId: "race-edge",
          evidenceReference: "validation:race-edge",
          evidenceClass: "definite_direct",
        }),
      ],
      maxDepth: 1,
      computedAt: now,
    };
    const same = await Promise.all([
      service.analyzeImpact(base as never),
      service.analyzeImpact(base as never),
    ]);
    expect(same[0]).toEqual(same[1]);

    const conflicting = await Promise.allSettled([
      service.analyzeImpact(base as never),
      service.analyzeImpact({
        ...base,
        evidenceSource: {
          snapshot: async () => snapshot([observation("race-edge", 1, "other-hash")]),
        },
      } as never),
    ]);
    expect(conflicting.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(conflicting.filter(({ status }) => status === "rejected")).toHaveLength(1);
  });


  it("[recovery] rejects tampered nested evidence and freezes persisted snapshot data", async () => {
    const persistence = createInMemoryDependencyImpactPersistence();
    const service = new DependencyImpactApplicationService(persistence);
    const fact = relation({
      id: "tamper-edge",
      dependent: identity("tamper-target"),
      dependency: identity("subject"),
    });
    await service.recordRelations({ relations: [fact] });
    const result = await service.analyzeImpact({
      analysisId: "impact-tamper",
      novelId,
      subject: identity("subject"),
      currentVersionSet: versionSet(identity("subject"), identity("tamper-target")),
      evidenceSource: { snapshot: async () => snapshot([observation("tamper-edge", 1)]) },
      classificationFacts: [
        createImpactClassificationFact({
          relationId: "tamper-edge",
          evidenceReference: "validation:tamper-edge",
          evidenceClass: "definite_direct",
        }),
      ],
      maxDepth: 1,
      computedAt: now,
    } as never);
    const tampered = {
      ...result,
      evidenceSnapshot: {
        ...result.evidenceSnapshot,
        observations: result.evidenceSnapshot.observations.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                data: {
                  ...entry.data,
                  sourceReference: { ...entry.data.sourceReference, hash: "tampered-inner" },
                },
              }
            : entry,
        ),
      },
    };
    await expect(service.recordImpactAnalysis(tampered as never)).rejects.toMatchObject({
      code: "evidence_integrity",
    });
    const loaded = await service.getImpactAnalysis(result.id);
    expect(() => {
      (loaded?.evidenceSnapshot.observations[0]?.data.sourceReference as { hash: string }).hash =
        "mutated";
    }).toThrow();
  });
  it("[cross-system] keeps Layer3 AI Risk out of persistent registry facts", async () => {
    const persistence = createInMemoryDependencyImpactPersistence();
    const service = new DependencyImpactApplicationService(persistence);
    await expect(
      service.recordRelations({
        relations: [
          relation({
            id: "ai-risk",
            dependent: identity("risk-target"),
            dependency: identity("subject"),
            sourceKind: "ai_suggested",
            lifecycle: "suggested",
          }),
        ],
      }),
    ).rejects.toMatchObject({ code: "layer3_ai_risk_not_persistent" });
  });
});
