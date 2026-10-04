import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import {
  createObservationSnapshot,
  createSourceReference,
  type EvidenceReference,
  type ObservationSource,
  type SourceReference,
} from "../../shared/domain/observationSource";

export type RecallObservationSourceKind =
  | "narrative"
  | "dependency"
  | "impact"
  | "validation"
  | "memory"
  | "run_signals";

export type RecallObservationStaleness = "fresh" | "stale" | "missing";

export interface RecallObservationPayload<T> {
  readonly sourceKind: RecallObservationSourceKind;
  readonly staleness: RecallObservationStaleness;
  readonly value: T;
}

export interface RecallObservationRecord<T> {
  readonly evidenceReference: EvidenceReference;
  readonly sourceReference: SourceReference;
  readonly ordinal: number;
  readonly staleness: RecallObservationStaleness;
  readonly value: T;
}

export interface RecallObservationLoad<T> {
  readonly sourceIdentity: string;
  readonly sourceVersion: string;
  readonly records: readonly RecallObservationRecord<T>[];
}

export type RecallObservationLoader<T> = () => Promise<RecallObservationLoad<T>>;

export interface RecallObservationAdapter<T> extends ObservationSource<RecallObservationPayload<T>> {
  readonly kind: RecallObservationSourceKind;
}

const stalenessValues = new Set<RecallObservationStaleness>(["fresh", "stale", "missing"]);

function requireText(value: string, field: string): string {
  if (!value.trim()) throw new Error(`${field} is required`);
  return value;
}

function assertRecord<T>(record: RecallObservationRecord<T>): void {
  requireText(record.evidenceReference, "evidenceReference");
  createSourceReference(record.sourceReference);
  if (!Number.isInteger(record.ordinal) || record.ordinal <= 0) {
    throw new Error("ordinal must be a positive integer");
  }
  if (!stalenessValues.has(record.staleness)) {
    throw new Error(`unsupported staleness: ${String(record.staleness)}`);
  }
}

export function createRecallObservationAdapter<T>(
  kind: RecallObservationSourceKind,
  load: RecallObservationLoader<T>,
): RecallObservationAdapter<T> {
  return Object.freeze({
    kind,
    async snapshot() {
      const loaded = await load();
      const sourceIdentity = requireText(loaded.sourceIdentity, "sourceIdentity");
      const sourceVersion = requireText(loaded.sourceVersion, "sourceVersion");
      for (const record of loaded.records) assertRecord(record);

      return createObservationSnapshot<RecallObservationPayload<T>>({
        sourceReference: createSourceReference({
          identity: sourceIdentity,
          version: sourceVersion,
          hash: hashContent(canonicalJson(loaded.records)),
        }),
        observations: loaded.records.map((record) => ({
          evidenceReference: record.evidenceReference,
          sourceReference: record.sourceReference,
          ordinal: record.ordinal,
          data: {
            sourceKind: kind,
            staleness: record.staleness,
            value: record.value,
          },
        })),
      });
    },
  });
}

export function createNarrativeObservationAdapter<T>(
  load: RecallObservationLoader<T>,
): RecallObservationAdapter<T> {
  return createRecallObservationAdapter("narrative", load);
}

export function createDependencyObservationAdapter<T>(
  load: RecallObservationLoader<T>,
): RecallObservationAdapter<T> {
  return createRecallObservationAdapter("dependency", load);
}

export function createImpactObservationAdapter<T>(
  load: RecallObservationLoader<T>,
): RecallObservationAdapter<T> {
  return createRecallObservationAdapter("impact", load);
}

export function createValidationObservationAdapter<T>(
  load: RecallObservationLoader<T>,
): RecallObservationAdapter<T> {
  return createRecallObservationAdapter("validation", load);
}

export function createMemoryObservationAdapter<T>(
  load: RecallObservationLoader<T>,
): RecallObservationAdapter<T> {
  return createRecallObservationAdapter("memory", load);
}

export function createRunSignalsObservationAdapter<T>(
  load: RecallObservationLoader<T>,
): RecallObservationAdapter<T> {
  return createRecallObservationAdapter("run_signals", load);
}
