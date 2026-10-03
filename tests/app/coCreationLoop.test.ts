import { describe, expect, it } from "vitest";
import { InMemoryCommitTransaction } from "../../src/app/inMemoryCommitTransaction";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { commitChangeSetRevision } from "../../src/safety/application/commitChangeSetRevision";
import { createChange, type Change } from "../../src/production/domain/change";
import {
  createInitialChangeSetRevision,
  type ChangeSetRevision,
} from "../../src/production/domain/changeSetRevision";
import {
  createValidationRun,
  type ValidationOutcome,
} from "../../src/production/domain/validationRun";
import {
  createReviewDecision,
  type ApprovalScope,
  type ReviewDecision,
} from "../../src/production/domain/reviewDecision";
import {
  commitSceneText,
  createScene,
  type Scene,
} from "../../src/manuscript/domain/scene";
import { createCanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";
import { createStateRecord } from "../../src/narrative/state/domain/stateRecord";
import { createGenerationTask } from "../../src/production/domain/generationTask";
import {
  createNarrativeCommit,
  markNarrativeCommitCommitted,
  markNarrativeCommitFailed,
  type NarrativeCommit,
} from "../../src/safety/domain/narrativeCommit";
import { createSceneCommittedEvent } from "../../src/manuscript/domain/manuscriptEvents";
import {
  createVersionReference,
  createVersionSet,
  type VersionReference,
} from "../../src/shared/domain/versioning";
import { hashContent } from "../../src/shared/domain/contentHash";

const now = new Date("2026-10-03T00:00:00.000Z");

function baseScene(): Scene {
  return commitSceneText({
    scene: createScene({
      id: "scene-1",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "The Northern Gate",
      revisionId: "scene-rev-1",
      commitId: "initial",
      createdAt: now,
    }),
    text: "Alpha middle Omega.",
    spanAnchors: {
      middle: {
        anchorId: "middle",
        start: 6,
        end: 12,
        text: "middle",
        sourceContentHash: hashContent("middle"),
      },
    },
    revisionId: "scene-rev-2",
    commitId: "initial",
    updatedAt: now,
  });
}

async function setup() {
  const transaction = new InMemoryCommitTransaction();
  await transaction.scenes.save(baseScene());
  await transaction.canonicalFacts.save(
    createCanonicalFact({
      id: "fact-1",
      novelId: "novel-1",
      type: "world_rule",
      content: { rule: "old" },
      revisionId: "fact-rev-1",
      commitId: "initial",
      createdAt: now,
    }),
  );
  await transaction.stateRecords.save(
    createStateRecord({
      id: "state-1",
      novelId: "novel-1",
      type: "character_state",
      subjectId: "character-1",
      position: { sceneId: "scene-1", ordinal: 1 },
      content: { condition: "healthy" },
      revisionId: "state-rev-1",
      commitId: "initial",
      createdAt: now,
    }),
  );
  return transaction;
}

function sceneChange(
  payload: Record<string, unknown> = { text: "New text" },
  subAddress?: string,
): Change {
  return createChange({
    id: subAddress ? `change-scene-${subAddress}` : "change-scene",
    sourceType: "candidate",
    sourceReference: {
      identity: "candidate-1",
      version: "candidate-source-v1",
      hash: hashContent("candidate source"),
    },
    targetAddress: { targetType: "manuscript", objectId: "scene-1", ...(subAddress ? { subAddress } : {}) },
    payload,
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
    }),
  });
}

function canonicalChange(): Change {
  return createChange({
    id: "change-fact",
    sourceType: "candidate",
    sourceReference: {
      identity: "candidate-1",
      version: "candidate-source-v1",
      hash: hashContent("candidate source"),
    },
    targetAddress: { targetType: "canonical_fact", objectId: "fact-1" },
    payload: { rule: "new" },
    basedOnVersionSet: createVersionSet({
      fact: createVersionReference("CanonicalFact", "fact-1", "fact-rev-1"),
    }),
  });
}

