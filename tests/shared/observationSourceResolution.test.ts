import { describe, expect, it } from "vitest";
import {
  createObservation,
  createObservationSnapshot,
  resolveObservation,
  type SourceReference,
} from "../../src/shared/domain/observationSource";

const sourceReference: SourceReference = {
  identity: "validation-source-1",
  version: "validation-version-1",
  hash: "validation-hash-1",
};

function snapshot() {
  return createObservationSnapshot({
    sourceReference,
    observations: [
      createObservation({
        evidenceReference: "validation-evidence-1",
        sourceReference,
        ordinal: 1,
        data: { observation: "scene text is consistent" },
      }),
    ],
  });
}

describe("evidence reference resolution", () => {
  it("observes evidence only when identity, version, and hash are current", () => {
    expect(
      resolveObservation(snapshot(), {
        evidenceReference: "validation-evidence-1",
        sourceReference,
      }),
    ).toEqual({
      status: "observed",
      observation: {
        evidenceReference: "validation-evidence-1",
        sourceReference,
        ordinal: 1,
        data: { observation: "scene text is consistent" },
      },
    });
  });

  it("reports missing evidence without inventing a replacement", () => {
    expect(
      resolveObservation(snapshot(), {
        evidenceReference: "missing-evidence",
        sourceReference,
      }),
    ).toEqual({
      status: "missing",
      evidenceReference: "missing-evidence",
      expectedSourceReference: sourceReference,
    });
  });

  it.each([
    [
      "identity_mismatch",
      { identity: "validation-source-other", version: "validation-version-1", hash: "validation-hash-1" },
    ],
    [
      "version_mismatch",
      { identity: "validation-source-1", version: "validation-version-2", hash: "validation-hash-1" },
    ],
    [
      "hash_mismatch",
      { identity: "validation-source-1", version: "validation-version-1", hash: "validation-hash-2" },
    ],
  ] as const)("reports %s instead of reusing stale or altered evidence", (status, expectedSourceReference) => {
    expect(
      resolveObservation(snapshot(), {
        evidenceReference: "validation-evidence-1",
        sourceReference: expectedSourceReference,
      }),
    ).toEqual({
      status,
      evidenceReference: "validation-evidence-1",
      expectedSourceReference,
      actualSourceReference: sourceReference,
    });
  });
});
