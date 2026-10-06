import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createChangeSetRevisionService } from "../../src/app/changeSetRevisionService";
import { createNovelBrainServer } from "../../src/http/server";
import {
  createHttpBoundaryPipeline,
  type HttpBoundaryContext,
  type HttpBoundaryPipeline,
} from "../../src/http/httpBoundaryPipeline";
import { createProductRequestValidators } from "../../src/http/productRequestSchemas";
import { createPlatformObservabilityBoundary } from "../../src/platform/observabilityBoundary";
import { createProductionSecurityBoundary } from "../../src/platform/productionSecurityProvider";
import { createCandidate, type Candidate } from "../../src/production/domain/candidate";
import { createValidationRun } from "../../src/production/domain/validationRun";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import type { ApiDependencies } from "../../src/http/routes";

const NOVEL = "novel-1";
const OTHER_NOVEL = "novel-2";
const authorToken = "w3-gate-token";
const AT = new Date("2026-10-06T00:00:00.000Z");
const authorHeader = { "x-author-id": authorToken };

function harness() {
  const dependencies = createInMemoryEngineDependencies();
  const calls: string[] = [];
  const security = createProductionSecurityBoundary({
    NB_SECURITY_PRINCIPALS: JSON.stringify([
      {
        token: authorToken,
        subjectId: "w3-author-1",
        accountId: "account-1",
        workspaceIds: [NOVEL],
        roles: ["author"],
      },
    ]),
    NB_SECURITY_RATE_LIMIT: "1000",
    NB_SECURITY_SECRETS: "{}",
  });
  const inner = createHttpBoundaryPipeline({
    security,
    observability: createPlatformObservabilityBoundary({
      sink: () => undefined,
      now: () => new Date(),
      idGenerator: () => "w3-gate-event",
    }),
    validators: createProductRequestValidators(),
  });
  const pipeline: HttpBoundaryPipeline = {
    execute<TValue>(
      contractId: string,
      context: HttpBoundaryContext,
      input: unknown,
      handler: (validated: unknown) => Promise<TValue>,
    ): Promise<TValue> {
      calls.push(contractId);
      return inner.execute(contractId, context, input, handler);
    },
  };
  const app = createNovelBrainServer(dependencies, { httpBoundaryPipeline: pipeline });
  return { app, dependencies, calls };
}

function candidateFixture(input: { readonly id: string; readonly novelId?: string }): Candidate {
  return createCandidate({
    id: input.id,
    taskId: `task-${input.id}`,
    novelId: input.novelId ?? NOVEL,
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-1:rev-1"),
    }),
    change: { type: "text", sceneId: "scene-1", text: "第一版文本。" },
    createdAt: AT,
  });
}

async function seedRevision(
  dependencies: ApiDependencies,
  input: {
    readonly novelId?: string;
    readonly candidateId?: string;
    readonly changeSetId?: string;
    readonly revisionId?: string;
    readonly parentRevisionId?: string;
  } = {},
) {
  const novelId = input.novelId ?? NOVEL;
  const candidateId = input.candidateId ?? "candidate-1";
  const candidate = candidateFixture({ id: candidateId, novelId });
  await dependencies.candidates.save(candidate);
  const service = createChangeSetRevisionService({ changeSets: dependencies.changeSets });
  const changeSetId = input.changeSetId ?? "cs-1";
  const revisionId = input.revisionId ?? "cs-1:r1";
  const parent =
    input.parentRevisionId === undefined
      ? undefined
      : await service.getRevision({ changeSetId, revisionId: input.parentRevisionId });
  return service.adoptCandidate({
    candidate,
    changeSetId,
    revisionId,
    ...(parent === undefined ? {} : { parentRevision: parent }),
    createdAt: AT,
  });
}

