import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createDevelopmentHttpBoundaryPipeline } from "../../src/http/developmentHttpBoundaryPipeline";
import type { HttpBoundaryPipeline } from "../../src/http/httpBoundaryPipeline";
import { createNovelBrainServer } from "../../src/http/server";
import {
  deploymentTopologyContract,
  type DeploymentHealthProbe,
  type DeploymentHealthStatus,
} from "../../src/platform/deploymentTopology";
import {
  createPlatformObservabilityBoundary,
  observabilityBoundaryContract,
  type ObservabilityCorrelation,
  type ObservabilityEvent,
} from "../../src/platform/observabilityBoundary";
import { parseProductionConfiguration } from "../../src/platform/productionConfiguration";
import { createProductionProcessBootstrap } from "../../src/platform/productionProcessBootstrap";
import {
  createPlatformSecurityBoundary,
  securityBoundaryContract,
  type PlatformSecurityBoundary,
} from "../../src/platform/securityBoundary";

/**
 * Release acceptance for the production capability roadmap. This file is a
 * verification-only smoke that must stay database-free: it composes the
 * in-memory engine root with stubbed migration/process adapters and Fastify's
 * `inject`, so the default unit/system suite never needs PostgreSQL or a live
 * listening socket. The real PostgreSQL path is verified separately by
 * `npm run test:integration`.
 */

const architectureSpecPath = fileURLToPath(
  new URL(
    "../../docs/superpowers/specs/2026-10-05-novel-brain-productionization-architecture.md",
    import.meta.url,
  ),
);

const configuration = parseProductionConfiguration({
  DATABASE_URL: "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain_test?schema=public",
  APPLICATION_PORT: "8080",
  PUBLIC_ORIGIN: "https://novel-brain.example",
  WORKER_CONCURRENCY: "2",
  LOG_LEVEL: "info",
});

const correlation: ObservabilityCorrelation = {
  requestId: "request-r6",
  traceId: "trace-r6",
  auditId: "audit-r6",
  runId: "run-r6",
};

interface AcceptanceHarness {
  readonly events: readonly string[];
  readonly observed: readonly ObservabilityEvent[];
  readonly contracts: readonly string[];
  readonly applied: readonly string[];
  readonly migrationCount: number;
  readonly bootstrap: ReturnType<typeof createProductionProcessBootstrap>;
  readonly app: ReturnType<typeof createNovelBrainServer>;
  readonly security: PlatformSecurityBoundary;
}

