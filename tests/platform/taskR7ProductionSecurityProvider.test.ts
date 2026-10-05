import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createPrismaEngineServer } from "../../src/app/prismaComposition";
import type { HttpBoundaryContext } from "../../src/http/httpBoundaryPipeline";
import {
  RateLimitError,
  ResourceIsolationError,
  SecretAccessError,
  SecurityAuthenticationError,
} from "../../src/platform/securityBoundary";
import type { ProductionConfiguration } from "../../src/platform/productionConfiguration";
import {
  createProductionHttpBoundaryPipeline,
  createProductionSecurityBoundary,
  parseProductionSecurityConfiguration,
} from "../../src/platform/productionSecurityProvider";
import { createDeploymentProcessBootstrap } from "../../scripts/productionProcessComposition";

const principals = [
  {
    token: "author-token",
    subjectId: "author-1",
    accountId: "account-1",
    workspaceIds: ["novel-1"],
    roles: ["author"],
  },
];

const securityEnv: Record<string, string> = {
  NB_SECURITY_PRINCIPALS: JSON.stringify(principals),
  NB_SECURITY_RATE_LIMIT: "2",
  NB_SECURITY_SECRETS: JSON.stringify({
    "novel-1:provider-a": "provider-a-secret",
    "novel-1:provider-b": "provider-b-secret",
  }),
};

const configuration: ProductionConfiguration = Object.freeze({
  databaseUrl: "postgresql://localhost/app",
  applicationPort: 8080,
  publicOrigin: "https://app.example",
  workerConcurrency: 2,
  logLevel: "error",
});

const workspaceFocusContract = "foundation.query.workspace-focus";

let requestCounter = 0;

function boundaryContext(subjectId: string, workspaceId: string): HttpBoundaryContext {
  const requestId = `request-${(requestCounter += 1)}`;
  return {
    requestId,
    principal: { subjectId, workspaceId },
    resource: { kind: "workspace", id: workspaceId },
    correlation: {
      requestId,
      traceId: `${requestId}-trace`,
      auditId: `${requestId}-audit`,
    },
  };
}

describe("[task:R7] [domain] production security configuration", () => {
  it("parses principals, rate limit and secrets from the environment", () => {
    expect(parseProductionSecurityConfiguration(securityEnv)).toEqual({
      principals,
      rateLimit: 2,
      secrets: {
        "novel-1:provider-a": "provider-a-secret",
        "novel-1:provider-b": "provider-b-secret",
      },
    });
  });

  it("fails fast when security configuration is missing or malformed", () => {
    expect(() => parseProductionSecurityConfiguration({})).toThrow(
      "NB_SECURITY_PRINCIPALS is required",
    );
    expect(() =>
      parseProductionSecurityConfiguration({ NB_SECURITY_PRINCIPALS: "{" }),
    ).toThrow("NB_SECURITY_PRINCIPALS must be valid JSON");
    expect(() =>
      parseProductionSecurityConfiguration({ NB_SECURITY_PRINCIPALS: "[]" }),
    ).toThrow("NB_SECURITY_RATE_LIMIT is required");
    expect(() =>
      parseProductionSecurityConfiguration({
        NB_SECURITY_PRINCIPALS: "[]",
        NB_SECURITY_RATE_LIMIT: "0",
      }),
    ).toThrow("NB_SECURITY_RATE_LIMIT must be a positive integer");
    expect(() =>
      parseProductionSecurityConfiguration({
        NB_SECURITY_PRINCIPALS: "[]",
        NB_SECURITY_RATE_LIMIT: "2",
      }),
    ).toThrow("NB_SECURITY_SECRETS is required");
    expect(() =>
      parseProductionSecurityConfiguration({
        NB_SECURITY_PRINCIPALS: "[]",
        NB_SECURITY_RATE_LIMIT: "2",
        NB_SECURITY_SECRETS: "not-json",
      }),
    ).toThrow("NB_SECURITY_SECRETS must be valid JSON");
  });

  it("fails fast when a principal entry is incomplete or duplicated", () => {
    const parse = (value: unknown) =>
      parseProductionSecurityConfiguration({
        ...securityEnv,
        NB_SECURITY_PRINCIPALS: JSON.stringify(value),
      });

    expect(() => parse([{ token: "author-token" }])).toThrow(/principal/i);
    expect(() => parse([{ ...principals[0], workspaceIds: [] }])).toThrow(/principal/i);
    expect(() => parse([{ ...principals[0], roles: "author" }])).toThrow(/principal/i);
    expect(() => parse([principals[0], principals[0]])).toThrow(/duplicate/i);
  });

  it("fails fast when a secret entry is not addressed as workspace:key", () => {
    expect(() =>
      parseProductionSecurityConfiguration({
        ...securityEnv,
        NB_SECURITY_SECRETS: JSON.stringify({ "novel-1": "value" }),
      }),
    ).toThrow(/workspace:key/i);
    expect(() =>
      parseProductionSecurityConfiguration({
        ...securityEnv,
        NB_SECURITY_SECRETS: JSON.stringify({ "novel-1:provider-a": "" }),
      }),
    ).toThrow(/workspace:key/i);
  });

  it("normalizes secret addresses so a padded entry stays resolvable", () => {
    expect(
      parseProductionSecurityConfiguration({
        ...securityEnv,
        NB_SECURITY_SECRETS: JSON.stringify({ " novel-1 : provider-a ": "padded-secret" }),
      }).secrets,
    ).toEqual({ "novel-1:provider-a": "padded-secret" });
  });
});

