import { deepFreeze } from "./immutable";

export type EvidenceReference = string;

export interface ImmutableTimestamp {
  readonly iso: string;
  readonly epochMilliseconds: number;
}

const immutableTimestampBrand = Symbol("ImmutableTimestamp");

function assertImmutableTimestampShape(input: unknown): asserts input is ImmutableTimestamp {
  if (input === null || typeof input !== "object") {
    throw new Error("ImmutableTimestamp input is required");
  }
  const keys = Object.keys(input).sort();
  if (keys.length !== 2 || keys[0] !== "epochMilliseconds" || keys[1] !== "iso") {
    throw new Error("ImmutableTimestamp must contain exactly iso and epochMilliseconds");
  }
  const value = input as ImmutableTimestamp;
  if (typeof value.iso !== "string" || !value.iso) throw new Error("timestamp iso is required");
  if (!Number.isInteger(value.epochMilliseconds)) {
    throw new Error("timestamp epochMilliseconds must be an integer");
  }
  const parsed = Date.parse(value.iso);
  if (!Number.isFinite(parsed) || parsed !== value.epochMilliseconds) {
    throw new Error("timestamp iso and epochMilliseconds must agree");
  }
  if (new Date(value.epochMilliseconds).toISOString() !== value.iso) {
    throw new Error("timestamp iso must use canonical ISO representation");
  }
}

export function isImmutableTimestamp(value: unknown): value is ImmutableTimestamp {
  if (value === null || typeof value !== "object") return false;
  const hasOwnBrand = Object.prototype.hasOwnProperty.call(value, immutableTimestampBrand);
  const inheritedBrand = immutableTimestampBrand in value;
  if (inheritedBrand && !hasOwnBrand) {
    throw new Error("malformed branded ImmutableTimestamp");
  }
  if (!hasOwnBrand) return false;
  assertImmutableTimestampShape(value);
  return true;
}

export function createImmutableTimestamp(input: {
  readonly iso: string;
  readonly epochMilliseconds: number;
}): ImmutableTimestamp {
  if (input === null || typeof input !== "object") {
    throw new Error("ImmutableTimestamp input is required");
  }
  if (immutableTimestampBrand in input && !Object.prototype.hasOwnProperty.call(input, immutableTimestampBrand)) {
    throw new Error("malformed branded ImmutableTimestamp");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("ImmutableTimestamp input must be a plain object");
  }
  assertImmutableTimestampShape(input);
  const timestamp = {
    iso: input.iso,
    epochMilliseconds: input.epochMilliseconds,
  };
  Object.defineProperty(timestamp, immutableTimestampBrand, {
    value: true,
    enumerable: false,
  });
  return deepFreeze(timestamp);
}

export type ObservationValue<T> = T extends Date
  ? ImmutableTimestamp
  : T extends readonly (infer TEntry)[]
    ? readonly ObservationValue<TEntry>[]
    : T extends Map<unknown, unknown> | Set<unknown>
      ? never
      : T extends object
        ? { readonly [TKey in keyof T]: ObservationValue<T[TKey]> }
        : T;

function cloneObservationValue<T>(
  value: T,
  seen: WeakMap<object, unknown> = new WeakMap(),
): ObservationValue<T> {
  if (value === null) return value as ObservationValue<T>;
  if (typeof value === "function") {
    throw new Error("function observation data is not supported");
  }
  if (typeof value !== "object") return value as ObservationValue<T>;
  if (value instanceof Date) {
    return createImmutableTimestamp({
      iso: value.toISOString(),
      epochMilliseconds: value.getTime(),
    }) as ObservationValue<T>;
  }
  if (isImmutableTimestamp(value)) {
    return createImmutableTimestamp(value) as ObservationValue<T>;
  }
  const existing = seen.get(value);
  if (existing !== undefined) return existing as ObservationValue<T>;
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const entry of value) clone.push(cloneObservationValue(entry, seen));
    return clone as ObservationValue<T>;
  }
  if (value instanceof Map) throw new Error("Map observation data is not supported");
  if (value instanceof Set) throw new Error("Set observation data is not supported");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("class instance observation data is not supported");
  }
  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    clone[key] = cloneObservationValue(entry, seen);
  }
  return clone as ObservationValue<T>;
}

export interface SourceReference {
  readonly identity: string;
  readonly version: string;
  readonly hash: string;
}

export interface ObservationInput<T> {
  readonly evidenceReference: EvidenceReference;
  readonly sourceReference: SourceReference;
  readonly ordinal: number;
  readonly data: T | ObservationValue<T>;
}

