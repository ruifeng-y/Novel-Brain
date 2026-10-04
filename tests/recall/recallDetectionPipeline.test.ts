import { describe, expect, it } from "vitest";
import { createSourceReference } from "../../src/shared/domain/observationSource";
import {
  createDependencyObservationAdapter,
  createImpactObservationAdapter,
  createMemoryObservationAdapter,
  createNarrativeObservationAdapter,
  createRunSignalsObservationAdapter,
  createValidationObservationAdapter,
  type RecallObservationLoad,
  type RecallObservationRecord,
} from "../../src/recall/observation/sourceAdapters";
import {
  baselineRecallClassifier,
  baselineRecallDetector,
  baselineRecallPrioritizer,
  detectRecallCandidates,
  observeRecallSources,
  prioritizeRecallCandidates,
  runRecallPipeline,
  type RecallCandidateSignal,
  type RecallClassifier,
  type RecallDetector,
  type RecallPrioritizer,
  type RecallSourceCollection,
} from "../../src/recall/detection/recallPipeline";

function record<T>(evidenceReference: string, value: T, staleness: "fresh" | "stale" | "missing", ordinal: number): RecallObservationRecord<T> {
  return {
    evidenceReference,
    sourceReference: createSourceReference({
      identity: evidenceReference,
      version: `v-${evidenceReference}`,
      hash: `hash-${evidenceReference}`,
    }),
    ordinal,
    staleness,
    value,
  };
}

function loader<T>(sourceIdentity: string, sourceVersion: string, records: readonly RecallObservationRecord<T>[]): () => Promise<RecallObservationLoad<T>> {
  return async () => ({ sourceIdentity, sourceVersion, records });
}

function sourceCollection(): RecallSourceCollection {
  return {
    narrative: createNarrativeObservationAdapter(loader("narrative:source", "narrative:v1", [
      record("narrative:evidence-1", { id: "narrative-1" }, "stale", 1),
    ])),
    validation: createValidationObservationAdapter(loader("validation:source", "validation:v1", [
      record("validation:evidence-1", { id: "validation-1" }, "missing", 1),
    ])),
    memory: createMemoryObservationAdapter(loader("memory:source", "memory:v1", [
      record("memory:evidence-1", { id: "memory-1" }, "stale", 1),
    ])),
    run_signals: createRunSignalsObservationAdapter(loader("run:source", "run:v1", [
      record("run:evidence-1", { id: "run-1" }, "missing", 1),
    ])),
    dependency: createDependencyObservationAdapter(loader("dependency:source", "dependency:v1", [
      record("dependency:evidence-1", { id: "dependency-1" }, "stale", 1),
    ])) as RecallSourceCollection["dependency"],
    impact: createImpactObservationAdapter(loader("impact:source", "impact:v1", [
      record("impact:evidence-1", { id: "impact-1" }, "missing", 1),
    ])) as RecallSourceCollection["impact"],
  };
}

