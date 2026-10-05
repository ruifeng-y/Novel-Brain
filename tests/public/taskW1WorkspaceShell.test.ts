import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createNovelBrainServer } from "../../src/http/server";
import type { HttpBoundaryPipeline } from "../../src/http/httpBoundaryPipeline";

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

/** The `Primary Working Surface` phrases of Spec §5, one renderer per phrase. */
const surfacePhrases = [
  "overview, health, current state",
  "five-direction skeleton, proposals",
  "object content, proposals",
  "structure, plan",
  "manuscript editor",
  "span editor or span provenance",
  "proposal workbench",
  "compare, diff",
  "revision content, diff",
  "commit detail, change",
  "impact, consistency report",
  "Process Center",
] as const;

function countOf(source: string, phrase: string): number {
  return source.split(phrase).length - 1;
}

describe("[task:W1] [cross-system] focus-driven workspace shell", () => {
  it("renders the six shell regions and loads the shell as an ES module", async () => {
    const { app } = harness();

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    const body = response.body;
    expect(body).toContain('data-region="identity-bar"');
    expect(body).toContain('data-region="lens-rail"');
    expect(body).toContain('data-region="focus-bar"');
    expect(body).toContain('data-region="working-surface"');
    expect(body).toContain('data-region="context-panels"');
    expect(body).toContain('data-region="attention-layer"');
    expect(body).toContain('<script type="module" src="/workspace/shell.js"></script>');
    expect(body).toContain('<link rel="stylesheet" href="/workspace/workspace.css" />');
  });

  it("keeps the legacy views reachable during the transition", async () => {
    const { app } = harness();

    const body = (await app.inject({ method: "GET", url: "/" })).body;

    expect(body).toContain('data-ws-action="show-legacy"');
    expect(body).toContain('data-ws-action="show-workspace"');
    expect(body).toContain('data-view="overview"');
    expect(body).toContain('data-view="recall"');
    expect(body).toContain('<script src="/app.js"></script>');
  });

  it("keeps focus and lens state separate in the client model", () => {
    const source = publicFile("workspace/focusModel.js");

    expect(source).toContain("setLens");
    expect(source).toMatch(/setLens[\s\S]*focus/);
    expect(source).toContain("push or replace");
    for (const name of ["createSessionState", "navigate", "goBack", "setLens", "pin", "setZoom"]) {
      expect(source).toContain(`export function ${name}`);
    }
    expect(source).not.toContain("location.reload");
    expect(source).not.toContain("location.href");
  });

  it("renders the server resolution instead of duplicating the entry contract", () => {
    const shell = publicFile("workspace/shell.js");
    const focusModel = publicFile("workspace/focusModel.js");
    const apiClient = publicFile("workspace/apiClient.js");

    expect(shell).toContain("view.mode");
    expect(shell).toContain("view.surfaceKind");
    expect(shell).toContain("view.defaultPanels");
    expect(shell).toContain("view.defaultLens");
    expect(shell).toContain("export function renderShell");
    expect(apiClient).toContain("export function createApiClient");

    for (const source of [focusModel, apiClient]) {
      expect(source).not.toContain("defaultMode");
      expect(source).not.toContain("defaultPanels");
      expect(source).not.toContain("defaultLens");
      for (const phrase of surfacePhrases) {
        expect(source).not.toContain(phrase);
      }
    }
  });

  it("maps every server surface phrase to exactly one renderer", () => {
    const shell = publicFile("workspace/shell.js");

    for (const phrase of surfacePhrases) {
      expect(countOf(shell, phrase), `surface phrase ${phrase}`).toBe(1);
    }
  });

  it("calls resolution through the api client and never reloads the page", () => {
    const apiClient = publicFile("workspace/apiClient.js");
    const shell = publicFile("workspace/shell.js");

    expect(apiClient).toContain("/workspace/resolution");
    expect(apiClient).toContain("x-author-id");
    for (const source of [apiClient, shell]) {
      expect(source).not.toContain("location.reload");
      expect(source).not.toContain("location.href");
      expect(source).not.toContain("<kbd");
      expect(source.toLowerCase()).not.toContain("shortcut");
    }
  });
});

describe("[task:W1] [integration] workspace shell static hosting", () => {
  it("serves the shell modules as presentation assets off the boundary pipeline", async () => {
    const { app, calls } = harness();

    const modules = [
      ["/workspace/shell.js", "javascript"],
      ["/workspace/focusModel.js", "javascript"],
      ["/workspace/apiClient.js", "javascript"],
    ] as const;

    for (const [route, contentType] of modules) {
      const response = await app.inject({ method: "GET", url: route });
      expect(response.statusCode, route).toBe(200);
      expect(response.headers["content-type"], route).toContain(contentType);
      expect(response.body.length, route).toBeGreaterThan(0);
    }

    const stylesheet = await app.inject({ method: "GET", url: "/workspace/workspace.css" });
    expect(stylesheet.statusCode).toBe(200);
    expect(stylesheet.headers["content-type"]).toContain("text/css");

    expect(calls).toEqual([]);
  });
});
