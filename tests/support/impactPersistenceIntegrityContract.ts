import { describe, expect, it } from "vitest";
import { DependencyImpactApplicationService } from "../../src/dependency/application/dependencyImpactService";
import type { DependencyImpactPersistence } from "../../src/dependency/application/dependencyImpactPersistence";
import type { ImpactAnalysisResult } from "../../src/dependency/domain/impactAnalysis";
import {
  canonicalJson,
  hashContent,
} from "../../src/shared/domain/contentHash";
import {
  computeImpactAnalysis,
  impactReadSetVersion,
} from "../../src/dependency/domain/impactAnalysis";
import type { DependencyImpactVerificationEnvironment } from "./dependencyImpactFixtures";
import { describeVerificationGate } from "./capabilityVerificationContract";

const computedAt = new Date("2026-10-04T03:00:00.000Z");

type MutableImpactAnalysisResult = {
  -readonly [K in keyof ImpactAnalysisResult]: ImpactAnalysisResult[K];
};

function rehashResult(
  result: ImpactAnalysisResult,
  mutate: (draft: MutableImpactAnalysisResult) => void = () => undefined,
): ImpactAnalysisResult {
  const draft = structuredClone(result) as MutableImpactAnalysisResult;
  mutate(draft);
  const { contentHash: _contentHash, ...core } = draft;
  return {
    ...core,
    contentHash: hashContent(canonicalJson(core)),
  };
}

function rehashResultWithReadSet(
  result: ImpactAnalysisResult,
  mutate: (draft: MutableImpactAnalysisResult) => void,
): ImpactAnalysisResult {
  const draft = structuredClone(result) as MutableImpactAnalysisResult;
  mutate(draft);
  const { version: _version, ...readSetCore } = draft.readSet;
  draft.readSet = {
    ...readSetCore,
    version: impactReadSetVersion(readSetCore),
  } as ImpactAnalysisResult["readSet"];
  const { contentHash: _contentHash, ...core } = draft;
  return {
    ...core,
    contentHash: hashContent(canonicalJson(core)),
  };
}

async function canonicalResult(
  environment: DependencyImpactVerificationEnvironment,
  id = "impact-2.3-H",
): Promise<ImpactAnalysisResult> {
  return computeImpactAnalysis({
    id,
    novelId: environment.subject.novelId,
    subject: environment.subject,
    relations: [environment.directRelation, environment.indirectRelation],
    classificationFacts: environment.classificationFacts,
    currentVersionSet: environment.currentVersionSet,
    evidenceSnapshot: await environment.evidenceSource.snapshot(),
    maxDepth: 2,
    computedAt,
  });
}

function directEntry(result: ImpactAnalysisResult) {
  return result.frontier.direct[0]!;
}

