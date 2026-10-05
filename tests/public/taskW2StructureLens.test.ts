import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createNovelBrainServer } from "../../src/http/server";
import type { HttpBoundaryPipeline } from "../../src/http/httpBoundaryPipeline";

/**
 * These tests load the real browser modules and drive them directly. The
 * structure lens is DOM-free at import time, so `visibleNodes` / `zoomLevelFor`
 * run in Node and the renderer runs against a fake root.
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

interface TreeNode {
  readonly objectId: string;
  readonly kind: string;
  readonly title: string;
  readonly children: readonly TreeNode[];
}

function arc(id: string, chapters: readonly TreeNode[] = []): TreeNode {
  return { objectId: id, kind: "arc", title: `弧${id}`, children: chapters };
}

function chapter(id: string, scenes: readonly TreeNode[] = []): TreeNode {
  return { objectId: id, kind: "chapter", title: `章${id}`, children: scenes };
}

function scene(id: string): TreeNode {
  return { objectId: id, kind: "scene", title: `场${id}`, children: [] };
}

function fullView() {
  return {
    novelId: "novel-1",
    arcs: [
      arc("arc-1", [
        chapter("chapter-1", [scene("scene-1"), scene("scene-2")]),
        chapter("chapter-2", []),
      ]),
      arc("arc-2", []),
    ],
    orphanScenes: [scene("scene-orphan")],
    degraded: false,
    issues: [],
  };
}

function degradedView() {
  return {
    novelId: "novel-1",
    arcs: [arc("arc-1", [chapter("chapter-1", [scene("scene-1")])])],
    orphanScenes: [],
    degraded: true,
    issues: [
      {
        kind: "arc_chapter_entry_missing",
        objectId: "chapter-ghost",
        detail: "Arc arc-1 lists missing chapter chapter-ghost",
      },
    ],
  };
}

function emptyView() {
  return { novelId: "novel-1", arcs: [], orphanScenes: [], degraded: false, issues: [] };
}

const novelResolution = {
  kind: "novel",
  mode: "explore",
  surfaceKind: "overview, health, current state",
  defaultPanels: ["Attention", "Recent", "Health"],
  defaultLens: "structure",
};

const idsOf = (rows: readonly any[]): string[] => rows.map((row) => row.objectId);
const depthsOf = (rows: readonly any[]): number[] => rows.map((row) => row.depth);

function fakeTreeRoot() {
  const listeners: ((event: any) => void)[] = [];
  return {
    innerHTML: "",
    listeners,
    addEventListener(type: string, listener: (event: any) => void) {
      if (type === "click") listeners.push(listener);
    },
  };
}

const REGIONS = [
  "identity-bar",
  "lens-rail",
  "focus-bar",
  "working-surface",
  "context-panels",
  "attention-layer",
] as const;

/** A shell root whose regions can host the structure tree container. */
function fakeShellRoot() {
  const tree = { innerHTML: "" };
  const regions = new Map<string, any>();
  for (const region of REGIONS) {
    const element: any = { innerHTML: "" };
    element.querySelector = (selector: string) =>
      selector === '[data-role="structure-tree"]' ? tree : null;
    regions.set(`[data-region="${region}"]`, element);
  }
  return {
    tree,
    region(name: string): string {
      return regions.get(`[data-region="${name}"]`)?.innerHTML ?? "";
    },
    querySelector(selector: string) {
      return regions.get(selector) ?? null;
    },
  };
}

