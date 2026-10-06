import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createChangeSetRevisionService } from "../../src/app/changeSetRevisionService";
import { createValidationRunService } from "../../src/app/validationRunService";
import { createReviewDecisionService } from "../../src/app/reviewDecisionService";
import { createNovelBrainServer } from "../../src/http/server";
import {
  createHttpBoundaryPipeline,
  type HttpBoundaryContext,
  type HttpBoundaryPipeline,
} from "../../src/http/httpBoundaryPipeline";
import { createProductRequestValidators } from "../../src/http/productRequestSchemas";
import { createPlatformObservabilityBoundary } from "../../src/platform/observabilityBoundary";
import { createProductionSecurityBoundary } from "../../src/platform/productionSecurityProvider";
import { createNovel } from "../../src/narrative/novel/domain/novel";
import { commitSceneText, createScene } from "../../src/manuscript/domain/scene";
import { createCandidate } from "../../src/production/domain/candidate";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import type { ApiDependencies } from "../../src/http/routes";

const NOVEL = "novel-1";
const CHANGE_SET = "cs-1";
const REVISION = "cs-1:r1";
const authorToken = "w3-commit-token";
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
      idGenerator: () => "w3-commit-event",
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

const approvalScope = {
  requirementDomain: "manuscript" as const,
  targetType: "manuscript" as const,
  objectId: "scene-1",
};

/** A novel, a scene, a candidate, an adopted revision, a run and a decision. */
async function seedArtefacts(dependencies: ApiDependencies, input: { mustPreserve?: readonly string[] } = {}) {
  await dependencies.novels.save(
    createNovel({ id: NOVEL, authorId: "author-1", title: "Novel", createdAt: AT }),
  );
  await dependencies.scenes.save(
    commitSceneText({
      scene: createScene({
        id: "scene-1",
        novelId: NOVEL,
        chapterId: "chapter-1",
        title: "Scene",
        revisionId: "scene-1:rev-1",
        commitId: "initial",
        createdAt: AT,
      }),
      text: "Lin Chuan waited.",
      revisionId: "scene-1:rev-2",
      commitId: "initial",
      updatedAt: AT,
    }),
  );
  const candidate = createCandidate({
    id: "candidate-1",
    taskId: "task-1",
    novelId: NOVEL,
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-1:rev-2"),
    }),
    change: { type: "text", sceneId: "scene-1", text: "新文本。" },
    createdAt: AT,
  });
  await dependencies.candidates.save(candidate);
  await createChangeSetRevisionService({ changeSets: dependencies.changeSets }).adoptCandidate({
    candidate,
    changeSetId: CHANGE_SET,
    revisionId: REVISION,
    createdAt: AT,
  });

  const run = await createValidationRunService({
    changeSets: dependencies.changeSets,
    validations: dependencies.validations,
    scenes: dependencies.scenes,
    candidates: dependencies.candidates,
  }).runValidation({
    changeSetId: CHANGE_SET,
    revisionId: REVISION,
    validationId: "run-1",
    planVersionId: "plan-v1",
    candidateId: "candidate-1",
    mustPreserve: input.mustPreserve ?? [],
    createdAt: AT,
  });
  const decision = await createReviewDecisionService({
    reviews: dependencies.reviews,
    changeSets: dependencies.changeSets,
  }).recordReview({
    reviewDecisionId: "review-1",
    changeSetId: CHANGE_SET,
    revisionId: REVISION,
    approvalScope,
    decision: "approve",
    decidedBy: "human",
    actorId: "w3-author-1",
    reason: "可以提交。",
    evidenceReferences: [run.id],
    createdAt: AT,
  });
  return { candidate, run, decision };
}

function commitBody(overrides: Record<string, unknown> = {}) {
  return {
    commitId: "commit-1",
    changeSetRevisionId: REVISION,
    validationRunIds: ["run-1"],
    reviewDecisionIds: ["review-1"],
    currentRevisionFacts: { unresolvedConflict: false, stale: false },
    targetInvariantViolations: [],
    approvalRequirements: [
      { approvalScope, requirement: "t12-basic-approval", requirementLevel: "not_required" },
    ],
    ...overrides,
  };
}

