import { describe, expect, it } from "vitest";
import { modeIsCompatible, resolveFocus } from "../../src/app/focusResolution";
import type { WorkspaceObjectKind } from "../../src/app/objectEntryContract";

describe("focus resolution", () => {
  it("resolves an incompatible mode to the object default instead of failing", () => {
    expect(resolveFocus({ kind: "scene", requestedMode: "review" })).toEqual({
      resolved: true,
      kind: "scene",
      mode: "write",
    });
  });

  it("keeps an explicitly compatible mode", () => {
    expect(resolveFocus({ kind: "scene", requestedMode: "analyze" })).toEqual({
      resolved: true,
      kind: "scene",
      mode: "analyze",
    });
    expect(resolveFocus({ kind: "target-span", requestedMode: "review" })).toEqual({
      resolved: true,
      kind: "target-span",
      mode: "review",
    });
  });

  it("resolves the target span default mode to write", () => {
    expect(resolveFocus({ kind: "target-span", requestedMode: "write" })).toEqual({
      resolved: true,
      kind: "target-span",
      mode: "write",
    });
    expect(resolveFocus({ kind: "target-span" })).toEqual({
      resolved: true,
      kind: "target-span",
      mode: "write",
    });
  });

  it("falls back to the default mode when a compatible kind gets an unsupported mode", () => {
    // Target Span supports write / review, not analyze.
    expect(resolveFocus({ kind: "target-span", requestedMode: "analyze" })).toEqual({
      resolved: true,
      kind: "target-span",
      mode: "write",
    });
  });

  it("uses the object's default mode when no mode is requested", () => {
    expect(resolveFocus({ kind: "novel" })).toEqual({
      resolved: true,
      kind: "novel",
      mode: "explore",
    });
    expect(resolveFocus({ kind: "candidate" })).toEqual({
      resolved: true,
      kind: "candidate",
      mode: "review",
    });
  });

  it("treats single-mode objects as exactly their default mode", () => {
    expect(resolveFocus({ kind: "novel", requestedMode: "write" })).toEqual({
      resolved: true,
      kind: "novel",
      mode: "explore",
    });
    expect(resolveFocus({ kind: "proposal", requestedMode: "review" })).toEqual({
      resolved: true,
      kind: "proposal",
      mode: "design",
    });
  });

  it("reports an unknown runtime kind as unresolvable with a reason", () => {
    const resolution = resolveFocus({ kind: "not-a-kind" as WorkspaceObjectKind });
    expect(resolution.resolved).toBe(false);
    if (resolution.resolved) {
      throw new Error("expected an unresolvable focus");
    }
    expect(resolution.reason.length).toBeGreaterThan(0);
    expect(resolution.reason).toMatch(/not-a-kind/);
  });

  it("reports mode compatibility only for the supported pairs", () => {
    expect(modeIsCompatible("scene", "write")).toBe(true);
    expect(modeIsCompatible("scene", "analyze")).toBe(true);
    expect(modeIsCompatible("scene", "review")).toBe(false);
    expect(modeIsCompatible("target-span", "write")).toBe(true);
    expect(modeIsCompatible("target-span", "review")).toBe(true);
    expect(modeIsCompatible("target-span", "design")).toBe(false);
    expect(modeIsCompatible("novel", "explore")).toBe(true);
    expect(modeIsCompatible("novel", "write")).toBe(false);
    expect(modeIsCompatible("process", "write")).toBe(false);
  });

  it("treats modes of an unknown kind as incompatible", () => {
    expect(modeIsCompatible("not-a-kind" as WorkspaceObjectKind, "write")).toBe(false);
  });
});
