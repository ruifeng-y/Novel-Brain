export type DeploymentProcess = "application" | "worker";
export type DeploymentPhase =
  | "idle"
  | "starting"
  | "ready"
  | "failed"
  | "stopping"
  | "stopped"
  | "crashed";
export type DeploymentHealthStatus = "healthy" | "degraded" | "unhealthy";
export type DeploymentSignal = "SIGTERM";
export type DeploymentMigrationOutcome = "applied" | "already-applied";

export interface DeploymentTopologyContract {
  readonly id: "platform.deployment.topology";
  readonly owner: "operational-platform";
  readonly processes: readonly ["application", "worker"];
  readonly persistence: "required";
  readonly migrations: "before-process-start";
  readonly configurationScopes: readonly [
    "shared",
    "application",
    "worker",
    "migration",
  ];
  readonly startupOrder: readonly ["application", "worker"];
  readonly shutdownOrder: readonly ["worker", "application"];
  readonly health: readonly ["liveness", "readiness"];
  readonly failureDiagnostics: "required";
  readonly changesNovelDomain: false;
}

export const deploymentTopologyContract: DeploymentTopologyContract = Object.freeze({
  id: "platform.deployment.topology",
  owner: "operational-platform",
  processes: Object.freeze(["application", "worker"] as const),
  persistence: "required",
  migrations: "before-process-start",
  configurationScopes: Object.freeze([
    "shared",
    "application",
    "worker",
    "migration",
  ] as const),
  startupOrder: Object.freeze(["application", "worker"] as const),
  shutdownOrder: Object.freeze(["worker", "application"] as const),
  health: Object.freeze(["liveness", "readiness"] as const),
  failureDiagnostics: "required",
  changesNovelDomain: false,
});

export type DeploymentConfiguration = Readonly<Record<string, string>>;

export interface DeploymentConfigurationValidator {
  validate(configuration: DeploymentConfiguration): void | Promise<void>;
}

export interface DeploymentMigration {
  readonly id: string;
}

export interface DeploymentMigrationOperation {
  ensureApplied(
    migration: DeploymentMigration,
  ): Promise<DeploymentMigrationOutcome>;
}

export interface DeploymentProcessController {
  start(process: DeploymentProcess): Promise<void>;
  stop(process: DeploymentProcess, signal: DeploymentSignal): Promise<void>;
}

export interface DeploymentHealthProbe {
  liveness(): Promise<DeploymentHealthStatus>;
  readiness(): Promise<DeploymentHealthStatus>;
  checks(): Promise<Readonly<Record<string, DeploymentHealthStatus>>>;
}

export interface DeploymentTopologyOptions {
  readonly configuration: DeploymentConfigurationValidator;
  readonly migrations: readonly DeploymentMigration[];
  readonly migrationOperation: DeploymentMigrationOperation;
  readonly processes: DeploymentProcessController;
  readonly healthProbe: DeploymentHealthProbe;
}

export interface DeploymentFailure {
  readonly process: DeploymentProcess | "startup";
  readonly reason: string;
}

