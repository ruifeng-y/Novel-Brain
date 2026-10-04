import { describe, expect, it } from "vitest";
import { canonicalJson, hashContent } from "../../src/shared/domain/contentHash";
import { createSourceReference, type SourceReference } from "../../src/shared/domain/observationSource";
import {
  createDependencyObservationAdapter,
  createImpactObservationAdapter,
  createMemoryObservationAdapter,
  createNarrativeObservationAdapter,
  createRunSignalsObservationAdapter,
  createValidationObservationAdapter,
  type RecallObservationAdapter,
  type RecallObservationLoad,
  type RecallObservationRecord,
  type RecallObservationSourceKind,
  type RecallObservationStaleness,
} from "../../src/recall/observation/sourceAdapters";

function sourceReference(identity: string, version: string, hash = `hash-${identity}-${version}`): SourceReference {
  return createSourceReference({ identity, version, hash });
}

function record<T>(
  evidenceReference: string,
  value: T,
  staleness: RecallObservationStaleness = "fresh",
  ordinal = 1,
): RecallObservationRecord<T> {
  return {
    evidenceReference,
    sourceReference: sourceReference(evidenceReference, `v-${evidenceReference}`),
    ordinal,
    staleness,
    value,
  };
}

function load<T>(
  sourceIdentity: string,
  sourceVersion: string,
  records: readonly RecallObservationRecord<T>[],
): () => Promise<RecallObservationLoad<T>> {
  return async () => ({ sourceIdentity, sourceVersion, records });
}

const adapterFactories: readonly {
  readonly kind: RecallObservationSourceKind;
  readonly create: (loader: () => Promise<RecallObservationLoad<{ readonly id: string }>>) => RecallObservationAdapter<{ readonly id: string }>;
}[] = [
  { kind: "narrative", create: createNarrativeObservationAdapter },
  { kind: "dependency", create: createDependencyObservationAdapter },
  { kind: "impact", create: createImpactObservationAdapter },
  { kind: "validation", create: createValidationObservationAdapter },
  { kind: "memory", create: createMemoryObservationAdapter },
  { kind: "run_signals", create: createRunSignalsObservationAdapter },
];

describe("[task:5.1-5.2] [domain] read-only observation source adapters", () => {
  it("[persistence] [cross-system] normalizes source version, evidence identity, staleness, and immutable data for all six sources", async () => {
    for (const factory of adapterFactories) {
      const value = { id: `${factory.kind}-1`, nested: { text: "original" } };
      const inputRecord = record(`${factory.kind}:evidence-1`, value, "stale");
      const adapter = factory.create(load(`${factory.kind}:source`, `${factory.kind}:v1`, [inputRecord]));
      const snapshot = await adapter.snapshot();

      expect(snapshot.sourceReference.identity).toBe(`${factory.kind}:source`);
      expect(snapshot.sourceReference.version).toBe(`${factory.kind}:v1`);
      expect(snapshot.sourceReference.hash).toBe(hashContent(canonicalJson([inputRecord])));
      expect(snapshot.observations).toHaveLength(1);
      expect(snapshot.observations[0]?.evidenceReference).toBe(`${factory.kind}:evidence-1`);
      expect(snapshot.observations[0]?.sourceReference.identity).toBe(`${factory.kind}:evidence-1`);
      expect(snapshot.observations[0]?.data).toMatchObject({
        sourceKind: factory.kind,
        staleness: "stale",
        value,
      });
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.observations[0])).toBe(true);
    }
  });

  it("[transaction] keeps source data unchanged and rejects mutation through observed values", async () => {
    const value = { id: "narrative-1", nested: { text: "original" } };
    const before = structuredClone(value);
    const adapter = createNarrativeObservationAdapter(
      load("narrative:source", "narrative:v1", [record("narrative:evidence-1", value)]),
    );

    const snapshot = await adapter.snapshot();
    const observed = snapshot.observations[0]?.data as { value: { nested: { text: string } } };
    expect(() => {
      observed.value.nested.text = "mutated";
    }).toThrow();
    expect(value).toEqual(before);
    expect((await adapter.snapshot()).observations[0]?.data).toMatchObject({ value: before });
  });

  it("[recovery] changes source hash for real content changes and preserves source version independently", async () => {
    let value = { id: "narrative-1", text: "one" };
    const records = () => [record("narrative:evidence-1", value)];
    const adapter = createNarrativeObservationAdapter(async () => ({
      sourceIdentity: "narrative:source",
      sourceVersion: "narrative:v1",
      records: records(),
    }));

    const first = await adapter.snapshot();
    value = { id: "narrative-1", text: "two" };
    const second = await adapter.snapshot();

    expect(second.sourceReference.version).toBe(first.sourceReference.version);
    expect(second.sourceReference.hash).not.toBe(first.sourceReference.hash);
    expect(second.observations[0]?.evidenceReference).toBe(first.observations[0]?.evidenceReference);
  });

  it("marks missing and stale evidence without mutating the source", async () => {
    const records = [
      record("memory:evidence-1", { id: "memory-1" }, "missing", 1),
      record("memory:evidence-2", { id: "memory-2" }, "stale", 2),
      record("memory:evidence-3", { id: "memory-3" }, "fresh", 3),
    ];
    const adapter = createMemoryObservationAdapter(load("memory:source", "memory:v1", records));

    const snapshot = await adapter.snapshot();
    expect(snapshot.observations.map((observation) => (observation.data as { staleness: RecallObservationStaleness }).staleness))
      .toEqual(["missing", "stale", "fresh"]);
    expect(records.map((entry) => entry.staleness)).toEqual(["missing", "stale", "fresh"]);
  });
});
