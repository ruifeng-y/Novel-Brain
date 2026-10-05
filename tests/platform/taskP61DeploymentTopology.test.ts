import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preProcessFile } from "typescript";
import { describe, expect, it } from "vitest";
import {
  createDeploymentTopology,
  deploymentTopologyContract,
  type DeploymentHealthStatus,
} from "../../src/platform/deploymentTopology";

function domainImports(entry: string): readonly string[] {
  const seen = new Set<string>();
  const queue = [entry];
  const found: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const imported of preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles) {
      const base = resolve(dirname(file), imported.fileName);
      const resolved = extname(base)
        ? base
        : [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")].find(candidate => {
            try {
              readFileSync(candidate);
              return true;
            } catch {
              return false;
            }
          }) ?? base;
      if (/[/\\]domain[/\\]/.test(resolved)) found.push(imported.fileName);
      if (!seen.has(resolved)) queue.push(resolved);
    }
  }
  return found;
}

interface SmokeHarness {
  readonly events: string[];
  readonly appliedMigrations: string[];
  readonly probes: {
    liveness: DeploymentHealthStatus;
    readiness: DeploymentHealthStatus;
    checks: Record<string, DeploymentHealthStatus>;
  };
  readonly topology: ReturnType<typeof createDeploymentTopology>;
}

function smokeHarness(configurationError?: string): SmokeHarness {
  const events: string[] = [];
  const applied = new Set<string>();
  const probes = {
    liveness: "healthy" as DeploymentHealthStatus,
    readiness: "healthy" as DeploymentHealthStatus,
    checks: {
      database: "healthy" as DeploymentHealthStatus,
      application: "healthy" as DeploymentHealthStatus,
      worker: "healthy" as DeploymentHealthStatus,
    },
  };
  const topology = createDeploymentTopology({
    configuration: {
      validate(config) {
        events.push(`config:${Object.keys(config).sort().join(",")}`);
        if (configurationError !== undefined) throw new Error(configurationError);
      },
    },
    migrations: [
      { id: "20261005000002_process_restart" },
      { id: "20261005000001_core_persistence" },
    ],
    migrationOperation: {
      async ensureApplied(migration) {
        if (applied.has(migration.id)) return "already-applied";
        applied.add(migration.id);
        events.push(`migration:${migration.id}`);
        return "applied";
      },
    },
    processes: {
      async start(process) {
        events.push(`start:${process}`);
      },
      async stop(process, signal) {
        events.push(`stop:${process}:${signal}`);
      },
    },
    healthProbe: {
      async liveness() {
        events.push("health:liveness");
        return probes.liveness;
      },
      async readiness() {
        events.push("health:readiness");
        return probes.readiness;
      },
      async checks() {
        events.push("health:checks");
        return { ...probes.checks };
      },
    },
  });
  return {
    events,
    get appliedMigrations() {
      return [...applied];
    },
    probes,
    topology,
  };
}

const config = {
  SHARED_DATABASE_URL: "postgres://database",
  APPLICATION_PORT: "8080",
  WORKER_CONCURRENCY: "4",
};

describe("[task:P6.1] [domain] Deployment topology ownership", () => {
  it("owns application, worker, migration, configuration, health, and diagnostics outside Novel Domain", () => {
    expect(deploymentTopologyContract).toEqual({
      id: "platform.deployment.topology",
      owner: "operational-platform",
      processes: ["application", "worker"],
      persistence: "required",
      migrations: "before-process-start",
      configurationScopes: ["shared", "application", "worker", "migration"],
      startupOrder: ["application", "worker"],
      shutdownOrder: ["worker", "application"],
      health: ["liveness", "readiness"],
      failureDiagnostics: "required",
      changesNovelDomain: false,
    });
    const entry = fileURLToPath(
      new URL("../../src/platform/deploymentTopology.ts", import.meta.url),
    );
    expect(domainImports(entry)).toEqual([]);
  });
});

