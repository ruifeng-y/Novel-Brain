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

const NOVEL = "novel-1";
const OTHER_NOVEL = "novel-2";
const authorToken = "w1-focus-author";
const focusResolutionContract = "workspace.query.focus-resolution";

/**
 * Real production security boundary whose principal is scoped to a single
 * workspace, wrapping a spy pipeline that records every contract it executes.
 */
function harness() {
  const calls: string[] = [];
  const security = createProductionSecurityBoundary({
    NB_SECURITY_PRINCIPALS: JSON.stringify([
      {
        token: authorToken,
        subjectId: "w1-focus-author-1",
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
      idGenerator: () => "w1-focus-event",
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
  const app = createNovelBrainServer(createInMemoryEngineDependencies(), {
    httpBoundaryPipeline: pipeline,
  });
  return { app, calls };
}

const authorHeader = { "x-author-id": authorToken };

describe("[task:W1] [integration] focus resolution HTTP surface", () => {
  it("serves the resolution through the boundary pipeline with the workspace query contract", async () => {
    const { app, calls } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/workspace/resolution?workspaceId=${NOVEL}&kind=scene&mode=write`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.workspaceId).toBe(NOVEL);
    expect(body.resolved).toBe(true);
    expect(body.kind).toBe("scene");
    expect(body.mode).toBe("write");
    expect(body.surfaceKind).toBe("manuscript editor");
    expect(body.defaultLens).toBe("structure");
    expect(body.defaultPanels).toEqual([
      "Context",
      "Candidates",
      "Validation",
      "Dependencies",
    ]);
    expect(calls).toEqual([focusResolutionContract]);
  });

  it("resolves the entry default when no mode is requested", async () => {
    const { app } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/workspace/resolution?workspaceId=${NOVEL}&kind=novel`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      resolved: true,
      kind: "novel",
      mode: "explore",
      surfaceKind: "overview, health, current state",
      defaultLens: "structure",
    });
  });

  it("resolves an incompatible mode to the kind default instead of failing", async () => {
    const { app, calls } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/workspace/resolution?workspaceId=${NOVEL}&kind=candidate&mode=write`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().mode).toBe("review");
    expect(response.json().surfaceKind).toBe("compare, diff");
    expect(calls).toEqual([focusResolutionContract]);
  });

  it("rejects a missing workspace id before the boundary pipeline runs", async () => {
    const { app, calls } = harness();

    const response = await app.inject({
      method: "GET",
      url: "/workspace/resolution?kind=novel",
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it("never falls back to a placeholder workspace", async () => {
    const { app, calls } = harness();

    const response = await app.inject({
      method: "GET",
      url: "/workspace/resolution?workspaceId=&kind=novel",
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it("rejects a kind outside the closed object union with 400", async () => {
    const { app, calls } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/workspace/resolution?workspaceId=${NOVEL}&kind=page`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it("rejects an unknown mode with 400 instead of resolving it", async () => {
    const { app, calls } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/workspace/resolution?workspaceId=${NOVEL}&kind=scene&mode=skim`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it("rejects a resolution outside the principal workspace", async () => {
    const { app } = harness();

    const response = await app.inject({
      method: "GET",
      url: `/workspace/resolution?workspaceId=${OTHER_NOVEL}&kind=novel`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().message).toContain(OTHER_NOVEL);
  });
});
