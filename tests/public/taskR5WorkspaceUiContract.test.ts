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

describe("[task:R5] [integration] workspace browser surface static hosting", () => {
  it("serves the workspace shell with Overview, Foundation, Run, and Recall views", async () => {
    const { app } = harness();

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain('data-view="overview"');
    expect(response.body).toContain('data-view="foundation"');
    expect(response.body).toContain('data-view="run"');
    expect(response.body).toContain('data-view="recall"');
  });

  it("serves the style sheet and application script as first-class assets", async () => {
    const { app } = harness();

    const styles = await app.inject({ method: "GET", url: "/styles.css" });
    const script = await app.inject({ method: "GET", url: "/app.js" });

    expect(styles.statusCode).toBe(200);
    expect(styles.headers["content-type"]).toContain("text/css");
    expect(styles.body.length).toBeGreaterThan(0);
    expect(script.statusCode).toBe(200);
    expect(script.headers["content-type"]).toContain("javascript");
    expect(script.body).toContain('data-state="loading"');
  });

  it("keeps static assets off the boundary pipeline while product routes stay on it", async () => {
    const { app, calls } = harness();

    await app.inject({ method: "GET", url: "/" });
    await app.inject({ method: "GET", url: "/styles.css" });
    await app.inject({ method: "GET", url: "/app.js" });

    expect(calls).toEqual([]);

    const workspace = await app.inject({ method: "GET", url: "/workspace/novel-1" });

    expect(workspace.statusCode).toBe(200);
    expect(calls).toEqual(["foundation.query.workspace-focus"]);
  });
});

describe("[task:R5] [cross-system] workspace UI contract states and authority boundaries", () => {
  it("uses the product API and exposes loading, empty, error, retry, disabled, and success states", () => {
    const source = publicFile("app.js");

    expect(source).toContain("/workspace/");
    expect(source).toContain('data-state="loading"');
    expect(source).toContain('data-state="empty"');
    expect(source).toContain('data-state="error"');
    expect(source).toContain('data-action="retry"');
    expect(source).toContain('data-state="disabled"');
    expect(source).toContain('data-state="success"');
  });

  it("binds the workspace identity through localStorage and the author header", () => {
    const markup = publicFile("index.html");
    const source = publicFile("app.js");

    expect(markup).toContain('data-context="workspace-identity"');
    expect(markup).toContain('id="novel-id"');
    expect(markup).toContain('id="author-id"');
    expect(source).toContain("localStorage");
    expect(source).toContain("x-author-id");
  });

  it("keeps the Recall view non-authoritative and free of commit actions", () => {
    const markup = publicFile("index.html");
    const source = publicFile("app.js");
    const recallSection = markup.slice(
      markup.indexOf('data-view="recall"'),
      markup.indexOf("</body>"),
    );

    expect(recallSection).toContain('data-recall-boundary="read-only"');
    expect(recallSection.toLowerCase()).not.toContain("commit");
    expect(markup).not.toContain('data-action="commit"');
    expect(source).not.toContain("/change-sets/");
  });
});

describe("[task:R5] [regression] workspace shell remains framework-free and self-contained", () => {
  it("ships no build step, no external assets, and no in-app shortcut explainers", () => {
    const markup = publicFile("index.html");

    expect(markup).toContain('<script src="/app.js"></script>');
    expect(markup).toContain('<link rel="stylesheet" href="/styles.css" />');
    expect(markup).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//);
    expect(markup).not.toContain("<kbd");
    expect(markup.toLowerCase()).not.toContain("shortcut");
  });
});
