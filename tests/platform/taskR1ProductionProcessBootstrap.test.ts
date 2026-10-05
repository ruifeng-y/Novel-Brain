import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProductionConfiguration } from "../../src/platform/productionConfiguration";
import { createProductionProcessBootstrap } from "../../src/platform/productionProcessBootstrap";
import { ProcessWorkerAdapter } from "../../src/production/runtime/processWorkerAdapter";
import { DeterministicRuntime } from "../../src/production/runtime/deterministicRuntime";
import type { RuntimeAdapter, RuntimeResult } from "../../src/production/runtime/runtimeAdapter";
import type {
  ScheduledWorkOrder,
  WorkerExecutionControl,
} from "../../src/production/runtime/schedulerWorkerBoundary";
import type { ProductionRun } from "../../src/production/domain/productionRun";
import type { ExecutionAttempt } from "../../src/production/domain/executionAttempt";

const configuration = parseProductionConfiguration({
  DATABASE_URL: "postgresql://localhost/app",
  APPLICATION_PORT: "8080",
  PUBLIC_ORIGIN: "https://app.example",
  WORKER_CONCURRENCY: "2",
  LOG_LEVEL: "info",
});

describe("[task:R1] [domain] production configuration", () => {
  it("rejects missing and invalid production configuration", () => {
    expect(() => parseProductionConfiguration({})).toThrow("DATABASE_URL is required");
    expect(() =>
      parseProductionConfiguration({
        DATABASE_URL: "postgresql://localhost/app",
        APPLICATION_PORT: "0",
        PUBLIC_ORIGIN: "https://app.example",
        WORKER_CONCURRENCY: "2",
        LOG_LEVEL: "info",
      }),
    ).toThrow("APPLICATION_PORT must be between 1 and 65535");
    expect(() =>
      parseProductionConfiguration({
        DATABASE_URL: "postgresql://localhost/app",
        APPLICATION_PORT: "8080",
        PUBLIC_ORIGIN: "app.example",
        WORKER_CONCURRENCY: "2",
        LOG_LEVEL: "info",
      }),
    ).toThrow("PUBLIC_ORIGIN must be an absolute http or https URL");
    expect(() =>
      parseProductionConfiguration({
        DATABASE_URL: "postgresql://localhost/app",
        APPLICATION_PORT: "8080",
        PUBLIC_ORIGIN: "https://app.example",
        WORKER_CONCURRENCY: "65",
        LOG_LEVEL: "info",
      }),
    ).toThrow("WORKER_CONCURRENCY must be between 1 and 64");
    expect(() =>
      parseProductionConfiguration({
        DATABASE_URL: "postgresql://localhost/app",
        APPLICATION_PORT: "8080",
        PUBLIC_ORIGIN: "https://app.example",
        WORKER_CONCURRENCY: "2",
        LOG_LEVEL: "verbose",
      }),
    ).toThrow("LOG_LEVEL must be one of error, warn, info, debug");
    expect(configuration).toEqual({
      databaseUrl: "postgresql://localhost/app",
      applicationPort: 8080,
      publicOrigin: "https://app.example",
      workerConcurrency: 2,
      logLevel: "info",
    });
  });
});