export interface Observation<T> {
  readonly evidenceReference: EvidenceReference;
  readonly sourceReference: SourceReference;
  readonly ordinal: number;
  readonly data: ObservationValue<T>;
}

export interface ObservationSnapshot<T> {
  readonly sourceReference: SourceReference;
  readonly observations: readonly Observation<T>[];
}

export interface ObservationSource<T> {
  snapshot(): Promise<ObservationSnapshot<T>>;
}

export type ReadonlySourceCollection<
  TSources extends Readonly<Record<keyof TSources, ObservationSource<unknown>>>,
> = Readonly<TSources>;

export type ObservationResolution<T> =
  | {
      readonly status: "observed";
      readonly observation: Observation<T>;
    }
  | {
      readonly status: "missing";
      readonly evidenceReference: EvidenceReference;
      readonly expectedSourceReference: SourceReference;
    }
  | {
      readonly status: "identity_mismatch" | "version_mismatch" | "hash_mismatch";
      readonly evidenceReference: EvidenceReference;
      readonly expectedSourceReference: SourceReference;
      readonly actualSourceReference: SourceReference;
    };

export function createSourceReference(input: SourceReference): SourceReference {
  if (!input.identity) throw new Error("identity is required");
  if (!input.version) throw new Error("version is required");
  if (!input.hash) throw new Error("hash is required");

  return deepFreeze({
    identity: input.identity,
    version: input.version,
    hash: input.hash,
  });
}

export function createObservation<T>(input: {
  evidenceReference: EvidenceReference;
  sourceReference: SourceReference;
  ordinal: number;
  data: T | ObservationValue<T>;
}): Observation<T> {
  if (!input.evidenceReference) throw new Error("evidenceReference is required");
  if (!Number.isInteger(input.ordinal) || input.ordinal <= 0) {
    throw new Error("ordinal must be a positive integer");
  }

  return deepFreeze({
    evidenceReference: input.evidenceReference,
    sourceReference: createSourceReference(input.sourceReference),
    ordinal: input.ordinal,
    data: cloneObservationValue(input.data as T),
  });
}

export function createObservationSnapshot<T>(input: {
  sourceReference: SourceReference;
  observations: readonly ObservationInput<T>[];
}): ObservationSnapshot<T> {
  const snapshotSourceReference = createSourceReference(input.sourceReference);
  const evidenceReferences = new Set<string>();
  let previousOrdinal = 0;
  for (const observation of input.observations) {
    createSourceReference(observation.sourceReference);
    if (!observation.evidenceReference) throw new Error("evidenceReference is required");
    if (!Number.isInteger(observation.ordinal) || observation.ordinal <= 0) {
      throw new Error("ordinal must be a positive integer");
    }
    if (evidenceReferences.has(observation.evidenceReference)) {
      throw new Error(`Duplicate evidenceReference: ${observation.evidenceReference}`);
    }
    if (observation.ordinal <= previousOrdinal) {
      throw new Error("observation ordinals must be strictly increasing");
    }
    evidenceReferences.add(observation.evidenceReference);
    previousOrdinal = observation.ordinal;
  }

  return deepFreeze({
    sourceReference: snapshotSourceReference,
    observations: input.observations.map((observation) =>
      createObservation({
        evidenceReference: observation.evidenceReference,
        sourceReference: observation.sourceReference,
        ordinal: observation.ordinal,
        data: observation.data as T,
      }),
    ),
  });
}

export function resolveObservation<T>(
  snapshot: ObservationSnapshot<T>,
  expected: {
    readonly evidenceReference: EvidenceReference;
    readonly sourceReference: SourceReference;
  },
): ObservationResolution<T> {
  const observation = snapshot.observations.find(
    candidate => candidate.evidenceReference === expected.evidenceReference,
  );
  if (!observation) {
    return deepFreeze({
      status: "missing" as const,
      evidenceReference: expected.evidenceReference,
      expectedSourceReference: createSourceReference(expected.sourceReference),
    });
  }

  const actual = observation.sourceReference;
  const expectedReference = createSourceReference(expected.sourceReference);
  const status =
    actual.identity !== expectedReference.identity
      ? ("identity_mismatch" as const)
      : actual.version !== expectedReference.version
        ? ("version_mismatch" as const)
        : actual.hash !== expectedReference.hash
          ? ("hash_mismatch" as const)
          : undefined;
  if (status === undefined) {
    return deepFreeze({ status: "observed" as const, observation });
  }

  return deepFreeze({
    status,
    evidenceReference: expected.evidenceReference,
    expectedSourceReference: expectedReference,
    actualSourceReference: actual,
  });
}
