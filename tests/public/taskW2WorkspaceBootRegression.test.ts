import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createNovelBrainServer } from "../../src/http/server";

/**
 * Guards the real page boot path. Every other public test drives `renderShell`
 * with a hand-built root, so a break in the module bootstrap that index.html
 * actually takes stayed invisible. This test installs the page's DOM shape,
 * imports the module so its own boot() runs, and asserts the lens rail is
 * populated from that path alone.
 */
const REGIONS = [
  "identity-bar",
  "lens-rail",
  "focus-bar",
  "working-surface",
  "context-panels",
  "attention-layer",
] as const;

function makeElement() {
  const element: any = {
    innerHTML: "",
    value: "",
    textContent: "",
    hidden: false,
    listeners: {} as Record<string, ((event: any) => void)[]>,
    addEventListener(type: string, listener: (event: any) => void) {
      (element.listeners[type] ||= []).push(listener);
    },
    dispatchEvent() {
      return true;
    },
    getAttribute() {
      return null;
    },
    setAttribute() {},
    closest() {
      return null;
    },
    querySelector() {
      return null;
    },
  };
  return element;
}

function installDom() {
  const ids = new Map<string, any>();
  const regions = new Map<string, any>();
  const root = makeElement();
  for (const region of REGIONS) regions.set(region, makeElement());
  const status = makeElement();
  const tree = makeElement();
  const scene = makeElement();

  const lensRail = regions.get("lens-rail");
  lensRail.querySelector = (selector: string) =>
    selector === '[data-role="structure-tree"]' &&
    lensRail.innerHTML.includes('data-role="structure-tree"')
      ? tree
      : null;

  const surface = regions.get("working-surface");
  surface.querySelector = (selector: string) =>
    selector === '[data-role="scene-surface"]' &&
    surface.innerHTML.includes('data-role="scene-surface"')
      ? scene
      : null;

  root.querySelector = (selector: string) => {
    const match = /^\[data-region="(.+)"\]$/.exec(selector);
    return match ? regions.get(match[1]!) ?? null : null;
  };

  for (const id of [
    "workspace-shell",
    "ws-novel-id",
    "ws-author-id",
    "novel-id",
    "author-id",
    "ws-target",
  ]) {
    ids.set(id, makeElement());
  }
  ids.set("workspace-shell", root);

  const documentStub: any = {
    readyState: "complete",
    getElementById: (id: string) => ids.get(id) ?? null,
    querySelector: (selector: string) =>
      selector === '[data-role="ws-identity-status"]' ? status : null,
    addEventListener() {},
    body: makeElement(),
  };
  const windowStub: any = {
    localStorage: { getItem: () => null, setItem: () => {} },
    getSelection: () => null,
  };

  return { documentStub, windowStub, regions, tree, scene, status, root };
}

describe("[task:W2] [cross-system] the page boot path populates the shell", () => {
  it("serves every module the shell's import graph reaches", async () => {
    const app = createNovelBrainServer(createInMemoryEngineDependencies());
    const seen = new Set<string>();
    const queue = ["/workspace/shell.js"];

    while (queue.length > 0) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);

      const response = await app.inject({ method: "GET", url });
      // A module the server does not serve falls through to the authenticated
      // /workspace/:novelId route and answers 401. In the browser that single
      // failure rejects the whole ES module graph, so the shell never boots and
      // every region stays empty.
      expect(response.statusCode, url).toBe(200);
      expect(response.headers["content-type"], url).toContain("javascript");

      for (const match of response.body.matchAll(/from\s+"(\.\/[^"]+)"/g)) {
        queue.push(`/workspace/${match[1]!.replace("./", "")}`);
      }
    }

    // The 2.4 shell added this import; its missing route is what blanked the
    // lens rail on the running page.
    expect([...seen]).toContain("/workspace/sceneSurface.js");
  });

  it("renders the lens rail from the module's own bootstrap", async () => {
    const dom = installDom();
    const previousDocument = (globalThis as any).document;
    const previousWindow = (globalThis as any).window;
    (globalThis as any).document = dom.documentStub;
    (globalThis as any).window = dom.windowStub;

    try {
      const url = pathToFileURL(resolve("public/workspace/shell.js")).href;
      await import(/* @vite-ignore */ url);
      await new Promise(resolve => setTimeout(resolve, 0));

      const rail = dom.regions.get("lens-rail")!.innerHTML as string;
      expect(rail).toContain("ws-lens-list");
      expect((rail.match(/data-ws-lens="/g) || []).length).toBe(6);
    } finally {
      (globalThis as any).document = previousDocument;
      (globalThis as any).window = previousWindow;
    }
  });
});
