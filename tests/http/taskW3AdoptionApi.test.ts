import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createNovelBrainServer } from "../../src/http/server";
import {
  createHttpBoundaryPipeline,
  type HttpBoundaryContext,
  type HttpBoundaryPipeline,
} from "../../src/http/httpBoundaryPipeline";
import { createProductRequestValidators } from "../../src/http/productRequestSchemas";
import { createPlatformObservabilityBoundary } from "../../src/platform/observabilityBoundary";
import { createProductionSecurityBoundary } from "../../src/platform/productionSecurityProvider";
import { createCandidate } from "../../src/production/domain/candidate";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import type { ApiDependencies } from "../../src/http/routes";

const NOVEL = "novel-1";
const OTHER_NOVEL = "novel-2";
const authorToken = "w3-author-token";
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
      idGenerator: () => "w3-event",
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

async function seedCandidate(
  dependencies: ApiDependencies,
  input: { readonly id: string; readonly novelId?: string; readonly text: string },
): Promise<void> {
  const novelId = input.novelId ?? NOVEL;
  await dependencies.candidates.save(
    createCandidate({
      id: input.id,
      taskId: `task-${input.id}`,
      novelId,
      basedOnVersionSet: createVersionSet({
        scene: createVersionReference("Scene", `scene-${input.id}`, `scene-${input.id}:rev-1`),
      }),
      change: { type: "text", sceneId: `scene-${input.id}`, text: input.text },
      createdAt: AT,
    }),
  );
}

describe("[task:W3] [integration] change set revision HTTP surface", () => {
  it("adopts a candidate through the boundary and reads the revision back", async () => {
    const { app, dependencies, calls } = harness();
    await seedCandidate(dependencies, { id: "candidate-1", text: "第一版文本。" });

    const response = await app.inject({
      method: "POST",
      url: "/change-sets/cs-1/revisions",
      headers: authorHeader,
      payload: { candidateId: "candidate-1", revisionId: "cs-1:r1" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      revisionId: "cs-1:r1",
      changeSetId: "cs-1",
      novelId: NOVEL,
      revisionNumber: 1,
    });
    expect((response.json() as { changes: readonly unknown[] }).changes).toHaveLength(1);
    expect(calls).toContain("commit.command.create-change-set-revision");
    await app.close();
  });

  it("is idempotent for the same revision and rejects a different content under the same id", async () => {
    const { app, dependencies } = harness();
    await seedCandidate(dependencies, { id: "candidate-1", text: "第一版文本。" });
    await seedCandidate(dependencies, { id: "candidate-2", text: "另一段文本。" });

    const first = await app.inject({
      method: "POST",
      url: "/change-sets/cs-1/revisions",
      headers: authorHeader,
      payload: { candidateId: "candidate-1", revisionId: "cs-1:r1" },
    });
    const again = await app.inject({
      method: "POST",
      url: "/change-sets/cs-1/revisions",
      headers: authorHeader,
      payload: { candidateId: "candidate-1", revisionId: "cs-1:r1" },
    });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());

    const conflict = await app.inject({
      method: "POST",
      url: "/change-sets/cs-1/revisions",
      headers: authorHeader,
      payload: { candidateId: "candidate-2", revisionId: "cs-1:r1" },
    });
    expect(conflict.statusCode).toBe(409);
    await app.close();
  });

  it("diffs two revisions of one change set through the boundary", async () => {
    const { app, dependencies, calls } = harness();
    await seedCandidate(dependencies, { id: "candidate-1", text: "第一版文本。" });
    await seedCandidate(dependencies, { id: "candidate-2", text: "第二版文本。" });
    await app.inject({
      method: "POST",
      url: "/change-sets/cs-1/revisions",
      headers: authorHeader,
      payload: { candidateId: "candidate-1", revisionId: "cs-1:r1" },
    });
    await app.inject({
      method: "POST",
      url: "/change-sets/cs-1/revisions",
      headers: authorHeader,
      payload: {
        candidateId: "candidate-2",
        revisionId: "cs-1:r2",
        parentRevisionId: "cs-1:r1",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/change-sets/cs-1/revisions/diff?fromRevisionId=cs-1:r1&toRevisionId=cs-1:r2",
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { changeId: "change:cs-1:r2:1", action: "added" },
      { changeId: "change:cs-1:r1:1", action: "removed" },
    ]);
    expect(calls).toContain("commit.query.change-set-revision-diff");
    await app.close();
  });

  it("returns 404 for an unknown candidate or an unknown revision diff", async () => {
    const { app, dependencies } = harness();
    await seedCandidate(dependencies, { id: "candidate-1", text: "第一版文本。" });

    const unknownCandidate = await app.inject({
      method: "POST",
      url: "/change-sets/cs-1/revisions",
      headers: authorHeader,
      payload: { candidateId: "candidate-missing", revisionId: "cs-1:r1" },
    });
    expect(unknownCandidate.statusCode).toBe(404);

    await app.inject({
      method: "POST",
      url: "/change-sets/cs-1/revisions",
      headers: authorHeader,
      payload: { candidateId: "candidate-1", revisionId: "cs-1:r1" },
    });
    const unknownDiff = await app.inject({
      method: "GET",
      url: "/change-sets/cs-1/revisions/diff?fromRevisionId=cs-1:r1&toRevisionId=cs-1:missing",
      headers: authorHeader,
    });
    expect(unknownDiff.statusCode).toBe(404);
    await app.close();
  });

  it("refuses to adopt a candidate from another workspace", async () => {
    const { app, dependencies } = harness();
    await seedCandidate(dependencies, { id: "candidate-other", novelId: OTHER_NOVEL, text: "别的故事。" });

    const response = await app.inject({
      method: "POST",
      url: "/change-sets/cs-other/revisions",
      headers: authorHeader,
      payload: { candidateId: "candidate-other", revisionId: "cs-other:r1" },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
