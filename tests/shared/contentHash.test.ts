import { describe, expect, it } from "vitest";
import { canonicalJson, hashContent } from "../../src/shared/domain/contentHash";

describe("canonical observation content", () => {
  it("is independent of plain object key order", () => {
    const left = {
      b: { z: 2, a: 1 },
      a: [{ y: 2, x: 1 }, 3],
    };
    const right = {
      a: [{ x: 1, y: 2 }, 3],
      b: { a: 1, z: 2 },
    };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(hashContent(canonicalJson(left))).toBe(hashContent(canonicalJson(right)));
  });

  it("sorts keys by stable code units across locale-sensitive names", () => {
    const input = Object.fromEntries(
      ["a", "A", "ä", "e\u0301", "i", "I", "ı", "İ", "z", "_"].map((key, index) => [
        key,
        index + 1,
      ]),
    );

    expect(canonicalJson(input)).toBe(
      '{"A":2,"I":6,"_":10,"a":1,"e\u0301":4,"i":5,"z":9,"ä":3,"İ":8,"ı":7}',
    );
  });

  it("preserves array order", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("uses one fixed representation for Date and ImmutableTimestamp values", () => {
    const date = new Date("2026-10-04T00:00:00.000Z");
    const timestamp = {
      iso: "2026-10-04T00:00:00.000Z",
      epochMilliseconds: Date.parse("2026-10-04T00:00:00.000Z"),
    };

    expect(canonicalJson({ value: date })).toBe(
      '{"value":{"epochMilliseconds":1791072000000,"iso":"2026-10-04T00:00:00.000Z"}}',
    );
    expect(canonicalJson({ value: timestamp })).toBe(canonicalJson({ value: date }));
  });
  it("rejects undefined, function, symbol, and BigInt content", () => {
    expect(() => canonicalJson(undefined)).toThrow("canonical content undefined is not supported");
    expect(() => canonicalJson({ value: undefined })).toThrow(
      "canonical content undefined is not supported",
    );
    expect(() => canonicalJson(() => "value")).toThrow(
      "canonical content value is not supported",
    );
    expect(() => canonicalJson(Symbol("value"))).toThrow(
      "canonical content value is not supported",
    );
    expect(() => canonicalJson(1n)).toThrow("canonical content value is not supported");
  });

  it("supports null and shared DAG references", () => {
    const shared = { value: 1 };

    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson({ left: shared, right: shared })).toBe(
      '{"left":{"value":1},"right":{"value":1}}',
    );
  });

  it("rejects cyclic content explicitly", () => {
    const node: { self?: unknown } = {};
    node.self = node;

    expect(() => canonicalJson(node)).toThrow("canonical content cycles are not supported");
  });
});
