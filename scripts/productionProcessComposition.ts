import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { createPrismaEngineServer } from "../src/app/prismaComposition.ts";
import {
  createProductionProcessBootstrap,
  type ProductionProcessBootstrap,
} from "../src/platform/productionProcessBootstrap.ts";
import type { ProductionConfiguration } from "../src/platform/productionConfiguration.ts";
import type {
  DeploymentHealthProbe,
  DeploymentHealthStatus,
  DeploymentMigration,
  DeploymentMigrationOperation,
  DeploymentProcess,
  DeploymentProcessController,
  DeploymentSignal,
} from "../src/platform/deploymentTopology.ts";
import { DeterministicRuntime } from "../src/production/runtime/deterministicRuntime.ts";
import { ProcessWorkerAdapter } from "../src/production/runtime/processWorkerAdapter.ts";
import type { ScheduledWorkOrder } from "../src/production/runtime/schedulerWorkerBoundary.ts";

export type DeploymentProcessRole = "application" | "worker";

interface RoleProcessController extends DeploymentProcessController {
  liveness(): Promise<DeploymentHealthStatus>;
  readiness(): Promise<DeploymentHealthStatus>;
  checks(): Promise<Readonly<Record<string, DeploymentHealthStatus>>>;
}

type PrismaEngineServer = ReturnType<typeof createPrismaEngineServer>;

function createApplicationProcessController(
  role: DeploymentProcessRole,
  configuration: ProductionConfiguration,
): RoleProcessController {
  let server: PrismaEngineServer | undefined;
  let prisma: PrismaClient | undefined;
  const healthy = () => server !== undefined && server.server.listening;
  return {
    async start(process: DeploymentProcess) {
      if (process !== role) return;
      if (server !== undefined) throw new Error("application process is already running");
      const client = new PrismaClient();
      const created = createPrismaEngineServer(client);
      try {
        await created.listen({ port: configuration.applicationPort, host: "0.0.0.0" });
      } catch (error) {
        await client.$disconnect();
        throw error;
      }
      prisma = client;
      server = created;
    },
    async stop(process: DeploymentProcess, _signal: DeploymentSignal) {
      if (process !== role || server === undefined) return;
      const running = server;
      const client = prisma;
      server = undefined;
      prisma = undefined;
      await running.close();
      if (client !== undefined) await client.$disconnect();
    },
    async liveness() {
      return healthy() ? "healthy" : "unhealthy";
    },
    async readiness() {
      return healthy() ? "healthy" : "unhealthy";
    },
    async checks() {
      return { application: healthy() ? "healthy" : "unhealthy" };
    },
  };
}

/**
 * The Scheduler adapter that feeds queued work orders is owned by the
 * Production Run boundary and is not part of the current task. The worker
 * process starts the real runtime and consumer loop; until a source is
 * injected the loop waits for orders instead of inventing a second scheduler.
 */
interface WorkOrderSource {
  take(signal: AbortSignal): Promise<ScheduledWorkOrder | undefined>;
}

function createIdleWorkOrderSource(): WorkOrderSource {
  return {
    take: signal =>
      new Promise<ScheduledWorkOrder | undefined>(resolve => {
        if (signal.aborted) {
          resolve(undefined);
          return;
        }
        signal.addEventListener("abort", () => resolve(undefined), { once: true });
      }),
  };
}

async function consumeWorkOrders(
  source: WorkOrderSource,
  adapter: ProcessWorkerAdapter,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    const order = await source.take(signal);
    if (order === undefined || signal.aborted) return;
    await adapter.execute(order, { signal });
  }
}

function createWorkerProcessController(
  role: DeploymentProcessRole,
  configuration: ProductionConfiguration,
  source: WorkOrderSource = createIdleWorkOrderSource(),
): RoleProcessController {
  let worker:
    | { readonly controller: AbortController; readonly loop: Promise<void> }
    | undefined;
  return {
    async start(process: DeploymentProcess) {
      if (process !== role || worker !== undefined) return;
      const adapter = new ProcessWorkerAdapter({ runtime: new DeterministicRuntime() });
      const controller = new AbortController();
      worker = {
        controller,
        loop: Promise.all(
          Array.from({ length: configuration.workerConcurrency }, () =>
            consumeWorkOrders(source, adapter, controller.signal),
          ),
        ).then(() => undefined),
      };
    },
    async stop(process: DeploymentProcess, _signal: DeploymentSignal) {
      if (process !== role || worker === undefined) return;
      const running = worker;
      worker = undefined;
      running.controller.abort();
      await running.loop;
    },
    async liveness() {
      return worker === undefined ? "unhealthy" : "healthy";
    },
    async readiness() {
      return worker === undefined ? "unhealthy" : "healthy";
    },
    async checks() {
      return { worker: worker === undefined ? "unhealthy" : "healthy" };
    },
  };
}

function discoverMigrations(): readonly DeploymentMigration[] {
  const directory = fileURLToPath(new URL("../prisma/migrations", import.meta.url));
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ id: entry.name }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function createPrismaMigrationOperation(): DeploymentMigrationOperation {
  let deployed = false;
  return {
    async ensureApplied() {
      if (deployed) return "already-applied";
      const command = process.platform === "win32" ? "npx.cmd" : "npx";
      const result = spawnSync(command, ["prisma", "migrate", "deploy"], {
        stdio: "inherit",
        env: process.env,
        shell: process.platform === "win32",
      });
      if (result.status !== 0) {
        throw new Error(
          `prisma migrate deploy failed with exit code ${result.status ?? "unknown"}`,
        );
      }
      deployed = true;
      return "applied";
    },
  };
}

/**
 * Builds the deployment bootstrap for a single process role. Migrations run
 * before the role process starts, and health is derived from the real process
 * state rather than static values.
 */
export function createDeploymentProcessBootstrap(
  role: DeploymentProcessRole,
  configuration: ProductionConfiguration,
): ProductionProcessBootstrap {
  const roleController =
    role === "application"
      ? createApplicationProcessController(role, configuration)
      : createWorkerProcessController(role, configuration);
  const processes: DeploymentProcessController = {
    start: async process => {
      if (process === role) await roleController.start(process);
    },
    stop: async (process, signal) => {
      if (process === role) await roleController.stop(process, signal);
    },
  };
  const healthProbe: DeploymentHealthProbe = {
    liveness: () => roleController.liveness(),
    readiness: () => roleController.readiness(),
    checks: () => roleController.checks(),
  };
  return createProductionProcessBootstrap({
    configuration,
    application: processes,
    worker: processes,
    migrations: discoverMigrations(),
    migrationOperation: createPrismaMigrationOperation(),
    healthProbe,
  });
}

export async function startDeploymentProcess(
  role: DeploymentProcessRole,
  configuration: ProductionConfiguration,
): Promise<void> {
  const bootstrap = createDeploymentProcessBootstrap(role, configuration);
  await bootstrap.start();

  const shutdown = async () => {
    await bootstrap.stop("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
