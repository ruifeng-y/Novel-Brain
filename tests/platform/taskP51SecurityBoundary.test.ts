import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preProcessFile } from "typescript";
import { describe, expect, it } from "vitest";
import {
  createPlatformSecurityBoundary,
  redactSensitiveValues,
  securityBoundaryContract,
  RateLimitError,
  ResourceIsolationError,
  SecurityAuthenticationError,
  type AuthorizationInput,
  type PlatformSecurityBoundaryOptions,
  type SecurityRequest,
} from "../../src/platform/securityBoundary";

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

const author = {
  id: "user-1",
  accountId: "account-1",
  workspaceId: "workspace-1",
  roles: ["author"],
};

function createRateLimiter(limit: number): PlatformSecurityBoundaryOptions["rateLimiter"] {
  const usage = new Map<string, number>();
  return {
    limit,
    consume({ key, limit: requestLimit }) {
      const count = (usage.get(key) ?? 0) + 1;
      usage.set(key, count);
      return {
        allowed: count <= requestLimit,
        remaining: Math.max(0, requestLimit - count),
        resetAt: new Date("2026-10-05T12:00:00.000Z"),
      };
    },
  };
}
function defaultOptions(
  overrides: Partial<PlatformSecurityBoundaryOptions> = {},
): PlatformSecurityBoundaryOptions {
  return {
    authentication: {
      authenticate: ({ credentials }) =>
        credentials.token === "valid-token"
          ? { authenticated: true, principal: author }
          : { authenticated: false, reason: "invalid credentials" },
    },
    authorization: {
      authorize: ({ principal, action }) => ({
        allowed: principal.roles.includes("author") && action.operation !== "secret",
      }),
    },
    resourceIsolation: {
      inspect: ({ principal, resource }) => ({
        allowed:
          principal.accountId === "account-1" &&
          principal.workspaceId === resource.workspaceId,
      }),
    },
    secrets: {
      resolve: ({ reference }) => Promise.resolve(`secret:${reference.key}`),
    },
    rateLimiter: createRateLimiter(2),
    ...overrides,
  };
}

function request(overrides: Partial<SecurityRequest> = {}): SecurityRequest {
  return {
    requestId: "request-1",
    credentials: { token: "valid-token" },
    action: {
      id: "run.command.start-run",
      operation: "command",
      resource: { id: "run-1", kind: "run", workspaceId: "workspace-1" },
    },
    ...overrides,
  };
}

describe("[task:P5.1] [domain] Platform security boundary ownership", () => {
  it("owns AuthN/AuthZ, isolation, secrets, rates, and abuse controls outside Novel Domain", () => {
    expect(securityBoundaryContract).toEqual({
      id: "platform.security.boundary",
      owner: "platform-security",
      authentication: "required",
      authorization: "required",
      resourceIsolation: "required",
      secretManagement: "platform-security",
      rateLimiting: "platform-security",
      abuseProtection: "platform-security",
      novelDomainOwnership: false,
    });
    const entry = fileURLToPath(new URL("../../src/platform/securityBoundary.ts", import.meta.url));
    expect(domainImports(entry)).toEqual([]);
  });
});

describe("[task:P5.1] [integration] AuthN and AuthZ hooks", () => {
  it("authenticates the caller and authorizes the exact protected action", async () => {
    const authorizationInputs: AuthorizationInput[] = [];
    const boundary = createPlatformSecurityBoundary(
      defaultOptions({
        authorization: {
          authorize: input => {
            authorizationInputs.push(input);
            return { allowed: input.principal.id === "user-1" };
          },
        },
      }),
    );

    const permit = await boundary.protect(request());

    expect(permit).toEqual({
      requestId: "request-1",
      principal: author,
      action: request().action,
      rateLimit: {
        allowed: true,
        remaining: 1,
        resetAt: new Date("2026-10-05T12:00:00.000Z"),
      },
    });
    expect(authorizationInputs).toEqual([
      { requestId: "request-1", principal: author, action: request().action },
    ]);
    await expect(
      boundary.protect(request({ credentials: { token: "invalid" } })),
    ).rejects.toBeInstanceOf(SecurityAuthenticationError);
    expect(authorizationInputs).toHaveLength(1);
  });
});

