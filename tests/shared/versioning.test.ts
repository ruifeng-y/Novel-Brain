import { describe, expect, it } from "vitest";
import {
  assertCovers,
  createVersionReference,
  createVersionSet,
  mergeVersionSets,
} from "../../src/shared/domain/versioning";

const sceneVersion = createVersionReference("Scene", "scene-1", "scene-rev-1");
const characterVersion = createVersionReference("CanonicalFact", "fact-1", "fact-rev-1");

describe("version sets", () => {
  it("rejects an empty object id", () => {
    expect(() => createVersionReference("Scene", "", "rev-1")).toThrow("objectId is required");
  });

  it("creates an immutable version set", () => {
    const set = createVersionSet({ scene: sceneVersion });
    expect(() => {
      (set as Record<string, unknown>).scene = characterVersion;
    }).toThrow();
    expect(set.scene).toEqual(sceneVersion);
  });

  it("merges sets without mutation", () => {
    const left = createVersionSet({ scene: sceneVersion });
    const right = createVersionSet({ character: characterVersion });
    const merged = mergeVersionSets(left, right);
    expect(merged).toEqual({ scene: sceneVersion, character: characterVersion });
    expect(left).toEqual({ scene: sceneVersion });
    expect(right).toEqual({ character: characterVersion });
  });

  it("requires all named dependencies to be present", () => {
    const set = createVersionSet({ scene: sceneVersion });
    expect(() => assertCovers(set, ["scene", "character"])).toThrow(
      "Version set is missing dependency: character",
    );
    expect(() => assertCovers(set, ["scene"])).not.toThrow();
  });
});
