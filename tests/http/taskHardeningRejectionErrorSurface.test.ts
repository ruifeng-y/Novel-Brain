import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createNovelBrainServer } from "../../src/http/server";
import type { ApiDependencies } from "../../src/http/routes";
import { ApiRequestValidationError } from "../../src/http/productionApiBoundary";
import { rejectionPayload, rejectionStatus } from "../../src/http/rejectionStatus";
import type { ProductionConfiguration } from "../../src/platform/productionConfiguration";
import { createProductionHttpBoundaryPipeline } from "../../src/platform/productionSecurityProvider";
import {
  RateLimitError,
  ResourceIsolationError,
  SecretAccessError,
  SecurityAuthenticationError,
  SecurityAuthorizationError,
} from "../../src/platform/securityBoundary";

const novelId = "novel-1";
const otherNovelId = "novel-2";
const authorToken = "author-token";

const configuration: ProductionConfiguration = Object.freeze({
  databaseUrl: "postgresql://localhost/app",
  applicationPort: 8080,
  publicOrigin: "https://app.example",
  workerConcurrency: 1,
  logLevel: "error",
});

function securityEnv(rateLimit = 2): Record<string, string> {
  return {
    NB_SECURITY_PRINCIPALS: JSON.stringify([
      {
        token: authorToken,
        subjectId: "author-1",
        accountId: "account-1",
        workspaceIds: [novelId],
        roles: ["author"],
      },
    ]),
    NB_SECURITY_RATE_LIMIT: String(rateLimit),
    NB_SECURITY_SECRETS: JSON.stringify({ "novel-1:provider-a": "provider-a-secret" }),
  };
}

function harness(options: { rateLimit?: number } = {}) {
  const dependencies = createInMemoryEngineDependencies();
  const pipeline = createProductionHttpBoundaryPipeline(
    configuration,
    securityEnv(options.rateLimit),
  );
  const app = createNovelBrainServer(dependencies, { httpBoundaryPipeline: pipeline });
  return { app, dependencies };
}

const authenticated = {
  "x-author-id": authorToken,
  "x-workspace-id": novelId,
};

describe("[task:Hardening-B] [domain] rejection status mapping", () => {
  it("maps each platform rejection to its transport status", () => {
    expect(rejectionStatus(new SecurityAuthenticationError("unknown credential"))).toBe(401);
    expect(rejectionStatus(new SecurityAuthorizationError("denied"))).toBe(403);
    expect(rejectionStatus(new ResourceIsolationError("out of scope"))).toBe(403);
    expect(rejectionStatus(new SecretAccessError("outside permitted scope"))).toBe(403);
    expect(rejectionStatus(new RateLimitError("budget spent"))).toBe(429);
    expect(rejectionStatus(new ApiRequestValidationError([{ code: "custom", message: "bad" }]))).toBe(
      400,
    );
    expect(rejectionStatus(new Error("genuine unexpected failure"))).toBeUndefined();
  });

  it("never places a secret value in a rejection body", () => {
    const body = rejectionPayload(new SecretAccessError("secret is not configured: novel-1:provider-a"), 403);
    expect(body.error).toBe("Forbidden");
    expect(JSON.stringify(body)).not.toContain("provider-a-secret");
    expect(JSON.stringify(body)).toContain("novel-1:provider-a");
  });
});

describe("[task:Hardening-B] [integration] rejection error surface", () => {
  it("rejects an unknown credential with 401", async () => {
    const { app } = harness();
    const response = await app.inject({
      method: "GET",
      url: `/workspace/${novelId}`,
      headers: { "x-author-id": "unknown-token" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("Unauthorized");
  });

  it("spends the rate limit budget before authentication and answers 429", async () => {
    const { app } = harness({ rateLimit: 2 });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: "GET",
        url: `/workspace/${novelId}`,
        headers: { "x-author-id": "unknown-token" },
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: "GET",
      url: `/workspace/${novelId}`,
      headers: { "x-author-id": "unknown-token" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe("Too Many Requests");
  });

  it("rejects a principal that is out of workspace scope with 403", async () => {
    const { app } = harness();
    const response = await app.inject({
      method: "GET",
      url: `/workspace/${otherNovelId}`,
      headers: { "x-author-id": authorToken },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("Forbidden");
  });

  it("rejects starting a run from an unapproved plan revision with 409", async () => {
    const { app } = harness();

    const created = await app.inject({
      method: "POST",
      url: "/run-plans",
      headers: authenticated,
      payload: {
        id: "plan-revision-1",
        planId: "plan-1",
        novelId,
        revisionNumber: 1,
        goal: "Draft the opening arc",
        steps: [
          { id: "step-1", ordinal: 1, generationTaskId: "generation-task-1", dependsOn: [] },
        ],
      },
    });
    expect(created.statusCode).toBe(201);

    const started = await app.inject({
      method: "POST",
      url: "/runs",
      headers: authenticated,
      payload: { id: "run-1", novelId, runPlanRevisionId: "plan-revision-1" },
    });

    expect(started.statusCode).toBe(409);
    expect(started.json().error).toBe("Run Plan Revision is not approved");
  });

  it("answers 404 for an unknown plan revision on the approval route", async () => {
    const { app } = harness();
    const response = await app.inject({
      method: "POST",
      url: "/run-plans/missing-plan-revision/approvals",
      headers: authenticated,
      payload: { approvalId: "approval-1", approvedBy: "author-1", evidenceReferences: ["e1"] },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("Run Plan Revision not found");
  });

  it("answers 404 for an unknown run on status, pause and resume", async () => {
    const { app } = harness();

    const status = await app.inject({
      method: "GET",
      url: "/runs/missing-run/status",
      headers: authenticated,
    });
    expect(status.statusCode).toBe(404);

    const paused = await app.inject({
      method: "POST",
      url: "/runs/missing-run/pause",
      headers: authenticated,
      payload: {},
    });
    expect(paused.statusCode).toBe(404);

    const resumed = await app.inject({
      method: "POST",
      url: "/runs/missing-run/resume",
      headers: authenticated,
      payload: {},
    });
    expect(resumed.statusCode).toBe(404);
  });

  it("keeps malformed input at 400", async () => {
    const { app } = harness();
    const response = await app.inject({
      method: "POST",
      url: "/novels",
      headers: authenticated,
      payload: { authorId: "author-1" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("keeps a genuine unexpected failure at 500", async () => {
    const dependencies = createInMemoryEngineDependencies();
    const broken: ApiDependencies = {
      ...dependencies,
      novels: {
        save: (novel) => dependencies.novels.save(novel),
        listByNovel: (id) => dependencies.novels.listByNovel(id),
        findById: async () => {
          throw new Error("persistence exploded");
        },
      },
    };
    const pipeline = createProductionHttpBoundaryPipeline(configuration, securityEnv());
    const app = createNovelBrainServer(broken, { httpBoundaryPipeline: pipeline });

    const response = await app.inject({
      method: "POST",
      url: `/novels/${novelId}/scenes`,
      headers: { "x-author-id": authorToken },
      payload: { id: "scene-1", chapterId: "chapter-1", title: "Opening" },
    });

    expect(response.statusCode).toBe(500);
  });
});
