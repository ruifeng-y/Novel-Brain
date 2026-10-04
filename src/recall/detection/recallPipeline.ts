import { deepFreeze } from "../../shared/domain/immutable";
import type {
  ObservationSource,
  SourceReference,
} from "../../shared/domain/observationSource";
import type {
  RecallObservationAdapter,
  RecallObservationPayload,
  RecallObservationSourceKind,
  RecallObservationStaleness,
} from "../observation/sourceAdapters";

export type RecallObservationSource = ObservationSource<RecallObservationPayload<unknown>>;

export type RecallSourceCollection = Partial<
  Record<RecallObservationSourceKind, RecallObservationSource>
>;

export interface RecallObservedEvidence {
  readonly sourceKind: RecallObservationSourceKind;
  readonly evidenceReference: string;
  readonly sourceReference: SourceReference;
  readonly ordinal: number;
  readonly staleness: RecallObservationStaleness;
  readonly value: unknown;
}

export interface RecallObservationBatch {
  readonly observations: readonly RecallObservedEvidence[];
}

export interface RecallEvidenceReference {
  readonly sourceKind: RecallObservationSourceKind;
  readonly evidenceReference: string;
  readonly sourceReference: SourceReference;
  readonly staleness: RecallObservationStaleness;
}

export interface RecallDetection {
  readonly detectionId: string;
  readonly detectionKind: string;
  readonly reason: string;
  readonly evidence: readonly RecallEvidenceReference[];
}

export type RecallClassification = "risk" | "validation" | "run" | "context";
export type RecallPriority = "high" | "normal" | "low";

export interface ClassifiedRecallCandidate {
  readonly candidateId: string;
  readonly detection: RecallDetection;
  readonly classification: RecallClassification;
}

export interface RecallCandidateSignal {
  readonly candidateId: string;
  readonly detectionKind: string;
  readonly classification: RecallClassification;
  readonly priority: RecallPriority;
  readonly reason: string;
  readonly evidence: readonly RecallEvidenceReference[];
}

export interface RecallDetector {
  readonly id: string;
  detect(observations: RecallObservationBatch): readonly RecallDetection[];
}

export interface RecallClassifier {
  readonly id: string;
  classify(
    detection: RecallDetection,
    observations: RecallObservationBatch,
  ): RecallClassification;
}

export interface RecallPrioritizer {
  readonly id: string;
  prioritize(
    candidate: ClassifiedRecallCandidate,
    observations: RecallObservationBatch,
  ): RecallPriority;
}

export interface RecallPipelineInput {
  readonly sources: RecallSourceCollection;
  readonly detectors?: readonly RecallDetector[];
  readonly classifier?: RecallClassifier;
  readonly prioritizer?: RecallPrioritizer;
}

export interface RecallPipelineResult {
  readonly observed: RecallObservationBatch;
  readonly detected: readonly RecallDetection[];
  readonly classified: readonly ClassifiedRecallCandidate[];
  readonly candidates: readonly RecallCandidateSignal[];
}

const sourceKindOrder: readonly RecallObservationSourceKind[] = [
  "dependency",
  "impact",
  "validation",
  "review_decision",
  "narrative_commit",
  "run_signals",
  "narrative",
  "memory",
];

function evidenceReference(observation: RecallObservedEvidence): RecallEvidenceReference {
  return deepFreeze({
    sourceKind: observation.sourceKind,
    evidenceReference: observation.evidenceReference,
    sourceReference: observation.sourceReference,
    staleness: observation.staleness,
  });
}

function compareEvidence(left: RecallObservedEvidence, right: RecallObservedEvidence): number {
  return (
    sourceKindOrder.indexOf(left.sourceKind) - sourceKindOrder.indexOf(right.sourceKind) ||
    left.ordinal - right.ordinal ||
    left.evidenceReference.localeCompare(right.evidenceReference)
  );
}

