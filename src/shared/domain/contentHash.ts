import { createHash } from "node:crypto";
import { isImmutableTimestamp } from "./observationSource";

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeContent(value));
}

function canonicalizeContent(value: unknown, ancestors: WeakSet<object> = new WeakSet()): unknown {
  if (value === undefined) throw new Error("canonical content undefined is not supported");
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical content number must be finite");
    return value;
  }
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new Error("canonical content value is not supported");
  }
  if (value instanceof Date) {
    return {
      epochMilliseconds: value.getTime(),
      iso: value.toISOString(),
    };
  }
  if (isImmutableTimestamp(value)) {
    return {
      epochMilliseconds: value.epochMilliseconds,
      iso: value.iso,
    };
  }
  if (value instanceof Map || value instanceof Set) {
    throw new Error("canonical content Map/Set is not supported");
  }
  if (ancestors.has(value)) throw new Error("canonical content cycles are not supported");
  ancestors.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => canonicalizeContent(entry, ancestors));
    ancestors.delete(value);
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("canonical content class instance is not supported");
  }
  const result = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalizeContent(entry, ancestors)]),
  );
  ancestors.delete(value);
  return result;
}