export interface DeploymentHealthReport {
  readonly phase: DeploymentPhase;
  readonly liveness: DeploymentHealthStatus;
  readonly readiness: DeploymentHealthStatus;
  readonly checks: Readonly<Record<string, DeploymentHealthStatus>>;
  readonly failure?: DeploymentFailure;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DeploymentTopology {
  private readonly options: DeploymentTopologyOptions;
  private readonly sortedMigrations: readonly DeploymentMigration[];
  private phase: DeploymentPhase = "idle";
  private readonly running = new Set<DeploymentProcess>();
  private readonly crashed = new Set<DeploymentProcess>();
  private configuration: DeploymentConfiguration | undefined;
  private failure: DeploymentFailure | undefined;

  constructor(options: DeploymentTopologyOptions) {
    this.options = options;
    this.sortedMigrations = [...options.migrations].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }

  async start(configuration: DeploymentConfiguration): Promise<void> {
    if (this.phase === "starting" || this.phase === "stopping") {
      throw new Error(`deployment cannot start while ${this.phase}`);
    }
    if (this.phase === "ready") throw new Error("deployment is already ready");
    if (this.phase === "crashed") throw new Error("deployment requires restart recovery");

    this.phase = "starting";
    this.running.clear();
    this.crashed.clear();
    this.failure = undefined;
    this.configuration = { ...configuration };

    try {
      await this.options.configuration.validate(this.configuration);
      await this.ensureMigrations();
      for (const process of deploymentTopologyContract.startupOrder) {
        await this.options.processes.start(process);
        this.running.add(process);
      }
      await this.verifyReadyHealth();
      this.phase = "ready";
    } catch (error) {
      this.phase = "failed";
      this.failure = {
        process: "startup",
        reason: errorMessage(error),
      };
      throw error;
    }
  }

  async restart(): Promise<void> {
    if (this.phase !== "crashed") {
      throw new Error("restart recovery requires a crashed deployment");
    }
    if (this.configuration === undefined) {
      throw new Error("restart recovery requires validated configuration");
    }

    this.phase = "starting";
    try {
      await this.options.configuration.validate(this.configuration);
      await this.ensureMigrations();
      for (const process of deploymentTopologyContract.startupOrder) {
        if (!this.crashed.has(process)) continue;
        await this.options.processes.start(process);
        this.crashed.delete(process);
        this.running.add(process);
      }
      await this.verifyReadyHealth();
      this.failure = undefined;
      this.phase = "ready";
    } catch (error) {
      this.phase = "failed";
      this.failure = {
        process: "startup",
        reason: errorMessage(error),
      };
      throw error;
    }
  }

  crash(process: DeploymentProcess, reason: string): void {
    if (!this.running.has(process)) {
      throw new Error(`deployment process is not running: ${process}`);
    }
    this.running.delete(process);
    this.crashed.add(process);
    this.phase = "crashed";
    this.failure = { process, reason };
  }

  async shutdown(): Promise<void> {
    if (this.phase !== "ready") {
      throw new Error(`deployment cannot stop while ${this.phase}`);
    }

    this.phase = "stopping";
    try {
      for (const process of deploymentTopologyContract.shutdownOrder) {
        if (!this.running.has(process)) continue;
        await this.options.processes.stop(process, "SIGTERM");
        this.running.delete(process);
      }
      this.failure = undefined;
      this.phase = "stopped";
    } catch (error) {
      this.phase = "failed";
      this.failure = {
        process: "startup",
        reason: errorMessage(error),
      };
      throw error;
    }
  }

  async health(): Promise<DeploymentHealthReport> {
    if (this.phase === "ready") return this.readHealth();
    return {
      phase: this.phase,
      liveness: "unhealthy",
      readiness: "unhealthy",
      checks: {
        database: "unhealthy",
        application: "unhealthy",
        worker: "unhealthy",
      },
      ...(this.failure === undefined ? {} : { failure: this.failure }),
    };
  }

  private async ensureMigrations(): Promise<void> {
    for (const migration of this.sortedMigrations) {
      await this.options.migrationOperation.ensureApplied(migration);
    }
  }

  private async verifyReadyHealth(): Promise<void> {
    const health = await this.readHealth();
    if (health.liveness !== "healthy" || health.readiness !== "healthy") {
      throw new Error(
        `deployment health is not ready: liveness=${health.liveness} readiness=${health.readiness}`,
      );
    }
  }

  private async readHealth(): Promise<DeploymentHealthReport> {
    const liveness = await this.options.healthProbe.liveness();
    const readiness = await this.options.healthProbe.readiness();
    const checks = await this.options.healthProbe.checks();
    return {
      phase: this.phase,
      liveness,
      readiness,
      checks,
      ...(this.failure === undefined ? {} : { failure: this.failure }),
    };
  }
}

export function createDeploymentTopology(
  options: DeploymentTopologyOptions,
): DeploymentTopology {
  return new DeploymentTopology(options);
}