function createAcceptanceHarness(): AcceptanceHarness {
  const events: string[] = [];
  const observed: ObservabilityEvent[] = [];
  const contracts: string[] = [];
  const applied = new Set<string>();
  let migrationCount = 0;
  let applicationRunning = false;
  let workerRunning = false;
  let eventSequence = 0;

  const observability = createPlatformObservabilityBoundary({
    sink: event => observed.push(event),
    now: () => new Date("2026-10-05T00:00:00.000Z"),
    idGenerator: () => `event-${(eventSequence += 1)}`,
  });

  const healthStatuses = () => ({
    liveness: (applicationRunning && workerRunning ? "healthy" : "unhealthy") as
      DeploymentHealthStatus,
    readiness: (applicationRunning && workerRunning ? "healthy" : "unhealthy") as
      DeploymentHealthStatus,
    checks: {
      database: "healthy" as DeploymentHealthStatus,
      application: (applicationRunning ? "healthy" : "unhealthy") as DeploymentHealthStatus,
      worker: (workerRunning ? "healthy" : "unhealthy") as DeploymentHealthStatus,
    },
  });

  const healthProbe: DeploymentHealthProbe = {
    liveness: async () => healthStatuses().liveness,
    readiness: async () => {
      const statuses = healthStatuses();
      observability.health(correlation, statuses);
      return statuses.readiness;
    },
    checks: async () => healthStatuses().checks,
  };

  const bootstrap = createProductionProcessBootstrap({
    configuration,
    application: {
      start: async () => {
        applicationRunning = true;
        events.push("start:application");
      },
      stop: async () => {
        applicationRunning = false;
        events.push("stop:application");
      },
    },
    worker: {
      start: async () => {
        workerRunning = true;
        events.push("start:worker");
      },
      stop: async () => {
        workerRunning = false;
        events.push("stop:worker");
      },
    },
    migrations: [
      { id: "20261005000002_process_restart" },
      { id: "20261005000001_core_persistence" },
    ],
    migrationOperation: {
      ensureApplied: async migration => {
        if (applied.has(migration.id)) return "already-applied";
        applied.add(migration.id);
        migrationCount += 1;
        events.push(`migration:${migration.id}`);
        return "applied";
      },
    },
    healthProbe,
  });

  const boundary = createDevelopmentHttpBoundaryPipeline();
  const pipeline: HttpBoundaryPipeline = {
    async execute(contractId, context, input, handler) {
      contracts.push(contractId);
      return boundary.execute(contractId, context, input, handler);
    },
  };
  const app = createNovelBrainServer(createInMemoryEngineDependencies(), {
    httpBoundaryPipeline: pipeline,
  });

  const security = createPlatformSecurityBoundary({
    authentication: {
      authenticate: ({ credentials }) =>
        credentials.token === "author-token"
          ? {
              authenticated: true,
              principal: {
                id: "author-1",
                accountId: "account-1",
                workspaceId: "novel-1",
                roles: ["author"],
              },
            }
          : { authenticated: false, reason: "invalid credentials" },
    },
    authorization: {
      authorize: ({ principal, action }) => ({
        allowed: principal.roles.includes("author"),
        reason: "author may act inside the platform security boundary",
      }),
    },
    resourceIsolation: {
      inspect: ({ principal, resource }) => ({
        allowed: resource.workspaceId === principal.workspaceId,
        reason: "workspace isolation",
      }),
    },
    secrets: {
      resolve: async ({ reference }) => `secret:${reference.key}`,
    },
    rateLimiter: {
      limit: 100,
      consume: () => ({
        allowed: true,
        remaining: 99,
        resetAt: new Date("2026-10-05T00:01:00.000Z"),
      }),
    },
  });

  return {
    events,
    observed,
    contracts,
    get applied() {
      return [...applied];
    },
    get migrationCount() {
      return migrationCount;
    },
    bootstrap,
    app,
    security,
  };
}

describe("[task:R6] [integration] production release smoke", () => {
  it("migrates before processes start, serves the workspace through the boundary pipeline, reports health, then shuts down in reverse order", async () => {
    const harness = createAcceptanceHarness();

    await harness.bootstrap.start();

    expect(harness.events.filter(event => event.startsWith("migration:"))).toEqual([
      "migration:20261005000001_core_persistence",
      "migration:20261005000002_process_restart",
    ]);
    expect(harness.events.indexOf("migration:20261005000002_process_restart")).toBeLessThan(
      harness.events.indexOf("start:application"),
    );
    expect(harness.events.indexOf("migration:20261005000002_process_restart")).toBeLessThan(
      harness.events.indexOf("start:worker"),
    );

    const health = await harness.bootstrap.topology.health();
    expect(health).toMatchObject({
      phase: "ready",
      liveness: "healthy",
      readiness: "healthy",
    });

    const workspace = await harness.app.inject({ method: "GET", url: "/workspace/novel-1" });
    expect(workspace.statusCode).toBe(200);
    expect(harness.contracts).toContain("foundation.query.workspace-focus");

    expect(harness.observed.map(event => event.kind)).toContain("health");

    await harness.bootstrap.stop();

    expect(harness.events.slice(-2)).toEqual(["stop:worker", "stop:application"]);
    expect((await harness.bootstrap.topology.health()).phase).toBe("stopped");
  });
});