describe("[task:W2] [cross-system] semantic zoom names the tree granularity", () => {
  it("reads the session zoom for a focus key and defaults to the novel level", async () => {
    const model = await loadModule("focusModel.js");
    const lens = await loadModule("structureLens.js");

    let state = model.createSessionState("novel-1");
    state = model.navigate(state, { kind: "novel", id: "novel-1", mode: "explore" });

    expect(lens.zoomLevelFor(state, "novel:novel-1")).toBe("novel");
    expect(lens.zoomLevelFor(state, "chapter:chapter-1")).toBe("novel");

    state = model.setZoom(state, "novel:novel-1", "chapter");
    expect(lens.zoomLevelFor(state, "novel:novel-1")).toBe("chapter");

    state = model.setZoom(state, "novel:novel-1", "target-span");
    expect(lens.zoomLevelFor(state, "novel:novel-1")).toBe("span");

    expect(lens.zoomLevelFor(state, "")).toBe("novel");
    expect(lens.zoomLevelFor(null, "novel:novel-1")).toBe("novel");
  });

  it("expands the same subtree one granularity at a time", async () => {
    const lens = await loadModule("structureLens.js");
    const view = fullView();

    const novel = lens.visibleNodes(view, "novel", "");
    expect(idsOf(novel)).toEqual(["arc-1", "arc-2"]);
    expect(depthsOf(novel)).toEqual([1, 1]);

    const arcLevel = lens.visibleNodes(view, "arc", "");
    expect(idsOf(arcLevel)).toEqual(["arc-1", "chapter-1", "chapter-2", "arc-2"]);
    expect(depthsOf(arcLevel)).toEqual([1, 2, 2, 1]);

    const chapterLevel = lens.visibleNodes(view, "chapter", "");
    expect(idsOf(chapterLevel)).toEqual([
      "arc-1",
      "chapter-1",
      "scene-1",
      "scene-2",
      "chapter-2",
      "arc-2",
      "scene-orphan",
    ]);
    expect(depthsOf(chapterLevel)).toEqual([1, 2, 3, 3, 2, 1, 3]);
  });

  it("clamps scene and span to the fully expanded tree instead of a different tree", async () => {
    const lens = await loadModule("structureLens.js");
    const view = fullView();

    const chapterLevel = lens.visibleNodes(view, "chapter", "");
    const sceneLevel = lens.visibleNodes(view, "scene", "");
    const spanLevel = lens.visibleNodes(view, "span", "");

    expect(idsOf(sceneLevel)).toEqual(idsOf(chapterLevel));
    expect(idsOf(spanLevel)).toEqual(idsOf(chapterLevel));
    // Fully expanded, and visibly so: nothing claims there is more below.
    expect(idsOf(spanLevel)).toContain("scene-1");
    expect(idsOf(spanLevel)).toContain("scene-orphan");
    expect(Math.max(...depthsOf(spanLevel))).toBe(3);
  });

  it("marks the focused row and only the focused row", async () => {
    const lens = await loadModule("structureLens.js");
    const rows = lens.visibleNodes(fullView(), "chapter", "scene:scene-2");

    const current = rows.filter((row: any) => row.current === true);
    expect(current.map((row: any) => row.objectId)).toEqual(["scene-2"]);
  });

  it("never fabricates a node for a dangling container entry", async () => {
    const lens = await loadModule("structureLens.js");
    const view = degradedView();

    const rows = lens.visibleNodes(view, "chapter", "");

    expect(idsOf(rows)).not.toContain("chapter-ghost");
    expect(view.arcs[0]!.children.map((child) => child.objectId)).toEqual(["chapter-1"]);
  });

  it("renders orphan scenes as scenes that belong to no chapter", async () => {
    const lens = await loadModule("structureLens.js");
    const rows = lens.visibleNodes(fullView(), "chapter", "");
    const orphans = rows.filter((row: any) => row.orphan === true);

    expect(orphans.map((row: any) => row.objectId)).toEqual(["scene-orphan"]);
    expect(orphans.every((row: any) => row.kind === "scene")).toBe(true);
    // There is no shallower tree that silently drops them.
    expect(idsOf(lens.visibleNodes(fullView(), "arc", ""))).not.toContain("scene-orphan");
  });

  it("returns no rows for a view that has not loaded", async () => {
    const lens = await loadModule("structureLens.js");

    expect(lens.visibleNodes(null, "chapter", "")).toEqual([]);
  });

  it("is DOM-free at import time", async () => {
    const lens = await loadModule("structureLens.js");

    expect(typeof lens.renderStructureLens).toBe("function");
    expect(typeof lens.zoomLevelFor).toBe("function");
    expect(typeof lens.visibleNodes).toBe("function");
  });
});

