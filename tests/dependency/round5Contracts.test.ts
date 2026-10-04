import { describe, expect, it } from "vitest";
import { DependencyImpactApplicationService } from "../../src/dependency/application/dependencyImpactService";
import { createInMemoryDependencyImpactPersistence } from "../../src/dependency/application/dependencyImpactPersistence";
import { canonicalJson, hashContent } from "../../src/shared/domain/contentHash";
import {
  computeImpactAnalysis,
  createImpactClassificationFact,
  impactReadSetVersion,
} from "../../src/dependency/domain/impactAnalysis";
import {
  createDependencyIdentity,
  createDependencyRelationFact,
  createDependencyRevisionProvenance,
} from "../../src/dependency/domain/dependencyRegistry";
import { createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import type { ValidationEvidence } from "../../src/production/domain/validationRun";
import {
  createObservation,
  createObservationSnapshot,
  createSourceReference,
} from "../../src/shared/domain/observationSource";
import {
  createVersionReference,
  createVersionSet,
} from "../../src/shared/domain/versioning";

const computedAt = new Date("2026-10-04T10:00:00.000Z");
const novelId = "novel-round5";

function identity(objectId: string, revisionId = `${objectId}-rev-1`) {
  return createDependencyIdentity({
    novelId,
    aggregateType: "Scene",
    objectId,
    revisionId,
  });
}

describe("Task2.3 round5 normalized classification facts [task:2.3]", () => {
  it("[regression] removes suppressed definite facts and rejects forged potential/definite persistence", async () => {
    const subject = identity("subject");
    const target = identity("target");
    const sourceReference = createSourceReference({
      identity: "source-ai-edge",
      version: "source-rev-1",
      hash: "hash-ai-edge",
    });
    const evidence = createObservation<ValidationEvidence>({
      evidenceReference: "validation:ai-edge",
      sourceReference,
      ordinal: 1,
      data: {
        id: "ai-edge",
        type: "ai-suggestion",
        sourceReference: {
          identity: sourceReference.identity,
          version: sourceReference.version,
          hash: sourceReference.hash,
        },
        observation: "AI suggestion evidence.",
      },
    });
    const relation = createDependencyRelationFact({
      id: "ai-edge",
      novelId,
      family: "causal",
      relationType: "causes",
      inverseSemantics: "inverse",
      inverseRelationType: "affects",
      sourceKind: "ai_suggested",
      lifecycle: "suggested",
      dependent: target,
      dependency: subject,
      revisionProvenance: createDependencyRevisionProvenance({
        revision: createInitialChangeSetRevision({
          revisionId: "changeset-ai-edge:rev-1",
          changeSetId: "changeset-ai-edge",
          novelId,
          createdAt: computedAt,
        }),
        dependent: target,
        dependency: subject,
        versionSet: createVersionSet({
          subject: createVersionReference("Scene", subject.objectId, subject.revisionId),
          target: createVersionReference("Scene", target.objectId, target.revisionId),
        }),
        evidence: [evidence],
      }),
      createdAt: computedAt,
    });
    const callerDefiniteFact = createImpactClassificationFact({
      relationId: "ai-edge",
      evidenceReference: "validation:ai-edge",
      evidenceClass: "definite_direct",
    });
    const input = {
      id: "impact-round5-suppression",
      novelId,
      subject,
      relations: [relation],
      classificationFacts: [callerDefiniteFact],
      currentVersionSet: createVersionSet({
        subject: createVersionReference("Scene", subject.objectId, subject.revisionId),
        target: createVersionReference("Scene", target.objectId, target.revisionId),
      }),
      evidenceSnapshot: createObservationSnapshot<ValidationEvidence>({
        sourceReference: createSourceReference({
          identity: "round5-snapshot",
          version: "snapshot-1",
          hash: "round5-snapshot-hash",
        }),
        observations: [evidence],
      }),
      maxDepth: 1,
      computedAt,
    };

    const result = computeImpactAnalysis(input);
    const replay = computeImpactAnalysis(input);

    expect(result.frontier.direct).toEqual([]);
    expect(result.frontier.indirect).toEqual([]);
    expect(result.frontier.potential.map(({ object }) => object.objectId)).toEqual(["target"]);
    expect(result.affectedObjects.map(({ objectId }) => objectId)).toEqual(["target"]);
    expect(result.readSet.classificationFacts.some(({ evidenceClass }) =>
      evidenceClass === "definite_direct" || evidenceClass === "definite_indirect",
    )).toBe(false);
    expect(result.readSet.classificationFacts).toEqual([
      {
        relationId: "ai-edge",
        evidenceReference: "validation:ai-edge",
        evidenceClass: "potential",
      },
    ]);
    expect(replay).toEqual(result);
    expect(replay.readSet.version).toBe(result.readSet.version);
    expect(replay.contentHash).toBe(result.contentHash);

    const service = new DependencyImpactApplicationService(
      createInMemoryDependencyImpactPersistence(),
    );
    const forgedReadSetCore = {
      ...result.readSet,
      classificationFacts: [callerDefiniteFact],
    };
    const forgedReadSet = {
      ...forgedReadSetCore,
      version: impactReadSetVersion(forgedReadSetCore),
    };
    const { contentHash: _oldContentHash, ...resultWithoutHash } = result;
    const forgedCore = {
      ...resultWithoutHash,
      id: "impact-round5-forged",
      readSet: forgedReadSet,
    };
    const forged = {
      ...forgedCore,
      contentHash: hashContent(canonicalJson(forgedCore)),
    };
    await expect(service.recordImpactAnalysis(result)).resolves.toEqual(result);
    expect(impactReadSetVersion(forged.readSet)).toBe(forged.readSet.version);
    await expect(service.recordImpactAnalysis(forged as never)).rejects.toMatchObject({
      code: "evidence_integrity",
    });
  });
});