describe("[task:R6] [cross-system] production authority boundaries", () => {
  it("keeps security, observability, and deployment ownership outside the Novel Domain", () => {
    expect(securityBoundaryContract).toMatchObject({
      owner: "platform-security",
      novelDomainOwnership: false,
    });
    expect(observabilityBoundaryContract).toMatchObject({
      owner: "operational-platform",
      changesNovelDomain: false,
    });
    expect(deploymentTopologyContract).toMatchObject({
      owner: "operational-platform",
      changesNovelDomain: false,
    });
  });

  it("denies unauthenticated, cross-workspace, and out-of-scope secret access", async () => {
    const harness = createAcceptanceHarness();
    const action = {
      id: "foundation.query.workspace-focus",
      operation: "query" as const,
      resource: { id: "novel-1", kind: "workspace" as const, workspaceId: "novel-1" },
    };

    await expect(
      harness.security.protect({
        requestId: "request-anonymous",
        credentials: { token: "anonymous" },
        action,
      }),
    ).rejects.toThrow("invalid credentials");

    await expect(
      harness.security.protect({
        requestId: "request-cross-workspace",
        credentials: { token: "author-token" },
        action: {
          ...action,
          resource: { id: "novel-2", kind: "workspace", workspaceId: "novel-2" },
        },
      }),
    ).rejects.toThrow("workspace isolation");

    const permit = await harness.security.protect({
      requestId: "request-permitted",
      credentials: { token: "author-token" },
      action,
    });
    expect(permit.principal.workspaceId).toBe("novel-1");

    const secretPermit = await harness.security.protect({
      requestId: "request-secret",
      credentials: { token: "author-token" },
      action: {
        id: "platform.secret.generation-provider",
        operation: "secret",
        resource: { id: "generation-provider", kind: "secret", workspaceId: "novel-1" },
      },
    });
    await expect(
      harness.security.resolveSecret(secretPermit, {
        key: "another-provider",
        workspaceId: "novel-1",
      }),
    ).rejects.toThrow("outside the permitted scope");
  });

  it("serves workspace and recall reads without narrative-truth mutation authority", async () => {
    const harness = createAcceptanceHarness();

    const workspace = await harness.app.inject({ method: "GET", url: "/workspace/novel-1" });
    expect(workspace.statusCode).toBe(200);
    expect(workspace.json().sharedTruth.owner).toBe("shared-novel-engine");

    const attention = await harness.app.inject({
      method: "GET",
      url: "/novels/novel-1/attention",
    });
    expect(attention.statusCode).toBe(200);
    expect(attention.json().truthOwner).toBe("shared-novel-engine");
    expect(attention.json().authority).toMatchObject({
      authoritative: false,
      mayMutateNarrativeTruth: false,
      mayCreateTaskDirectly: false,
      mayCommit: false,
      proposedActionChannel: "production-run-policy",
    });

    expect(harness.contracts).toEqual([
      "foundation.query.workspace-focus",
      "recall.query.recall-attention",
    ]);
  });
});

describe("[task:R6] [recovery] production crash recovery", () => {
  it("restarts a crashed process without repeating migrations and returns to ready", async () => {
    const harness = createAcceptanceHarness();

    await harness.bootstrap.start();
    const eventsBeforeCrash = harness.events.length;

    harness.bootstrap.topology.crash("application", "application exited unexpectedly");
    expect(await harness.bootstrap.topology.health()).toMatchObject({
      phase: "crashed",
      liveness: "unhealthy",
      readiness: "unhealthy",
      failure: { process: "application", reason: "application exited unexpectedly" },
    });

    await harness.bootstrap.topology.restart();

    expect(harness.events.slice(eventsBeforeCrash)).toContain("start:application");
    expect(harness.migrationCount).toBe(2);
    expect(harness.applied).toEqual([
      "20261005000001_core_persistence",
      "20261005000002_process_restart",
    ]);
    expect(await harness.bootstrap.topology.health()).toMatchObject({
      phase: "ready",
      liveness: "healthy",
      readiness: "healthy",
    });
  });
});

describe("[task:R6] [regression] frozen scope stays deferred", () => {
  it("keeps provider, prompt, vector retrieval, cost, and advanced validator scope deferred", () => {
    const source = readFileSync(architectureSpecPath, "utf8");

    for (const deferred of [
      "Provider-specific implementation",
      "Prompt framework",
      "Recall scoring/vector retrieval",
      "Cost optimization details",
      "Advanced validator catalog",
      "Field-level database schema",
      "DTO fields",
      "API parameter details",
      "Pixel-level UI design",
    ]) {
      expect(source).toContain(deferred);
    }
    expect(source).toContain("Productionization Architecture = FROZEN");
  });

  it("exposes no product routes for the deferred capabilities", async () => {
    const harness = createAcceptanceHarness();

    for (const url of [
      "/providers",
      "/prompts",
      "/recall/vector-search",
      "/cost",
      "/validators",
    ]) {
      const response = await harness.app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
    }
    expect(harness.contracts).toEqual([]);
  });
});