const commitUrl = `/change-sets/${CHANGE_SET}/commit`;

describe("[task:W3] [integration] commit boundary over real artefacts", () => {
  it("commits a revision referencing real validation and approval artefacts", async () => {
    const { app, dependencies, calls } = harness();
    await seedArtefacts(dependencies);

    const response = await app.inject({
      method: "POST",
      url: commitUrl,
      headers: authorHeader,
      payload: commitBody(),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: "commit-1",
      changeSetRevisionId: REVISION,
      status: "committed",
    });
    expect(calls).toContain("commit.command.commit-change-set-revision");
    expect((await dependencies.scenes.findById("scene-1"))?.text).toBe("新文本。");

    const provenance = await app.inject({
      method: "GET",
      url: `/novels/${NOVEL}/commits/commit-1`,
      headers: authorHeader,
    });
    expect(provenance.statusCode).toBe(200);
    const body = provenance.json() as {
      changeSetRevisionId: string;
      validationRuns: readonly { id: string }[];
      reviewDecisions: readonly { id: string }[];
      auditEvents: readonly { name: string }[];
    };
    expect(body.changeSetRevisionId).toBe(REVISION);
    expect(body.validationRuns.map(run => run.id)).toEqual(["run-1"]);
    expect(body.reviewDecisions.map(decision => decision.id)).toEqual(["review-1"]);
    expect(body.auditEvents.map(event => event.name)).toContain("NarrativeCommitRecorded");
    expect(calls).toContain("commit.query.commit-provenance");
    await app.close();
  });

  it("rejects a commit that references an artefact from another revision", async () => {
    const { app, dependencies } = harness();
    await seedArtefacts(dependencies);
    const second = createCandidate({
      id: "candidate-2",
      taskId: "task-2",
      novelId: NOVEL,
      basedOnVersionSet: createVersionSet({
        scene: createVersionReference("Scene", "scene-1", "scene-1:rev-2"),
      }),
      change: { type: "text", sceneId: "scene-1", text: "第二版文本。" },
      createdAt: AT,
    });
    await dependencies.candidates.save(second);
    await createChangeSetRevisionService({ changeSets: dependencies.changeSets }).adoptCandidate({
      candidate: second,
      changeSetId: CHANGE_SET,
      revisionId: "cs-1:r2",
      parentRevision: await createChangeSetRevisionService({
        changeSets: dependencies.changeSets,
      }).getRevision({ changeSetId: CHANGE_SET, revisionId: REVISION }),
      createdAt: AT,
    });
    // The run belongs to cs-1:r1; committing cs-1:r2 must not accept it.
    await createValidationRunService({
      changeSets: dependencies.changeSets,
      validations: dependencies.validations,
      scenes: dependencies.scenes,
      candidates: dependencies.candidates,
    }).runValidation({
      changeSetId: CHANGE_SET,
      revisionId: "cs-1:r2",
      validationId: "run-2",
      planVersionId: "plan-v1",
      candidateId: "candidate-2",
      mustPreserve: [],
      createdAt: AT,
    });

    const response = await app.inject({
      method: "POST",
      url: commitUrl,
      headers: authorHeader,
      payload: commitBody({ changeSetRevisionId: "cs-1:r2", validationRunIds: ["run-1"] }),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().reason).toContain("does not belong to revision");
    expect(await dependencies.narrativeCommits.listByNovel(NOVEL)).toHaveLength(0);
    expect((await dependencies.scenes.findById("scene-1"))?.text).toBe("Lin Chuan waited.");
    await app.close();
  });

  it("rejects a commit whose gate is blocked and returns the five conditions", async () => {
    const { app, dependencies } = harness();
    await seedArtefacts(dependencies, { mustPreserve: ["不在正文里的短语"] });

    const response = await app.inject({
      method: "POST",
      url: commitUrl,
      headers: authorHeader,
      payload: commitBody(),
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as {
      gate: {
        allowed: boolean;
        validation: { ok: boolean };
        approval: { ok: boolean };
        revisionValidity: { ok: boolean };
        concurrency: { ok: boolean };
        invariant: { ok: boolean };
      };
    };
    expect(body.gate.allowed).toBe(false);
    expect(body.gate.validation.ok).toBe(false);
    expect(body.gate.approval.ok).toBe(true);
    expect(body.gate.revisionValidity.ok).toBe(true);
    expect(body.gate.concurrency.ok).toBe(true);
    expect(body.gate.invariant.ok).toBe(true);
    expect(await dependencies.narrativeCommits.listByNovel(NOVEL)).toHaveLength(0);
    expect((await dependencies.scenes.findById("scene-1"))?.text).toBe("Lin Chuan waited.");
    await app.close();
  });

  it("no longer accepts a candidate id or a client-supplied review template", async () => {
    const { app, dependencies } = harness();
    await seedArtefacts(dependencies);

    const withCandidate = await app.inject({
      method: "POST",
      url: commitUrl,
      headers: authorHeader,
      payload: commitBody({ candidateId: "candidate-1" }),
    });
    expect(withCandidate.statusCode).toBe(400);

    const withTemplate = await app.inject({
      method: "POST",
      url: commitUrl,
      headers: authorHeader,
      payload: commitBody({
        reviewDecision: { id: "review-1", decidedBy: "human", actorId: "author-1", reason: "", evidenceReferences: [] },
      }),
    });
    expect(withTemplate.statusCode).toBe(400);

    const withValidationId = await app.inject({
      method: "POST",
      url: commitUrl,
      headers: authorHeader,
      payload: commitBody({ validationId: "run-1" }),
    });
    expect(withValidationId.statusCode).toBe(400);

    expect(await dependencies.narrativeCommits.listByNovel(NOVEL)).toHaveLength(0);
    await app.close();
  });

  it("returns 404 for an unknown revision and 403 for another workspace", async () => {
    const { app, dependencies } = harness();
    await seedArtefacts(dependencies);

    const unknownRevision = await app.inject({
      method: "POST",
      url: commitUrl,
      headers: authorHeader,
      payload: commitBody({ changeSetRevisionId: "cs-1:missing" }),
    });
    expect(unknownRevision.statusCode).toBe(404);

    // A revision of another workspace: the route derives that workspace, and
    // the principal is not scoped to it.
    await dependencies.novels.save(
      createNovel({ id: "novel-2", authorId: "author-2", title: "Other", createdAt: AT }),
    );
    const otherCandidate = createCandidate({
      id: "candidate-other",
      taskId: "task-other",
      novelId: "novel-2",
      basedOnVersionSet: createVersionSet({
        scene: createVersionReference("Scene", "scene-2", "scene-2:rev-2"),
      }),
      change: { type: "text", sceneId: "scene-2", text: "其他文本。" },
      createdAt: AT,
    });
    await dependencies.candidates.save(otherCandidate);
    await createChangeSetRevisionService({ changeSets: dependencies.changeSets }).adoptCandidate({
      candidate: otherCandidate,
      changeSetId: "cs-other",
      revisionId: "cs-other:r1",
      createdAt: AT,
    });

    const otherRevision = await app.inject({
      method: "POST",
      url: "/change-sets/cs-other/commit",
      headers: authorHeader,
      payload: commitBody({ changeSetRevisionId: "cs-other:r1" }),
    });
    expect(otherRevision.statusCode).toBe(403);

    const otherProvenance = await app.inject({
      method: "GET",
      url: "/novels/novel-2/commits/commit-1",
      headers: authorHeader,
    });
    expect(otherProvenance.statusCode).toBe(403);
    await app.close();
  });
});
