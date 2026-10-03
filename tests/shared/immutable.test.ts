import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../src/shared/domain/immutable";

describe("deepFreeze", () => {
  it("traverses already shallow-frozen parents to freeze nested values", () => {
    const nested = { values: ["one"] };
    const shallowFrozenParent = Object.freeze({ nested });

    const result = deepFreeze(shallowFrozenParent);

    expect(result).toBe(shallowFrozenParent);
    expect(Object.isFrozen(result.nested)).toBe(true);
    expect(Object.isFrozen(result.nested.values)).toBe(true);
  });

  it("supports circular object graphs", () => {
    const node: { name: string; self?: unknown } = { name: "node" };
    node.self = node;

    expect(() => deepFreeze(node)).not.toThrow();
    expect(Object.isFrozen(node)).toBe(true);
    expect(node.self).toBe(node);
  });

  it("supports circular arrays", () => {
    const values: unknown[] = [];
    values.push(values);

    expect(() => deepFreeze(values)).not.toThrow();
    expect(Object.isFrozen(values)).toBe(true);
    expect(values[0]).toBe(values);
  });
});