describe("[task:R1] [integration] production process lifecycle", () => {
  it("starts application and worker after migrations and stops in reverse order", async () => {
    const calls: string[] = [];
    const bootstrap = createProductionProcessBootstrap({
      configuration,
      application: {
        start: async () => {
          calls.push("start:application");
        },
        stop: async () => {
          calls.push("stop:application");
        },
      },
      worker: {
        start: async () => {
          calls.push("start:worker");
        },
        stop: async () => {
          calls.push("stop:worker");
        },
      },
      migrations: [{ id: "001" }],
      migrationOperation: {
        ensureApplied: async () => {
          calls.push("migration:001");
          return "applied";
        },
      },
      healthProbe: {
        liveness: async () => "healthy",
        readiness: async () => "healthy",
        checks: async () => ({ persistence: "healthy" }),
      },
    });

    await bootstrap.start();
    await bootstrap.stop();

    expect(calls).toEqual([
      "migration:001",
      "start:application",
      "start:worker",
      "stop:worker",
      "stop:application",
    ]);
    expect((await bootstrap.topology.health()).phase).toBe("stopped");
  });

  it("preserves startup failure diagnostics and does not start processes", async () => {
    const calls: string[] = [];
    const bootstrap = createProductionProcessBootstrap({
      configuration,
      application: {
        start: async () => {
          calls.push("start:application");
        },
        stop: async () => {
          calls.push("stop:application");
        },
      },
      worker: {
        start: async () => {
          calls.push("start:worker");
        },
        stop: async () => {
          calls.push("stop:worker");
        },
      },
      migrations: [{ id: "001" }],
      migrationOperation: {
        ensureApplied: async () => {
          throw new Error("migration failed");
        },
      },
      healthProbe: {
        liveness: async () => "healthy",
        readiness: async () => "healthy",
        checks: async () => ({ persistence: "healthy" }),
      },
    });

    await expect(bootstrap.start()).rejects.toThrow("migration failed");
    expect(calls).toEqual([]);
    expect(await bootstrap.topology.health()).toMatchObject({
      phase: "failed",
      failure: { process: "startup", reason: "migration failed" },
    });
  });
});

describe("[task:R1] [recovery] process worker adapter", () => {
  const order = {
    workId: "work-1",
    timeoutMs: 1000,
    run: {} as ProductionRun,
    attempt: {} as ExecutionAttempt,
    runtimeRequest: {
      taskId: "task-1",
      agentRole: "writer",
      modelPolicy: { provider: "deterministic", model: "reference", maxOutputTokens: 100 },
      basedOnVersionSet: {},
      context: {},
      requestedChange: {
        type: "text",
        sceneId: "scene-1",
        text: "Generated text",
      },
    },
  } as ScheduledWorkOrder;

  it("executes a runtime request and preserves its result", async () => {
    const runtimeResult = {
      taskId: "task-1",
      agentRole: "writer",
      modelPolicy: { provider: "deterministic", model: "reference", maxOutputTokens: 100 },
      change: { type: "text", sceneId: "scene-1", text: "Generated text" },
      basedOnVersionSet: {},
    } as RuntimeResult;
    const runtime: RuntimeAdapter = { execute: async () => runtimeResult };
    const adapter = new ProcessWorkerAdapter({ runtime });

    const result = await adapter.execute(order, {
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("succeeded");
    expect(result.status === "succeeded" && result.runtimeResult).toBe(runtimeResult);
  });

  it("returns cancellation before execution when the signal is already aborted", async () => {
    const adapter = new ProcessWorkerAdapter({ runtime: new DeterministicRuntime() });
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.execute(order, { signal: controller.signal } satisfies WorkerExecutionControl),
    ).resolves.toEqual({
      status: "cancelled",
      reason: "aborted before execution",
    });
  });

  it("maps runtime failures to stable non-retryable worker failures", async () => {
    const adapter = new ProcessWorkerAdapter({
      runtime: {
        execute: async () => {
          throw new Error("runtime exploded");
        },
      },
    });

    await expect(
      adapter.execute(order, { signal: new AbortController().signal }),
    ).resolves.toEqual({
      status: "failed",
      error: {
        code: "runtime-error",
        message: "runtime exploded",
        retryable: false,
      },
    });
  });
});

describe("[task:R1] [integration] direct process entrypoints", () => {
  it.each([
    "runMigrations.ts",
    "startApplication.ts",
    "startWorker.ts",
  ])("executes %s as a real process entrypoint", script => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts", script)],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: "",
          APPLICATION_PORT: "",
          PUBLIC_ORIGIN: "",
          WORKER_CONCURRENCY: "",
          LOG_LEVEL: "",
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toContain("DATABASE_URL is required");
  });
});
