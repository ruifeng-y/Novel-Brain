export function deepFreeze<T>(value: T): T {
  return deepFreezeInternal(value, new WeakSet<object>());
}

function deepFreezeInternal<T>(value: T, seen: WeakSet<object>): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    if (!Object.isFrozen(value)) Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreezeInternal(nested, seen);
    }
  }
  return value;
}
