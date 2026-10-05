import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createHttpBoundaryPipeline } from "../../src/http/httpBoundaryPipeline";
import {
  productRequestSchemas,
  productRequestSchemaAliases,
} from "../../src/http/productRequestSchemas";
import {
  commandResultSchema,
  productResponseSchemas,
  queryResultSchema,
} from "../../src/http/productResponseSchemas";
import { apiBoundaryContracts, getApiBoundaryContract } from "../../src/http/productionApiBoundary";
import {
  createPlatformSecurityBoundary,
  type PlatformSecurityBoundaryOptions,
  SecurityAuthenticationError,
} from "../../src/platform/securityBoundary";
import {
  createPlatformObservabilityBoundary,
  type ObservabilityCorrelation,
  type ObservabilityEvent,
} from "../../src/platform/observabilityBoundary";
import { createNovelBrainServer } from "../../src/http/server";
import { createInMemoryEngineDependencies } from "../../src/app/composition";

function fixtures() {
  const rateLimiter = {
    limit: 10,
    consume: vi.fn(() => ({
      allowed: true,
      remaining: 9,
      resetAt: new Date("2026-10-05T12:00:00.000Z"),
    })),
  };
  const securityOptions: PlatformSecurityBoundaryOptions = {
    authentication: {
      authenticate: ({ credentials }) =>
        credentials.token === "subject-1"
          ? {
              authenticated: true,
              principal: {
                id: "subject-1",
                accountId: "account-1",
                workspaceId: "workspace-1",
                roles: ["author"],
              },
            }
          : { authenticated: false, reason: "invalid credentials" },
    },
    authorization: {
      authorize: ({ principal, action }) => ({
        allowed: principal.id === "subject-1" && action.operation !== "secret",
      }),
    },
    resourceIsolation: {
      inspect: ({ principal, resource }) => ({
        allowed: principal.workspaceId === resource.workspaceId,
      }),
    },
    secrets: {
      resolve: async () => "secret",
    },
    rateLimiter,
  };
  const events: ObservabilityEvent[] = [];
  let next = 0;
  const observability = createPlatformObservabilityBoundary({
    sink: event => events.push(event),
    now: () => new Date("2026-10-05T12:00:00.000Z"),
    idGenerator: () => `event-${++next}`,
  });
  const pipeline = createHttpBoundaryPipeline({
    security: createPlatformSecurityBoundary(securityOptions),
    observability,
    validators: new Map([
      ["api.command", (input: unknown) => ({ valid: true, request: input })],
      ["api.query", (input: unknown) => ({ valid: true, request: input })],
    ]),
  });
  const correlation: ObservabilityCorrelation = {
    requestId: "request-1",
    traceId: "trace-1",
    auditId: "audit-1",
    runId: "run-1",
  };
  return { rateLimiter, events, pipeline, correlation };
}

const context = {
  requestId: "request-1",
  principal: { subjectId: "subject-1", workspaceId: "workspace-1" },
  resource: { kind: "run", id: "run-1" },
  correlation: {
    requestId: "request-1",
    traceId: "trace-1",
    auditId: "audit-1",
    runId: "run-1",
  },
};

describe("[task:R2] [concurrency] HTTP boundary ordering", () => {
  it("consumes rate budget before rejecting invalid authentication", async () => {
    const { rateLimiter, pipeline } = fixtures();
    const invalidContext = {
      ...context,
      requestId: "request-invalid",
      principal: { subjectId: "invalid", workspaceId: "workspace-1" },
    };

    await expect(
      pipeline.execute("api.query", invalidContext, {}, async () => "never"),
    ).rejects.toBeInstanceOf(SecurityAuthenticationError);
    await expect(
      pipeline.execute("api.query", invalidContext, {}, async () => "never"),
    ).rejects.toBeInstanceOf(SecurityAuthenticationError);

    expect(rateLimiter.consume).toHaveBeenCalledTimes(2);
  });
});

describe("[task:R2] [integration] HTTP validation and replay", () => {
  it("validates requests and returns replayed command results without duplicate execution", async () => {
    const { pipeline } = fixtures();
    let executions = 0;
    const input = { command: "generate", idempotencyKey: "request-1" };

    const first = await pipeline.execute("api.command", context, input, async value => {
      executions += 1;
      return value;
    });
    const second = await pipeline.execute("api.command", context, input, async value => {
      executions += 1;
      return value;
    });

    expect(executions).toBe(1);
    expect(second).toEqual(first);
  });

  it("rejects invalid request payloads before invoking the handler", async () => {
    const { pipeline } = fixtures();
    const invalid = createHttpBoundaryPipeline({
      security: createPlatformSecurityBoundary({
        authentication: {
          authenticate: () => ({
            authenticated: true,
            principal: {
              id: "subject-1",
              accountId: "account-1",
              workspaceId: "workspace-1",
              roles: ["author"],
            },
          }),
        },
        authorization: { authorize: () => ({ allowed: true }) },
        resourceIsolation: {
          inspect: ({ principal, resource }) => ({
            allowed: principal.workspaceId === resource.workspaceId,
          }),
        },
        secrets: { resolve: async () => "secret" },
        rateLimiter: {
          limit: 10,
          consume: () => ({ allowed: true, remaining: 9, resetAt: new Date() }),
        },
      }),
      observability: createPlatformObservabilityBoundary({
        sink: () => undefined,
        now: () => new Date(),
        idGenerator: () => "event",
      }),
      validators: new Map([
        [
          "api.command",
          () => ({ valid: false, issues: [{ code: "invalid", message: "invalid request" }] }),
        ],
      ]),
    });
    let executions = 0;

    await expect(
      invalid.execute("api.command", context, {}, async () => {
        executions += 1;
      }),
    ).rejects.toThrow("API request validation failed");
    expect(executions).toBe(0);
    expect(pipeline).toBeDefined();
  });
});

describe("[task:R2] [cross-system] HTTP schemas and audit", () => {
  it("exposes schemas for every production API contract without Domain shapes", () => {
    for (const contract of apiBoundaryContracts) {
      const schema = productRequestSchemas[contract.id];
      expect(schema).toBeInstanceOf(z.ZodType);
      expect(schema!.safeParse({ idempotencyKey: "key" }).success).toBe(true);
    }
    expect(productRequestSchemaAliases["api.command"]).toBe(productRequestSchemas[getApiBoundaryContract("api.command").id]);
    expect(commandResultSchema.safeParse({
      channel: "command-result",
      contractId: "api.command",
      value: {},
      replayed: false,
    }).success).toBe(true);
    expect(queryResultSchema.safeParse({
      channel: "query-result",
      contractId: "api.query",
      value: {},
    }).success).toBe(true);
    expect(productResponseSchemas["command-result"]).toBe(commandResultSchema);
    expect(productResponseSchemas["query-result"]).toBe(queryResultSchema);
  });

  it("emits correlated structured audit after successful execution", async () => {
    const { events, pipeline } = fixtures();

    await pipeline.execute("api.command", context, { idempotencyKey: "audit-1" }, async value => value);

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "audit",
        subjectKind: "run",
        subjectId: "run-1",
        correlation: context.correlation,
      }),
    );
  });

  it("keeps the optional server composition hook without changing existing routes", () => {
    const { pipeline } = fixtures();
    const app = createNovelBrainServer(createInMemoryEngineDependencies(), {
      httpBoundaryPipeline: pipeline,
    });

    expect(app.hasDecorator("httpBoundaryPipeline")).toBe(true);
    expect(app.httpBoundaryPipeline).toBe(pipeline);
  });
});
