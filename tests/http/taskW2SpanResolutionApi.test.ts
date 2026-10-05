import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createNovelBrainServer } from "../../src/http/server";
import {
  createHttpBoundaryPipeline,
  type HttpBoundaryContext,
  type HttpBoundaryPipeline,
} from "../../src/http/httpBoundaryPipeline";
import { createProductRequestValidators } from "../../src/http/productRequestSchemas";
import { createPlatformObservabilityBoundary } from "../../src/platform/observabilityBoundary";
import { createProductionSecurityBoundary } from "../../src/platform/productionSecurityProvider";
import { hashContent } from "../../src/shared/domain/contentHash";
import {
  commitSceneText,
  createScene,
  type Scene,
} from "../../src/manuscript/domain/scene";
import type { TargetSpan } from "../../src/manuscript/domain/targetSpan";

const resolverControl = vi.hoisted(() => ({ throwOnResolve: false }));

vi.mock("../../src/manuscript/domain/targetSpan", async importOriginal => {
  const actual = (await importOriginal()) as typeof import("../../src/manuscript/domain/targetSpan");
  return {
    ...actual,
    resolveTargetSpan: (scene: Scene, span: TargetSpan) => {
      if (resolverControl.throwOnResolve) {
        throw new Error("unforeseen target span resolver failure");
      }
      return actual.resolveTargetSpan(scene, span);
    },
  };
});

const NOVEL = "novel-1";
const OTHER_NOVEL = "novel-2";
const authorToken = "w2-author-token";
const AT = new Date("2026-10-06T00:00:00.000Z");
const LATER = new Date("2026-10-06T00:00:01.000Z");
const TEXT = "第一段。第二段。";
const ANCHOR_TEXT = "第一段";
const ANCHOR_HASH = hashContent(ANCHOR_TEXT);

const authorHeader = { "x-author-id": authorToken };

/**
 * Real production security boundary whose principal is scoped to a single
 * workspace, wrapping a spy pipeline that records every contract it executes.
 */
function harness() {
  const dependencies = createInMemoryEngineDependencies();
  const calls: string[] = [];
  const security = createProductionSecurityBoundary({
    NB_SECURITY_PRINCIPALS: JSON.stringify([
      {
        token: authorToken,
        subjectId: "w2-author-1",
        accountId: "account-1",
        workspaceIds: [NOVEL],
        roles: ["author"],
      },
    ]),
    NB_SECURITY_RATE_LIMIT: "1000",
    NB_SECURITY_SECRETS: "{}",
  });
  const inner = createHttpBoundaryPipeline({
    security,
    observability: createPlatformObservabilityBoundary({
      sink: () => undefined,
      now: () => new Date(),
      idGenerator: () => "w2-event",
    }),
    validators: createProductRequestValidators(),
  });
  const pipeline: HttpBoundaryPipeline = {
    execute<TValue>(
      contractId: string,
      context: HttpBoundaryContext,
      input: unknown,
      handler: (validated: unknown) => Promise<TValue>,
    ): Promise<TValue> {
      calls.push(contractId);
      return inner.execute(contractId, context, input, handler);
    },
  };
  const app = createNovelBrainServer(dependencies, { httpBoundaryPipeline: pipeline });
  return { app, dependencies, calls };
}

function sceneFixture(input: { readonly id: string; readonly novelId: string }): Scene {
  return createScene({
    id: input.id,
    novelId: input.novelId,
    chapterId: `chapter:${input.novelId}`,
    title: `${input.id} 标题`,
    revisionId: `${input.id}:r1`,
    commitId: `commit:${input.id}`,
    createdAt: AT,
  });
}

function anchoredSceneFixture(input: { readonly id: string; readonly novelId: string }): Scene {
  return commitSceneText({
    scene: sceneFixture(input),
    text: TEXT,
    spanAnchors: {
      "anchor-1": {
        anchorId: "anchor-1",
        start: 0,
        end: 3,
        text: ANCHOR_TEXT,
        sourceContentHash: ANCHOR_HASH,
      },
    },
    revisionId: `${input.id}:r2`,
    commitId: `commit:${input.id}:r2`,
    updatedAt: LATER,
  });
}

function matchingSpan(): TargetSpan {
  return { anchorId: "anchor-1", text: ANCHOR_TEXT, sourceContentHash: ANCHOR_HASH };
}

beforeEach(() => {
  resolverControl.throwOnResolve = false;
});