export async function observeRecallSources(
  sources: RecallSourceCollection,
): Promise<RecallObservationBatch> {
  const observations: RecallObservedEvidence[] = [];
  for (const sourceKind of sourceKindOrder) {
    const source = sources[sourceKind];
    if (source === undefined) continue;
    const snapshot = await source.snapshot();
    for (const observation of snapshot.observations) {
      const data = observation.data as RecallObservationPayload<unknown>;
      if (data.sourceKind !== sourceKind) {
        throw new Error(
          `observation source ${sourceKind} returned mismatched sourceKind ${String(data.sourceKind)}`,
        );
      }
      observations.push(
        deepFreeze({
          sourceKind,
          evidenceReference: observation.evidenceReference,
          sourceReference: observation.sourceReference,
          ordinal: observation.ordinal,
          staleness: data.staleness,
          value: data.value,
        }),
      );
    }
  }
  observations.sort(compareEvidence);
  return deepFreeze({ observations });
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function isValidationAttention(value: unknown): boolean {
  const record = recordValue(value);
  return (
    record.outcome === "fail" ||
    record.outcome === "needs_review" ||
    record.executionState === "failed" ||
    record.executionState === "interrupted"
  );
}

function isRunFailure(value: unknown): boolean {
  const record = recordValue(value);
  return (
    typeof record.sourceKind === "string" &&
    typeof record.sourceId === "string" &&
    typeof record.code === "string" &&
    typeof record.message === "string"
  );
}

export const baselineRecallDetector: RecallDetector = Object.freeze({
  id: "deterministic-baseline",
  detect(observations: RecallObservationBatch) {
    return observations.observations.flatMap((observation) => {
      const evidence = [evidenceReference(observation)];
      if (observation.staleness !== "fresh") {
        return [
          deepFreeze({
            detectionId: `baseline:stale-evidence:${observation.sourceKind}:${observation.evidenceReference}`,
            detectionKind: "stale_evidence",
            reason: `${observation.sourceKind} evidence is ${observation.staleness}`,
            evidence,
          }),
        ];
      }
      if (observation.sourceKind === "validation" && isValidationAttention(observation.value)) {
        return [
          deepFreeze({
            detectionId: `baseline:validation-attention:${observation.evidenceReference}`,
            detectionKind: "validation_attention",
            reason: `validation evidence requires attention: ${observation.evidenceReference}`,
            evidence,
          }),
        ];
      }
      if (observation.sourceKind === "run_signals" && isRunFailure(observation.value)) {
        return [
          deepFreeze({
            detectionId: `baseline:run-failure:${observation.evidenceReference}`,
            detectionKind: "run_failure",
            reason: `run signal records a failure: ${observation.evidenceReference}`,
            evidence,
          }),
        ];
      }
      return [];
    });
  },
});

export const baselineRecallClassifier: RecallClassifier = Object.freeze({
  id: "deterministic-baseline",
  classify(detection: RecallDetection, _observations: RecallObservationBatch) {
    const sourceKind = detection.evidence[0]?.sourceKind;
    if (sourceKind === "dependency" || sourceKind === "impact") return "risk";
    if (sourceKind === "validation") return "validation";
    if (sourceKind === "run_signals") return "run";
    return "context";
  },
});

export const baselineRecallPrioritizer: RecallPrioritizer = Object.freeze({
  id: "deterministic-baseline",
  prioritize(candidate: ClassifiedRecallCandidate, _observations: RecallObservationBatch) {
    if (candidate.classification === "risk") return "high";
    if (candidate.classification === "validation" || candidate.classification === "run") {
      return "normal";
    }
    return "low";
  },
});

export function detectRecallCandidates(
  observations: RecallObservationBatch,
  detectors: readonly RecallDetector[] = [baselineRecallDetector],
): readonly RecallDetection[] {
  return deepFreeze(
    detectors
      .flatMap((detector) => detector.detect(observations))
      .sort(
        (left, right) =>
          sourceKindOrder.indexOf(left.evidence[0]?.sourceKind ?? "narrative") -
            sourceKindOrder.indexOf(right.evidence[0]?.sourceKind ?? "narrative") ||
          left.detectionId.localeCompare(right.detectionId),
      ),
  );
}

export function classifyRecallCandidates(
  detections: readonly RecallDetection[],
  observations: RecallObservationBatch,
  classifier: RecallClassifier = baselineRecallClassifier,
): readonly ClassifiedRecallCandidate[] {
  return deepFreeze(
    detections.map((detection) => ({
      candidateId: detection.detectionId,
      detection,
      classification: classifier.classify(detection, observations),
    })),
  );
}

const priorityOrder: Readonly<Record<RecallPriority, number>> = {
  high: 0,
  normal: 1,
  low: 2,
};

export function prioritizeRecallCandidates(
  candidates: readonly ClassifiedRecallCandidate[],
  observations: RecallObservationBatch,
  prioritizer: RecallPrioritizer = baselineRecallPrioritizer,
): readonly RecallCandidateSignal[] {
  return deepFreeze(
    candidates
      .map((candidate) => ({
        candidateId: candidate.candidateId,
        detectionKind: candidate.detection.detectionKind,
        classification: candidate.classification,
        priority: prioritizer.prioritize(candidate, observations),
        reason: candidate.detection.reason,
        evidence: candidate.detection.evidence,
      }))
      .sort(
        (left, right) =>
          priorityOrder[left.priority] - priorityOrder[right.priority] ||
          sourceKindOrder.indexOf(left.evidence[0]?.sourceKind ?? "narrative") -
            sourceKindOrder.indexOf(right.evidence[0]?.sourceKind ?? "narrative") ||
          left.candidateId.localeCompare(right.candidateId),
      ),
  );
}

export async function runRecallPipeline(
  input: RecallPipelineInput,
): Promise<RecallPipelineResult> {
  const observed = await observeRecallSources(input.sources);
  const detected = detectRecallCandidates(observed, input.detectors);
  const classified = classifyRecallCandidates(detected, observed, input.classifier);
  const candidates = prioritizeRecallCandidates(classified, observed, input.prioritizer);
  return deepFreeze({ observed, detected, classified, candidates });
}

export type { RecallObservationAdapter };
