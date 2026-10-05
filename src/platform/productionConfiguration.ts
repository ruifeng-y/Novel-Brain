export interface ProductionConfiguration {
  readonly databaseUrl: string;
  readonly applicationPort: number;
  readonly publicOrigin: string;
  readonly workerConcurrency: number;
  readonly logLevel: "error" | "warn" | "info" | "debug";
}

const logLevels = new Set(["error", "warn", "info", "debug"]);

function required(env: Readonly<Record<string, string | undefined>>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function integerInRange(
  value: string,
  key: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^\d+$/.test(value)) throw new Error(`${key} must be an integer`);
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${key} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function parseProductionConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): ProductionConfiguration {
  const databaseUrl = required(env, "DATABASE_URL");
  const applicationPortValue = required(env, "APPLICATION_PORT");
  const publicOrigin = required(env, "PUBLIC_ORIGIN");
  const workerConcurrencyValue = required(env, "WORKER_CONCURRENCY");
  const logLevel = required(env, "LOG_LEVEL");

  const applicationPort = integerInRange(applicationPortValue, "APPLICATION_PORT", 1, 65535);
  const workerConcurrency = integerInRange(
    workerConcurrencyValue,
    "WORKER_CONCURRENCY",
    1,
    64,
  );

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(publicOrigin);
  } catch {
    throw new Error("PUBLIC_ORIGIN must be an absolute http or https URL");
  }
  if (
    (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") ||
    parsedOrigin.origin === "null"
  ) {
    throw new Error("PUBLIC_ORIGIN must be an absolute http or https URL");
  }

  if (!logLevels.has(logLevel)) {
    throw new Error("LOG_LEVEL must be one of error, warn, info, debug");
  }

  return Object.freeze({
    databaseUrl,
    applicationPort,
    publicOrigin,
    workerConcurrency,
    logLevel: logLevel as ProductionConfiguration["logLevel"],
  });
}
