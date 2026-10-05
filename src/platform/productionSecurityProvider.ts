import {
  createPlatformSecurityBoundary,
  redactSensitiveValues,
  SecretAccessError,
  type PlatformSecurityBoundary,
  type RateLimiter,
  type SecurityPrincipal,
} from "./securityBoundary";
import {
  createPlatformObservabilityBoundary,
  type LogLevel,
  type PlatformObservabilityBoundary,
} from "./observabilityBoundary";
import {
  createHttpBoundaryPipeline,
  type HttpBoundaryPipeline,
} from "../http/httpBoundaryPipeline";
import { createProductRequestValidators } from "../http/productRequestSchemas";
import type { ProductionConfiguration } from "./productionConfiguration";

export type ProductionSecurityEnvironment = Readonly<Record<string, string | undefined>>;

export interface ProductionSecurityPrincipal {
  readonly token: string;
  readonly subjectId: string;
  readonly accountId: string;
  readonly workspaceIds: readonly string[];
  readonly roles: readonly string[];
}

/**
 * Deployment-supplied security facts. Principals are addressed by credential
 * token, secrets are addressed as `<workspaceId>:<key>`, and the rate limit is
 * the per credential/action budget consumed before authentication runs.
 */
export interface ProductionSecurityConfiguration {
  readonly principals: readonly ProductionSecurityPrincipal[];
  readonly rateLimit: number;
  readonly secrets: Readonly<Record<string, string>>;
}

const principalsVariable = "NB_SECURITY_PRINCIPALS";
const rateLimitVariable = "NB_SECURITY_RATE_LIMIT";
const secretsVariable = "NB_SECURITY_SECRETS";

function requiredText(env: ProductionSecurityEnvironment, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function parseJson(env: ProductionSecurityEnvironment, key: string): unknown {
  const source = requiredText(env, key);
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error(`${key} must be valid JSON`);
  }
}

function recordAt(value: unknown, address: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${address} must be an object`);
  }
  return value as Record<string, unknown>;
}

function textAt(value: unknown, address: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${address} must be a non-empty string`);
  }
  return value.trim();
}

function textListAt(value: unknown, address: string, requireEntry: boolean): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${address} must be an array of strings`);
  }
  if (requireEntry && value.length === 0) {
    throw new Error(`${address} must be a non-empty array of strings`);
  }
  return value.map((entry, index) => textAt(entry, `${address}[${index}]`));
}

function parsePrincipals(env: ProductionSecurityEnvironment): readonly ProductionSecurityPrincipal[] {
  const parsed = parseJson(env, principalsVariable);
  if (!Array.isArray(parsed)) {
    throw new Error(`${principalsVariable} must be a JSON array of principals`);
  }

  const tokens = new Set<string>();
  const subjectIds = new Set<string>();
  return parsed.map((entry, index) => {
    const address = `${principalsVariable}[${index}]`;
    const record = recordAt(entry, `${address} must be a principal object`);
    const token = textAt(record.token, `${address}.token`);
    const subjectId = textAt(record.subjectId, `${address}.subjectId`);
    const accountId = textAt(record.accountId, `${address}.accountId`);
    const workspaceIds = textListAt(record.workspaceIds, `${address}.workspaceIds`, true);
    const roles = textListAt(record.roles, `${address}.roles`, false);

    if (tokens.has(token)) {
      throw new Error(`${principalsVariable} contains a duplicate token: ${token}`);
    }
    // Isolation resolves the caller by subject id, so the mapping must stay a
    // function: two principals sharing a subject id would make scope ambiguous.
    if (subjectIds.has(subjectId)) {
      throw new Error(`${principalsVariable} contains a duplicate subjectId: ${subjectId}`);
    }
    tokens.add(token);
    subjectIds.add(subjectId);

    return Object.freeze({
      token,
      subjectId,
      accountId,
      workspaceIds: Object.freeze([...workspaceIds]),
      roles: Object.freeze([...roles]),
    });
  });
}

function parseRateLimit(env: ProductionSecurityEnvironment): number {
  const source = requiredText(env, rateLimitVariable);
  if (!/^\d+$/.test(source)) {
    throw new Error(`${rateLimitVariable} must be a positive integer`);
  }
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${rateLimitVariable} must be a positive integer`);
  }
  return parsed;
}

