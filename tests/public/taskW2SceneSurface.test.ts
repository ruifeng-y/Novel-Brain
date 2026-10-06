import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createNovelBrainServer } from "../../src/http/server";
import type { HttpBoundaryPipeline } from "../../src/http/httpBoundaryPipeline";
import { hashContent } from "../../src/shared/domain/contentHash";

/**
 * These tests load the real browser modules and drive them directly. The scene
 * surface is DOM-free at import time, so the descriptor derivation and the
 * render branches run in Node against a fake root.
 */
async function loadModule(name: string): Promise<Record<string, any>> {
  const url = pathToFileURL(resolve("public/workspace", name)).href;
  return (await import(/* @vite-ignore */ url)) as Record<string, any>;
}

function publicFile(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../public/${name}`, import.meta.url)), "utf8");
}

function harness() {
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
  return { app, calls };
}

const REGIONS = [
  "identity-bar",
  "lens-rail",
  "focus-bar",
  "working-surface",
  "context-panels",
  "attention-layer",
] as const;

const sceneView = {
  sceneId: "scene-1",
  novelId: "novel-1",
  chapterId: "chapter-1",
  title: "第一场",
  revisionId: "scene-1:r2",
  text: "第一段。第二段。",
  anchorIds: ["anchor-1"],
};

const sceneResolution = {
  kind: "scene",
  mode: "write",
  surfaceKind: "manuscript editor",
  defaultPanels: ["Context", "Candidates", "Validation", "Dependencies"],
  defaultLens: "structure",
};

function arc(id: string, chapters: readonly any[] = []): any {
  return { objectId: id, kind: "arc", title: `弧${id}`, children: chapters };
}

function chapter(id: string, scenes: readonly any[] = []): any {
  return { objectId: id, kind: "chapter", title: `章${id}`, children: scenes };
}

function sceneNode(id: string): any {
  return { objectId: id, kind: "scene", title: `场${id}`, children: [] };
}

function structureView() {
  return {
    novelId: "novel-1",
    arcs: [arc("arc-1", [chapter("chapter-1", [sceneNode("scene-1"), sceneNode("scene-2")])])],
    orphanScenes: [],
    degraded: false,
    issues: [],
  };
}

/** A shell root whose regions host the structure tree and the scene container. */
function fakeShellRoot() {
  const tree = {
    innerHTML: "",
    listeners: [] as ((event: any) => void)[],
    addEventListener(type: string, listener: (event: any) => void) {
      if (type === "click") this.listeners.push(listener);
    },
  };
  const sceneRoot = {
    innerHTML: "",
    listeners: [] as ((event: any) => void)[],
    querySelector: () => null,
    addEventListener(type: string, listener: (event: any) => void) {
      if (type === "mouseup") this.listeners.push(listener);
    },
  };
  const regions = new Map<string, any>();
  for (const region of REGIONS) {
    const element: any = { innerHTML: "" };
    element.querySelector = (selector: string) => {
      if (selector === '[data-role="structure-tree"]') return tree;
      if (selector === '[data-role="scene-surface"]') {
        return element.innerHTML.includes('data-role="scene-surface"') ? sceneRoot : null;
      }
      return null;
    };
    regions.set(`[data-region="${region}"]`, element);
  }
  return {
    tree,
    sceneRoot,
    region(name: string): string {
      return regions.get(`[data-region="${name}"]`)?.innerHTML ?? "";
    },
    querySelector(selector: string) {
      return regions.get(selector) ?? null;
    },
  };
}

function sceneFocusState(model: Record<string, any>, zoomLevel?: string) {
  let state = model.createSessionState("novel-1");
  state = model.initialiseLens(state, "structure");
  state = model.navigate(state, { kind: "novel", id: "novel-1", mode: "explore" });
  if (typeof zoomLevel === "string") state = model.setZoom(state, "novel:novel-1", zoomLevel);
  state = model.navigate(state, { kind: "scene", id: "scene-1", mode: "write" });
  return state;
}

describe("[task:W2] [cross-system] span descriptors come from the selection", () => {
  it("derives the descriptor from the selected text and its content hash", async () => {
    const surface = await loadModule("sceneSurface.js");

    const descriptor = surface.spanDescriptorFromSelection("第一段。第二段。", { start: 0, end: 3 });

    expect(descriptor).toEqual({
      anchorId: `span:${hashContent("第一段")}`,
      text: "第一段",
      sourceContentHash: hashContent("第一段"),
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
  });

  it("never turns an empty or out-of-range selection into a request", async () => {
    const surface = await loadModule("sceneSurface.js");
    const text = "第一段。";

    expect(surface.spanDescriptorFromSelection(text, { start: 2, end: 2 })).toBeUndefined();
    expect(surface.spanDescriptorFromSelection(text, { start: 0, end: 99 })).toBeUndefined();
    expect(surface.spanDescriptorFromSelection(text, { start: -1, end: 2 })).toBeUndefined();
    expect(surface.spanDescriptorFromSelection(text, { start: 0.5, end: 2 })).toBeUndefined();
    expect(surface.spanDescriptorFromSelection(text, null)).toBeUndefined();
    expect(surface.spanDescriptorFromSelection(undefined, { start: 0, end: 1 })).toBeUndefined();
  });

  it("hands the selection bounds to the surface handler", async () => {
    const surface = await loadModule("sceneSurface.js");

    const prefix = {
      selectNodeContents() {},
      setEnd() {},
      toString: () => "前",
    };
    const range = {
      startContainer: {},
      endContainer: {},
      startOffset: 0,
      toString: () => "第一段",
      cloneRange: () => prefix,
    };
    const fakeSelection = { rangeCount: 1, isCollapsed: false, getRangeAt: () => range };
    const textElement = { contains: () => true };
    const listeners: { type: string; listener: (event: any) => void }[] = [];
    const root = {
      innerHTML: "",
      querySelector: (selector: string) =>
        selector === '[data-role="scene-text"]' ? textElement : null,
      addEventListener(type: string, listener: (event: any) => void) {
        listeners.push({ type, listener });
      },
    };

    let captured: any = null;
    surface.renderSceneSurface(root, sceneView, null, {
      onSelectSpan: (bounds: any) => {
        captured = bounds;
      },
    });
    expect(listeners.map((entry) => entry.type).sort()).toEqual(["keyup", "mouseup"]);

    const previousWindow = (globalThis as any).window;
    (globalThis as any).window = { getSelection: () => fakeSelection };
    try {
      listeners.find((entry) => entry.type === "mouseup")!.listener({});
    } finally {
      if (previousWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = previousWindow;
    }

    expect(captured).toEqual({ start: 1, end: 4 });
  });

  it("is DOM-free at import time", async () => {
    const surface = await loadModule("sceneSurface.js");

    expect(typeof surface.renderSceneSurface).toBe("function");
    expect(typeof surface.spanDescriptorFromSelection).toBe("function");
  });
});

describe("[task:W2] [cross-system] the scene surface renders honestly", () => {
  function fakeSceneRoot() {
    return {
      innerHTML: "",
      querySelector: () => null,
      addEventListener() {},
    };
  }

  it("renders a scene with text read-only, with its title and revision", async () => {
    const surface = await loadModule("sceneSurface.js");
    const root = fakeSceneRoot();

    surface.renderSceneSurface(root, sceneView, null, {});

    expect(root.innerHTML).toContain("第一场");
    expect(root.innerHTML).toContain("scene-1:r2");
    expect(root.innerHTML).toContain("第一段。第二段。");
    expect(root.innerHTML).toContain('data-readonly="true"');
    expect(root.innerHTML).not.toContain("contenteditable");
    expect(root.innerHTML).not.toContain("<textarea");
  });

  it("renders a scene with no text as the empty state, never as an error", async () => {
    const surface = await loadModule("sceneSurface.js");
    const root = fakeSceneRoot();

    surface.renderSceneSurface(root, { ...sceneView, text: "   " }, null, {});

    expect(root.innerHTML).toContain('data-state="empty"');
    expect(root.innerHTML).not.toContain('data-state="error"');
    expect(root.innerHTML).not.toContain('data-role="scene-text"');
  });

  it("renders an unaddressable scene as an error with a retry path", async () => {
    const surface = await loadModule("sceneSurface.js");
    const root = fakeSceneRoot();

    surface.renderSceneSurface(root, null, null, { error: "Scene not found" });

    expect(root.innerHTML).toContain('data-state="error"');
    expect(root.innerHTML).toContain("Scene not found");
    expect(root.innerHTML).toContain('data-ws-action="scene-retry"');
    expect(root.innerHTML).not.toContain('data-state="empty"');
  });

  it("renders the loading state until the scene arrives", async () => {
    const surface = await loadModule("sceneSurface.js");
    const root = fakeSceneRoot();

    surface.renderSceneSurface(root, null, null, {});

    expect(root.innerHTML).toContain('data-state="loading"');
    expect(root.innerHTML).not.toContain('data-state="empty"');
    expect(root.innerHTML).not.toContain('data-state="error"');
  });
});

describe("[task:W2] [cross-system] the span outcome is the server's answer", () => {
  function fakeSceneRoot() {
    return { innerHTML: "", querySelector: () => null, addEventListener() {} };
  }

  const descriptor = {
    anchorId: `span:${hashContent("第一段")}`,
    text: "第一段",
    sourceContentHash: hashContent("第一段"),
  };

  it("shows a resolvable span as usable", async () => {
    const surface = await loadModule("sceneSurface.js");
    const root = fakeSceneRoot();

    surface.renderSceneSurface(root, sceneView, {
      descriptor,
      resolution: { state: "resolvable", reason: "", span: { start: 0, end: 3, text: "第一段" } },
      pending: false,
    }, {});

    expect(root.innerHTML).toContain('data-span-state="resolvable"');
    expect(root.innerHTML).toContain('data-state="success"');
    expect(root.innerHTML).not.toContain("ws-span-unavailable");
  });

  it("shows a drifted span as an unusable warning with the server's reason", async () => {
    const surface = await loadModule("sceneSurface.js");
    const root = fakeSceneRoot();

    surface.renderSceneSurface(root, sceneView, {
      descriptor,
      resolution: { state: "drifted", reason: "anchor revision moved" },
      pending: false,
    }, {});

    expect(root.innerHTML).toContain('data-span-state="drifted"');
    expect(root.innerHTML).toContain("anchor revision moved");
    expect(root.innerHTML).toContain("不可用");
    expect(root.innerHTML).toContain("ws-span-unavailable");
    expect(root.innerHTML).not.toContain('data-state="success"');
    expect(root.innerHTML).not.toContain('data-state="empty"');
  });

  it("shows a missing span as an unusable warning with the server's reason", async () => {
    const surface = await loadModule("sceneSurface.js");
    const root = fakeSceneRoot();

    surface.renderSceneSurface(root, sceneView, {
      descriptor,
      resolution: { state: "missing", reason: "anchor not found: span:abc" },
      pending: false,
    }, {});

    expect(root.innerHTML).toContain('data-span-state="missing"');
    expect(root.innerHTML).toContain("anchor not found: span:abc");
    expect(root.innerHTML).toContain("不可用");
    expect(root.innerHTML).toContain("ws-span-unavailable");
    expect(root.innerHTML).not.toContain('data-state="success"');
  });

  it("shows the pending state while the resolution is in flight", async () => {
    const surface = await loadModule("sceneSurface.js");
    const root = fakeSceneRoot();

    surface.renderSceneSurface(root, sceneView, { descriptor, resolution: null, pending: true }, {});

    expect(root.innerHTML).toContain('data-span-state="pending"');
    expect(root.innerHTML).toContain('data-state="loading"');
  });
});

describe("[task:W2] [cross-system] the shell renders the scene surface through the API", () => {
  it("renders the scene read view into the working surface for a scene focus", async () => {
    const model = await loadModule("focusModel.js");
    const shell = await loadModule("shell.js");
    const root = fakeShellRoot();

    shell.renderShell(
      root,
      sceneFocusState(model),
      sceneResolution,
      { view: structureView(), error: "" },
      { view: sceneView, error: "", selection: null },
    );

    expect(root.region("working-surface")).toContain('data-role="scene-surface"');
    expect(root.sceneRoot.innerHTML).toContain("第一场");
    expect(root.sceneRoot.innerHTML).toContain("第一段。第二段。");
  });

  it("shows the server's span outcome in the working surface", async () => {
    const model = await loadModule("focusModel.js");
    const shell = await loadModule("shell.js");
    const root = fakeShellRoot();

    shell.renderShell(
      root,
      sceneFocusState(model),
      sceneResolution,
      { view: structureView(), error: "" },
      {
        view: sceneView,
        error: "",
        selection: {
          descriptor: { anchorId: "span:x", text: "第一段", sourceContentHash: hashContent("第一段") },
          resolution: { state: "drifted", reason: "anchor content moved" },
          pending: false,
        },
      },
    );

    expect(root.sceneRoot.innerHTML).toContain('data-span-state="drifted"');
    expect(root.sceneRoot.innerHTML).toContain("anchor content moved");
  });

  it("reads the scene and resolves spans through the product API, never locally", () => {
    const apiClient = publicFile("workspace/apiClient.js");
    const shell = publicFile("workspace/shell.js");

    expect(apiClient).toContain("getScene");
    expect(apiClient).toContain("resolveSpan");
    expect(apiClient).toContain("/span-resolution");
    expect(shell).toContain("spanDescriptorFromSelection");
    expect(shell).toContain("renderSceneSurface");
    expect(shell).not.toContain("location.reload");
    expect(shell).not.toContain("location.href");
  });
});

describe("[task:W2] [cross-system] the structure tree marks the focused row", () => {
  it("marks the scene row that matches the current focus", async () => {
    const model = await loadModule("focusModel.js");
    const shell = await loadModule("shell.js");
    const root = fakeShellRoot();

    shell.renderShell(root, sceneFocusState(model, "chapter"), null, {
      view: structureView(),
      error: "",
    });

    expect(root.tree.innerHTML).toContain('data-structure-object-id="scene-1"');
    expect(root.tree.innerHTML).toMatch(
      /data-structure-object-id="scene-1"[^>]*aria-current="true"/,
    );
    expect(root.tree.innerHTML).not.toMatch(
      /data-structure-object-id="scene-2"[^>]*aria-current="true"/,
    );
  });
});

describe("[task:W2] [integration] scene surface static hosting", () => {
  it("serves the scene surface module off the boundary pipeline", async () => {
    const { app, calls } = harness();

    const module = await app.inject({ method: "GET", url: "/workspace/sceneSurface.js" });
    expect(module.statusCode).toBe(200);
    expect(module.headers["content-type"]).toContain("javascript");
    expect(module.body).toContain("renderSceneSurface");
    expect(module.body).toContain("spanDescriptorFromSelection");

    expect(calls).toEqual([]);
  });
});

describe("[task:W2] [regression] the scene surface stays read-only and localized", () => {
  it("adds no manuscript write affordance and keeps the legacy views reachable", async () => {
    const surface = publicFile("workspace/sceneSurface.js");
    const shell = publicFile("workspace/shell.js");

    for (const source of [surface, shell]) {
      expect(source).not.toContain("contenteditable");
      expect(source).not.toContain("<textarea");
      expect(source).not.toContain("location.reload");
      expect(source).not.toContain("location.href");
      expect(source).not.toContain("<kbd");
      expect(source.toLowerCase()).not.toContain("shortcut");
    }
    expect(surface).not.toContain('data-ws-action="commit"');
    expect(surface).not.toContain("candidateIds");

    const { app } = harness();
    const body = (await app.inject({ method: "GET", url: "/" })).body;
    expect(body).toContain('data-view="overview"');
    expect(body).toContain('data-view="recall"');
    expect(body).toContain('<script src="/app.js"></script>');
    expect(body).toContain('<script type="module" src="/workspace/shell.js"></script>');
  });
});
