import { describe, expect, it } from "vitest";
import { DependencyImpactApplicationService } from "../../src/dependency/application/dependencyImpactService";
import type { ImpactAnalysisResult } from "../../src/dependency/domain/impactAnalysis";
import {
  createDependencyRelationFact,
  dependencyObjectKey,
} from "../../src/dependency/domain/dependencyRegistry";
import {
  describeVerificationGate,
  type CapabilityVerificationGate,
} from "./capabilityVerificationContract";
import {
  createDependencyImpactVerificationEnvironment,
  type DependencyImpactVerificationEnvironment,
} from "./dependencyImpactFixtures";

function gate(
  name: CapabilityVerificationGate,
  title: string,
  body: (environment: DependencyImpactVerificationEnvironment) => Promise<void>,
  createEnvironment: () => Promise<DependencyImpactVerificationEnvironment>,
): void {
  describeVerificationGate(name, title, async () => {
    await body(await createEnvironment());
  });
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") return keys;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectKeys(nested, keys);
  }
  return keys;
}

const forbiddenLayerFieldKeys = [
  "recallItem",
  "recallItemId",
  "run",
  "runId",
  "runRevisionId",
  "checkpoint",
  "checkpointId",
  "checkpointRevisionId",
  "narrativeTruth",
] as const;

function classificationFactsFor(
  environment: DependencyImpactVerificationEnvironment,
  ...relationIds: string[]
) {
  return environment.classificationFacts.filter(({ relationId }) =>
    relationIds.includes(relationId),
  );
}

function expectNoForbiddenLayerFields(value: unknown): void {
  const keys = collectKeys(value);
  for (const key of forbiddenLayerFieldKeys) {
    expect(keys.has(key)).toBe(false);
  }
}

