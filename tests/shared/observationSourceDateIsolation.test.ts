import { describe, expect, it } from "vitest";
import {
  createObservation,
  createObservationSnapshot,
  type ObservationInput,
  type ObservationSource,
  type SourceReference,
} from "../../src/shared/domain/observationSource";

const sourceReference: SourceReference = {
  identity: "date-source-1",
  version: "date-rev-1",
  hash: "date-hash-1",
};
const originalIso = "2026-10-04T00:00:00.000Z";
const changedTime = Date.parse("2026-10-05T00:00:00.000Z");
const originalTime = Date.parse(originalIso);

function timestamp(value: unknown): { iso: string; epochMilliseconds: number } {
  return value as { iso: string; epochMilliseconds: number };
}

describe("observation Date isolation", () => {
  it("converts input Date values to immutable timestamp data", () => {
    const sourceDate = new Date(originalTime);
    const observation = createObservation({
      evidenceReference: "date-evidence-1",
      sourceReference,
      ordinal: 1,
      data: { occurredAt: sourceDate },
    });

    sourceDate.setTime(changedTime);

    expect(observation.data.occurredAt).not.toBeInstanceOf(Date);
    expect(timestamp(observation.data.occurredAt)).toEqual({
      iso: originalIso,
      epochMilliseconds: originalTime,
    });
    expect(() =>
      Date.prototype.setTime.call(observation.data.occurredAt, changedTime),
    ).toThrow();
    expect(() => Date.prototype.toISOString.call(observation.data.occurredAt)).toThrow();
  });

  it("prevents returned snapshot timestamp mutators from affecting source or repeated snapshots", async () => {
    const sourceDate = new Date(originalTime);
    const source: ObservationSource<{ occurredAt: Date }> = {
      async snapshot() {
        return createObservationSnapshot({
          sourceReference,
          observations: [
            createObservation({
              evidenceReference: "date-evidence-1",
              sourceReference,
              ordinal: 1,
              data: { occurredAt: sourceDate },
            }),
          ],
        });
      },
    };

    const first = await source.snapshot();
    const firstTimestamp = timestamp(first.observations[0]?.data.occurredAt);
    expect(() => {
      (firstTimestamp as { iso: string }).iso = "2099-01-01T00:00:00.000Z";
    }).toThrow();
    expect(() =>
      Date.prototype.setTime.call(first.observations[0]?.data.occurredAt, changedTime),
    ).toThrow();

    const second = await source.snapshot();
    expect(second).toEqual(first);
    expect(timestamp(second.observations[0]?.data.occurredAt)).toEqual({
      iso: originalIso,
      epochMilliseconds: originalTime,
    });
    expect(sourceDate.getTime()).toBe(originalTime);
  });

  it("copies bypassed snapshot Date data before exposing it", () => {
    const sourceDate = new Date(originalTime);
    const rawObservation = {
      evidenceReference: "date-evidence-bypass",
      sourceReference,
      ordinal: 1,
      data: { occurredAt: sourceDate },
    } satisfies ObservationInput<{ occurredAt: Date }>;

    const first = createObservationSnapshot({
      sourceReference,
      observations: [rawObservation],
    });
    expect(() =>
      Date.prototype.setTime.call(first.observations[0]?.data.occurredAt, changedTime),
    ).toThrow();

    const second = createObservationSnapshot({
      sourceReference,
      observations: [rawObservation],
    });
    expect(second).toEqual(first);
    expect(sourceDate.getTime()).toBe(originalTime);
    expect(timestamp(second.observations[0]?.data.occurredAt).epochMilliseconds).toBe(
      originalTime,
    );
  });
  it("keeps repeated snapshots stable when the original input Date mutates", async () => {
    const sourceDate = new Date(originalTime);
    const observation = createObservation({
      evidenceReference: "date-evidence-input-mutation",
      sourceReference,
      ordinal: 1,
      data: { occurredAt: sourceDate },
    });
    const source: ObservationSource<{ occurredAt: Date }> = {
      async snapshot() {
        return createObservationSnapshot({
          sourceReference,
          observations: [observation],
        });
      },
    };

    const first = await source.snapshot();
    sourceDate.setTime(changedTime);
    const second = await source.snapshot();

    expect(second).toEqual(first);
    expect(timestamp(second.observations[0]?.data.occurredAt).epochMilliseconds).toBe(
      originalTime,
    );
  });
});