describe("[task:W2] [cross-system] the structure lens renders honestly", () => {
  it("renders a degraded structure as degraded with its issues and no fabricated node", async () => {
    const lens = await loadModule("structureLens.js");
    const root = fakeTreeRoot();

    lens.renderStructureLens(root, degradedView(), { level: "chapter", focusKey: "" });

    expect(root.innerHTML).toContain('data-state="degraded"');
    expect(root.innerHTML).toContain("chapter-ghost");
    expect(root.innerHTML).not.toContain('data-structure-object-id="chapter-ghost"');
    expect(root.innerHTML).toContain('data-structure-object-id="chapter-1"');
  });

  it("renders an empty structure as the empty state, never as an error", async () => {
    const lens = await loadModule("structureLens.js");
    const root = fakeTreeRoot();

    lens.renderStructureLens(root, emptyView(), { level: "chapter", focusKey: "" });

    expect(root.innerHTML).toContain('data-state="empty"');
    expect(root.innerHTML).not.toContain('data-state="error"');
    expect(root.innerHTML).not.toContain("data-structure-object-id");
  });

  it("renders loading while the structure is in flight and error with a retry path", async () => {
    const lens = await loadModule("structureLens.js");
    const loading = fakeTreeRoot();
    const failed = fakeTreeRoot();

    lens.renderStructureLens(loading, null, { level: "chapter", focusKey: "" });
    lens.renderStructureLens(failed, null, {
      level: "chapter",
      focusKey: "",
      error: "结构加载失败",
    });

    expect(loading.innerHTML).toContain('data-state="loading"');
    expect(failed.innerHTML).toContain('data-state="error"');
    expect(failed.innerHTML).toContain("结构加载失败");
    expect(failed.innerHTML).toContain('data-ws-action="structure-retry"');
  });

  it("renders at the granularity it was given", async () => {
    const lens = await loadModule("structureLens.js");
    const shallow = fakeTreeRoot();
    const deep = fakeTreeRoot();

    lens.renderStructureLens(shallow, fullView(), { level: "novel", focusKey: "" });
    lens.renderStructureLens(deep, fullView(), { level: "chapter", focusKey: "" });

    expect(shallow.innerHTML).not.toContain('data-structure-object-id="chapter-1"');
    expect(deep.innerHTML).toContain('data-structure-object-id="chapter-1"');
    expect(deep.innerHTML).toContain('data-structure-object-id="scene-orphan"');
    expect(deep.innerHTML).toContain("不属于任何章节的场景");
  });

  it("selects a node through the handler instead of switching pages", async () => {
    const lens = await loadModule("structureLens.js");
    const root = fakeTreeRoot();
    const picked: any[] = [];

    lens.renderStructureLens(root, fullView(), {
      level: "chapter",
      focusKey: "",
      onSelect: (node: any) => picked.push(node),
    });

    expect(root.listeners.length).toBe(1);
    const attributes: Record<string, string> = {
      "data-structure-kind": "scene",
      "data-structure-object-id": "scene-2",
    };
    root.listeners[0]!({
      target: { closest: () => ({ getAttribute: (name: string) => attributes[name] ?? null }) },
    });
    expect(picked).toEqual([{ kind: "scene", objectId: "scene-2" }]);

    root.listeners[0]!({ target: { closest: () => null } });
    expect(picked.length).toBe(1);
  });

  it("ignores a missing root", async () => {
    const lens = await loadModule("structureLens.js");

    expect(() => lens.renderStructureLens(null, fullView(), {})).not.toThrow();
  });
});