function stateChange(): Change {
  return createChange({
    id: "change-state",
    sourceType: "candidate",
    sourceReference: {
      identity: "candidate-1",
      version: "candidate-source-v1",
      hash: hashContent("candidate source"),
    },
    targetAddress: { targetType: "story_state", objectId: "state-1" },
    payload: { condition: "injured" },
    basedOnVersionSet: createVersionSet({
      state: createVersionReference("StateRecord", "state-1", "state-rev-1"),
    }),
  });
}



function deferred() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => {
    open = resolve;
  });
  return { promise, open };
}

function narrativeCommit(
  id: string,
  changeSetRevisionId: string,
  sceneRevisionId = "scene-rev-2",
): NarrativeCommit {
  return createNarrativeCommit({
    id,
    novelId: "novel-1",
    changeSetRevision: revisionWith([sceneChange()], changeSetRevisionId),
    validationRuns: [validation("pass", changeSetRevisionId)],
    reviewDecisions: reviewsFor([sceneChange()], changeSetRevisionId),
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", sceneRevisionId),
    }),
    createdAt: now,
  });
}

function sceneEvent(eventId: string, revisionId: string) {
  return createSceneCommittedEvent({
    eventId,
    novelId: "novel-1",
    objectId: "scene-1",
    revisionId,
    commitId: "external-commit",
    payload: { changeSetRevisionId: "external-cs-r1" },
    occurredAt: now,
  });
}
function revisionWith(changes: readonly Change[], revisionId = "cs-1-r1"): ChangeSetRevision {
  const revision = createInitialChangeSetRevision({
    revisionId,
    changeSetId: "cs-1",
    novelId: "novel-1",
    createdAt: now,
  });
  return Object.freeze({ ...revision, changes: Object.freeze([...changes]) });
}

function validation(outcome: ValidationOutcome = "pass", revisionId = "cs-1-r1") {
  return createValidationRun({
    id: `validation-${revisionId}`,
    changeSetRevisionId: revisionId,
    planVersionId: "plan-v1",
    validatorId: "basic-validator",
    entryResults: [],
    executionState: "completed",
    outcome,
    createdAt: now,
  });
}

function scopeFor(change: Change): ApprovalScope {
  const targetType = change.targetAddress.targetType;
  return {
    requirementDomain:
      targetType === "canonical_fact"
        ? "canon"
        : targetType === "story_state"
          ? "story_state"
          : targetType,
    targetType,
    objectId: change.targetAddress.objectId,
    ...(change.targetAddress.subAddress
      ? { subAddress: change.targetAddress.subAddress }
      : {}),
  };
}

function reviewsFor(changes: readonly Change[], revisionId = "cs-1-r1"): ReviewDecision[] {
  return changes.map((change, index) =>
    createReviewDecision({
      id: `review-${revisionId}-${index}`,
      changeSetRevisionId: revisionId,
      approvalScope: scopeFor(change),
      decision: "approve",
      decidedBy: "human",
      actorId: "reviewer-1",
      reason: "",
      evidenceReferences: [`validation-${revisionId}`],
      createdAt: now,
    }),
  );
}

function requirementsFor(changes: readonly Change[]) {
  return changes.map(change => ({
    approvalScope: scopeFor(change),
    requirement: "t12-basic-approval",
    requirementLevel: "not_required" as const,
  }));
}

async function commit(
  transaction: InMemoryCommitTransaction,
  changes: readonly Change[],
  options: {
    revisionId?: string;
    validationOutcome?: ValidationOutcome;
    commitId?: string;
    unresolvedConflict?: boolean;
    stale?: boolean;
    targetInvariantViolations?: readonly (
      | string
      | { message: string; evidenceReferences?: readonly string[] }
    )[];
  } = {},
) {
  const revisionId = options.revisionId ?? "cs-1-r1";
  const revision = revisionWith(changes, revisionId);
  return commitChangeSetRevision({
    transaction,
    input: {
      commitId: options.commitId ?? "commit-1",
      changeSetRevision: revision,
      validationRuns: [validation(options.validationOutcome ?? "pass", revisionId)],
      reviewDecisions: reviewsFor(changes, revisionId),
      currentRevisionFacts: {
        unresolvedConflict: options.unresolvedConflict ?? false,
        stale: options.stale ?? false,
      },
      targetInvariantViolations: options.targetInvariantViolations ?? [],
      requiredApproval: false,
      approvalScopeRequirements: requirementsFor(changes),
      now,
    },
  });
}

