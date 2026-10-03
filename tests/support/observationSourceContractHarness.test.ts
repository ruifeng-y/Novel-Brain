import { describe, expect, it } from "vitest";
import { findUnfrozenPath } from "./observationSourceContract";
import { createImmutableTimestamp } from "../../src/shared/domain/observationSource";

describe("observation source contract validator", () => {
  it("does not treat frozen Map or Set contents as immutable", () => {
    expect(
      findUnfrozenPath(Object.freeze({ map: Object.freeze(new Map([["key", "value"]])) }), "value"),
    ).toBe("value.map[Map]");
    expect(
      findUnfrozenPath(Object.freeze({ set: Object.freeze(new Set(["value"])) }), "value"),
    ).toBe("value.set[Set]");
  });

  it("does not treat frozen Date internals as immutable", () => {
    expect(
      findUnfrozenPath(Object.freeze({ date: Object.freeze(new Date(0)) }), "value"),
    ).toBe("value.date[Date]");
  });

  it("does not treat frozen class instances as immutable observation data", () => {
    class ExampleData {
      readonly value = "example";
    }

    expect(
      findUnfrozenPath(Object.freeze({ value: Object.freeze(new ExampleData()) }), "value"),
    ).toBe("value.value[object]");
  });

  it("accepts deeply frozen plain observation data", () => {
    const value = Object.freeze({
      nested: Object.freeze({ timestamp: Object.freeze({ iso: "2026-10-04T00:00:00.000Z" }) }),
    });

    expect(findUnfrozenPath(value, "value")).toBeUndefined();
  });
  it("reports malformed branded timestamp values", () => {
    const valid = createImmutableTimestamp({
      iso: "2026-10-04T00:00:00.000Z",
      epochMilliseconds: Date.parse("2026-10-04T00:00:00.000Z"),
    });
    const malformed = Object.create(valid);

    expect(findUnfrozenPath(Object.freeze({ value: malformed }), "value")).toBe("value.value[timestamp]");
  });

  it("does not treat function values as immutable observation data", () => {
    expect(
      findUnfrozenPath(Object.freeze({ value: () => "mutable behavior" }), "value"),
    ).toBe("value.value[function]");
  });
});
