import {
  createDeploymentTopology,
  DeploymentTopology,
  type DeploymentConfiguration,
  type DeploymentHealthProbe,
  type DeploymentMigration,
  type DeploymentMigrationOperation,
  type DeploymentProcess,
  type DeploymentProcessController,
  type DeploymentSignal,
} from "./deploymentTopology";
import {
  parseProductionConfiguration,
  type ProductionConfiguration,
} from "./productionConfiguration";

export interface ProductionProcessBootstrap {
  readonly topology: DeploymentTopology;
  start(): Promise<void>;
  stop(signal?: DeploymentSignal): Promise<void>;
}

export interface ProductionProcessBootstrapOptions {
  readonly configuration: ProductionConfiguration;
  readonly application: DeploymentProcessController;
  readonly worker: DeploymentProcessController;
  readonly migrations: readonly DeploymentMigration[];
  readonly migrationOperation: DeploymentMigrationOperation;
  readonly healthProbe: DeploymentHealthProbe;
}

function configurationRecord(configuration: ProductionConfiguration): DeploymentConfiguration {
  return {
    DATABASE_URL: configuration.databaseUrl,
    APPLICATION_PORT: String(configuration.applicationPort),
    PUBLIC_ORIGIN: configuration.publicOrigin,
    WORKER_CONCURRENCY: String(configuration.workerConcurrency),
    LOG_LEVEL: configuration.logLevel,
  };
}

export function createProductionProcessBootstrap(
  options: ProductionProcessBootstrapOptions,
): ProductionProcessBootstrap {
  const topology = createDeploymentTopology({
    configuration: {
      validate: configuration => {
        parseProductionConfiguration(configuration);
      },
    },
    migrations: options.migrations,
    migrationOperation: options.migrationOperation,
    processes: {
      start: (process: DeploymentProcess) =>
        process === "application"
          ? options.application.start(process)
          : options.worker.start(process),
      stop: (process: DeploymentProcess, signal: DeploymentSignal) =>
        process === "application"
          ? options.application.stop(process, signal)
          : options.worker.stop(process, signal),
    },
    healthProbe: options.healthProbe,
  });

  return {
    topology,
    start: () => topology.start(configurationRecord(options.configuration)),
    stop: (signal: DeploymentSignal = "SIGTERM") => {
      if (signal !== "SIGTERM") throw new Error("unsupported deployment signal");
      return topology.shutdown();
    },
  };
}