describe("[task:5.1-5.2] [integration] Observe to Detect to Classify to Prioritize", () => {
  it("produces deterministic evidence-backed candidate signals in priority bands", async () => {
    const result = await runRecallPipeline({ sources: sourceCollection() });

    expect(result.candidates.map((candidate) => candidate.candidateId)).toEqual([
      "baseline:stale-evidence:dependency:dependency:evidence-1",
      "baseline:stale-evidence:impact:impact:evidence-1",
      "baseline:stale-evidence:validation:validation:evidence-1",
      "baseline:stale-evidence:run_signals:run:evidence-1",
      "baseline:stale-evidence:narrative:narrative:evidence-1",
      "baseline:stale-evidence:memory:memory:evidence-1",
    ]);
    expect(result.candidates.map((candidate) => candidate.priority)).toEqual([
      "high",
      "high",
      "normal",
      "normal",
      "low",
      "low",
    ]);
    expect(result.candidates[0]?.evidence[0]).toMatchObject({
      sourceKind: "dependency",
      evidenceReference: "dependency:evidence-1",
      staleness: "stale",
    });
    expect(result.candidates[0]?.reason).toContain("dependency");
  });

  it("[concurrency] [replay] keeps the deterministic baseline replayable and immutable", async () => {
    const first = await runRecallPipeline({ sources: sourceCollection() });
    const second = await runRecallPipeline({ sources: sourceCollection() });

    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.candidates)).toBe(true);
    expect(() => {
      (first.candidates as RecallCandidateSignal[]).push({} as RecallCandidateSignal);
    }).toThrow();
  });

  it("[domain] detects validation and run signals without a scoring algorithm", async () => {
    const result = await runRecallPipeline({
      sources: {
        validation: createValidationObservationAdapter(loader("validation:source", "validation:v1", [
          record("validation:failure-1", { id: "validation-1", outcome: "fail" }, "fresh", 1),
        ])),
        run_signals: createRunSignalsObservationAdapter(loader("run:source", "run:v1", [
          record("run:failure-1", {
            sourceKind: "attempt",
            sourceId: "attempt-1",
            code: "runtime_failed",
            message: "failed",
          }, "fresh", 1),
        ])),
      },
    });

    expect(result.candidates.map((candidate) => candidate.detectionKind)).toEqual([
      "validation_attention",
      "run_failure",
    ]);
    expect(result.candidates.map((candidate) => candidate.priority)).toEqual(["normal", "normal"]);
  });

  it("[recovery] does not require impact sources for the base pipeline", async () => {
    const sources = sourceCollection();
    delete sources.impact;
    const result = await runRecallPipeline({ sources });

    expect(result.candidates.some((candidate) => candidate.evidence[0]?.sourceKind === "impact")).toBe(false);
    expect(result.candidates).toHaveLength(5);
  });
});

describe("[task:5.1-5.2] [domain] pluggable recall detection boundary", () => {
  it("uses detector, classifier, and prioritizer plugins without creating workflow authority", async () => {
    const detector: RecallDetector = {
      id: "custom-detector",
      detect: (batch) => [
        {
          detectionId: "custom:1",
          detectionKind: "custom_attention",
          reason: "custom reason",
          evidence: batch.observations.slice(0, 1).map((observation) => ({
            sourceKind: observation.sourceKind,
            evidenceReference: observation.evidenceReference,
            sourceReference: observation.sourceReference,
            staleness: observation.staleness,
          })),
        },
      ],
    };
    const classifier: RecallClassifier = {
      id: "custom-classifier",
      classify: () => "context",
    };
    const prioritizer: RecallPrioritizer = {
      id: "custom-prioritizer",
      prioritize: () => "high",
    };

    const result = await runRecallPipeline({
      sources: sourceCollection(),
      detectors: [detector],
      classifier,
      prioritizer,
    });

    expect(result.detected).toHaveLength(1);
    expect(result.classified[0]?.classification).toBe("context");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.priority).toBe("high");
    expect(result.candidates[0]).not.toHaveProperty("taskId");
    expect(result.candidates[0]).not.toHaveProperty("commitId");
  });

  it("exposes each pipeline stage as a deterministic contract", async () => {
    const observed = await observeRecallSources(sourceCollection());
    const detected = detectRecallCandidates(observed, [baselineRecallDetector]);
    const classified = detected.map((detection) => ({
      candidateId: detection.detectionId,
      detection,
      classification: baselineRecallClassifier.classify(detection, observed),
    }));
    const prioritized = prioritizeRecallCandidates(classified, observed, baselineRecallPrioritizer);

    expect(observed.observations.map((observation) => observation.sourceKind)).toEqual([
      "dependency",
      "impact",
      "validation",
      "run_signals",
      "narrative",
      "memory",
    ]);
    expect(detected).toHaveLength(6);
    expect(classified.map((candidate) => candidate.classification)).toEqual([
      "risk",
      "risk",
      "validation",
      "run",
      "context",
      "context",
    ]);
    expect(prioritized.map((candidate) => candidate.priority)).toEqual([
      "high",
      "high",
      "normal",
      "normal",
      "low",
      "low",
    ]);
  });
});

describe("[task:5.1-5.2] [regression] deterministic baseline", () => {
  it("does not invent scores, vectors, tasks, or commits", async () => {
    const result = await runRecallPipeline({ sources: sourceCollection() });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("score");
    expect(serialized).not.toContain("vector");
    expect(serialized).not.toContain("taskId");
    expect(serialized).not.toContain("commitId");
  });
});