describe("[task:W2] [cross-system] the tree lives in the lens rail and navigates the shell", () => {
  it("renders the structure tree inside the lens rail, below the lens selector", async () => {
    const model = await loadModule("focusModel.js");
    const shell = await loadModule("shell.js");
    const root = fakeShellRoot();

    let state = model.createSessionState("novel-1");
    state = model.initialiseLens(state, "structure");
    state = model.navigate(state, { kind: "novel", id: "novel-1", mode: "explore" });

    shell.renderShell(root, state, null, { view: fullView(), error: "" });

    const rail = root.region("lens-rail");
    expect(rail).toContain("ws-lens-list");
    expect(rail).toContain('data-role="structure-tree"');
    expect(rail.indexOf("ws-lens-list")).toBeLessThan(rail.indexOf('data-role="structure-tree"'));

    // The session zoom defaults to the novel granularity: arcs only.
    expect(root.tree.innerHTML).toContain('data-structure-object-id="arc-1"');
    expect(root.tree.innerHTML).not.toContain('data-structure-object-id="chapter-1"');

    // Zooming the Novel focus expands the same tree without navigating.
    state = model.setZoom(state, "novel:novel-1", "chapter");
    shell.renderShell(root, state, null, { view: fullView(), error: "" });

    expect(root.tree.innerHTML).toContain('data-structure-object-id="arc-1"');
    expect(root.tree.innerHTML).toContain('data-structure-object-id="chapter-1"');
    expect(root.tree.innerHTML).toContain('data-structure-object-id="scene-orphan"');
  });

  it("renders the tree without touching focus, lens, pinned context, or the stack", async () => {
    const model = await loadModule("focusModel.js");
    const shell = await loadModule("shell.js");
    const root = fakeShellRoot();

    let state = model.createSessionState("novel-1");
    state = model.initialiseLens(state, "structure");
    state = model.navigate(state, { kind: "novel", id: "novel-1", mode: "explore" });
    state = model.pin(state, { kind: "chapter", id: "chapter-1", label: "章节" });
    state = model.setLens(state, "temporal");
    state = model.setZoom(state, "novel:novel-1", "chapter");

    const before = JSON.stringify(state);
    shell.renderShell(root, state, null, { view: fullView(), error: "" });
    shell.renderShell(root, state, novelResolution, { view: fullView(), error: "" });

    expect(JSON.stringify(state)).toBe(before);
    expect(model.currentLens(state)).toBe("temporal");
    expect(state.pinned.length).toBe(1);
    expect(state.focusStack.length).toBe(1);
  });

  it("shows the loading state in the rail until the structure arrives", async () => {
    const model = await loadModule("focusModel.js");
    const shell = await loadModule("shell.js");
    const root = fakeShellRoot();

    let state = model.createSessionState("novel-1");
    state = model.initialiseLens(state, "structure");
    state = model.navigate(state, { kind: "novel", id: "novel-1", mode: "explore" });

    shell.renderShell(root, state, null, { view: null, error: "" });

    expect(root.tree.innerHTML).toContain('data-state="loading"');
  });

  it("keeps the structure tree out of a lens whose browse tree is not built yet", async () => {
    const model = await loadModule("focusModel.js");
    const shell = await loadModule("shell.js");
    const root = fakeShellRoot();

    let state = model.createSessionState("novel-1");
    state = model.initialiseLens(state, "structure");
    state = model.navigate(state, { kind: "novel", id: "novel-1", mode: "explore" });
    state = model.setLens(state, "impact");

    shell.renderShell(root, state, null, { view: fullView(), error: "" });

    expect(root.tree.innerHTML).toContain('data-state="empty"');
    expect(root.tree.innerHTML).not.toContain("data-structure-object-id");
  });

  it("selects a tree node through the shell's existing navigation path", () => {
    const source = shellSource();

    expect(source).toContain("renderStructureLens");
    expect(source).toContain("zoomLevelFor");
    expect(source).toMatch(/onSelect:\s*selectStructureNode/);
    expect(source).toMatch(/selectStructureNode[\s\S]{0,240}resolveKind\(/);
    expect(source).not.toContain("location.reload");
    expect(source).not.toContain("location.href");
  });

  it("loads the structure through the product API instead of reading it locally", () => {
    const apiClient = readFileSync(
      fileURLToPath(new URL("../../public/workspace/apiClient.js", import.meta.url)),
      "utf8",
    );

    expect(apiClient).toContain("getStructure");
    expect(apiClient).toContain("/structure");
    expect(apiClient).toContain("x-author-id");
  });
});

describe("[task:W2] [integration] structure lens static hosting", () => {
  it("serves the structure lens module off the boundary pipeline", async () => {
    const calls: string[] = [];
    const pipeline: HttpBoundaryPipeline = {
      async execute(contractId, _context, input, handler) {
        calls.push(contractId);
        return handler(input);
      },
    };
    const app = createNovelBrainServer(createInMemoryEngineDependencies(), {
      httpBoundaryPipeline: pipeline,
    });

    const module = await app.inject({ method: "GET", url: "/workspace/structureLens.js" });
    expect(module.statusCode).toBe(200);
    expect(module.headers["content-type"]).toContain("javascript");
    expect(module.body).toContain("renderStructureLens");

    const stylesheet = await app.inject({ method: "GET", url: "/workspace/workspace.css" });
    expect(stylesheet.statusCode).toBe(200);
    expect(stylesheet.body).toContain(".ws-tree");

    expect(calls).toEqual([]);
  });
});
