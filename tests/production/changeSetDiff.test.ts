import { describe, expect, it } from "vitest";
import { createChange } from "../../src/production/domain/change";
import {
  diffChangeSets,
  isRevisionContentChange,
} from "../../src/production/domain/changeSetDiff";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

function change(input: {
  id: string;
  objectId?: string;
  text?: string;
  revisionId?: string;
  payload?: Readonly<Record<string, unknown>>;
}) {
  const objectId = input.objectId ?? "scene-1";
  return createChange({
    id: input.id,
    sourceType: "author_edit",
    sourceReference: { identity: "author-1", version: "r1", hash: `hash-${input.id}` },
    targetAddress: { targetType: "manuscript", objectId },
    payload: input.payload ?? { text: input.text ?? input.id },
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", objectId, input.revisionId ?? "scene-rev-1"),
    }),
  });
}

describe("changeSetDiff", () => {
  it("classifies unchanged, modified, and added changes", () => {
    const parent = [change({ id: "change-1" }), change({ id: "change-2", objectId: "scene-2" })];
    const child = [
      change({ id: "change-1" }),
      change({ id: "change-2", objectId: "scene-2", text: "changed" }),
      change({ id: "change-3", objectId: "scene-3" }),
    ];

    const diff = diffChangeSets(parent, child);
    expect(diff.find(entry => entry.changeId === "change-1")?.action).toBe("unchanged");
    expect(diff.find(entry => entry.changeId === "change-2")?.action).toBe("modified");
    expect(diff.find(entry => entry.changeId === "change-3")?.action).toBe("added");
  });

  it("reports removed changes", () => {
    expect(diffChangeSets([change({ id: "change-1" })], [])).toEqual([
      { changeId: "change-1", action: "removed" },
    ]);
  });

  it("treats a basedOnVersionSet change as modified", () => {
    const parent = [change({ id: "change-1" })];
    const child = [change({ id: "change-1", revisionId: "scene-rev-2" })];
    expect(diffChangeSets(parent, child)).toEqual([{ changeId: "change-1", action: "modified" }]);
  });

  it("detects whether a revision contains any content change", () => {
    const parent = [change({ id: "change-1" })];
    expect(isRevisionContentChange(parent, [change({ id: "change-1" })])).toBe(false);
    expect(isRevisionContentChange(parent, [])).toBe(true);
  });

  it("ignores ordinary object key insertion order recursively", () => {
    const parent = [
      change({
        id: "change-1",
        payload: { outer: { first: 1, second: 2 }, third: 3 },
      }),
    ];
    const child = [
      change({
        id: "change-1",
        payload: { third: 3, outer: { second: 2, first: 1 } },
      }),
    ];

    expect(diffChangeSets(parent, child)).toEqual([{ changeId: "change-1", action: "unchanged" }]);
  });

  it("distinguishes NaN from Infinity without conflating them as JSON null", () => {
    const parent = [change({ id: "change-1", payload: { value: NaN } })];

    expect(diffChangeSets(parent, [change({ id: "change-1", payload: { value: NaN } })])).toEqual([
      { changeId: "change-1", action: "unchanged" },
    ]);
    expect(
      diffChangeSets(parent, [change({ id: "change-1", payload: { value: Infinity } })]),
    ).toEqual([{ changeId: "change-1", action: "modified" }]);
  });

  it("compares BigInt values without throwing", () => {
    const parent = [change({ id: "change-1", payload: { value: 1n } })];

    expect(diffChangeSets(parent, [change({ id: "change-1", payload: { value: 1n } })])).toEqual([
      { changeId: "change-1", action: "unchanged" },
    ]);
    expect(diffChangeSets(parent, [change({ id: "change-1", payload: { value: 2n } })])).toEqual([
      { changeId: "change-1", action: "modified" },
    ]);
  });

  it("distinguishes positive zero from negative zero", () => {
    expect(
      diffChangeSets(
        [change({ id: "change-1", payload: { value: 0 } })],
        [change({ id: "change-1", payload: { value: -0 } })],
      ),
    ).toEqual([{ changeId: "change-1", action: "modified" }]);
  });

  it("is sensitive to array order while recursively comparing ordinary objects", () => {
    const parent = [
      change({ id: "change-1", payload: { items: [1, 2], nested: { first: 1, second: 2 } } }),
    ];
    const reordered = [
      change({ id: "change-1", payload: { nested: { second: 2, first: 1 }, items: [1, 2] } }),
    ];
    const reorderedArray = [
      change({ id: "change-1", payload: { nested: { second: 2, first: 1 }, items: [2, 1] } }),
    ];
    const changedNestedValue = [
      change({ id: "change-1", payload: { nested: { second: 2, first: 3 }, items: [1, 2] } }),
    ];

    expect(diffChangeSets(parent, reordered)).toEqual([
      { changeId: "change-1", action: "unchanged" },
    ]);
    expect(diffChangeSets(parent, reorderedArray)).toEqual([
      { changeId: "change-1", action: "modified" },
    ]);
    expect(diffChangeSets(parent, changedNestedValue)).toEqual([
      { changeId: "change-1", action: "modified" },
    ]);
  });

  it("compares Dates by time value", () => {
    const timestamp = Date.UTC(2026, 9, 3);
    const parent = [change({ id: "change-1", payload: { value: new Date(timestamp) } })];

    expect(
      diffChangeSets(parent, [change({ id: "change-1", payload: { value: new Date(timestamp) } })]),
    ).toEqual([{ changeId: "change-1", action: "unchanged" }]);
    expect(
      diffChangeSets(
        parent,
        [change({ id: "change-1", payload: { value: new Date(timestamp + 1) } })],
      ),
    ).toEqual([{ changeId: "change-1", action: "modified" }]);
  });

  it("requires identity equality for non-plain objects", () => {
    class Snapshot {
      public constructor(public readonly value: number) {}
    }

    const sharedMap = new Map([["key", 1]]);
    const sharedSnapshot = new Snapshot(1);
    const parent = [
      change({ id: "change-1", payload: { map: sharedMap, snapshot: sharedSnapshot } }),
    ];
    const sameReferences = [
      change({ id: "change-1", payload: { map: sharedMap, snapshot: sharedSnapshot } }),
    ];
    const equivalentNonPlainObjects = [
      change({
        id: "change-1",
        payload: { map: new Map([["key", 1]]), snapshot: new Snapshot(1) },
      }),
    ];

    expect(diffChangeSets(parent, sameReferences)).toEqual([
      { changeId: "change-1", action: "unchanged" },
    ]);
    expect(diffChangeSets(parent, equivalentNonPlainObjects)).toEqual([
      { changeId: "change-1", action: "modified" },
    ]);
  });
});
