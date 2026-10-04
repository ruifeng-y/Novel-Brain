import { describe, expect, it } from "vitest";
import { DependencyImpactApplicationService } from "../../src/dependency/application/dependencyImpactService";
import { createInMemoryDependencyImpactPersistence } from "../../src/dependency/application/dependencyImpactPersistence";
import {
  createDependencyRelationFact,
  dependencyObjectKey,
} from "../../src/dependency/domain/dependencyRegistry";
import { createDependencyImpactVerificationEnvironment } from "../support/dependencyImpactFixtures";

function environment() {
  return createDependencyImpactVerificationEnvironment(
    createInMemoryDependencyImpactPersistence(),
  );
}

describe("Dependency impact application review contracts [task:2.3]", () => {
  it("[persistence] persists a versioned read set and immutable evidence snapshot atomically", async () => {
    const env = environment();
    const service = new DependencyImpactApplicationService(env.persistence);
    await service.recordRelations({ relations: [env.directRelation] });
    const result = await service.analyzeImpact({
      analysisId: "impact-application-read-set",
      novelId: env.subject.novelId,
      subject: env.subject,
      currentVersionSet: env.currentVersionSet,
      evidenceSource: env.evidenceSource,
      maxDepth: 2,
      computedAt: new Date("2026-10-04T05:00:00.000Z"),
    });

    expect(result.readSet.version).toHaveLength(64);
    expect(result.readSet.relations.map(({ id }) => id)).toEqual(["relation-direct"]);
    expect(result.evidenceSnapshot.hash).toBe(result.readSet.evidenceSnapshot.hash);
    expect(await service.getImpactAnalysis(result.id)).toEqual(result);
  });

  it("[concurrency] keeps one semantic winner and rejects conflicting read-set replay", async () => {
    const env = environment();
    const service = new DependencyImpactApplicationService(env.persistence);
    const alternate = createDependencyRelationFact({
      ...env.directRelation,
      relationType: "appliesTo",
    });
    const writes = await Promise.allSettled([
      service.recordRelations({ relations: [env.directRelation] }),
      service.recordRelations({ relations: [alternate] }),
    ]);
    const winner = writes.flatMap((write) =>
      write.status === "fulfilled" ? write.value : [],
    )[0];
    const rejected = writes.filter((write) => write.status === "rejected");
    expect(winner).toBeDefined();
    expect(rejected).toHaveLength(1);
    expect([env.directRelation, alternate]).toContainEqual(winner);

    const first = await service.analyzeImpact({
      analysisId: "impact-application-concurrency",
      novelId: env.subject.novelId,
      subject: env.subject,
      currentVersionSet: env.currentVersionSet,
      evidenceSource: env.evidenceSource,
      maxDepth: 1,
      computedAt: new Date("2026-10-04T05:01:00.000Z"),
    });
    await expect(
      service.recordImpactAnalysis({
        ...first,
        readSet: { ...first.readSet, version: "different-read-set" },
        contentHash: "different-content",
      }),
    ).rejects.toMatchObject({ code: "impact_result_conflict" });
  });

  it("[replay] returns identical read-set provenance and rejects evidence-changing replay", async () => {
    const env = environment();
    const service = new DependencyImpactApplicationService(env.persistence);
    await service.recordRelations({ relations: [env.directRelation] });
    const input = {
      analysisId: "impact-application-replay",
      novelId: env.subject.novelId,
      subject: env.subject,
      currentVersionSet: env.currentVersionSet,
      evidenceSource: env.evidenceSource,
      maxDepth: 1,
      computedAt: new Date("2026-10-04T05:02:00.000Z"),
    };
    const first = await service.analyzeImpact(input);
    const replay = await service.analyzeImpact(input);
    expect(replay).toEqual(first);

    await expect(
      service.analyzeImpact({ ...input, evidenceSource: env.mismatchedEvidenceSource }),
    ).rejects.toMatchObject({ code: "impact_result_conflict" });
  });

  it("[recovery] keeps mismatched evidence degraded and leaves persisted facts unchanged", async () => {
    const env = environment();
    const service = new DependencyImpactApplicationService(env.persistence);
    await service.recordRelations({ relations: [env.directRelation] });
    const before = await env.persistence.relations.findById(env.directRelation.id);
    const result = await service.analyzeImpact({
      analysisId: "impact-application-recovery",
      novelId: env.subject.novelId,
      subject: env.subject,
      currentVersionSet: env.currentVersionSet,
      evidenceSource: env.mismatchedEvidenceSource,
      maxDepth: 1,
      computedAt: new Date("2026-10-04T05:03:00.000Z"),
    });

    expect(result.evidenceIntegrityStatus).toBe("degraded");
    expect(result.evidenceIssues).toEqual([
      { relationId: "relation-direct", status: "hash_mismatch" },
    ]);
    expect(await env.persistence.relations.findById(env.directRelation.id)).toEqual(before);
  });

  it("[cross-system] preserves ChangeSet/VersionSet/ValidationEvidence provenance without Recall/Run fields", async () => {
    const env = environment();
    const service = new DependencyImpactApplicationService(env.persistence);
    await service.recordRelations({ relations: [env.directRelation] });
    const result = await service.analyzeImpact({
      analysisId: "impact-application-cross-system",
      novelId: env.subject.novelId,
      subject: env.subject,
      currentVersionSet: env.currentVersionSet,
      evidenceSource: env.evidenceSource,
      maxDepth: 2,
      computedAt: new Date("2026-10-04T05:04:00.000Z"),
    });

    expect(env.directRelation.revisionProvenance.changeSet.hash).toHaveLength(64);
    expect(env.directRelation.revisionProvenance.changeSet.identity.novelId).toBe(
      env.subject.novelId,
    );
    expect(result.basedOnVersionSet).toEqual(env.currentVersionSet);
    expect(dependencyObjectKey(result.subject)).toEqual(dependencyObjectKey(env.subject));
    expect(result.evidenceSnapshot.observations[0]?.data.type).toBe("dependency-provenance");
    expect(JSON.stringify(result)).not.toMatch(/recallItem|checkpointId|runId|narrativeTruth/i);
  });
});