export function runDependencyImpactVerificationContract(
  adapterName: string,
  taskId: string,
  createEnvironment: () => Promise<DependencyImpactVerificationEnvironment>,
): void {
  describe(`${adapterName} [task:${taskId}] dependency impact verification`, () => {
    gate(
      "domain",
      "keeps structured identity, ChangeSet provenance, and relation semantics immutable",
      async (environment) => {
        const fact = environment.directRelation;
        expect(fact.revisionProvenance.changeSet.identity.novelId).toBe(
          environment.subject.novelId,
        );
        expect(fact.revisionProvenance.changeSet.hash).toHaveLength(64);
        expect(fact).toMatchObject({
          family: "narrative",
          relationType: "causes",
          inverseSemantics: "inverse",
          sourceKind: "commit-derived",
          lifecycle: "active",

        });
        expect(Object.isFrozen(fact)).toBe(true);
        expect(dependencyObjectKey(fact.dependency)).toEqual(
          dependencyObjectKey(environment.subject),
        );
      },
      createEnvironment,
    );

    gate(
      "integration",
      "queries registry facts and analyzes a versioned impact read set",
      async (environment) => {
        const service = new DependencyImpactApplicationService(environment.persistence);
        await service.recordRelations({
          relations: [environment.indirectRelation, environment.directRelation],
        });

        const view = await service.queryDependencyRegistry({ subject: environment.subject });
        const result = await service.analyzeImpact({
          analysisId: "impact-verification",
          novelId: environment.subject.novelId,
          subject: environment.subject,
          currentVersionSet: environment.currentVersionSet,
          evidenceSource: environment.evidenceSource,
          classificationFacts: classificationFactsFor(environment, "relation-direct", "relation-indirect"),
          maxDepth: 2,
          computedAt: new Date("2026-10-04T02:01:00.000Z"),
        });

        expect(view.incoming.map(({ id }) => id)).toEqual(["relation-direct"]);
        expect(result.readSet.version).toHaveLength(64);
        expect(result.frontier.direct.map(({ object }) => object.objectId)).toEqual([
          environment.directTarget.objectId,
        ]);
        expect(result.frontier.indirect.map(({ object }) => object.objectId)).toEqual([
          environment.indirectTarget.objectId,
        ]);
        expect(result.evidenceIntegrityStatus).toBe("verified");
      },
      createEnvironment,
    );

    gate(
      "persistence",
      "round-trips registry and impact facts including evidence snapshot provenance",
      async (environment) => {
        const service = new DependencyImpactApplicationService(environment.persistence);
        await service.recordRelations({ relations: [environment.directRelation] });
        const recorded = await service.analyzeImpact({
          analysisId: "impact-persisted",
          novelId: environment.subject.novelId,
          subject: environment.subject,
          currentVersionSet: environment.currentVersionSet,
          evidenceSource: environment.evidenceSource,
          classificationFacts: classificationFactsFor(environment, "relation-direct"),
          maxDepth: 2,
          computedAt: new Date("2026-10-04T02:02:00.000Z"),
        });

        expect(await service.getImpactAnalysis("impact-persisted")).toEqual(recorded);
        expect(recorded.evidenceSnapshot).toEqual(recorded.readSet.evidenceSnapshot);
        expect(
          await environment.persistence.relations.findById(environment.directRelation.id),
        ).toEqual(environment.directRelation);
      },
      createEnvironment,
    );

    gate(
      "transaction",
      "rolls back a complete relation batch when immutable relation identity conflicts",
      async (environment) => {
        const service = new DependencyImpactApplicationService(environment.persistence);
        await service.recordRelations({ relations: [environment.directRelation] });
        const conflicting = createDependencyRelationFact({
          ...environment.directRelation,
          relationType: "appliesTo",
        });

        await expect(
          service.recordRelations({
            relations: [environment.indirectRelation, conflicting],
          }),
        ).rejects.toMatchObject({ code: "relation_conflict" });

        expect(
          await environment.persistence.relations.findById(environment.indirectRelation.id),
        ).toBeUndefined();
        expect(
          await environment.persistence.relations.findById(environment.directRelation.id),
        ).toEqual(environment.directRelation);
      },
      createEnvironment,
    );

    gate(
      "concurrency",
      "keeps one relation winner and one read-set/result winner under races",
      async (environment) => {
        const service = new DependencyImpactApplicationService(environment.persistence);
        const alternate = createDependencyRelationFact({
          ...environment.directRelation,
          relationType: "appliesTo",
        });
        const relationResults = await Promise.allSettled([
          service.recordRelations({ relations: [environment.directRelation] }),
          service.recordRelations({ relations: [alternate] }),
        ]);
        const fulfilled = relationResults.flatMap((result) =>
          result.status === "fulfilled" ? result.value : [],
        );
        const rejected = relationResults.filter(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect([environment.directRelation, alternate]).toContainEqual(fulfilled[0]);

        await service.recordRelations({ relations: [fulfilled[0]!] });
        const first = await service.analyzeImpact({
          analysisId: "impact-concurrent",
          novelId: environment.subject.novelId,
          subject: environment.subject,
          currentVersionSet: environment.currentVersionSet,
          evidenceSource: environment.evidenceSource,
          classificationFacts: classificationFactsFor(environment, "relation-direct"),
          maxDepth: 1,
          computedAt: new Date("2026-10-04T02:03:00.000Z"),
        });
        const raceInput = {
          analysisId: "impact-concurrent-race",
          novelId: environment.subject.novelId,
          subject: environment.subject,
          currentVersionSet: environment.currentVersionSet,
          evidenceSource: environment.evidenceSource,
          classificationFacts: classificationFactsFor(environment, "relation-direct"),
          maxDepth: 1,
          computedAt: new Date("2026-10-04T02:03:30.000Z"),
        };
        const sameRace = await Promise.all([
          service.analyzeImpact(raceInput),
          service.analyzeImpact(raceInput),
        ]);
        expect(sameRace[0]).toEqual(sameRace[1]);
        const differentRace = await Promise.allSettled([
          service.analyzeImpact({ ...raceInput, analysisId: "impact-concurrent-race-2" }),
          service.analyzeImpact({
            ...raceInput,
            analysisId: "impact-concurrent-race-2",
            evidenceSource: environment.mismatchedEvidenceSource,
          }),
        ]);
        expect(differentRace.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
        expect(differentRace.filter(({ status }) => status === "rejected")).toHaveLength(1);
        expect(collectKeys(first).has("recallItem")).toBe(false);
        expect(collectKeys(first).has("checkpointId")).toBe(false);
        expectNoForbiddenLayerFields(first);
        expect(sameRace[0]?.contentHash).toBe(sameRace[1]?.contentHash);
        expect(sameRace[0]?.readSet.version).toBe(sameRace[1]?.readSet.version);
        const second: ImpactAnalysisResult = {
          ...first,
          readSet: { ...first.readSet, version: "different-read-set" },
          contentHash: "different-content-hash",
        };
        await expect(service.recordImpactAnalysis(second)).rejects.toMatchObject({
          code: "impact_result_conflict",
        });
        expect(await service.getImpactAnalysis(first.id)).toEqual(first);
      },
      createEnvironment,
    );

    gate(
      "recovery",
      "downgrades only reachable mismatched evidence and preserves persisted facts",
      async (environment) => {
        const service = new DependencyImpactApplicationService(environment.persistence);
        await service.recordRelations({
          relations: [environment.directRelation, environment.indirectRelation],
        });
        const before = await environment.persistence.relations.findById(
          environment.directRelation.id,
        );

        const result = await service.analyzeImpact({
          analysisId: "impact-recovery",
          novelId: environment.subject.novelId,
          subject: environment.subject,
          currentVersionSet: environment.currentVersionSet,
          evidenceSource: environment.mismatchedEvidenceSource,
          classificationFacts: classificationFactsFor(environment, "relation-indirect"),
          maxDepth: 1,
          computedAt: new Date("2026-10-04T02:04:00.000Z"),
        });

        expectNoForbiddenLayerFields(result);
        expect(result.evidenceIntegrityStatus).toBe("degraded");
        expect(result.evidenceIssues).toEqual([
          { relationId: "relation-direct", status: "hash_mismatch" },
        ]);
        expect(result.frontier.potential.map(({ object }) => object.objectId)).toEqual([
          environment.directTarget.objectId,
        ]);
        expect(await environment.persistence.relations.findById(
          environment.directRelation.id,
        )).toEqual(before);
        expect(collectKeys(result).has("recallItem")).toBe(false);
        expect(collectKeys(result).has("runId")).toBe(false);
      },
      createEnvironment,
    );

    gate(
      "replay",
      "returns identical versioned provenance and rejects evidence-changing replay",
      async (environment) => {
        const service = new DependencyImpactApplicationService(environment.persistence);
        await service.recordRelations({ relations: [environment.directRelation] });
        await expect(
          service.recordRelations({ relations: [environment.directRelation] }),
        ).resolves.toEqual([environment.directRelation]);

        const input = {
          analysisId: "impact-replay",
          novelId: environment.subject.novelId,
          subject: environment.subject,
          currentVersionSet: environment.currentVersionSet,
          evidenceSource: environment.evidenceSource,
          classificationFacts: classificationFactsFor(environment, "relation-direct"),
          maxDepth: 1,
          computedAt: new Date("2026-10-04T02:05:00.000Z"),
        };
        const first = await service.analyzeImpact(input);
        const replay = await service.analyzeImpact(input);
        expectNoForbiddenLayerFields(first);
        expect(replay).toEqual(first);
        expect(replay.contentHash).toBe(first.contentHash);
        expect(replay.readSet.version).toBe(first.readSet.version);
        expect(collectKeys(first).has("recallItem")).toBe(false);
        expect(collectKeys(first).has("checkpointId")).toBe(false);

        await expect(
          service.analyzeImpact({ ...input, evidenceSource: environment.mismatchedEvidenceSource, classificationFacts: [] }),
        ).rejects.toMatchObject({ code: "impact_result_conflict" });
      },
      createEnvironment,
    );

    gate(
      "cross-system",
      "preserves ChangeSet, VersionSet, and ValidationEvidence bindings without truth fields",
      async (environment) => {
        const service = new DependencyImpactApplicationService(environment.persistence);
        await service.recordRelations({ relations: [environment.directRelation] });
        const result = await service.analyzeImpact({
          analysisId: "impact-cross-system",
          novelId: environment.subject.novelId,
          subject: environment.subject,
          currentVersionSet: environment.currentVersionSet,
          evidenceSource: environment.evidenceSource,
          classificationFacts: classificationFactsFor(environment, "relation-direct"),
          maxDepth: 2,
          computedAt: new Date("2026-10-04T02:06:00.000Z"),
        });

        expect(result.basedOnVersionSet).toEqual(environment.currentVersionSet);
        expect(environment.directRelation.revisionProvenance.changeSet.hash).toHaveLength(64);
        expect(result.evidenceSnapshot.observations[0]?.data.type).toBe(
          "dependency-provenance",
        );
        expectNoForbiddenLayerFields(result);
        expect(result.readSet.classificationFacts.length).toBeGreaterThan(0);
        expect(result.frontier.direct[0]?.path[0]?.classification).toBe("direct");
        const keys = collectKeys(result);
        for (const forbidden of ["recallItem", "runId", "checkpointId", "narrativeTruth"]) {
          expect(keys.has(forbidden)).toBe(false);
        }
      },
      createEnvironment,
    );

    gate(
      "regression",
      "enforces semantic negatives, scope, stable ordering, and deterministic contracts",
      async (environment) => {
        const service = new DependencyImpactApplicationService(environment.persistence);
        expect(() =>
          createDependencyRelationFact({
            ...environment.directRelation,
            id: "relation-invalid",
            dependent: environment.subject,
            dependency: environment.subject,
          }),
        ).toThrow("self dependency relation is not allowed");

        await service.recordRelations({ relations: [environment.directRelation] });
        const stale = await service.analyzeImpact({
          analysisId: "impact-stale-regression",
          novelId: environment.subject.novelId,
          subject: environment.subject,
          currentVersionSet: {
            ...environment.currentVersionSet,
            state: {
              ...environment.currentVersionSet["state"]!,
              revisionId: "state-impact-rev-2",
            },
          },
          evidenceSource: environment.evidenceSource,
          classificationFacts: classificationFactsFor(environment, "relation-direct"),
          maxDepth: 2,
          computedAt: new Date("2026-10-04T02:07:00.000Z"),
        });
        expect(stale.staleness).toBe("stale");
        expect(stale.frontier.potential.map(({ object }) => object.objectId)).toEqual([
          environment.directTarget.objectId,
        ]);
        expect(stale.readSet.relations.map(({ id }) => id)).toEqual(["relation-direct"]);
      },
      createEnvironment,
    );
  });
}