describe("[task:R7] [integration] production security boundary", () => {
  it("rejects an unknown token", async () => {
    const boundary = createProductionSecurityBoundary(securityEnv);

    await expect(
      boundary.protect({
        requestId: "request-unknown",
        credentials: { token: "unknown-token" },
        action: {
          id: workspaceFocusContract,
          operation: "query",
          resource: { id: "novel-1", kind: "workspace", workspaceId: "novel-1" },
        },
      }),
    ).rejects.toBeInstanceOf(SecurityAuthenticationError);
  });

  it("resolves only secrets inside the permitted workspace and key scope", async () => {
    const boundary = createProductionSecurityBoundary(securityEnv);
    const permit = await boundary.protect({
      requestId: "request-secret",
      credentials: { token: "author-token" },
      action: {
        id: "provider-a",
        operation: "secret",
        resource: { id: "provider-a", kind: "secret", workspaceId: "novel-1" },
      },
    });

    await expect(
      boundary.resolveSecret(permit, { key: "provider-b", workspaceId: "novel-1" }),
    ).rejects.toBeInstanceOf(SecretAccessError);
    await expect(
      boundary.resolveSecret(permit, { key: "provider-a", workspaceId: "novel-2" }),
    ).rejects.toBeInstanceOf(SecretAccessError);
    await expect(
      boundary.resolveSecret(permit, { key: "unconfigured", workspaceId: "novel-1" }),
    ).rejects.toBeInstanceOf(SecretAccessError);
    expect(
      await boundary.resolveSecret(permit, { key: "provider-a", workspaceId: "novel-1" }),
    ).toBe("provider-a-secret");
  });

  it("refuses to resolve a secret through a non-secret permit", async () => {
    const boundary = createProductionSecurityBoundary(securityEnv);
    const permit = await boundary.protect({
      requestId: "request-query",
      credentials: { token: "author-token" },
      action: {
        id: workspaceFocusContract,
        operation: "query",
        resource: { id: "novel-1", kind: "workspace", workspaceId: "novel-1" },
      },
    });

    await expect(
      boundary.resolveSecret(permit, { key: "provider-a", workspaceId: "novel-1" }),
    ).rejects.toBeInstanceOf(SecretAccessError);
  });
});

describe("[task:R7] [integration] production HTTP boundary pipeline", () => {
  it("executes the handler for a configured principal inside its workspace", async () => {
    const pipeline = createProductionHttpBoundaryPipeline(configuration, securityEnv);

    await expect(
      pipeline.execute(
        workspaceFocusContract,
        boundaryContext("author-token", "novel-1"),
        { params: { novelId: "novel-1" } },
        async () => "workspace-view",
      ),
    ).resolves.toBe("workspace-view");
  });

  it("consumes the rate budget before rejecting an unknown token", async () => {
    const pipeline = createProductionHttpBoundaryPipeline(configuration, securityEnv);
    const attempt = () =>
      pipeline.execute(
        workspaceFocusContract,
        boundaryContext("unknown-token", "novel-1"),
        { params: { novelId: "novel-1" } },
        async () => "never",
      );

    await expect(attempt()).rejects.toBeInstanceOf(SecurityAuthenticationError);
    await expect(attempt()).rejects.toBeInstanceOf(SecurityAuthenticationError);
    await expect(attempt()).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("[task:R7] [cross-system] production process security wiring", () => {
  it("rejects a principal acting outside its workspace ids", async () => {
    const pipeline = createProductionHttpBoundaryPipeline(configuration, securityEnv);

    await expect(
      pipeline.execute(
        workspaceFocusContract,
        boundaryContext("author-token", "novel-2"),
        { params: { novelId: "novel-2" } },
        async () => "never",
      ),
    ).rejects.toBeInstanceOf(ResourceIsolationError);
  });

  it("injects the production boundary pipeline into the Prisma engine server", () => {
    const pipeline = createProductionHttpBoundaryPipeline(configuration, securityEnv);
    const server = createPrismaEngineServer({} as PrismaClient, {
      httpBoundaryPipeline: pipeline,
    });

    expect(server.httpBoundaryPipeline).toBe(pipeline);
  });
});

describe("[task:R7] [regression] production composition refuses the development pipeline", () => {
  it("fails fast when the application role has no security configuration", () => {
    expect(() => createDeploymentProcessBootstrap("application", configuration, {})).toThrow(
      "NB_SECURITY_PRINCIPALS is required",
    );
    expect(() =>
      createDeploymentProcessBootstrap("application", configuration, securityEnv),
    ).not.toThrow();
    expect(() => createDeploymentProcessBootstrap("worker", configuration, {})).not.toThrow();
  });

  it("never falls back to the development pipeline in the production composition", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../scripts/productionProcessComposition.ts", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("createProductionHttpBoundaryPipeline");
    expect(source).not.toContain("createDevelopmentHttpBoundaryPipeline");
    expect(source).toMatch(/createPrismaEngineServer\([\s\S]*?httpBoundaryPipeline/);
  });
});
