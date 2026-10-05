import { describe, expect, it } from "vitest";
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
import { createScene, type Scene } from "../../src/manuscript/domain/scene";

const NOVEL = "novel-1";
const OTHER_NOVEL = "novel-2";
const authorToken = "w2-author-token";
const AT = new Date("2026-10-06T00:00:00.000Z");

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

const authorHeader = { "x-author-id": authorToken };

describe("[task:W2] [integration] scene read HTTP surface", () => {
  it("serves a scene through the boundary pipeline with the manuscript scene query contract", async () => {
    const { app, dependencies, calls } = harness();
    await dependencies.scenes.save(sceneFixture({ id: "scene-1", novelId: NOVEL }));

    const response = await app.inject({
      method: "GET",
      url: `/novels/${NOVEL}/scenes/scene-1`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sceneId: "scene-1",
      novelId: NOVEL,
      chapterId: `chapter:${NOVEL}`,
      title: "scene-1 标题",
      revisionId: "scene-1:r1",
      text: "",
      anchorIds: [],
    });
    expect(calls).toEqual(["manuscript.query.scene"]);
  });

  it("[cross-system] returns 404 without leaking a scene that belongs to another novel", async () => {
    const { app, dependencies, calls } = harness();
    await dependencies.scenes.save(sceneFixture({ id: "scene-1", novelId: NOVEL }));
    await dependencies.scenes.save(sceneFixture({ id: "scene-2", novelId: OTHER_NOVEL }));

    const response = await app.inject({
      method: "GET",
      url: `/novels/${NOVEL}/scenes/scene-2`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(OTHER_NOVEL);
    expect(calls).toEqual(["manuscript.query.scene"]);
  });

  it("returns 404 for a scene that does not exist", async () => {
    const { app } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/novels/${NOVEL}/scenes/scene-ghost`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(404);
  });

  it("[cross-system] rejects a read outside the principal workspace even when the header is in scope", async () => {
    const { app, dependencies } = harness();
    await dependencies.scenes.save(sceneFixture({ id: "scene-2", novelId: OTHER_NOVEL }));

    const response = await app.inject({
      method: "GET",
      url: `/novels/${OTHER_NOVEL}/scenes/scene-2`,
      headers: { ...authorHeader, "x-workspace-id": NOVEL },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("scene-2");
    expect(response.json()).not.toHaveProperty("text");
  });

  it("derives the authorization workspace from the addressed novel, not the client header", async () => {
    const { app, dependencies } = harness();
    await dependencies.scenes.save(sceneFixture({ id: "scene-2", novelId: OTHER_NOVEL }));

    const response = await app.inject({
      method: "GET",
      url: `/novels/${NOVEL}/scenes/scene-2`,
      headers: { ...authorHeader, "x-workspace-id": OTHER_NOVEL },
    });

    expect(response.statusCode).toBe(403);
  });
});
