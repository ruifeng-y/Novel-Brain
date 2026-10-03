import { describe, expect, it } from "vitest";
import {
  assertNoDuplicateTargets,
  createChange,
  targetAddressKey,
} from "../../src/production/domain/change";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const sceneVersion = createVersionReference("Scene", "scene-1", "scene-rev-1");

function baseInput() {
  return {
    id: "change-1",
    sourceType: "proposal_adoption" as const,
    sourceReference: { identity: "proposal-1", version: "r3", hash: "hash-1" },
    targetAddress: { targetType: "manuscript" as const, objectId: "scene-1" },
    payload: { text: "New text" },
    basedOnVersionSet: createVersionSet({ scene: sceneVersion }),
  };
}

describe("Change", () => {
  it("creates a change with exactly one source and one target address", () => {
    const change = createChange(baseInput());
    expect(change.sourceType).toBe("proposal_adoption");
    expect(change.targetAddress.objectId).toBe("scene-1");
    expect(change.sourceReference.identity).toBe("proposal-1");
  });

  it("rejects a missing source reference or target address", () => {
    expect(() => createChange({ ...baseInput(), sourceReference: undefined as never })).toThrow(
      "sourceReference is required",
    );
    expect(() => createChange({ ...baseInput(), targetAddress: undefined as never })).toThrow(
      "targetAddress is required",
    );
    expect(() =>
      createChange({ ...baseInput(), targetAddress: { targetType: "manuscript", objectId: "" } }),
    ).toThrow("targetAddress.objectId is required");
  });

  it("rejects an empty basedOnVersionSet", () => {
    expect(() => createChange({ ...baseInput(), basedOnVersionSet: createVersionSet({}) })).toThrow(
      "basedOnVersionSet must contain at least one dependency",
    );
  });

  it("builds a stable target key from target type and object id", () => {
    expect(targetAddressKey(createChange(baseInput()).targetAddress)).toBe("manuscript:scene-1");
  });

  it("includes the sub-address in the target key when present", () => {
    const change = createChange({
      ...baseInput(),
      targetAddress: {
        targetType: "story_state",
        objectId: "scene-1",
        subAddress: "character_state:john",
      },
    });
    expect(targetAddressKey(change.targetAddress)).toBe("story_state:scene-1#character_state:john");
  });

  it("freezes the change so callers cannot mutate it", () => {
    const change = createChange(baseInput());
    expect(() => {
      (change as { id: string }).id = "mutated";
    }).toThrow();
  });

  it("rejects two changes that share a target address", () => {
    const first = createChange(baseInput());
    const second = createChange({ ...baseInput(), id: "change-2" });
    expect(() => assertNoDuplicateTargets([first, second])).toThrow(
      "Duplicate target address in change set revision: manuscript:scene-1",
    );
    expect(() => assertNoDuplicateTargets([first])).not.toThrow();
  });

  it("deep-freezes nested payload content", () => {
    const change = createChange({
      ...baseInput(),
      payload: { text: "New text", meta: { tags: ["a"] } },
    });
    const meta = change.payload.meta as { tags: string[] };
    expect(() => meta.tags.push("b")).toThrow();
  });

  it("rejects a target object id containing the sub-address separator", () => {
    expect(() =>
      createChange({
        ...baseInput(),
        targetAddress: { targetType: "manuscript", objectId: "scene-1#x" },
      }),
    ).toThrow("targetAddress.objectId must not contain '#'");
  });

  it("rejects a sub-address containing the separator", () => {
    expect(() =>
      createChange({
        ...baseInput(),
        targetAddress: { targetType: "story_state", objectId: "scene-1", subAddress: "a#b" },
      }),
    ).toThrow("targetAddress.subAddress must not contain '#'");
  });

  it("treats the same object id with different sub-addresses as distinct addresses", () => {
    const first = createChange({
      ...baseInput(),
      id: "change-a",
      targetAddress: {
        targetType: "story_state",
        objectId: "scene-1",
        subAddress: "character_state:john",
      },
    });
    const second = createChange({
      ...baseInput(),
      id: "change-b",
      targetAddress: {
        targetType: "story_state",
        objectId: "scene-1",
        subAddress: "character_state:mary",
      },
    });
    expect(() => assertNoDuplicateTargets([first, second])).not.toThrow();
  });

  it("rejects two changes that share a sub-address", () => {
    const first = createChange({
      ...baseInput(),
      id: "change-a",
      targetAddress: {
        targetType: "story_state",
        objectId: "scene-1",
        subAddress: "character_state:john",
      },
    });
    const second = createChange({
      ...baseInput(),
      id: "change-b",
      targetAddress: {
        targetType: "story_state",
        objectId: "scene-1",
        subAddress: "character_state:john",
      },
    });
    expect(() => assertNoDuplicateTargets([first, second])).toThrow(
      "Duplicate target address in change set revision: story_state:scene-1#character_state:john",
    );
  });
});
