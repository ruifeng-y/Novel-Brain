import { describe, expect, it } from "vitest";
import type { DomainEvent } from "../../src/safety/domain/domainEvent";
import { canonicalJson, hashContent } from "../../src/shared/domain/contentHash";
import {
  resolveObservation,
  createImmutableTimestamp,
  type ImmutableTimestamp,
  isImmutableTimestamp,
  type ObservationSnapshot,
  type ObservationSource,
  type SourceReference,
} from "../../src/shared/domain/observationSource";

export interface ExpectedObservationReference {
  readonly evidenceReference: string;
  readonly sourceReference: SourceReference;
  readonly ordinal: number;
}

export interface ObservationSourceContractEnvironment<T> {
  readonly source: ObservationSource<T>;
  readonly expectedSourceReference: SourceReference;
  readonly expectedObservations: readonly ExpectedObservationReference[];
  captureSourceState(): Promise<unknown>;
  attemptObservedDataMutation(snapshot: ObservationSnapshot<T>): void;
}

export interface DomainEventSourceContent {
  readonly eventId: string;
  readonly name: DomainEvent["name"];
  readonly context: DomainEvent["context"];
  readonly novelId: string;
  readonly objectId: string;
  readonly revisionId: string;
  readonly commitId: string | null;
  readonly payload: DomainEvent["payload"];
  readonly occurredAt: ImmutableTimestamp;
}

export function domainEventSourceContent(event: DomainEvent): DomainEventSourceContent {
  return {
    eventId: event.eventId,
    name: event.name,
    context: event.context,
    novelId: event.novelId,
    objectId: event.objectId,
    revisionId: event.revisionId,
    commitId: event.commitId ?? null,
    payload: event.payload,
    occurredAt: createImmutableTimestamp({
      iso: event.occurredAt.toISOString(),
      epochMilliseconds: event.occurredAt.getTime(),
    }),
  };
}

export function domainEventSourceReference(event: DomainEvent): SourceReference {
  return {
    identity: event.eventId,
    version: event.revisionId,
    hash: hashContent(canonicalJson(domainEventSourceContent(event))),
  };
}
export interface MutableObservationSourceContractEnvironment<T> {
  readonly source: ObservationSource<T>;
  readonly evidenceReference: string;
  readonly expectedInitialSourceReference: SourceReference;
  readonly expectedVersionChangedSourceReference: SourceReference;
  readonly expectedContentChangedSourceReference: SourceReference;
  changeSourceVersion(): Promise<void>;
  changeSourceContent(): Promise<void>;
}

export function runMutableObservationSourceContract<T>(
  adapterName: string,
  createEnvironment: () => Promise<MutableObservationSourceContractEnvironment<T>>,
): void {
  describe(`${adapterName} real content source contract`, () => {
    it("derives source version and content hash from actual source state", async () => {
      const environment = await createEnvironment();
      const snapshot = await environment.source.snapshot();

      expect(snapshot.sourceReference).toEqual(environment.expectedInitialSourceReference);
      expect(
        resolveObservation(snapshot, {
          evidenceReference: environment.evidenceReference,
          sourceReference: environment.expectedInitialSourceReference,
        }).status,
      ).toBe("observed");
    });

    it("identifies a real source version change with unchanged content", async () => {
      const environment = await createEnvironment();
      const initial = await environment.source.snapshot();
      expect(initial.sourceReference.hash).toBe(environment.expectedInitialSourceReference.hash);

      await environment.changeSourceVersion();
      const changed = await environment.source.snapshot();

      expect(changed.sourceReference).toEqual(environment.expectedVersionChangedSourceReference);
      expect(changed.sourceReference.hash).toBe(initial.sourceReference.hash);
      expect(
        resolveObservation(changed, {
          evidenceReference: environment.evidenceReference,
          sourceReference: environment.expectedInitialSourceReference,
        }),
      ).toMatchObject({
        status: "version_mismatch",
        actualSourceReference: environment.expectedVersionChangedSourceReference,
      });
    });

    it("identifies a real source content change with unchanged version", async () => {
      const environment = await createEnvironment();
      const initial = await environment.source.snapshot();
      expect(initial.sourceReference.version).toBe(environment.expectedInitialSourceReference.version);

      await environment.changeSourceContent();
      const changed = await environment.source.snapshot();

      expect(changed.sourceReference).toEqual(environment.expectedContentChangedSourceReference);
      expect(changed.sourceReference.version).toBe(initial.sourceReference.version);
      expect(changed.sourceReference.hash).not.toBe(initial.sourceReference.hash);
      expect(
        resolveObservation(changed, {
          evidenceReference: environment.evidenceReference,
          sourceReference: environment.expectedInitialSourceReference,
        }),
      ).toMatchObject({
        status: "hash_mismatch",
        actualSourceReference: environment.expectedContentChangedSourceReference,
      });
    });
  });
}

export function runObservationSourceContract<T>(
  adapterName: string,
  createEnvironment: () => Promise<ObservationSourceContractEnvironment<T>>,
): void {
  describe(`${adapterName} observation source contract`, () => {
    it("returns exact source provenance and stable ordered evidence identities", async () => {
      const environment = await createEnvironment();

      const first = await environment.source.snapshot();
      const second = await environment.source.snapshot();

      expect(first.sourceReference).toEqual(environment.expectedSourceReference);

      expect(
        first.observations.map((observation) => ({
          evidenceReference: observation.evidenceReference,
          sourceReference: observation.sourceReference,
          ordinal: observation.ordinal,
        })),
      ).toEqual(environment.expectedObservations);
      expect(second).toEqual(first);
    });

    it("returns deeply read-only data and performs no source write side effects", async () => {
      const environment = await createEnvironment();
      const before = await environment.captureSourceState();

      const snapshot = await environment.source.snapshot();
      expect(findUnfrozenPath(snapshot)).toBeUndefined();
      expect(() => environment.attemptObservedDataMutation(snapshot)).toThrow();

      expect(await environment.source.snapshot()).toEqual(snapshot);
      expect(await environment.captureSourceState()).toEqual(before);
    });

    it("resolves stable evidence references against the source snapshot", async () => {
      const environment = await createEnvironment();
      const snapshot = await environment.source.snapshot();

      for (const expected of environment.expectedObservations) {
        const resolution = resolveObservation(snapshot, {
          evidenceReference: expected.evidenceReference,
          sourceReference: expected.sourceReference,
        });
        expect(resolution.status).toBe("observed");
        if (resolution.status !== "observed") continue;
        expect({
          evidenceReference: resolution.observation.evidenceReference,
          sourceReference: resolution.observation.sourceReference,
          ordinal: resolution.observation.ordinal,
        }).toEqual(expected);
      }
    });
  });
}

export function findUnfrozenPath(value: unknown, path = "snapshot"): string | undefined {
  if (value === null) return undefined;
  if (typeof value === "function") return `${path}[function]`;
  if (typeof value !== "object") return undefined;
  try {
    if (isImmutableTimestamp(value)) {
      return Object.isFrozen(value) ? undefined : path;
    }
  } catch {
    return `${path}[timestamp]`;
  }
  if (value instanceof Date) return `${path}[Date]`;
  if (value instanceof Map) return `${path}[Map]`;
  if (value instanceof Set) return `${path}[Set]`;
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    return `${path}[object]`;
  }
  if (!Object.isFrozen(value)) return path;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nestedPath = findUnfrozenPath(nested, `${path}.${key}`);
    if (nestedPath !== undefined) return nestedPath;
  }
  return undefined;
}