describe("[task:P5.1] [integration] AuthZ denial", () => {
  it("rejects authenticated callers when the action-level authorization hook denies access", async () => {
    const boundary = createPlatformSecurityBoundary(
      defaultOptions({
        authorization: {
          authorize: () => ({ allowed: false, reason: "role not permitted" }),
        },
      }),
    );

    await expect(boundary.protect(request())).rejects.toMatchObject({
      name: "SecurityAuthorizationError",
      message: "role not permitted",
    });
  });
});
describe("[task:P5.1] [cross-system] Resource isolation", () => {
  it("rejects cross-workspace resources before authorization or execution", async () => {
    let authorizationCalls = 0;
    const boundary = createPlatformSecurityBoundary(
      defaultOptions({
        authorization: {
          authorize: () => {
            authorizationCalls += 1;
            return { allowed: true };
          },
        },
      }),
    );

    await expect(
      boundary.protect(
        request({
          action: {
            id: "run.query.run-status",
            operation: "query",
            resource: { id: "run-other", kind: "run", workspaceId: "workspace-2" },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ResourceIsolationError);
    expect(authorizationCalls).toBe(0);
  });
});

describe("[task:P5.1] [integration] Secret management", () => {
  it("resolves only scoped secrets and redacts secret-bearing diagnostics", async () => {
    const boundary = createPlatformSecurityBoundary(
      defaultOptions({ authorization: { authorize: () => ({ allowed: true }) } }),
    );
    const permit = await boundary.protect(
      request({
        action: {
          id: "secret.read.provider-token",
          operation: "secret",
          resource: { id: "provider-token", kind: "secret", workspaceId: "workspace-1" },
        },
      }),
    );

    await expect(
      boundary.resolveSecret(permit, {
        key: "other-workspace-token",
        workspaceId: "workspace-2",
      }),
    ).rejects.toMatchObject({ name: "SecretAccessError" });
    await expect(
      boundary.resolveSecret(permit, {
        key: "other-key",
        workspaceId: "workspace-1",
      }),
    ).rejects.toMatchObject({ name: "SecretAccessError" });
    expect(
      await boundary.resolveSecret(permit, {
        key: "provider-token",
        workspaceId: "workspace-1",
      }),
    ).toBe("secret:provider-token");
    expect(
      redactSensitiveValues({
        authorization: "Bearer visible",
        nested: { apiKey: "secret:provider-token", safe: "value" },
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", safe: "value" },
    });
  });
});

describe("[task:P5.1] [concurrency] Rate limits and abuse protection", () => {
  it("rejects repeated invalid authentication after the rate budget is exhausted", async () => {
    const boundary = createPlatformSecurityBoundary(defaultOptions());

    await expect(
      boundary.protect(request({ credentials: { token: "invalid" } })),
    ).rejects.toBeInstanceOf(SecurityAuthenticationError);
    await expect(
      boundary.protect(request({ credentials: { token: "invalid" } })),
    ).rejects.toBeInstanceOf(SecurityAuthenticationError);
    await expect(
      boundary.protect(request({ credentials: { token: "invalid" } })),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("limits repeated actions per principal without limiting unrelated actions", async () => {
    const boundary = createPlatformSecurityBoundary(defaultOptions());
    const unrelated = request({
      action: {
        id: "run.command.pause-run",
        operation: "command",
        resource: { id: "run-1", kind: "run", workspaceId: "workspace-1" },
      },
    });

    const first = await boundary.protect(request());
    const second = await boundary.protect(request());
    await expect(boundary.protect(request())).rejects.toBeInstanceOf(RateLimitError);
    const other = await boundary.protect(unrelated);

    expect(first.rateLimit.remaining).toBe(1);
    expect(second.rateLimit.remaining).toBe(0);
    expect(other.rateLimit.remaining).toBe(1);
  });
});
