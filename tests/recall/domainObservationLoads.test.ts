import { describe, expect, it } from "vitest";
import type { DependencyRegistryView } from "../../src/dependency/domain/dependencyRegistry";
import type { ImpactAnalysisResult } from "../../src/dependency/domain/impactAnalysis";
import { isMemoryProjectionStale, type MemoryProjection } from "../../src/memory/projections/memoryProjection";
import { createStateRecord } from "../../src/narrative/state/domain/stateRecord";
import type { RunAuditProjection } from "../../src/production/application/runAuditProjection";
import { createValidationRun } from "../../src/production/domain/validationRun";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import {
  createDependencyObservationLoad,
  createImpactObservationLoad,
  createMemoryObservationLoad,
  createNarrativeObservationLoad,
  createRunSignalsObservationLoad,
  createValidationObservationLoad,
} from "../../src/recall/observation/domainSourceLoads";

describe("[task:5.1-5.2] [domain] typed observation load normalization", () => {
  it("derives narrative evidence identity and source version from StateRecord revisions", () => {
    const record = createStateRecord({
      id: "state-1",
      novelId: "novel-1",
      type: "character_state",
      subjectId: "character-1",
      position: { sceneId: "scene-1", ordinal: 1 },
      content: { mood: "guarded" },
      revisionId: "state-rev-1",
      commitId: "commit-1",
      createdAt: new Date("2026-10-04T00:00:00.000Z"),
    });

    const load = createNarrativeObservationLoad({
      sourceIdentity: "narrative:novel-1",
      records: [record],
    });

    expect(load.sourceVersion).toBe("state-rev-1");
    expect(load.records).toHaveLength(1);
    expect(load.records[0]).toMatchObject({
      evidenceReference: "StateRecord:state-1",
      ordinal: 1,
      staleness: "fresh",
      value: record,
    });
    expect(load.records[0]?.sourceReference).toMatchObject({
      identity: "StateRecord:state-1",
      version: "state-rev-1",
    });
  });

  it("maps dependency relation staleness without mutating the registry view", () => {
    const fact = {
      id: "relation-1",
      novelId: "novel-1",
      dependent: { aggregateType: "Scene", objectId: "scene-1", novelId: "novel-1", revisionId: "scene-rev-1" },
      dependency: { aggregateType: "CanonicalFact", objectId: "fact-1", novelId: "novel-1", revisionId: "fact-rev-1" },
      revisionProvenance: {
        changeSet: {
          identity: {
            novelId: "novel-1",
            changeSetId: "change-set-1",
            revisionId: "dependency-rev-1",
            revisionNumber: 1,
          },
          hash: "change-set-hash-1",
        },
        versionSet: {
          "CanonicalFact:fact-1": createVersionReference("CanonicalFact", "fact-1", "fact-rev-1"),
        },
        evidence: [],
      },
    };
    const view = {
      subject: fact.dependent,
      objectKey: { scope: "object", novelId: "novel-1", aggregateType: "Scene", objectId: "scene-1" },
      outgoing: [fact],
      incoming: [],
    } as unknown as DependencyRegistryView;
    const before = structuredClone(view);

    const load = createDependencyObservationLoad({
      sourceIdentity: "dependency:novel-1",
      view,
      currentVersionSet: createVersionSet({
        "Scene:scene-1": createVersionReference("Scene", "scene-1", "scene-rev-1"),
        "CanonicalFact:fact-1": createVersionReference("CanonicalFact", "fact-1", "fact-rev-2"),
      }),
    });

    expect(load.sourceVersion).toBe("dependency-rev-1");
    expect(load.records[0]).toMatchObject({
      evidenceReference: "DependencyRelation:relation-1",
      staleness: "stale",
      value: fact,
    });
    expect(view).toEqual(before);
  });

  it("normalizes impact integrity and staleness into one evidence record", () => {
    const result = {
      id: "impact-1",
      readSet: { version: "impact-read-set-v1" },
      contentHash: "impact-hash-1",
      staleness: "stale",
      evidenceIntegrityStatus: "degraded",
    } as unknown as ImpactAnalysisResult;

    const load = createImpactObservationLoad({
      sourceIdentity: "impact:novel-1",
      results: [result],
    });

    expect(load.sourceVersion).toBe("impact-read-set-v1");
    expect(load.records[0]).toMatchObject({
      evidenceReference: "ImpactAnalysis:impact-1",
      staleness: "stale",
      value: result,
    });
    expect(load.records[0]?.sourceReference).toMatchObject({
      identity: "ImpactAnalysis:impact-1",
      version: "impact-read-set-v1",
      hash: "impact-hash-1",
    });
  });

  it("keeps validation state as evidence without converting failure into staleness", () => {
    const run = createValidationRun({
      id: "validation-1",
      changeSetRevisionId: "change-set-rev-1",
      planVersionId: "plan-v1",
      validatorId: "validator-1",
      entryResults: [],
      executionState: "completed",
      outcome: "fail",
      createdAt: new Date("2026-10-04T00:00:00.000Z"),
    });

    const load = createValidationObservationLoad({
      sourceIdentity: "validation:novel-1",
      runs: [run],
    });

    expect(load.sourceVersion).toBe("change-set-rev-1");
    expect(load.records[0]).toMatchObject({
      evidenceReference: "ValidationRun:validation-1",
      staleness: "fresh",
      value: run,
    });
  });

  it("derives memory staleness from the bound version set", () => {
    const projection: MemoryProjection = {
      novelId: "novel-1",
      sourceRevisionSet: { "Scene:scene-1": "scene-rev-1" },
      scenes: {},
    };
    const versionSet = createVersionSet({
      "Scene:scene-1": createVersionReference("Scene", "scene-1", "scene-rev-2"),
    });

    const load = createMemoryObservationLoad({
      sourceIdentity: "memory:novel-1",
      projection,
      versionSet,
    });

    expect(isMemoryProjectionStale(projection, versionSet)).toBe(true);
    expect(load.sourceVersion).toMatch(/^memory:/);
    expect(load.records[0]).toMatchObject({
      evidenceReference: "MemoryProjection:novel-1",
      staleness: "stale",
      value: projection,
    });
  });

  it("exposes run failure signals with the audit projection hash as source version", () => {
    const projection = {
      runId: "run-1",
      novelId: "novel-1",
      run: { status: "failed" },
      failures: [
        {
          sourceKind: "attempt",
          sourceId: "attempt-1",
          code: "runtime_failed",
          message: "failed",
          occurredAt: new Date("2026-10-04T00:00:00.000Z"),
        },
      ],
      hash: "run-audit-hash-1",
    } as unknown as RunAuditProjection;

    const load = createRunSignalsObservationLoad({
      sourceIdentity: "run:novel-1",
      projection,
    });

    expect(load.sourceVersion).toBe("run-audit-hash-1");
    expect(load.records[0]).toMatchObject({
      evidenceReference: "RunFailure:attempt:attempt-1",
      staleness: "fresh",
    });
    expect(load.records[0]?.sourceReference).toMatchObject({
      identity: "RunFailure:attempt:attempt-1",
      version: "run-audit-hash-1",
    });
  });
});
