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
import { createScene } from "../../src/manuscript/domain/scene";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import type { ApiDependencies } from "../../src/http/routes";

const NOVEL = "novel-1";
const OTHER_NOVEL = "novel-2";
const authorToken = "w3-validation-token";
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
      idGenerator: () => "w3-validation-event",
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

function candidateFixture(input: {
  readonly id: string;
  readonly novelId?: string;
  readonly text?: string;
}): Candidate {
  const novelId = input.novelId ?? NOVEL;
  return createCandidate({
    id: input.id,
    taskId: `task-${input.id}`,
    novelId,
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-1:rev-1"),
    }),
    change: { type: "text", sceneId: "scene-1", text: input.text ?? "第一版文本。" },
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

const validationBody = {
  validationId: "run-1",
  planVersionId: "plan-v1",
  candidateId: "candidate-1",
  mustPreserve: ["不在正文里的短语"],
};

describe("[task:W3] [integration] validation run HTTP surface", () => {
  it("runs validation against a revision and reads the run back without a commit", async () => {
    const { app, dependencies, calls } = harness();
    await seedRevision(dependencies, {});

    const response = await app.inject({
      method: "POST",
      url: "/change-sets/cs-1/revisions/cs-1:r1/validation-runs",
      headers: authorHeader,
      payload: validationBody,
    });

    expect(response.statusCode).toBe(201);
    const run = response.json() as {
      id: string;
      changeSetRevisionId: string;
      planVersionId: string;
      outcome?: string;
      entryResults: readonly { findings: readonly { code: string }[] }[];
    };
    expect(run.changeSetRevisionId).toBe("cs-1:r1");
    expect(run.planVersionId).toBe("plan-v1");
    expect(run.outcome).toBe("fail");
    expect(run.entryResults.flatMap(entry => entry.findings.map(f => f.code))).toContain(
      "REQUIRED_PHRASE_MISSING",
    );
    expect(calls).toContain("validation.command.run-validation");

    const read = await app.inject({
      method: "GET",
      url: `/change-sets/cs-1/revisions/cs-1:r1/validation-runs/${run.id}`,
      headers: authorHeader,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ id: run.id, changeSetRevisionId: "cs-1:r1" });
    expect(calls).toContain("validation.query.validation-run");

    // Validation is a pre-commit stage: no canonical commit was written.
    expect(await dependencies.narrativeCommits.listByNovel(NOVEL)).toHaveLength(0);
    await app.close();
  });

  it("does not answer with a run under a revision it did not validate", async () => {
    const { app, dependencies } = harness();
    await seedRevision(dependencies, {});
    await seedRevision(dependencies, {
      candidateId: "candidate-2",
      revisionId: "cs-1:r2",
      parentRevisionId: "cs-1:r1",
    });

    const created = await app.inject({
      method: "POST",
      url: "/change-sets/cs-1/revisions/cs-1:r1/validation-runs",
      headers: authorHeader,
      payload: validationBody,
    });
    const run = created.json() as { id: string };
    expect(created.statusCode).toBe(201);

    const crossRevision = await app.inject({
      method: "GET",
      url: `/change-sets/cs-1/revisions/cs-1:r2/validation-runs/${run.id}`,
      headers: authorHeader,
    });
    expect(crossRevision.statusCode).toBe(404);
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
      method: "POST",
      url: "/change-sets/cs-1/revisions/cs-1:missing/validation-runs",
      headers: authorHeader,
      payload: validationBody,
    });
    expect(unknownRevision.statusCode).toBe(404);

    const otherWorkspace = await app.inject({
      method: "POST",
      url: "/change-sets/cs-other/revisions/cs-other:r1/validation-runs",
      headers: authorHeader,
      payload: { ...validationBody, candidateId: "candidate-other" },
    });
    expect(otherWorkspace.statusCode).toBe(403);
    await app.close();
  });
});
