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
import { createArc } from "../../src/manuscript/domain/arc";

const NOVEL = "novel-1";
const OTHER_NOVEL = "novel-2";
const authorToken = "w1-author-token";

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
        subjectId: "w1-author-1",
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
      idGenerator: () => "w1-event",
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

const authorHeader = { "x-author-id": authorToken };

describe("[task:W1] [integration] structural navigation HTTP surface", () => {
  it("serves the structure through the boundary pipeline with the manuscript query contract", async () => {
    const { app, calls } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/novels/${NOVEL}/structure`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().novelId).toBe(NOVEL);
    expect(calls).toEqual(["manuscript.query.structural-navigation"]);
  });

  it("rejects a read outside the principal workspace", async () => {
    const { app } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/novels/${OTHER_NOVEL}/structure`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("Forbidden");
  });

  it("[cross-system] rejects a workspace header that disagrees with the addressed novel", async () => {
    const { app } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/novels/${NOVEL}/structure`,
      headers: { ...authorHeader, "x-workspace-id": OTHER_NOVEL },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("[task:W1] [cross-system] structure command HTTP surface", () => {
  it("creates an arc and a chapter, reorders them, and reads the container order back", async () => {
    const { app, calls } = harness();

    const arc = await app.inject({
      method: "POST",
      url: `/novels/${NOVEL}/arcs`,
      headers: authorHeader,
      payload: { id: "arc-1", title: "第一幕" },
    });
    const chapter = await app.inject({
      method: "POST",
      url: `/novels/${NOVEL}/chapters`,
      headers: authorHeader,
      payload: { id: "chapter-1", arcId: "arc-1", title: "第一章" },
    });
    const reordered = await app.inject({
      method: "POST",
      url: "/arcs/arc-1/chapter-order",
      headers: authorHeader,
      payload: { chapterIds: ["chapter-1"] },
    });
    const view = await app.inject({
      method: "GET",
      url: `/novels/${NOVEL}/structure`,
      headers: authorHeader,
    });

    expect(arc.statusCode).toBe(201);
    expect(chapter.statusCode).toBe(201);
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json().chapterIds).toEqual(["chapter-1"]);
    expect(view.statusCode).toBe(200);
    expect(view.json().arcs[0].children.map((node: { objectId: string }) => node.objectId)).toEqual([
      "chapter-1",
    ]);
    expect(calls).toEqual([
      "manuscript.command.create-arc",
      "manuscript.command.create-chapter",
      "manuscript.command.reorder-structure",
      "manuscript.query.structural-navigation",
    ]);
  });

  it("derives the reorder authorization workspace from the addressed arc, not the client header", async () => {
    const { app, dependencies, calls } = harness();
    await dependencies.arcs.save(
      createArc({
        id: "arc-foreign",
        novelId: OTHER_NOVEL,
        title: "Foreign",
        createdAt: new Date("2026-10-06T00:00:00.000Z"),
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/arcs/arc-foreign/chapter-order",
      headers: authorHeader,
      payload: { chapterIds: [] },
    });

    expect(response.statusCode).toBe(403);
    expect(calls).toEqual(["manuscript.command.reorder-structure"]);
  });

  it("[regression] rejects a dangling scene id instead of persisting it", async () => {
    const { app, dependencies, calls } = harness();
    await app.inject({
      method: "POST",
      url: `/novels/${NOVEL}/arcs`,
      headers: authorHeader,
      payload: { id: "arc-1", title: "第一幕" },
    });
    await app.inject({
      method: "POST",
      url: `/novels/${NOVEL}/chapters`,
      headers: authorHeader,
      payload: { id: "chapter-1", arcId: "arc-1", title: "第一章" },
    });

    calls.length = 0;
    const response = await app.inject({
      method: "POST",
      url: "/chapters/chapter-1/scene-order",
      headers: authorHeader,
      payload: { sceneIds: ["scene-ghost"] },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(calls).toEqual(["manuscript.command.reorder-structure"]);
    expect((await dependencies.chapters.findById("chapter-1"))?.sceneIds).toEqual([]);
  });
});
