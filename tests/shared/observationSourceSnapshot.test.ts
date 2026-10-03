import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createObservation,
  createObservationSnapshot,
  type Observation,
  type ObservationSnapshot,
  type ObservationSource,
  type ReadonlySourceCollection,
  type SourceReference,
} from "../../src/shared/domain/observationSource";

const sourceReference: SourceReference = {
  identity: "memory-projection-1",
  version: "memory-rev-1",
  hash: "memory-hash-1",
};

describe("observation snapshots", () => {
  it("keeps evidence identity, source provenance, order, and data read-only", () => {
    const data = { nested: { values: ["one"] } };
    const observation = createObservation({
      evidenceReference: "memory-evidence-1",
      sourceReference,
      ordinal: 1,
      data,
    });

    expect(observation).toEqual({
      evidenceReference: "memory-evidence-1",
      sourceReference,
      ordinal: 1,
      data: { nested: { values: ["one"] } },
    });
    expect(Object.isFrozen(observation)).toBe(true);
    expect(Object.isFrozen(observation.data)).toBe(true);
    expect(Object.isFrozen(observation.data.nested)).toBe(true);
    expect(Object.isFrozen(observation.data.nested.values)).toBe(true);
    data.nested.values.push("two");
    expect(observation.data.nested.values).toEqual(["one"]);
    expect(() => (observation.data.nested.values as string[]).push("three")).toThrow();
  });

  it("creates a stable ordered snapshot without exposing mutable source data", () => {
    const observations = [
      createObservation({
        evidenceReference: "event-1",
        sourceReference,
        ordinal: 1,
        data: { eventId: "event-1" },
      }),
      createObservation({
        evidenceReference: "event-2",
        sourceReference,
        ordinal: 2,
        data: { eventId: "event-2" },
      }),
    ];
    const snapshot = createObservationSnapshot({ sourceReference, observations });

    expect(snapshot.sourceReference).toEqual(sourceReference);
    expect(snapshot.observations.map((item) => item.evidenceReference)).toEqual([
      "event-1",
      "event-2",
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.observations)).toBe(true);
    const mutableObservations = snapshot.observations as unknown as Observation<
      { eventId: string }
    >[];
    expect(() => mutableObservations.push(observations[0] as Observation<{ eventId: string }>)).toThrow();
  });

  it("rejects duplicate evidence identities and broken event ordering", () => {
    const duplicate = createObservation({
      evidenceReference: "event-duplicate",
      sourceReference,
      ordinal: 1,
      data: { eventId: "event-duplicate" },
    });
    expect(() =>
      createObservationSnapshot({
        sourceReference,
        observations: [duplicate, duplicate],
      }),
    ).toThrow("Duplicate evidenceReference: event-duplicate");

    const first = createObservation({
      evidenceReference: "event-first",
      sourceReference,
      ordinal: 2,
      data: { eventId: "event-first" },
    });
    const second = createObservation({
      evidenceReference: "event-second",
      sourceReference,
      ordinal: 2,
      data: { eventId: "event-second" },
    });
    expect(() =>
      createObservationSnapshot({ sourceReference, observations: [first, second] }),
    ).toThrow("observation ordinals must be strictly increasing");
  });

  it("rejects missing evidence identity and invalid ordering", () => {
    expect(() =>
      createObservation({
        evidenceReference: "",
        sourceReference,
        ordinal: 1,
        data: {},
      }),
    ).toThrow("evidenceReference is required");
    expect(() =>
      createObservation({
        evidenceReference: "event-invalid-order",
        sourceReference,
        ordinal: 0,
        data: {},
      }),
    ).toThrow("ordinal must be a positive integer");
  });

  it("exposes only typed read-only source collection members", () => {
    interface Sources {
      readonly memory: ObservationSource<{ readonly novelId: string }>;
      readonly events: ObservationSource<{ readonly eventId: string }>;
    }
    type Collection = ReadonlySourceCollection<Sources>;

    expectTypeOf<Collection["memory"]>().toEqualTypeOf<
      ObservationSource<{ readonly novelId: string }>
    >();
    expectTypeOf<Collection>().toEqualTypeOf<Readonly<Sources>>();
    expectTypeOf<ObservationSnapshot<string>["observations"]>().toEqualTypeOf<
      readonly Observation<string>[]
    >();
  });
  it("validates bypassed evidence identity and ordinal inputs", () => {
    const missingEvidence = {
      evidenceReference: "",
      sourceReference,
      ordinal: 1,
      data: {},
    } as Observation<Record<string, never>>;
    const invalidOrdinal = {
      evidenceReference: "event-invalid-ordinal",
      sourceReference,
      ordinal: 0,
      data: {},
    } as Observation<Record<string, never>>;

    expect(() =>
      createObservationSnapshot({ sourceReference, observations: [missingEvidence] }),
    ).toThrow("evidenceReference is required");
    expect(() =>
      createObservationSnapshot({ sourceReference, observations: [invalidOrdinal] }),
    ).toThrow("ordinal must be a positive integer");
  });

  it("validates bypassed duplicate identity and ordering inputs", () => {
    const first = {
      evidenceReference: "event-bypass-duplicate",
      sourceReference,
      ordinal: 1,
      data: {},
    } as Observation<Record<string, never>>;
    const duplicate = {
      evidenceReference: "event-bypass-duplicate",
      sourceReference,
      ordinal: 2,
      data: {},
    } as Observation<Record<string, never>>;
    const later = {
      evidenceReference: "event-bypass-later",
      sourceReference,
      ordinal: 2,
      data: {},
    } as Observation<Record<string, never>>;
    const earlier = {
      evidenceReference: "event-bypass-earlier",
      sourceReference,
      ordinal: 1,
      data: {},
    } as Observation<Record<string, never>>;

    expect(() =>
      createObservationSnapshot({ sourceReference, observations: [first, duplicate] }),
    ).toThrow("Duplicate evidenceReference: event-bypass-duplicate");
    expect(() =>
      createObservationSnapshot({ sourceReference, observations: [later, earlier] }),
    ).toThrow("observation ordinals must be strictly increasing");
  });

  it("validates bypassed source reference fields", () => {
    const invalidSourceReference = {
      evidenceReference: "event-invalid-source",
      sourceReference: {
        identity: "source-1",
        version: "version-1",
        hash: "",
      },
      ordinal: 1,
      data: {},
    } as Observation<Record<string, never>>;

    expect(() =>
      createObservationSnapshot({
        sourceReference: {
          identity: "source-1",
          version: "version-1",
          hash: "hash-1",
        },
        observations: [invalidSourceReference],
      }),
    ).toThrow("hash is required");
  });
  it("preserves heterogeneous observation provenance under a collection reference", () => {
    const firstSource: SourceReference = {
      identity: "source-a",
      version: "version-a",
      hash: "hash-a",
    };
    const secondSource: SourceReference = {
      identity: "source-b",
      version: "version-b",
      hash: "hash-b",
    };
    const snapshot = createObservationSnapshot({
      sourceReference: {
        identity: "collection-source",
        version: "collection-version-1",
        hash: "collection-hash-1",
      },
      observations: [
        {
          evidenceReference: "evidence-a",
          sourceReference: firstSource,
          ordinal: 1,
          data: { value: "a" },
        },
        {
          evidenceReference: "evidence-b",
          sourceReference: secondSource,
          ordinal: 2,
          data: { value: "b" },
        },
      ],
    });

    expect(snapshot.sourceReference.identity).toBe("collection-source");
    expect(snapshot.observations.map((observation) => observation.sourceReference)).toEqual([
      firstSource,
      secondSource,
    ]);
  });
  it("rejects mutable Map and Set observation data", () => {
    expect(() =>
      createObservation({
        evidenceReference: "map-data",
        sourceReference,
        ordinal: 1,
        data: { value: new Map([["key", "value"]]) },
      }),
    ).toThrow("Map observation data is not supported");
    expect(() =>
      createObservation({
        evidenceReference: "set-data",
        sourceReference,
        ordinal: 1,
        data: { value: Object.freeze(new Set(["value"])) },
      }),
    ).toThrow("Set observation data is not supported");
  });

  it("rejects class instance observation data", () => {
    class ExampleData {
      readonly value = "example";
    }

    expect(() =>
      createObservation({
        evidenceReference: "class-data",
        sourceReference,
        ordinal: 1,
        data: { value: new ExampleData() },
      }),
    ).toThrow("class instance observation data is not supported");
  });
  it("rejects function-valued observation data", () => {
    expect(() =>
      createObservation({
        evidenceReference: "function-data",
        sourceReference,
        ordinal: 1,
        data: { value: () => "mutable behavior" },
      }),
    ).toThrow("function observation data is not supported");
  });
});
