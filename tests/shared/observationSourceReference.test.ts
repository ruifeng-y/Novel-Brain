import { describe, expect, it } from "vitest";
import { createSourceReference } from "../../src/shared/domain/observationSource";

describe("observation source references", () => {
  it("keeps source identity, version, and hash stable and read-only", () => {
    const reference = createSourceReference({
      identity: "source-1",
      version: "version-1",
      hash: "hash-1",
    });

    expect(reference).toEqual({
      identity: "source-1",
      version: "version-1",
      hash: "hash-1",
    });
    expect(Object.isFrozen(reference)).toBe(true);
    expect(() => {
      (reference as { identity: string }).identity = "changed";
    }).toThrow();
  });

  it.each([
    ["identity", { identity: "", version: "version-1", hash: "hash-1" }],
    ["version", { identity: "source-1", version: "", hash: "hash-1" }],
    ["hash", { identity: "source-1", version: "version-1", hash: "" }],
  ] as const)("requires a non-empty %s", (field, input) => {
    expect(() => createSourceReference(input)).toThrow(`${field} is required`);
  });
});
