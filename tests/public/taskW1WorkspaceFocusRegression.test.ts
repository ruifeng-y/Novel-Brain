import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * These tests load the real browser modules and drive them directly. Both
 * `focusModel.js` and `shell.js` are DOM-free at import time, so the session
 * model and the renderer can be exercised without a browser.
 */
async function loadModule(name: string): Promise<Record<string, any>> {
  const url = pathToFileURL(resolve("public/workspace", name)).href;
  return (await import(/* @vite-ignore */ url)) as Record<string, any>;
}

function shellSource(): string {
  return readFileSync(
    fileURLToPath(new URL("../../public/workspace/shell.js", import.meta.url)),
    "utf8",
  );
}

const REGIONS = [
  "identity-bar",
  "lens-rail",
  "focus-bar",
  "working-surface",
  "context-panels",
  "attention-layer",
] as const;

function fakeShellRoot() {
  const regions = new Map<string, { innerHTML: string }>();
  for (const region of REGIONS) regions.set(`[data-region="${region}"]`, { innerHTML: "" });
  return {
    region(region: string): string {
      return regions.get(`[data-region="${region}"]`)?.innerHTML ?? "";
    },
    querySelector(selector: string) {
      return regions.get(selector) ?? null;
    },
  };
}

const chapterView = {
  kind: "chapter",
  mode: "design",
  surfaceKind: "structure, plan",
  defaultPanels: ["Scenes", "Threads", "Foreshadowing"],
  defaultLens: "structure",
};

const novelView = {
  kind: "novel",
  mode: "explore",
  surfaceKind: "overview, health, current state",
  defaultPanels: ["Attention", "Recent", "Health"],
  defaultLens: "structure",
};

describe("[task:W1] [regression] the lens is a session property", () => {
  it("keeps the chosen lens across navigate, back, pin, and zoom", async () => {
    const model = await loadModule("focusModel.js");
    let state = model.createSessionState("novel-1");
    state = model.initialiseLens(state, "structure");
    state = model.navigate(state, { kind: "novel", id: "novel-1", mode: "explore" });
    state = model.navigate(state, { kind: "chapter", id: "chapter-1", mode: "design" });
    state = model.setLens(state, "temporal");

    expect(model.currentLens(state)).toBe("temporal");
    expect(model.currentLens(model.navigate(state, { kind: "scene", id: "scene-1", mode: "write" }))).toBe(
      "temporal",
    );
    expect(model.currentLens(model.goBack(state))).toBe("temporal");
    expect(model.currentLens(model.pin(state, { kind: "chapter", id: "chapter-1" }))).toBe("temporal");
    expect(model.currentLens(model.setZoom(state, "chapter:chapter-1", "scene"))).toBe("temporal");
  });

  it("stores no lens on a focus stack entry and ignores a per-target lens", async () => {
    const model = await loadModule("focusModel.js");
    let state = model.createSessionState("novel-1");
    state = model.initialiseLens(state, "structure");
    state = model.navigate(state, {
      kind: "chapter",
      id: "chapter-1",
      mode: "design",
      lens: "impact",
    });

    const entry = state.focusStack[state.focusStack.length - 1];
    expect(Object.keys(entry)).not.toContain("lens");
    expect(model.currentLens(state)).toBe("structure");
  });

  it("seeds the session lens once and never pulls it back to an object default", async () => {
    const model = await loadModule("focusModel.js");
    let state = model.createSessionState("novel-1");
    expect(model.currentLens(state)).toBeNull();

    state = model.initialiseLens(state, "structure");
    state = model.initialiseLens(state, "semantic");
    expect(model.currentLens(state)).toBe("structure");

    state = model.setLens(state, "impact");
    state = model.initialiseLens(state, "structure");
    expect(model.currentLens(state)).toBe("impact");
  });

  it("still restores the previous focus with its mode and zoom", async () => {
    const model = await loadModule("focusModel.js");
    let state = model.createSessionState("novel-1");
    state = model.navigate(state, { kind: "novel", id: "novel-1", mode: "explore" });
    state = model.setZoom(state, "novel:novel-1", "arc");
    state = model.navigate(state, { kind: "scene", id: "scene-1", mode: "write" });

    const back = model.goBack(state);
    expect(model.currentFocus(back).key).toBe("novel:novel-1");
    expect(model.currentFocus(back).mode).toBe("explore");
    expect(model.zoomFor(back, "novel:novel-1")).toBe("arc");
  });
});

describe("[task:W1] [regression] the working surface follows the restored focus", () => {
  it("never paints a surface from a resolution that belongs to another focus", async () => {
    const model = await loadModule("focusModel.js");
    const shell = await loadModule("shell.js");
    const root = fakeShellRoot();

    let state = model.createSessionState("novel-1");
    state = model.initialiseLens(state, "structure");
    state = model.navigate(state, { kind: "novel", id: "novel-1", mode: "explore" });
    state = model.navigate(state, { kind: "chapter", id: "chapter-1", mode: "design" });
    shell.renderShell(root, state, chapterView);
    expect(root.region("working-surface")).toContain("结构与计划");

    const restored = model.goBack(state);
    expect(model.currentFocus(restored).kind).toBe("novel");

    // The chapter resolution is stale for the restored focus.
    expect(shell.resolutionMatchesFocus(chapterView, model.currentFocus(restored))).toBe(false);
    shell.renderShell(root, restored, chapterView);
    expect(root.region("working-surface")).not.toContain("结构与计划");
    expect(root.region("working-surface")).toContain('data-state="loading"');

    expect(shell.resolutionMatchesFocus(novelView, model.currentFocus(restored))).toBe(true);
    shell.renderShell(root, restored, novelView);
    expect(root.region("working-surface")).toContain("概览");
    expect(root.region("focus-bar")).toContain("小说");
  });

  it("re-resolves the restored focus instead of reusing the previous resolution", () => {
    const source = shellSource();

    expect(source).toMatch(/action === "back"[\s\S]{0,200}afterFocusChange\(previousKey\)/);
    expect(source).toMatch(/async function afterFocusChange[\s\S]{0,200}resolveCurrentFocus\(\)/);
    expect(source).toMatch(/async function resolveCurrentFocus[\s\S]{0,400}resolution = null;/);
  });
});