function parseSecrets(env: ProductionSecurityEnvironment): Readonly<Record<string, string>> {
  const parsed = parseJson(env, secretsVariable);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${secretsVariable} must be a JSON object addressed as workspace:key`);
  }

  const secrets: Record<string, string> = {};
  for (const [address, value] of Object.entries(parsed as Record<string, unknown>)) {
    const separator = address.indexOf(":");
    const workspaceId = separator === -1 ? "" : address.slice(0, separator).trim();
    const key = separator === -1 ? "" : address.slice(separator + 1).trim();
    if (workspaceId.length === 0 || key.length === 0) {
      throw new Error(`${secretsVariable} entries must be addressed as workspace:key: ${address}`);
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `${secretsVariable} entries must be addressed as workspace:key with a non-empty value: ${address}`,
      );
    }
    // Store under the same normalized address the resolver composes, so a
    // padded environment entry cannot become an unreachable secret.
    const normalized = `${workspaceId}:${key}`;
    if (secrets[normalized] !== undefined) {
      throw new Error(`${secretsVariable} contains a duplicate secret address: ${normalized}`);
    }
    secrets[normalized] = value;
  }
  return Object.freeze(secrets);
}

export function parseProductionSecurityConfiguration(
  env: ProductionSecurityEnvironment,
): ProductionSecurityConfiguration {
  const principals = parsePrincipals(env);
  const rateLimit = parseRateLimit(env);
  const secrets = parseSecrets(env);
  return Object.freeze({ principals, rateLimit, secrets });
}

function primaryWorkspaceId(principal: ProductionSecurityPrincipal): string {
  const workspaceId = principal.workspaceIds[0];
  if (workspaceId === undefined) {
    throw new Error(`principal ${principal.subjectId} has no workspace id`);
  }
  return workspaceId;
}

function toSecurityPrincipal(principal: ProductionSecurityPrincipal): SecurityPrincipal {
  return {
    id: principal.subjectId,
    accountId: principal.accountId,
    workspaceId: primaryWorkspaceId(principal),
    roles: principal.roles,
  };
}

const rateLimitWindowMs = 60_000;

/**
 * Fixed-window budget keyed by the credential/action pair the security
 * boundary derives. The budget is spent on every attempt, including attempts
 * that later fail authentication, so a caller cannot retry unknown tokens for
 * free.
 */
function createProductionRateLimiter(limit: number, now: () => Date): RateLimiter {
  const usage = new Map<string, { count: number; resetAt: number }>();
  return {
    limit,
    consume({ key }) {
      const current = now().getTime();
      const existing = usage.get(key);
      if (existing === undefined || existing.resetAt <= current) {
        const resetAt = current + rateLimitWindowMs;
        usage.set(key, { count: 1, resetAt });
        return {
          allowed: true,
          remaining: Math.max(0, limit - 1),
          resetAt: new Date(resetAt),
        };
      }
      existing.count += 1;
      return {
        allowed: existing.count <= limit,
        remaining: Math.max(0, limit - existing.count),
        resetAt: new Date(existing.resetAt),
      };
    },
  };
}

function buildProductionSecurityBoundary(
  configuration: ProductionSecurityConfiguration,
  now: () => Date,
): PlatformSecurityBoundary {
  const principalsByToken = new Map(
    configuration.principals.map(principal => [principal.token, principal] as const),
  );
  const principalsBySubjectId = new Map(
    configuration.principals.map(principal => [principal.subjectId, principal] as const),
  );

  return createPlatformSecurityBoundary({
    authentication: {
      authenticate: ({ credentials }) => {
        const principal = principalsByToken.get(credentials.token);
        if (principal === undefined) {
          return { authenticated: false, reason: "unknown credential token" };
        }
        return { authenticated: true, principal: toSecurityPrincipal(principal) };
      },
    },
    authorization: {
      // Authentication already bound the caller to a configured principal;
      // workspace scope is enforced by isolation and secrets by scope checks.
      authorize: () => ({ allowed: true }),
    },
    resourceIsolation: {
      inspect: ({ principal, resource }) => {
        const configured = principalsBySubjectId.get(principal.id);
        if (configured === undefined) {
          return { allowed: false, reason: `unknown principal ${principal.id}` };
        }
        if (!configured.workspaceIds.includes(resource.workspaceId)) {
          return {
            allowed: false,
            reason: `principal ${principal.id} is not scoped to workspace ${resource.workspaceId}`,
          };
        }
        return { allowed: true };
      },
    },
    secrets: {
      resolve: async ({ reference }) => {
        const address = `${reference.workspaceId}:${reference.key}`;
        const value = configuration.secrets[address];
        if (value === undefined) {
          throw new SecretAccessError(`secret is not configured: ${address}`);
        }
        return value;
      },
    },
    rateLimiter: createProductionRateLimiter(configuration.rateLimit, now),
  });
}

function isSecurityConfiguration(value: unknown): value is ProductionSecurityConfiguration {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { principals?: unknown }).principals)
  );
}

/**
 * Builds the deployment security boundary from either a parsed configuration
 * or the raw environment. Raw environments are parsed eagerly so a malformed
 * deployment fails before any request is served.
 */
export function createProductionSecurityBoundary(
  input: ProductionSecurityConfiguration | ProductionSecurityEnvironment,
): PlatformSecurityBoundary {
  const configuration = isSecurityConfiguration(input)
    ? input
    : parseProductionSecurityConfiguration(input);
  return buildProductionSecurityBoundary(configuration, () => new Date());
}

const logLevelRank: Readonly<Record<LogLevel, number>> = Object.freeze({
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
});

/**
 * Structured logs go to stderr, filtered by the deployment log level, and
 * secret-bearing fields are redacted before they can reach the log stream.
 */
function createProductionObservabilityBoundary(
  minimumLevel: LogLevel,
): PlatformObservabilityBoundary {
  let eventCount = 0;
  return createPlatformObservabilityBoundary({
    sink: event => {
      if (event.kind !== "log") return;
      if (logLevelRank[event.level] > logLevelRank[minimumLevel]) return;
      process.stderr.write(
        `${JSON.stringify({
          level: event.level,
          message: event.message,
          fields: redactSensitiveValues(event.fields),
        })}\n`,
      );
    },
    now: () => new Date(),
    idGenerator: () => `production-event-${(eventCount += 1)}`,
  });
}

export function createProductionHttpBoundaryPipeline(
  configuration: ProductionConfiguration,
  env: ProductionSecurityEnvironment,
): HttpBoundaryPipeline {
  return createHttpBoundaryPipeline({
    security: createProductionSecurityBoundary(env),
    observability: createProductionObservabilityBoundary(configuration.logLevel),
    validators: createProductRequestValidators(),
  });
}
