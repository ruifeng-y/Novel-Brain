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
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import type { ApiDependencies } from "../../src/http/routes";

const NOVEL = "novel-1";
const OTHER_NOVEL = "novel-2";
const authorToken = "w3-approval-token";
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
      idGenerator: () => "w3-approval-event",
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

const decisionBody = {
  reviewDecisionId: "review-1",
  approvalScope: {
    requirementDomain: "manuscript",
    targetType: "manuscript",
    objectId: "scene-1",
  },
  decision: "approve",
  decidedBy: "human",
  actorId: "w3-author-1",
  reason: "可以提交。",
  evidenceReferences: ["run-1"],
};

describe("[task:W3] [integration] review decision HTTP surface", () => {
  it("records a decision against a revision and reads it back without a commit", async () => {
    const { app, dependencies, calls } = harness();
    await seedRevision(dependencies, {});

    const response = await app.inject({
      method: "POST",
      url: "/change-sets/cs-1/revisions/cs-1:r1/review-decisions",
      headers: authorHeader,
      payload: decisionBody,
    });

    expect(response.statusCode).toBe(201);
    const decision = response.json() as {
      id: string;
      changeSetRevisionId: string;
      decision: string;
      approvalScope: { objectId: string };
      novelId?: string;
    };
    expect(decision.changeSetRevisionId).toBe("cs-1:r1");
    expect(decision.decision).toBe("approve");
    expect(decision.approvalScope.objectId).toBe("scene-1");
    expect(decision.novelId).toBeUndefined();
    expect(calls).toContain("approval.command.record-review-decision");

    const read = await app.inject({
      method: "GET",
      url: "/change-sets/cs-1/revisions/cs-1:r1/review-decisions",
      headers: authorHeader,
    });
    expect(read.statusCode).toBe(200);
    expect((read.json() as readonly { id: string }[]).map(entry => entry.id)).toEqual(["review-1"]);
    expect(calls).toContain("approval.query.approval-evidence");

    // Approval is a pre-commit stage: no canonical commit was written.
    expect(await dependencies.narrativeCommits.listByNovel(NOVEL)).toHaveLength(0);
    await app.close();
  });

  it("does not answer with a decision under a revision it did not decide about", async () => {
    const { app, dependencies } = harness();
    await seedRevision(dependencies, {});
    await seedRevision(dependencies, {
      candidateId: "candidate-2",
      revisionId: "cs-1:r2",
      parentRevisionId: "cs-1:r1",
    });

    const created = await app.inject({
      method: "POST",
      url: "/change-sets/cs-1/revisions/cs-1:r1/review-decisions",
      headers: authorHeader,
      payload: decisionBody,
    });
    expect(created.statusCode).toBe(201);

    const otherRevision = await app.inject({
      method: "GET",
      url: "/change-sets/cs-1/revisions/cs-1:r2/review-decisions",
      headers: authorHeader,
    });
    expect(otherRevision.statusCode).toBe(200);
    expect(otherRevision.json()).toEqual([]);
    await app.close();
  });

  it("rejects a pending decision: there is no pending decision state", async () => {
    const { app, dependencies } = harness();
    await seedRevision(dependencies, {});

    const response = await app.inject({
      method: "POST",
      url: "/change-sets/cs-1/revisions/cs-1:r1/review-decisions",
      headers: authorHeader,
      payload: { ...decisionBody, decision: "pending" },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("rejects a malformed decision as a 400 instead of failing as a 500", async () => {
    const { app, dependencies } = harness();
    await seedRevision(dependencies, {});
    const url = "/change-sets/cs-1/revisions/cs-1:r1/review-decisions";

    const noReason = await app.inject({
      method: "POST",
      url,
      headers: authorHeader,
      payload: { ...decisionBody, decision: "reject", reason: "" },
    });
    expect(noReason.statusCode).toBe(400);

    const policyWithoutVersion = await app.inject({
      method: "POST",
      url,
      headers: authorHeader,
      payload: { ...decisionBody, decidedBy: "policy" },
    });
    expect(policyWithoutVersion.statusCode).toBe(400);
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
      url: "/change-sets/cs-1/revisions/cs-1:missing/review-decisions",
      headers: authorHeader,
      payload: decisionBody,
    });
    expect(unknownRevision.statusCode).toBe(404);

    const otherWorkspace = await app.inject({
      method: "POST",
      url: "/change-sets/cs-other/revisions/cs-other:r1/review-decisions",
      headers: authorHeader,
      payload: decisionBody,
    });
    expect(otherWorkspace.statusCode).toBe(403);
    await app.close();
  });
});
