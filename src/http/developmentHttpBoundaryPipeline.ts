import { createPlatformObservabilityBoundary } from "../platform/observabilityBoundary";
import { createPlatformSecurityBoundary } from "../platform/securityBoundary";
import {
  createHttpBoundaryPipeline,
  type HttpBoundaryPipeline,
} from "./httpBoundaryPipeline";
import { createProductRequestValidators } from "./productRequestSchemas";

const developmentRateLimit = Number.MAX_SAFE_INTEGER;

/**
 * Boundary used when the server runs without an injected production pipeline.
 * It keeps the single request path (rate limit -> authentication -> isolation
 * -> authorization -> validation -> idempotency -> handler -> observability)
 * intact while allowing local and in-memory composition roots.
 */
export function createDevelopmentHttpBoundaryPipeline(): HttpBoundaryPipeline {
  let eventCount = 0;
  const observability = createPlatformObservabilityBoundary({
    sink: () => undefined,
    now: () => new Date(),
    idGenerator: () => `development-event-${(eventCount += 1)}`,
  });
  const security = createPlatformSecurityBoundary({
    authentication: {
      authenticate: ({ credentials }) => ({
        authenticated: true,
        principal: {
          id: credentials.token,
          accountId: "development",
          workspaceId: "development",
          roles: ["development"],
        },
      }),
    },
    authorization: {
      authorize: () => ({ allowed: true }),
    },
    resourceIsolation: {
      inspect: () => ({ allowed: true }),
    },
    secrets: {
      resolve: async () => {
        throw new Error("development secret provider does not expose secrets");
      },
    },
    rateLimiter: {
      limit: developmentRateLimit,
      consume: () => ({
        allowed: true,
        remaining: developmentRateLimit,
        resetAt: new Date(),
      }),
    },
  });
  return createHttpBoundaryPipeline({
    security,
    observability,
    validators: createProductRequestValidators(),
  });
}