describe("[task:W2] [integration] target span resolution HTTP surface", () => {
  it("serves a resolvable span through the boundary pipeline with the manuscript target span query contract", async () => {
    const { app, dependencies, calls } = harness();
    await dependencies.scenes.save(anchoredSceneFixture({ id: "scene-1", novelId: NOVEL }));

    const response = await app.inject({
      method: "POST",
      url: `/novels/${NOVEL}/scenes/scene-1/span-resolution`,
      headers: authorHeader,
      payload: matchingSpan(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      state: "resolvable",
      reason: "",
      span: { start: 0, end: 3, text: ANCHOR_TEXT },
    });
    expect(calls).toEqual(["manuscript.query.target-span-resolution"]);
  });

  it("reports a drifted anchor without handing back a span range", async () => {
    const { app, dependencies } = harness();
    const base = anchoredSceneFixture({ id: "scene-1", novelId: NOVEL });
    await dependencies.scenes.save(
      Object.freeze({ ...base, text: "改名了。第二段。" }) as Scene,
    );

    const response = await app.inject({
      method: "POST",
      url: `/novels/${NOVEL}/scenes/scene-1/span-resolution`,
      headers: authorHeader,
      payload: matchingSpan(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.state).toBe("drifted");
    expect(body).not.toHaveProperty("span");
  });

  it("reports a missing anchor without handing back a span range", async () => {
    const { app, dependencies } = harness();
    await dependencies.scenes.save(anchoredSceneFixture({ id: "scene-1", novelId: NOVEL }));

    const response = await app.inject({
      method: "POST",
      url: `/novels/${NOVEL}/scenes/scene-1/span-resolution`,
      headers: authorHeader,
      payload: { anchorId: "anchor-ghost", text: ANCHOR_TEXT, sourceContentHash: ANCHOR_HASH },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.state).toBe("missing");
    expect(body).not.toHaveProperty("span");
  });

  it("[cross-system] answers an unknown scene exactly like the scene read route", async () => {
    const { app, dependencies, calls } = harness();
    await dependencies.scenes.save(anchoredSceneFixture({ id: "scene-1", novelId: NOVEL }));

    const read = await app.inject({
      method: "GET",
      url: `/novels/${NOVEL}/scenes/scene-ghost`,
      headers: authorHeader,
    });
    const resolution = await app.inject({
      method: "POST",
      url: `/novels/${NOVEL}/scenes/scene-ghost/span-resolution`,
      headers: authorHeader,
      payload: matchingSpan(),
    });

    expect(resolution.statusCode).toBe(404);
    expect(resolution.body).toBe(read.body);
    expect(calls).toEqual([
      "manuscript.query.scene",
      "manuscript.query.target-span-resolution",
    ]);
  });

  it("[cross-system] answers a scene belonging to another novel exactly like the scene read route", async () => {
    const { app, dependencies } = harness();
    await dependencies.scenes.save(anchoredSceneFixture({ id: "scene-2", novelId: OTHER_NOVEL }));

    const read = await app.inject({
      method: "GET",
      url: `/novels/${NOVEL}/scenes/scene-2`,
      headers: authorHeader,
    });
    const resolution = await app.inject({
      method: "POST",
      url: `/novels/${NOVEL}/scenes/scene-2/span-resolution`,
      headers: authorHeader,
      payload: matchingSpan(),
    });

    expect(resolution.statusCode).toBe(404);
    expect(resolution.body).toBe(read.body);
    expect(resolution.body).not.toContain(OTHER_NOVEL);
    expect(resolution.body).not.toContain("scene-2");
  });

  it("[cross-system] derives the authorization workspace from the addressed novel, not the client header", async () => {
    const { app, dependencies } = harness();
    await dependencies.scenes.save(anchoredSceneFixture({ id: "scene-2", novelId: OTHER_NOVEL }));

    const response = await app.inject({
      method: "POST",
      url: `/novels/${OTHER_NOVEL}/scenes/scene-2/span-resolution`,
      headers: { ...authorHeader, "x-workspace-id": NOVEL },
      payload: matchingSpan(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("scene-2");
  });

  it("maps an unforeseen resolver failure to 500 rather than a span outcome", async () => {
    const { app, dependencies } = harness();
    await dependencies.scenes.save(anchoredSceneFixture({ id: "scene-1", novelId: NOVEL }));

    resolverControl.throwOnResolve = true;
    try {
      const response = await app.inject({
        method: "POST",
        url: `/novels/${NOVEL}/scenes/scene-1/span-resolution`,
        headers: authorHeader,
        payload: matchingSpan(),
      });

      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain("drifted");
      expect(response.body).not.toContain("missing");
    } finally {
      resolverControl.throwOnResolve = false;
    }
  });
});
