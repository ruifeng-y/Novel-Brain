import type { DomainId } from "../../shared/domain/ids";
import { targetAddressKey, type Change } from "./change";

export type ChangeDiffAction = "unchanged" | "modified" | "added" | "removed";

export interface ChangeDiffEntry {
  readonly changeId: DomainId;
  readonly action: ChangeDiffAction;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function contentEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && Object.is(left.getTime(), right.getTime());
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((entry, index) => contentEquals(entry, right[index]));
  }

  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every(
    key => Object.prototype.hasOwnProperty.call(right, key) && contentEquals(left[key], right[key]),
  );
}

function changesEqual(left: Change, right: Change): boolean {
  return (
    left.id === right.id &&
    left.sourceType === right.sourceType &&
    targetAddressKey(left.targetAddress) === targetAddressKey(right.targetAddress) &&
    contentEquals(left.sourceReference, right.sourceReference) &&
    contentEquals(left.payload, right.payload) &&
    contentEquals(left.basedOnVersionSet, right.basedOnVersionSet)
  );
}

export function diffChangeSets(
  parent: readonly Change[],
  child: readonly Change[],
): readonly ChangeDiffEntry[] {
  const parentById = new Map(parent.map(change => [change.id, change]));
  const childById = new Map(child.map(change => [change.id, change]));
  const entries: ChangeDiffEntry[] = [];

  for (const [id, childChange] of childById) {
    const parentChange = parentById.get(id);
    if (!parentChange) {
      entries.push(Object.freeze({ changeId: id, action: "added" }));
      continue;
    }
    entries.push(
      Object.freeze({
        changeId: id,
        action: changesEqual(parentChange, childChange) ? "unchanged" : "modified",
      }),
    );
  }

  for (const id of parentById.keys()) {
    if (!childById.has(id)) {
      entries.push(Object.freeze({ changeId: id, action: "removed" }));
    }
  }

  return Object.freeze(entries);
}

export function isRevisionContentChange(
  parent: readonly Change[],
  child: readonly Change[],
): boolean {
  return diffChangeSets(parent, child).some(entry => entry.action !== "unchanged");
}
