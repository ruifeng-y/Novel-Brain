import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createChangeSetRevisionService } from "../../src/app/changeSetRevisionService";
import { createValidationRunService } from "../../src/app/validationRunService";
import { createReviewDecisionService } from "../../src/app/reviewDecisionService";
import { createNovelBrainServer } from "../../src/http/server";
import {
  createCandidate,
  type Candidate,
  type CandidateAtomicChange,
  type CandidateChange,
} from "../../src/production/domain/candidate";
import { createGenerationTask } from "../../src/production/domain/generationTask";
import { createNovel } from "../../src/narrative/novel/domain/novel";
import {
  commitSceneText,
  createScene,
  type Scene,
} from "../../src/manuscript/domain/scene";
import { createCanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";
import { createStateRecord } from "../../src/narrative/state/domain/stateRecord";
import {
  createVersionReference,
  createVersionSet,
  type VersionSet,
} from "../../src/shared/domain/versioning";
import { hashContent } from "../../src/shared/domain/contentHash";

const now = new Date("2026-10-03T00:00:00.000Z");

function server() {
  const dependencies = createInMemoryEngineDependencies();
  return { app: createNovelBrainServer(dependencies), dependencies };
}

function commitConflict(conflictType: string) {
  const error = new Error(`Commit conflict: ${conflictType}`) as Error & {
    conflictType: string;
  };
  error.name = "CommitConflictError";
  error.conflictType = conflictType;
  return error;
}
function atomicChanges(change: CandidateChange): readonly CandidateAtomicChange[] {
  return change.type === "composite" ? change.changes : [change];
}

function scopeFor(change: CandidateAtomicChange) {
  if (change.type === "text" || change.type === "local_text") {
    return {
      requirementDomain: "manuscript" as const,
      targetType: "manuscript" as const,
      objectId: change.sceneId,
      ...(change.type === "local_text" ? { subAddress: change.targetSpan.anchorId } : {}),
    };
  }
  if (change.type === "canonical_fact") {
    return {
      requirementDomain: "canon" as const,
      targetType: "canonical_fact" as const,
      objectId: change.canonicalFactId,
    };
  }
  return {
    requirementDomain: "story_state" as const,
    targetType: "story_state" as const,
    objectId: change.stateRecordId,
  };
}

/**
 * W3 boundary: a commit references real artefacts by id. This helper performs
 * the stages an author performs — adopt the candidate into a persisted Change
 * Set Revision, run validation against that revision, record an approving
 * decision — and returns the commit request body that references them.
 */
async function prepareCommit(
  dependencies: ReturnType<typeof createInMemoryEngineDependencies>,
  candidate: Candidate,
  options: {
    changeSetId: string;
    commitId?: string;
    revisionId?: string;
    validationId?: string;
    reviewDecisionId?: string;
    mustPreserve?: readonly string[];
    unresolvedConflict?: boolean;
    stale?: boolean;
    targetInvariantViolations?: readonly (
      | string
      | { message: string; evidenceReferences?: readonly string[] }
    )[];
  },
) {
  const revisionId = options.revisionId ?? `change-set-${candidate.id}-r1`;
  const revision = await createChangeSetRevisionService({
    changeSets: dependencies.changeSets,
  }).adoptCandidate({
    candidate,
    changeSetId: options.changeSetId,
    revisionId,
    createdAt: now,
  });
  const run = await createValidationRunService({
    changeSets: dependencies.changeSets,
    validations: dependencies.validations,
    scenes: dependencies.scenes,
    candidates: dependencies.candidates,
  }).runValidation({
    changeSetId: options.changeSetId,
    revisionId,
    validationId: options.validationId ?? `validation-${candidate.id}`,
    planVersionId: "plan-v1",
    candidateId: candidate.id,
    mustPreserve: options.mustPreserve ?? [],
    createdAt: now,
  });
  const decision = await createReviewDecisionService({
    reviews: dependencies.reviews,
    changeSets: dependencies.changeSets,
  }).recordReview({
    reviewDecisionId: options.reviewDecisionId ?? `review-${candidate.id}`,
    changeSetId: options.changeSetId,
    revisionId,
    approvalScope: scopeFor(atomicChanges(candidate.change)[0]!),
    decision: "approve",
    decidedBy: "human",
    actorId: "author-1",
    reason: "",
    evidenceReferences: [run.id],
    createdAt: now,
  });

  return {
    revision,
    run,
    decision,
    body: {
      commitId: options.commitId ?? `commit-${candidate.id}`,
      changeSetRevisionId: revisionId,
      validationRunIds: [run.id],
      reviewDecisionIds: [decision.id],
      currentRevisionFacts: {
        unresolvedConflict: options.unresolvedConflict ?? false,
        stale: options.stale ?? false,
      },
      targetInvariantViolations: options.targetInvariantViolations ?? [],
      approvalRequirements: atomicChanges(candidate.change).map(change => ({
        approvalScope: scopeFor(change),
        requirement: "t12-basic-approval",
        requirementLevel: "not_required" as const,
      })),
    },
  };
}

function sceneFixture(id: string, novelId: string): Scene {
  return commitSceneText({
    scene: createScene({
      id,
      novelId,
      chapterId: `chapter-${id}`,
      title: `Scene ${id}`,
      revisionId: `${id}:rev-1`,
      commitId: `initial:${id}`,
      createdAt: now,
    }),
    text: "Lin Chuan waited. The Northern Sect gate stayed closed.",
    spanAnchors: {
      gate: {
        anchorId: "gate",
        start: 18,
        end: 55,
        text: "The Northern Sect gate stayed closed.",
        sourceContentHash: hashContent("The Northern Sect gate stayed closed."),
      },
    },
    revisionId: `${id}:rev-2`,
    commitId: `initial:${id}`,
    updatedAt: now,
  });
}

async function seedCandidate(
  dependencies: ReturnType<typeof createInMemoryEngineDependencies>,
  input: {
    novelId?: string;
    sceneId?: string;
    candidateId: string;
    change: CandidateChange;
    basedOnVersionSet?: VersionSet;
  },
): Promise<Candidate> {
  const novelId = input.novelId ?? "novel-1";
  if (!(await dependencies.novels.findById(novelId))) {
    await dependencies.novels.save(
      createNovel({
        id: novelId,
        authorId: "author-1",
        title: "Novel",
        createdAt: now,
      }),
    );
  }
  const sceneId = input.sceneId ?? "scene-1";
  if (!(await dependencies.scenes.findById(sceneId))) {
    await dependencies.scenes.save(sceneFixture(sceneId, novelId));
  }
  const basedOnVersionSet =
    input.basedOnVersionSet ??
    createVersionSet({
      scene: createVersionReference("Scene", sceneId, `${sceneId}:rev-2`),
    });
  await dependencies.generationTasks.save(
    createGenerationTask({
      id: `task-${input.candidateId}`,
      novelId,
      operation: "rewrite",
      targetSceneId: sceneId,
      intent: "Update the scene.",
      basedOnVersionSet: createVersionSet({
        ...basedOnVersionSet,
        scene: createVersionReference("Scene", sceneId, `${sceneId}:rev-2`),
      }),
      createdAt: now,
    }),
  );
  const candidate = createCandidate({
    id: input.candidateId,
    taskId: `task-${input.candidateId}`,
    novelId,
    basedOnVersionSet,
    change: input.change,
    createdAt: now,
  });
  await dependencies.candidates.save(candidate);
  return candidate;
}

describe("core engine API", () => {
  it("supports the co-creation loop over HTTP", async () => {
    const { app, dependencies } = server();
    await app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-loop", authorId: "author-1", title: "Loop" },
    });
    const sceneResponse = await app.inject({
      method: "POST",
      url: "/novels/novel-loop/scenes",
      headers: { "x-author-id": "author-1" },
      payload: { id: "scene-loop", chapterId: "chapter-1", title: "Loop Scene" },
    });
    expect(sceneResponse.statusCode).toBe(201);
    const scene = sceneResponse.json() as Scene;
    await app.inject({
      method: "POST",
      url: "/novels/novel-loop/generation-tasks",
      headers: { "x-author-id": "author-1" },
      payload: {
        id: "task-loop",
        operation: "rewrite",
        targetSceneId: scene.id,
        intent: "Rewrite the scene.",
        basedOnVersionSet: {
          scene: {
            aggregateType: "Scene",
            objectId: scene.id,
            revisionId: scene.currentRevisionId,
          },
        },
      },
    });
    await app.inject({
      method: "POST",
      url: "/generation-tasks/task-loop/candidates",
      payload: {
        id: "candidate-loop",
        agentRole: "writer",
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
        change: { type: "text", sceneId: scene.id, text: "New loop text" },
      },
    });
    const candidate = (await dependencies.candidates.findById("candidate-loop"))!;

    const prepared = await prepareCommit(dependencies, candidate, {
      changeSetId: "change-set-loop",
      revisionId: "change-set-loop-r1",
      commitId: "commit-loop",
    });
    const response = await app.inject({
      method: "POST",
      url: "/change-sets/change-set-loop/commit",
      payload: prepared.body,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: "commit-loop",
      changeSetRevisionId: "change-set-loop-r1",
      status: "committed",
    });
    expect((await dependencies.scenes.findById(scene.id))?.text).toBe("New loop text");
    expect((await dependencies.eventStore.listByNovel("novel-loop")).map(event => event.name))
      .toEqual(["SceneCommitted", "NarrativeCommitRecorded"]);
    await app.close();
  });

  it("rejects an invalid novel payload", async () => {
    const { app } = server();

    const response = await app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "", authorId: "", title: "" },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("reports a failed validation as a blocked gate without selecting the candidate", async () => {
    const { app, dependencies } = server();
    const candidate = await seedCandidate(dependencies, {
      candidateId: "candidate-invalid",
      change: {
        type: "text",
        sceneId: "scene-1",
        text: "Different text without the required phrase",
      },
    });

    const prepared = await prepareCommit(dependencies, candidate, {
      changeSetId: "change-set-invalid",
      revisionId: "change-set-invalid-r1",
      validationId: "validation-invalid",
      mustPreserve: ["Northern Sect"],
    });
    const response = await app.inject({
      method: "POST",
      url: "/change-sets/change-set-invalid/commit",
      payload: prepared.body,
    });

    // Validation is its own stage: the run carries the failure, and the commit
    // is refused by the gate rather than by an inline validation step.
    expect(response.statusCode).toBe(409);
    expect(prepared.run.outcome).toBe("fail");
    expect(response.json()).toMatchObject({
      error: "Commit Conflict",
      gate: {
        allowed: false,
        validation: { ok: false },
      },
    });
    expect((await dependencies.candidates.findById(candidate.id))?.status).toBe("generated");
    expect(await dependencies.narrativeCommits.listByNovel("novel-1")).toEqual([]);
    expect(await dependencies.eventStore.listByNovel("novel-1")).toEqual([]);
    await app.close();
  });

  it("commits structured-only and canonical-only candidates without a scene change", async () => {
    const { app, dependencies } = server();
    await dependencies.novels.save(
      createNovel({ id: "novel-structured", authorId: "author-1", title: "Structured", createdAt: now }),
    );
    await dependencies.scenes.save(sceneFixture("scene-structured", "novel-structured"));
    await dependencies.canonicalFacts.save(
      createCanonicalFact({
        id: "fact-api",
        novelId: "novel-structured",
        type: "world_rule",
        content: { rule: "old" },
        revisionId: "fact-api-rev-1",
        commitId: "initial",
        createdAt: now,
      }),
    );
    await dependencies.stateRecords.save(
      createStateRecord({
        id: "state-api",
        novelId: "novel-structured",
        type: "character_state",
        subjectId: "character-api",
        position: { sceneId: "scene-structured", ordinal: 1 },
        content: { condition: "healthy" },
        revisionId: "state-api-rev-1",
        commitId: "initial",
        createdAt: now,
      }),
    );
    const structured = await seedCandidate(dependencies, {
      novelId: "novel-structured",
      sceneId: "scene-structured",
      candidateId: "candidate-structured",
      change: {
        type: "structured_state",
        stateRecordId: "state-api",
        content: { condition: "injured" },
      },
      basedOnVersionSet: createVersionSet({
        state: createVersionReference("StateRecord", "state-api", "state-api-rev-1"),
      }),
    });
    const canonical = await seedCandidate(dependencies, {
      novelId: "novel-structured",
      sceneId: "scene-structured",
      candidateId: "candidate-canonical",
      change: { type: "canonical_fact", canonicalFactId: "fact-api", content: { rule: "new" } },
      basedOnVersionSet: createVersionSet({
        fact: createVersionReference("CanonicalFact", "fact-api", "fact-api-rev-1"),
      }),
    });

    const preparedStructured = await prepareCommit(dependencies, structured, {
      changeSetId: "change-set-structured",
      revisionId: "change-set-structured-r1",
      commitId: "commit-structured",
    });
    const preparedCanonical = await prepareCommit(dependencies, canonical, {
      changeSetId: "change-set-canonical",
      revisionId: "change-set-canonical-r1",
      commitId: "commit-canonical",
    });
    const structuredResponse = await app.inject({
      method: "POST",
      url: "/change-sets/change-set-structured/commit",
      payload: preparedStructured.body,
    });
    const canonicalResponse = await app.inject({
      method: "POST",
      url: "/change-sets/change-set-canonical/commit",
      payload: preparedCanonical.body,
    });

    expect(structuredResponse.statusCode).toBe(201);
    expect(canonicalResponse.statusCode).toBe(201);
    expect((await dependencies.stateRecords.findById("state-api"))?.content).toEqual({
      condition: "injured",
    });
    expect((await dependencies.canonicalFacts.findById("fact-api"))?.content).toEqual({
      rule: "new",
    });
    expect((await dependencies.scenes.findById("scene-structured"))?.text).toContain(
      "Northern Sect",
    );
    await app.close();
  });

  it("rejects empty version sets through the API schema", async () => {
    const { app, dependencies } = server();
    await dependencies.novels.save(
      createNovel({ id: "novel-schema", authorId: "author-1", title: "Schema", createdAt: now }),
    );
    await dependencies.scenes.save(sceneFixture("scene-schema", "novel-schema"));

    const response = await app.inject({
      method: "POST",
      url: "/novels/novel-schema/generation-tasks",
      headers: { "x-author-id": "author-1" },
      payload: {
        id: "task-schema",
        operation: "rewrite",
        targetSceneId: "scene-schema",
        intent: "Rewrite.",
        basedOnVersionSet: {},
      },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("verifies novel existence and author ownership before creating child objects", async () => {
    const { app, dependencies } = server();
    await dependencies.novels.save(
      createNovel({ id: "novel-auth", authorId: "author-1", title: "Auth", createdAt: now }),
    );
    await dependencies.scenes.save(sceneFixture("scene-auth", "novel-auth"));

    const missing = await app.inject({
      method: "POST",
      url: "/novels/missing/generation-tasks",
      headers: { "x-author-id": "author-1" },
      payload: {},
    });
    const forbidden = await app.inject({
      method: "POST",
      url: "/novels/novel-auth/generation-tasks",
      headers: { "x-author-id": "author-2" },
      payload: {},
    });

    expect(missing.statusCode).toBe(404);
    expect(forbidden.statusCode).toBe(403);
    await app.close();
  });

  it("commits a composite candidate over scene and state changes", async () => {
    const { app, dependencies } = server();
    await dependencies.novels.save(
      createNovel({ id: "novel-composite", authorId: "author-1", title: "Composite", createdAt: now }),
    );
    await dependencies.scenes.save(sceneFixture("scene-composite", "novel-composite"));
    await dependencies.stateRecords.save(
      createStateRecord({
        id: "state-composite",
        novelId: "novel-composite",
        type: "character_state",
        subjectId: "character-composite",
        position: { sceneId: "scene-composite", ordinal: 1 },
        content: { condition: "healthy" },
        revisionId: "state-composite-rev-1",
        commitId: "initial",
        createdAt: now,
      }),
    );
    const candidate = await seedCandidate(dependencies, {
      novelId: "novel-composite",
      sceneId: "scene-composite",
      candidateId: "candidate-composite",
      change: {
        type: "composite",
        changes: [
          { type: "text", sceneId: "scene-composite", text: "Composite scene text" },
          {
            type: "structured_state",
            stateRecordId: "state-composite",
            content: { condition: "injured" },
          },
        ],
      },
      basedOnVersionSet: createVersionSet({
        scene: createVersionReference("Scene", "scene-composite", "scene-composite:rev-2"),
        state: createVersionReference("StateRecord", "state-composite", "state-composite-rev-1"),
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/change-sets/change-set-composite/commit",
      payload: (
        await prepareCommit(dependencies, candidate, {
          changeSetId: "change-set-composite",
          revisionId: "change-set-composite-r1",
          commitId: "commit-composite",
        })
      ).body,
    });

    expect(response.statusCode).toBe(201);
    expect((await dependencies.scenes.findById("scene-composite"))?.text).toBe(
      "Composite scene text",
    );
    expect((await dependencies.stateRecords.findById("state-composite"))?.content).toEqual({
      condition: "injured",
    });
    expect((await dependencies.eventStore.listByNovel("novel-composite")).map(event => event.name))
      .toEqual(["SceneCommitted", "CharacterStateChanged", "NarrativeCommitRecorded"]);
    await app.close();
  });

  it("returns a controlled commit conflict for stale versions without corrupting state", async () => {
    const { app, dependencies } = server();
    const candidate = await seedCandidate(dependencies, {
      candidateId: "candidate-stale",
      change: { type: "text", sceneId: "scene-1", text: "Candidate stale text" },
    });
    await dependencies.scenes.save(
      commitSceneText({
        scene: (await dependencies.scenes.findById("scene-1"))!,
        text: "Author updated text",
        revisionId: "scene-1:author-rev",
        commitId: "author-edit",
        updatedAt: now,
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/change-sets/change-set-stale/commit",
      payload: (
        await prepareCommit(dependencies, candidate, {
          changeSetId: "change-set-stale",
          revisionId: "change-set-stale-r1",
          commitId: "commit-stale",
        })
      ).body,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "Commit Conflict",
      gate: {
        allowed: false,
        concurrency: { ok: false },
        blockers: expect.arrayContaining([
          expect.objectContaining({ type: "occ_conflict" }),
        ]),
      },
    });
    expect((await dependencies.scenes.findById("scene-1"))?.text).toBe("Author updated text");
    expect(await dependencies.eventStore.listByNovel("novel-1")).toEqual([]);
    await app.close();
  });

  it("returns controlled errors for explicit invariant facts without half commits", async () => {
    const { app, dependencies } = server();
    const candidate = await seedCandidate(dependencies, {
      candidateId: "candidate-invariant",
      change: { type: "text", sceneId: "scene-1", text: "Invariant text" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/change-sets/change-set-invariant/commit",
      payload: (
        await prepareCommit(dependencies, candidate, {
          changeSetId: "change-set-invariant",
          revisionId: "change-set-invariant-r1",
          commitId: "commit-invariant",
          targetInvariantViolations: [
            {
              message: "target invariant failed",
              evidenceReferences: ["candidate-invariant:candidate-source-v1"],
            },
          ],
        })
      ).body,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "Commit Conflict",
      gate: {
        allowed: false,
        invariant: { ok: false },
        blockers: expect.arrayContaining([
          expect.objectContaining({ type: "invariant_violation" }),
        ]),
      },
    });
    expect((await dependencies.scenes.findById("scene-1"))?.text).toContain("Northern Sect");
    expect(await dependencies.narrativeCommits.listByNovel("novel-1")).toEqual([]);
    expect(await dependencies.eventStore.listByNovel("novel-1")).toEqual([]);
    await app.close();
  });
  it.each([
    "cas_revision",
    "cas_commit_status",
    "narrative_commit_id",
    "narrative_commit_revision",
    "narrative_commit_binding",
    "revision_history",
    "raw_write_in_transaction",
    "duplicate_event_id",
  ] as const)("returns 409 controlled JSON for %s conflicts", async conflictType => {
    const { dependencies } = server();
    const candidate = await seedCandidate(dependencies, {
      candidateId: `candidate-${conflictType}`,
      change: {
        type: "text",
        sceneId: "scene-1",
        text: `Conflict ${conflictType}`,
      },
    });
    const app = createNovelBrainServer({
      ...dependencies,
      commitTransaction: {
        run: () => Promise.reject(commitConflict(conflictType)),
      } as typeof dependencies.commitTransaction,
    });

    const prepared = await prepareCommit(dependencies, candidate, {
      changeSetId: `change-set-${conflictType}`,
      revisionId: `change-set-${conflictType}-r1`,
      commitId: `commit-${conflictType}`,
    });
    const response = await app.inject({
      method: "POST",
      url: `/change-sets/change-set-${conflictType}/commit`,
      payload: prepared.body,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "Commit Conflict",
      conflictType,
      reason: `Commit conflict: ${conflictType}`,
    });
    expect((await dependencies.scenes.findById("scene-1"))?.text).toContain("Northern Sect");
    expect(await dependencies.narrativeCommits.listByNovel("novel-1")).toEqual([]);
    expect(await dependencies.eventStore.listByNovel("novel-1")).toEqual([]);
    await app.close();
  });

  it("rejects duplicate targets at adoption with controlled JSON and zero writes", async () => {
    const { app, dependencies } = server();
    const candidate = await seedCandidate(dependencies, {
      candidateId: "candidate-duplicate-target",
      change: {
        type: "composite",
        changes: [
          { type: "text", sceneId: "scene-1", text: "First target write" },
          { type: "text", sceneId: "scene-1", text: "Second target write" },
        ],
      },
    });

    // A Change Set Revision cannot address one target twice, and that is
    // decided when the candidate is adopted, before any commit is attempted.
    const response = await app.inject({
      method: "POST",
      url: "/change-sets/change-set-duplicate-target/revisions",
      payload: {
        candidateId: candidate.id,
        revisionId: "change-set-duplicate-target-r1",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "Commit Conflict",
      conflictType: "duplicate_target",
      reason: expect.stringContaining("Duplicate target address"),
    });
    expect((await dependencies.scenes.findById("scene-1"))?.text).toContain("Northern Sect");
    expect(await dependencies.narrativeCommits.listByNovel("novel-1")).toEqual([]);
    expect(await dependencies.eventStore.listByNovel("novel-1")).toEqual([]);
    await app.close();
  });
});