describe("commitChangeSetRevision through InMemoryCommitTransaction", () => {
  it("commits a text candidate source as a revision-bound coherent transition", async () => {
    const transaction = await setup();

    const result = await commit(transaction, [sceneChange()]);

    expect(result.status).toBe("committed");
    expect(result.changeSetRevisionId).toBe("cs-1-r1");
    expect(result.validationRunIds).toEqual(["validation-cs-1-r1"]);
    expect((await transaction.scenes.findById("scene-1"))?.text).toBe("New text");
    expect((await transaction.narrativeCommits.listByNovel("novel-1")).map(entry => entry.status))
      .toEqual(["committed"]);
  });

  it("blocks a stale base revision and leaves current, history, commit, and events unchanged", async () => {
    const transaction = await setup();
    await transaction.scenes.save(
      commitSceneText({
        scene: (await transaction.scenes.findById("scene-1"))!,
        text: "Author changed it",
        revisionId: "scene-rev-3",
        commitId: "author-commit",
        updatedAt: now,
      }),
    );

    await expect(
      commit(transaction, [sceneChange()], {
        stale: true,
        targetInvariantViolations: [
          {
            message: "candidate source is stale",
            evidenceReferences: ["candidate-1:candidate-source-v1"],
          },
        ],
      }),
    ).rejects.toMatchObject({ name: "CommitGateBlockedError" });

    expect((await transaction.scenes.findById("scene-1"))?.text).toBe("Author changed it");
    expect(await transaction.scenes.getRevision("scene-1", "scene-rev-2:commit-1")).toBeUndefined();
    expect(await transaction.narrativeCommits.listByNovel("novel-1")).toEqual([]);
    expect(await transaction.eventStore.listByNovel("novel-1")).toEqual([]);
  });

  it("commits a canonical fact change", async () => {
    const transaction = await setup();

    await commit(transaction, [canonicalChange()]);

    expect((await transaction.canonicalFacts.findById("fact-1"))?.content).toEqual({ rule: "new" });
  });

  it("commits a position-aware state record change", async () => {
    const transaction = await setup();

    await commit(transaction, [stateChange()]);

    expect((await transaction.stateRecords.findById("state-1"))?.content).toEqual({
      condition: "injured",
    });
  });

  it("commits local text and rebinds the target anchor", async () => {
    const transaction = await setup();

    await commit(transaction, [
      sceneChange(
        {
          targetSpan: {
            anchorId: "middle",
            text: "middle",
            sourceContentHash: hashContent("middle"),
          },
          replacement: "core",
        },
        "middle",
      ),
    ]);

    const scene = await transaction.scenes.findById("scene-1");
    expect(scene?.text).toBe("Alpha core Omega.");
    expect(scene?.spanAnchors.middle).toMatchObject({
      start: 6,
      end: 10,
      text: "core",
      sourceContentHash: hashContent("core"),
    });
  });

  it("commits composite text, state, and canonical changes in one transition", async () => {
    const transaction = await setup();

    const result = await commit(transaction, [sceneChange(), stateChange(), canonicalChange()]);

    expect(result.status).toBe("committed");
    expect((await transaction.scenes.findById("scene-1"))?.text).toBe("New text");
    expect((await transaction.stateRecords.findById("state-1"))?.content).toEqual({
      condition: "injured",
    });
    expect((await transaction.canonicalFacts.findById("fact-1"))?.content).toEqual({ rule: "new" });
    expect((await transaction.eventStore.listByNovel("novel-1")).map(event => event.name)).toEqual([
      "SceneCommitted",
      "CharacterStateChanged",
      "CanonicalFactChanged",
      "NarrativeCommitRecorded",
    ]);
  });

  it("rejects failed validation without writing a commit", async () => {
    const transaction = await setup();

    await expect(
      commit(transaction, [sceneChange()], { validationOutcome: "fail" }),
    ).rejects.toThrow();

    expect((await transaction.scenes.findById("scene-1"))?.text).toBe("Alpha middle Omega.");
    expect(await transaction.narrativeCommits.listByNovel("novel-1")).toEqual([]);
    expect(await transaction.eventStore.listByNovel("novel-1")).toEqual([]);
  });

  it("rolls back current, revision history, NarrativeCommit, and events when an operation fails", async () => {
    const transaction = await setup();
    const original = (await transaction.scenes.findById("scene-1"))!;
    const next = commitSceneText({
      scene: original,
      text: "Must roll back",
      revisionId: "scene-rev-3:rollback",
      commitId: "commit-rollback",
      updatedAt: now,
    });
    const revision = revisionWith([sceneChange()], "cs-rollback-r1");
    const pending: NarrativeCommit = createNarrativeCommit({
      id: "commit-rollback",
      novelId: "novel-1",
      changeSetRevision: revision,
      validationRuns: [validation("pass", "cs-rollback-r1")],
      reviewDecisions: reviewsFor([sceneChange()], "cs-rollback-r1"),
      basedOnVersionSet: createVersionSet({
        scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
      }),
      createdAt: now,
    });

    await expect(
      transaction.run(async work => {
        await work.repositories.scenes.saveSceneIfCurrent(original.currentRevisionId, next);
        await work.repositories.narrativeCommits.saveNarrativeCommitIfAbsent(pending);
        await work.eventStore.appendEventsIfAbsent([
          createSceneCommittedEvent({
            eventId: "event:rollback",
            novelId: "novel-1",
            objectId: "scene-1",
            revisionId: next.currentRevisionId,
            commitId: "commit-rollback",
            payload: { changeSetRevisionId: revision.revisionId },
            occurredAt: now,
          }),
        ]);
        throw new Error("operation failed");
      }),
    ).rejects.toThrow("operation failed");

    expect((await transaction.scenes.findById("scene-1"))?.currentRevisionId).toBe("scene-rev-2");
    expect(await transaction.scenes.getRevision("scene-1", "scene-rev-3:rollback")).toBeUndefined();
    expect(await transaction.narrativeCommits.findById("commit-rollback")).toBeUndefined();
    expect(await transaction.eventStore.listByNovel("novel-1")).toEqual([]);
  });

  it("keeps raw NarrativeCommit saves idempotent for an identical entity", async () => {
    const transaction = await setup();
    const first = narrativeCommit("commit-raw-id", "cs-raw-id-r1");

    await transaction.narrativeCommits.save(first);
    await expect(transaction.narrativeCommits.save(first)).resolves.toBeUndefined();

    expect(await transaction.narrativeCommits.findById("commit-raw-id")).toEqual(first);
    expect(await transaction.narrativeCommits.listByNovel("novel-1")).toHaveLength(1);
  });

  it("keeps raw NarrativeCommit saves idempotent when only property insertion order differs", async () => {
    const transaction = await setup();
    const first = narrativeCommit("commit-raw-order", "cs-raw-order-r1");
    const reordered: NarrativeCommit = {
      updatedAt: first.updatedAt,
      createdAt: first.createdAt,
      status: first.status,
      basedOnVersionSet: {
        scene: {
          revisionId: first.basedOnVersionSet.scene?.revisionId ?? "",
          objectId: first.basedOnVersionSet.scene?.objectId ?? "",
          aggregateType: first.basedOnVersionSet.scene?.aggregateType ?? "Scene",
        },
      },
      reviewDecisionIds: [...first.reviewDecisionIds],
      validationRunIds: [...first.validationRunIds],
      changeSetRevisionId: first.changeSetRevisionId,
      novelId: first.novelId,
      id: first.id,
    };

    await transaction.narrativeCommits.save(first);
    await expect(transaction.narrativeCommits.save(reordered)).resolves.toBeUndefined();

    expect(await transaction.narrativeCommits.findById("commit-raw-order")).toEqual(first);
    expect(await transaction.narrativeCommits.listByNovel("novel-1")).toHaveLength(1);
  });
  it("rejects raw NarrativeCommit saves that reuse an id with different content and preserves the original", async () => {
    const transaction = await setup();
    const first = narrativeCommit("commit-raw-id-conflict", "cs-raw-id-conflict-r1");
    const different = { ...first, changeSetRevisionId: "cs-raw-id-conflict-r2" };

    await transaction.narrativeCommits.save(first);
    await expect(transaction.narrativeCommits.save(different)).rejects.toMatchObject({
      name: "CommitConflictError",
      conflictType: "narrative_commit_id",
    });

    expect(await transaction.narrativeCommits.findById("commit-raw-id-conflict")).toEqual(first);
  });

  it("rejects raw NarrativeCommit saves that reuse an id with a different status and preserves the original", async () => {
    const transaction = await setup();
    const first = narrativeCommit("commit-raw-status", "cs-raw-status-r1");
    const differentStatus = { ...first, status: "failed" as const };

    await transaction.narrativeCommits.save(first);
    await expect(transaction.narrativeCommits.save(differentStatus)).rejects.toMatchObject({
      name: "CommitConflictError",
      conflictType: "narrative_commit_id",
    });

    expect(await transaction.narrativeCommits.findById("commit-raw-status")).toEqual(first);
    expect((await transaction.narrativeCommits.findById("commit-raw-status"))?.status).toBe("pending");
  });
  it("rejects raw NarrativeCommit saves with a different id and an already used revision", async () => {
    const transaction = await setup();
    const first = narrativeCommit("commit-raw-revision-1", "cs-raw-revision-r1");
    const differentId = { ...first, id: "commit-raw-revision-2" };

    await transaction.narrativeCommits.save(first);
    await expect(transaction.narrativeCommits.save(differentId)).rejects.toMatchObject({
      name: "CommitConflictError",
      conflictType: "narrative_commit_revision",
    });

    expect(await transaction.narrativeCommits.findById("commit-raw-revision-1")).toEqual(first);
    expect(await transaction.narrativeCommits.findById("commit-raw-revision-2")).toBeUndefined();
  });
  it("enforces NarrativeCommit id and change set revision uniqueness in the transaction", async () => {
    const transaction = await setup();
    const revision = revisionWith([sceneChange()], "cs-unique-r1");
    const first = createNarrativeCommit({
      id: "commit-unique-1",
      novelId: "novel-1",
      changeSetRevision: revision,
      validationRuns: [validation("pass", "cs-unique-r1")],
      reviewDecisions: reviewsFor([sceneChange()], "cs-unique-r1"),
      createdAt: now,
    });
    const duplicateRevision = { ...first, id: "commit-unique-2" };

    await transaction.run(work =>
      work.repositories.narrativeCommits.saveNarrativeCommitIfAbsent(first),
    );
    await expect(
      transaction.run(work =>
        work.repositories.narrativeCommits.saveNarrativeCommitIfAbsent(duplicateRevision),
      ),
    ).rejects.toThrow("NarrativeCommit changeSetRevisionId already exists");

    expect((await transaction.narrativeCommits.listByNovel("novel-1")).map(entry => entry.id))
      .toEqual(["commit-unique-1"]);
  });

  it("reports unsupported based-on dependencies as controlled OCC blockers", async () => {
    const transaction = await setup();
    const unsupported = createChange({
      id: "change-unsupported",
      sourceType: "candidate",
      sourceReference: {
        identity: "candidate-1",
        version: "candidate-source-v1",
        hash: hashContent("candidate source"),
      },
      targetAddress: { targetType: "manuscript", objectId: "scene-1" },
      payload: { text: "New text" },
      basedOnVersionSet: createVersionSet({
        candidate: {
          aggregateType: "Candidate",
          objectId: "candidate-1",
          revisionId: "candidate-source-v1",
        } as VersionReference,
      }),
    });

    const caught = await commit(transaction, [unsupported]).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(caught).toMatchObject({ name: "CommitGateBlockedError" });
    expect((await transaction.scenes.findById("scene-1"))?.text).toBe("Alpha middle Omega.");
    expect(await transaction.eventStore.listByNovel("novel-1")).toEqual([]);
  });
  it("serializes concurrent transactions in FIFO order and keeps successful A after B CAS rollback", async () => {
    const transaction = await setup();
    const original = (await transaction.scenes.findById("scene-1"))!;
    const nextA = commitSceneText({
      scene: original,
      text: "A committed text",
      revisionId: "scene-rev-2:commit-a",
      commitId: "commit-a",
      updatedAt: now,
    });
    const nextB = commitSceneText({
      scene: original,
      text: "B must not commit",
      revisionId: "scene-rev-2:commit-b",
      commitId: "commit-b",
      updatedAt: now,
    });
    const commitA = markNarrativeCommitCommitted({
      commit: narrativeCommit("commit-a", "cs-a-r1"),
      resultingVersionSet: createVersionSet({
        scene: createVersionReference("Scene", "scene-1", "scene-rev-2:commit-a"),
      }),
      committedAt: now,
    });
    const aStarted = deferred();
    const releaseA = deferred();
    const releaseB = deferred();

    const a = transaction.run(async work => {
      aStarted.open();
      await releaseA.promise;
      await work.repositories.scenes.saveSceneIfCurrent(original.currentRevisionId, nextA);
      await work.repositories.narrativeCommits.saveNarrativeCommitIfAbsent(commitA);
      await work.eventStore.appendEventsIfAbsent([
        sceneEvent("event:commit-a", "scene-rev-2:commit-a"),
      ]);
      return "A";
    });
    await aStarted.promise;

    const b = transaction.run(async work => {
      await releaseB.promise;
      await work.repositories.scenes.saveSceneIfCurrent(original.currentRevisionId, nextB);
    });

    releaseA.open();
    await expect(a).resolves.toBe("A");
    releaseB.open();
    await expect(b).rejects.toMatchObject({
      name: "CommitConflictError",
      conflictType: "cas_revision",
    });

    expect((await transaction.scenes.findById("scene-1"))?.text).toBe("A committed text");
    expect(await transaction.scenes.getRevision("scene-1", "scene-rev-2:commit-a")).toBeDefined();
    expect((await transaction.narrativeCommits.findById("commit-a"))?.status).toBe("committed");
    expect((await transaction.eventStore.listByNovel("novel-1")).map(event => event.eventId)).toEqual([
      "event:commit-a",
    ]);
  });

  it("keeps external save and append outside a failing transaction and preserves their committed writes", async () => {
    const dependencies = createInMemoryEngineDependencies();
    await dependencies.scenes.save(baseScene());
    const transaction = dependencies.commitTransaction;
    const original = (await dependencies.scenes.findById("scene-1"))!;
    const next = commitSceneText({
      scene: original,
      text: "Transaction write",
      revisionId: "scene-rev-2:transaction",
      commitId: "transaction",
      updatedAt: now,
    });
    const externalScene = commitSceneText({
      scene: original,
      text: "External write",
      revisionId: "scene-rev-2:external",
      commitId: "external",
      updatedAt: now,
    });
    const started = deferred();
    const release = deferred();
    let externalWritesFinished = false;

    const failing = transaction.run(async work => {
      started.open();
      await release.promise;
      await work.repositories.scenes.saveSceneIfCurrent(original.currentRevisionId, next);
      throw new Error("transaction must roll back");
    });
    await started.promise;

    const externalSave = dependencies.scenes.save(externalScene).then(() => {
      externalWritesFinished = true;
    });
    const externalAppend = dependencies.eventStore
      .append(sceneEvent("event:external", "scene-rev-2:external"))
      .then(() => {
        externalWritesFinished = true;
      });
    const genericSave = dependencies.generationTasks
      .save(
        createGenerationTask({
          id: "task-external",
          novelId: "novel-1",
          operation: "rewrite",
          targetSceneId: "scene-1",
          intent: "External write",
          basedOnVersionSet: createVersionSet({
            scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
          }),
          createdAt: now,
        }),
      )
      .then(() => {
        externalWritesFinished = true;
      });

    await Promise.resolve();
    expect(externalWritesFinished).toBe(false);

    release.open();
    await expect(failing).rejects.toThrow("transaction must roll back");
    await Promise.all([externalSave, externalAppend, genericSave]);

    expect((await dependencies.scenes.findById("scene-1"))?.text).toBe("External write");
    expect(await dependencies.scenes.getRevision("scene-1", "scene-rev-2:transaction")).toBeUndefined();
    expect(await dependencies.scenes.getRevision("scene-1", "scene-rev-2:external")).toBeDefined();
    expect((await dependencies.eventStore.listByNovel("novel-1")).map(event => event.eventId)).toEqual([
      "event:external",
    ]);
    expect(await dependencies.generationTasks.findById("task-external")).toBeDefined();
  });

  it("rejects CAS revision conflicts with a typed commit conflict", async () => {
    const transaction = await setup();
    const original = (await transaction.scenes.findById("scene-1"))!;
    const caught = await transaction
      .run(work =>
        work.repositories.scenes.saveSceneIfCurrent(
          "wrong-revision",
          commitSceneText({
            scene: original,
            text: "Must fail",
            revisionId: "scene-rev-2:cas",
            commitId: "commit-cas",
            updatedAt: now,
          }),
        ),
      )
      .then(() => undefined, (error: unknown) => error);

    expect(caught).toMatchObject({ name: "CommitConflictError", conflictType: "cas_revision" });
  });

  it("rejects NarrativeCommit status CAS conflicts with a typed commit conflict", async () => {
    const transaction = await setup();
    const pending = narrativeCommit("commit-status", "cs-status-r1");
    await transaction.narrativeCommits.save(pending);
    const failed = markNarrativeCommitFailed({
      commit: pending,
      reason: "failure",
      failedAt: now,
    });
    const caught = await transaction
      .run(work =>
        work.repositories.narrativeCommits.saveNarrativeCommitIfCurrent("committed", failed),
      )
      .then(() => undefined, (error: unknown) => error);

    expect(caught).toMatchObject({
      name: "CommitConflictError",
      conflictType: "cas_commit_status",
    });
  });

  it("rejects duplicate NarrativeCommit ids with a typed commit conflict", async () => {
    const transaction = await setup();
    const first = narrativeCommit("commit-duplicate-id", "cs-id-r1");
    const duplicateId = { ...first, changeSetRevisionId: "cs-id-r2" };
    await transaction.narrativeCommits.save(first);
    const caught = await transaction
      .run(work => work.repositories.narrativeCommits.saveNarrativeCommitIfAbsent(duplicateId))
      .then(() => undefined, (error: unknown) => error);

    expect(caught).toMatchObject({
      name: "CommitConflictError",
      conflictType: "narrative_commit_id",
    });
  });

  it("rejects duplicate NarrativeCommit revisions with a typed commit conflict", async () => {
    const transaction = await setup();
    const first = narrativeCommit("commit-revision-1", "cs-revision-r1");
    const duplicateRevision = { ...first, id: "commit-revision-2" };
    await transaction.narrativeCommits.save(first);
    const caught = await transaction
      .run(work =>
        work.repositories.narrativeCommits.saveNarrativeCommitIfAbsent(duplicateRevision),
      )
      .then(() => undefined, (error: unknown) => error);

    expect(caught).toMatchObject({
      name: "CommitConflictError",
      conflictType: "narrative_commit_revision",
    });
  });

  it("rejects duplicate event ids with a typed commit conflict", async () => {
    const transaction = await setup();
    await transaction.eventStore.append(sceneEvent("event:duplicate", "scene-rev-2"));
    const caught = await transaction
      .run(work =>
        work.eventStore.appendEventsIfAbsent([
          sceneEvent("event:duplicate", "scene-rev-2:other"),
        ]),
      )
      .then(() => undefined, (error: unknown) => error);

    expect(caught).toMatchObject({
      name: "CommitConflictError",
      conflictType: "duplicate_event_id",
    });
  });
  it("supports reentrant nested transaction savepoints without deadlocks", async () => {
    const transaction = await setup();
    const original = (await transaction.scenes.findById("scene-1"))!;
    const outerNext = commitSceneText({
      scene: original,
      text: "Outer transaction write",
      revisionId: "scene-rev-2:outer",
      commitId: "outer",
      updatedAt: now,
    });
    const nestedNext = commitSceneText({
      scene: outerNext,
      text: "Nested transaction write",
      revisionId: "scene-rev-2:outer:nested",
      commitId: "nested",
      updatedAt: now,
    });

    await transaction.run(async work => {
      await work.repositories.scenes.saveSceneIfCurrent(original.currentRevisionId, outerNext);
      await transaction.run(async nestedWork => {
        await nestedWork.repositories.scenes.saveSceneIfCurrent(
          outerNext.currentRevisionId,
          nestedNext,
        );
      });
    });

    expect((await transaction.scenes.findById("scene-1"))?.text).toBe("Nested transaction write");
    expect(await transaction.scenes.getRevision("scene-1", "scene-rev-2:outer")).toBeDefined();
    expect(await transaction.scenes.getRevision("scene-1", "scene-rev-2:outer:nested")).toBeDefined();
  });

  it("rolls back only a failed nested savepoint and preserves the outer write", async () => {
    const transaction = await setup();
    const original = (await transaction.scenes.findById("scene-1"))!;
    const outerNext = commitSceneText({
      scene: original,
      text: "Outer savepoint write",
      revisionId: "scene-rev-2:outer-savepoint",
      commitId: "outer-savepoint",
      updatedAt: now,
    });
    const nestedNext = commitSceneText({
      scene: outerNext,
      text: "Nested savepoint write",
      revisionId: "scene-rev-2:outer-savepoint:nested",
      commitId: "nested-savepoint",
      updatedAt: now,
    });
    const nestedCommit = narrativeCommit("commit-nested-savepoint", "cs-nested-savepoint-r1");

    await transaction.run(async work => {
      await work.repositories.scenes.saveSceneIfCurrent(original.currentRevisionId, outerNext);
      await transaction.run(async nestedWork => {
        await nestedWork.repositories.scenes.saveSceneIfCurrent(
          outerNext.currentRevisionId,
          nestedNext,
        );
        await nestedWork.repositories.narrativeCommits.saveNarrativeCommitIfAbsent(nestedCommit);
        await nestedWork.eventStore.appendEventsIfAbsent([
          sceneEvent("event:nested-savepoint", "scene-rev-2:outer-savepoint:nested"),
        ]);
        throw new Error("nested savepoint must roll back");
      }).then(
        () => undefined,
        (error: unknown) => {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toBe("nested savepoint must roll back");
        },
      );
    });

    expect((await transaction.scenes.findById("scene-1"))?.text).toBe("Outer savepoint write");
    expect(await transaction.scenes.getRevision("scene-1", "scene-rev-2:outer-savepoint")).toBeDefined();
    expect(
      await transaction.scenes.getRevision("scene-1", "scene-rev-2:outer-savepoint:nested"),
    ).toBeUndefined();
    expect(await transaction.narrativeCommits.findById("commit-nested-savepoint")).toBeUndefined();
    expect(await transaction.eventStore.listByNovel("novel-1")).toEqual([]);
  });

  it("probes FIFO entry order directly while the first transaction is active", async () => {
    const transaction = await setup();
    const order: string[] = [];
    const started = deferred();
    const release = deferred();

    const first = transaction.run(async () => {
      order.push("first");
      started.open();
      await release.promise;
      return "first";
    });
    await started.promise;

    const second = transaction.run(async () => {
      order.push("second");
      return "second";
    });
    const third = transaction.run(async () => {
      order.push("third");
      return "third";
    });

    await Promise.resolve();
    expect(order).toEqual(["first"]);

    release.open();
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(order).toEqual(["first", "second", "third"]);
  });
  it("rejects raw external writes from inside the active transaction", async () => {
    const transaction = await setup();
    const original = (await transaction.scenes.findById("scene-1"))!;
    await expect(
      transaction.run(async () => {
        await expect(
          transaction.scenes.save(
            commitSceneText({
              scene: original,
              text: "Raw write",
              revisionId: "scene-rev-2:raw",
              commitId: "raw",
              updatedAt: now,
            }),
          ),
        ).rejects.toMatchObject({
          name: "CommitConflictError",
          conflictType: "raw_write_in_transaction",
        });
      }),
    ).resolves.toBeUndefined();
    expect(await transaction.scenes.getRevision("scene-1", "scene-rev-2:raw")).toBeUndefined();
  });
});