describe("[task:P6.1] [integration] Deployment startup and health smoke", () => {
  it("validates configuration, migrates, starts application then worker, and reports health", async () => {
    const harness = smokeHarness();

    await harness.topology.start(config);

    expect(harness.events.slice(0, 8)).toEqual([
      "config:APPLICATION_PORT,SHARED_DATABASE_URL,WORKER_CONCURRENCY",
      "migration:20261005000001_core_persistence",
      "migration:20261005000002_process_restart",
      "start:application",
      "start:worker",
      "health:liveness",
      "health:readiness",
      "health:checks",
    ]);
    expect(await harness.topology.health()).toEqual({
      phase: "ready",
      liveness: "healthy",
      readiness: "healthy",
      checks: {
        database: "healthy",
        application: "healthy",
        worker: "healthy",
      },
    });
  });

  it("rejects invalid configuration before migration or process startup", async () => {
    const harness = smokeHarness("configuration validation failed");

    await expect(harness.topology.start(config)).rejects.toThrow(
      "configuration validation failed",
    );

    expect(harness.events).toEqual([
      "config:APPLICATION_PORT,SHARED_DATABASE_URL,WORKER_CONCURRENCY",
    ]);
    expect(harness.appliedMigrations).toEqual([]);
    expect(await harness.topology.health()).toMatchObject({
      phase: "failed",
      liveness: "unhealthy",
      readiness: "unhealthy",
    });
  });

  it("surfaces liveness and readiness diagnostics after startup", async () => {
    const harness = smokeHarness();
    await harness.topology.start(config);
    harness.probes.readiness = "degraded";

    expect(await harness.topology.health()).toEqual({
      phase: "ready",
      liveness: "healthy",
      readiness: "degraded",
      checks: {
        database: "healthy",
        application: "healthy",
        worker: "healthy",
      },
    });
  });
});

describe("[task:P6.1] [persistence] Migration ordering smoke", () => {
  it("applies migrations once in stable identifier order before processes start", async () => {
    const harness = smokeHarness();

    await harness.topology.start(config);

    expect(harness.appliedMigrations).toEqual([
      "20261005000001_core_persistence",
      "20261005000002_process_restart",
    ]);
    expect(harness.events.indexOf("migration:20261005000001_core_persistence")).toBeLessThan(
      harness.events.indexOf("start:application"),
    );
    expect(harness.events.indexOf("migration:20261005000002_process_restart")).toBeLessThan(
      harness.events.indexOf("start:application"),
    );
  });
});

describe("[task:P6.1] [concurrency] Migration idempotency smoke", () => {
  it("does not reapply completed migrations when the topology restarts", async () => {
    const harness = smokeHarness();

    await harness.topology.start(config);
    await harness.topology.shutdown();
    await harness.topology.start(config);

    expect(harness.appliedMigrations).toEqual([
      "20261005000001_core_persistence",
      "20261005000002_process_restart",
    ]);
    expect(
      harness.events.filter(event => event.startsWith("migration:")),
    ).toHaveLength(2);
  });
});

describe("[task:P6.1] [integration] Graceful shutdown smoke", () => {
  it("stops worker then application with SIGTERM and reports a stopped topology", async () => {
    const harness = smokeHarness();
    await harness.topology.start(config);
    const startupEventCount = harness.events.length;

    await harness.topology.shutdown();

    expect(harness.events.slice(startupEventCount)).toEqual([
      "stop:worker:SIGTERM",
      "stop:application:SIGTERM",
    ]);
    expect(await harness.topology.health()).toMatchObject({
      phase: "stopped",
      liveness: "unhealthy",
      readiness: "unhealthy",
    });
  });
});

describe("[task:P6.1] [recovery] Crash and restart smoke", () => {
  it("diagnoses a crashed process and restarts it without repeating migrations", async () => {
    const harness = smokeHarness();
    await harness.topology.start(config);
    const readyEventCount = harness.events.length;

    harness.topology.crash("application", "application exited unexpectedly");
    expect(await harness.topology.health()).toMatchObject({
      phase: "crashed",
      liveness: "unhealthy",
      readiness: "unhealthy",
      failure: {
        process: "application",
        reason: "application exited unexpectedly",
      },
    });

    await harness.topology.restart();

    expect(harness.events.slice(readyEventCount)).toEqual([
      "config:APPLICATION_PORT,SHARED_DATABASE_URL,WORKER_CONCURRENCY",
      "start:application",
      "health:liveness",
      "health:readiness",
      "health:checks",
    ]);
    expect(harness.appliedMigrations).toEqual([
      "20261005000001_core_persistence",
      "20261005000002_process_restart",
    ]);
    expect(await harness.topology.health()).toMatchObject({
      phase: "ready",
      liveness: "healthy",
      readiness: "healthy",
    });
  });
});