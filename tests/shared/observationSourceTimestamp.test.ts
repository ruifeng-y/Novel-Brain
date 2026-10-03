import { describe, expect, it } from "vitest";
import {
  createImmutableTimestamp,
  createObservation,
  type SourceReference,
} from "../../src/shared/domain/observationSource";

const sourceReference: SourceReference = {
  identity: "timestamp-source-1",
  version: "timestamp-rev-1",
  hash: "timestamp-hash-1",
};
const iso = "2026-10-04T00:00:00.000Z";
const epochMilliseconds = Date.parse(iso);

describe("ImmutableTimestamp construction", () => {
  it("creates a frozen timestamp only when iso and epochMilliseconds agree", () => {
    const timestamp = createImmutableTimestamp({ iso, epochMilliseconds });

    expect(timestamp).toEqual({ iso, epochMilliseconds });
    expect(Object.isFrozen(timestamp)).toBe(true);
    expect(() => (timestamp as { iso: string }).iso = "changed").toThrow();
  });

  it.each([
    ["missing iso", { epochMilliseconds }],
    ["missing epochMilliseconds", { iso }],
    ["inconsistent values", { iso, epochMilliseconds: epochMilliseconds + 1 }],
    ["extra field", { iso, epochMilliseconds, mutable: true }],
  ] as const)("rejects malformed raw timestamp %s", (_name, input) => {
    expect(() => createImmutableTimestamp(input as never)).toThrow();
  });

  it("rejects class instance timestamp input", () => {
    class RawTimestamp {
      readonly iso = iso;
      readonly epochMilliseconds = epochMilliseconds;
    }

    expect(() => createImmutableTimestamp(new RawTimestamp())).toThrow();
  });

  it("rejects malformed branded timestamp data in observations", () => {
    const valid = createImmutableTimestamp({ iso, epochMilliseconds });
    const malformedBranded = Object.create(valid);

    expect(() =>
      createObservation({
        evidenceReference: "timestamp-evidence",
        sourceReference,
        ordinal: 1,
        data: { occurredAt: malformedBranded },
      }),
    ).toThrow("malformed branded ImmutableTimestamp");
  });

  it("treats ordinary objects with timestamp-like field names as business data", () => {
    const observation = createObservation({
      evidenceReference: "timestamp-like-business-data",
      sourceReference,
      ordinal: 1,
      data: {
        occurredAt: {
          iso: "business-value",
          epochMilliseconds: 17,
          business: "ordinary",
        },
      },
    });

    expect(observation.data.occurredAt).toEqual({
      iso: "business-value",
      epochMilliseconds: 17,
      business: "ordinary",
    });
  });

  it("accepts valid raw ImmutableTimestamp data and keeps it immutable", () => {
    const observation = createObservation({
      evidenceReference: "timestamp-evidence-valid",
      sourceReference,
      ordinal: 1,
      data: { occurredAt: { epochMilliseconds, iso } },
    });

    expect(observation.data.occurredAt).toEqual({ iso, epochMilliseconds });
    expect(Object.isFrozen(observation.data.occurredAt)).toBe(true);
  });
});