async function seedRun(
  dependencies: ApiDependencies,
  input: { readonly id: string; readonly revisionId?: string; readonly outcome: "pass" | "fail" },
) {
  await dependencies.validations.saveIfAbsent(
    createValidationRun({
      id: input.id,
      changeSetRevisionId: input.revisionId ?? "cs-1:r1",
      planVersionId: "plan-v1",
      validatorId: "validator-1",
      entryResults: [],
      executionState: "completed",
      outcome: input.outcome,
      createdAt: AT,
    }),
  );
}

const gateUrl = "/change-sets/cs-1/revisions/cs-1:r1/commit-gate";

describe("[task:W3] [integration] commit gate HTTP surface", () => {
  it("reports the five conditions independently for a blocked revision", async () => {
    const { app, dependencies, calls } = harness();
    await seedRevision(dependencies, {});
    await seedRun(dependencies, { id: "run-fail", outcome: "fail" });

    const response = await app.inject({
      method: "GET",
      url: gateUrl,
      headers: authorHeader,
      query: { validationRunIds: "run-fail" },
    });

    expect(response.statusCode).toBe(200);
    const gate = response.json() as {
      allowed: boolean;
      validation: { ok: boolean; reason?: string };
      approval: { ok: boolean };
      revisionValidity: { ok: boolean };
      concurrency: { ok: boolean };
      invariant: { ok: boolean };
      requiredActions: readonly string[];
    };
    expect(gate.allowed).toBe(false);
    expect(gate.validation.ok).toBe(false);
    expect(gate.approval.ok).toBe(true);
    expect(gate.revisionValidity.ok).toBe(true);
    expect(gate.concurrency.ok).toBe(true);
    expect(gate.invariant.ok).toBe(true);
    expect(gate.requiredActions).toContain("fix_validation");
    expect(calls).toContain("commit.query.commit-gate");
    await app.close();
  });

  it("allows a clean revision and reports every condition satisfied", async () => {
    const { app, dependencies } = harness();
    await seedRevision(dependencies, {});
    await seedRun(dependencies, { id: "run-pass", outcome: "pass" });

    const response = await app.inject({
      method: "GET",
      url: gateUrl,
      headers: authorHeader,
      query: { validationRunIds: "run-pass" },
    });

    expect(response.statusCode).toBe(200);
    const gate = response.json() as { allowed: boolean; requiredActions: readonly string[] };
    expect(gate.allowed).toBe(true);
    expect(gate.requiredActions).toEqual([]);
    await app.close();
  });

  it("rejects a validation run from another revision and a malformed query field", async () => {
    const { app, dependencies } = harness();
    await seedRevision(dependencies, {});
    await seedRevision(dependencies, {
      candidateId: "candidate-2",
      revisionId: "cs-1:r2",
      parentRevisionId: "cs-1:r1",
    });
    await seedRun(dependencies, { id: "run-other", revisionId: "cs-1:r2", outcome: "pass" });

    const crossRevision = await app.inject({
      method: "GET",
      url: gateUrl,
      headers: authorHeader,
      query: { validationRunIds: "run-other" },
    });
    expect(crossRevision.statusCode).toBe(409);

    const malformed = await app.inject({
      method: "GET",
      url: gateUrl,
      headers: authorHeader,
      query: { approvalRequirements: "{not json}" },
    });
    expect(malformed.statusCode).toBe(400);
    await app.close();
  });

  it("returns 404 for an unknown revision and 403 for another workspace", async () => {
    const { app, dependencies } = harness();
    await seedRevision(dependencies, {});
    await seedRevision(dependencies, {
      novelId: OTHER_NOVEL,
      candidateId: "candidate-other",
      changeSetId: "cs-other",
      revisionId: "cs-other:r1",
    });

    const unknownRevision = await app.inject({
      method: "GET",
      url: "/change-sets/cs-1/revisions/cs-1:missing/commit-gate",
      headers: authorHeader,
    });
    expect(unknownRevision.statusCode).toBe(404);

    const otherWorkspace = await app.inject({
      method: "GET",
      url: "/change-sets/cs-other/revisions/cs-other:r1/commit-gate",
      headers: authorHeader,
    });
    expect(otherWorkspace.statusCode).toBe(403);
    await app.close();
  });
});
