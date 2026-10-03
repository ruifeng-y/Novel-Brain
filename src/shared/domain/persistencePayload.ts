const DATE_TAG = "$date";

function fail(path: string, reason: string): never {
  throw new Error(`Unsupported persistence payload at ${path}: ${reason}`);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertValue(value: unknown, path: string): void {
  if (value === null) return;
  switch (typeof value) {
    case "string":
    case "boolean":
      return;
    case "number":
      if (!Number.isFinite(value)) fail(path, "non-finite number");
      if (Object.is(value, -0)) fail(path, "negative zero");
      return;
    case "undefined":
      fail(path, "undefined");
      return;
    case "bigint":
    case "function":
    case "symbol":
      fail(path, typeof value);
      return;
    case "object":
      break;
    default:
      fail(path, typeof value);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail(path, "invalid Date");
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        fail(`${path}[${index}]`, "sparse array hole");
      }
      assertValue(value[index], `${path}[${index}]`);
    }
    return;
  }
  if (!isPlainObject(value)) {
    fail(path, "non-plain object");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(path, "symbol key");
    if (key === DATE_TAG) fail(path, "reserved Date tag");
    assertValue(value[key], `${path}.${key}`);
  }
}

/**
 * Capability persistence supports JSON-like plain values plus Date. Unsupported
 * values are rejected consistently instead of being lossy in one adapter.
 */
export function assertSupportedPersistencePayload(value: unknown): void {
  assertValue(value, "payload");
}

function encodeValue(value: unknown): unknown {
  if (value instanceof Date) return { [DATE_TAG]: value.toISOString() };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        encodeValue(nested),
      ]),
    );
  }
  return value;
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === DATE_TAG && typeof record[DATE_TAG] === "string") {
      return new Date(record[DATE_TAG] as string);
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, nested]) => [key, decodeValue(nested)]),
    );
  }
  return value;
}

export function encodePersistencePayload(value: unknown): Record<string, unknown> {
  assertSupportedPersistencePayload(value);
  return encodeValue(value) as Record<string, unknown>;
}

export function decodePersistencePayload(value: unknown): unknown {
  return decodeValue(value);
}

export interface PersistencePayloadCodec {
  assertSupported(value: unknown): void;
  encode(value: unknown): Record<string, unknown>;
  decode(value: unknown): unknown;
}

export const legacyPersistencePayloadCodec: PersistencePayloadCodec = {
  assertSupported: () => undefined,
  encode: (value) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>,
  decode: (value) => value,
};

export const capabilityPersistencePayloadCodec: PersistencePayloadCodec = {
  assertSupported: assertSupportedPersistencePayload,
  encode: encodePersistencePayload,
  decode: decodePersistencePayload,
};