export function runImpactPersistenceIntegrityContract(
  adapterName: string,
  createEnvironment: () => Promise<DependencyImpactVerificationEnvironment>,
): void {
  describe(`${adapterName} [task:2.3-H] impact persistence integrity`, () => {
    describeVerificationGate("domain", "rejects forged frontier bucket membership", async () => {
      const environment = await createEnvironment();
      const result = await canonicalResult(environment);
      const forged = rehashResult(result, (draft) => {
        const entry = directEntry(draft);
        draft.frontier = {
          ...draft.frontier,
          direct: [],
          indirect: [...draft.frontier.indirect, entry],
        };
      });

      await expect(
        new DependencyImpactApplicationService(environment.persistence).recordImpactAnalysis(forged),
      ).rejects.toMatchObject({ code: "impact_result_conflict" });
    });

    describeVerificationGate("integration", "rejects forged boundary and disconnected paths", async () => {
      const environment = await createEnvironment();
      const result = await canonicalResult(environment);
      const service = new DependencyImpactApplicationService(environment.persistence);
      const boundaryForged = rehashResult(result, (draft) => {
        draft.frontier = { ...draft.frontier, boundary: [] };
      });
      const pathForged = rehashResult(result, (draft) => {
        const entry = directEntry(draft);
        const path = structuredClone(entry.path) as unknown as ImpactAnalysisResult["frontier"]["direct"][number]["path"];
        (path as unknown as { [index: number]: unknown })[0] = {
          ...path[0]!,
          from: environment.directTarget,
          to: environment.indirectTarget,
        };
        draft.frontier = {
          ...draft.frontier,
          direct: [{ ...entry, path }],
        };
      });

      await expect(service.recordImpactAnalysis(boundaryForged)).rejects.toMatchObject({
        code: "impact_result_conflict",
      });
      await expect(service.recordImpactAnalysis(pathForged)).rejects.toMatchObject({
        code: "impact_result_conflict",
      });
    });

    describeVerificationGate("persistence", "rejects forged subject and maxDepth", async () => {
      const environment = await createEnvironment();
      const result = await canonicalResult(environment);
      const service = new DependencyImpactApplicationService(environment.persistence);
      const subjectForged = rehashResult(result, (draft) => {
        draft.subject = environment.directTarget;
      });
      const depthForged = rehashResult(result, (draft) => {
        draft.maxDepth = 1;
      });

      await expect(service.recordImpactAnalysis(subjectForged)).rejects.toMatchObject({
        code: "impact_result_conflict",
      });
      await expect(service.recordImpactAnalysis(depthForged)).rejects.toMatchObject({
        code: "impact_result_conflict",
      });
      expect(await service.getImpactAnalysis(result.id)).toBeUndefined();
    });

    describeVerificationGate("transaction", "does not persist a forged result", async () => {
      const environment = await createEnvironment();
      const result = await canonicalResult(environment);
      const service = new DependencyImpactApplicationService(environment.persistence);
      const forged = rehashResult(result, (draft) => {
        draft.frontier = { ...draft.frontier, boundary: [] };
      });

      await expect(service.recordImpactAnalysis(forged)).rejects.toMatchObject({
        code: "impact_result_conflict",
      });
      expect(await service.getImpactAnalysis(result.id)).toBeUndefined();
      await expect(service.recordImpactAnalysis(result)).resolves.toEqual(result);
    });

    describeVerificationGate("concurrency", "keeps one canonical winner for identical replays", async () => {
      const environment = await createEnvironment();
      const result = await canonicalResult(environment);
      const service = new DependencyImpactApplicationService(environment.persistence);

      const settled = await Promise.allSettled([
        service.recordImpactAnalysis(result),
        service.recordImpactAnalysis(result),
      ]);
      expect(settled.map(({ status }) => status).sort()).toEqual(["fulfilled", "fulfilled"]);
      expect(await service.getImpactAnalysis(result.id)).toEqual(result);
    });

    describeVerificationGate("recovery", "recovers only with the canonical result after rejection", async () => {
      const environment = await createEnvironment();
      const result = await canonicalResult(environment, "impact-2.3-H-recovery");
      const service = new DependencyImpactApplicationService(environment.persistence);
      const forged = rehashResult(result, (draft) => {
        draft.subject = environment.directTarget;
      });

      await expect(service.recordImpactAnalysis(forged)).rejects.toMatchObject({
        code: "impact_result_conflict",
      });
      expect(await service.getImpactAnalysis(result.id)).toBeUndefined();
      await expect(service.recordImpactAnalysis(result)).resolves.toEqual(result);
      expect(await service.getImpactAnalysis(result.id)).toEqual(result);
    });

    describeVerificationGate("replay", "replays canonical readSet provenance exactly", async () => {
      const environment = await createEnvironment();
      const result = await canonicalResult(environment);
      const service = new DependencyImpactApplicationService(environment.persistence);

      await expect(service.recordImpactAnalysis(result)).resolves.toEqual(result);
      const loaded = await service.getImpactAnalysis(result.id);
      await expect(service.recordImpactAnalysis(loaded!)).resolves.toEqual(result);
      expect(loaded!.readSet.version).toBe(result.readSet.version);
      expect(loaded!.contentHash).toBe(result.contentHash);
    });

    describeVerificationGate("cross-system", "preserves the canonical payload through persistence", async () => {
      const environment = await createEnvironment();
      const result = await canonicalResult(environment);
      const service = new DependencyImpactApplicationService(environment.persistence);

      await expect(service.recordImpactAnalysis(result)).resolves.toEqual(result);
      const loaded = await service.getImpactAnalysis(result.id);
      expect(loaded).toEqual(result);
      expect(loaded!.readSet.relations.map(({ id }) => id)).toEqual([
        environment.directRelation.id,
        environment.indirectRelation.id,
      ]);
    });

    describeVerificationGate("regression", "keeps hash and readSet forgery rejection intact", async () => {
      const environment = await createEnvironment();
      const result = await canonicalResult(environment);
      const service = new DependencyImpactApplicationService(environment.persistence);
      const readSetForged = rehashResultWithReadSet(result, (draft) => {
        draft.readSet = {
          ...draft.readSet,
          relations: [...draft.readSet.relations].reverse(),
        };
      });

      await expect(service.recordImpactAnalysis(readSetForged)).rejects.toMatchObject({
        code: "impact_result_conflict",
      });
    });
  });
}
