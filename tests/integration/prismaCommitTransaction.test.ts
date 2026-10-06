import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createPrismaCommitTransaction,
  prismaCommitAggregateTypes,
} from "../../src/app/prismaCommitTransaction";
import {
  commitChangeSetRevision,
  type CommitChangeSetRevisionTransaction,
  type CommitChangeSetRevisionTransactionWork,
} from "../../src/safety/application/commitChangeSetRevision";
import { createChange } from "../../src/production/domain/change";
import { createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import { createValidationRun } from "../../src/production/domain/validationRun";
import { createReviewDecision } from "../../src/production/domain/reviewDecision";
import { commitSceneText, createScene, type Scene } from "../../src/manuscript/domain/scene";
import type { NarrativeCommit } from "../../src/safety/domain/narrativeCommit";
import { createDomainEvent, type DomainEvent } from "../../src/safety/domain/domainEvent";
import {
  PrismaEventStore,
  PrismaRepository,
  PrismaRevisionedRepository,
} from "../../src/shared/infrastructure/prismaRepositories";
import { capabilityPersistencePayloadCodec } from "../../src/shared/domain/persistencePayload";
import type {
  Identified,
  UniqueCreatePort,
} from "../../src/shared/application/repository";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain_test?schema=public";
const prisma = new PrismaClient();

const now = new Date("2026-10-05T00:00:00.000Z");
const novelId = "novel-commit-prisma";
const aggregateTypes = [
  prismaCommitAggregateTypes.scene,
  prismaCommitAggregateTypes.canonicalFact,
  prismaCommitAggregateTypes.stateRecord,
  prismaCommitAggregateTypes.narrativeCommit,
  prismaCommitAggregateTypes.runCompensationRecord,
];

function sceneRepository(): PrismaRevisionedRepository<Scene> {
  return new PrismaRevisionedRepository<Scene>(
    prisma,
    prismaCommitAggregateTypes.scene,
    payload => payload as unknown as Scene,
    capabilityPersistencePayloadCodec,
  );
}

function narrativeCommitRepository(): PrismaRepository<NarrativeCommit> {
  return new PrismaRepository<NarrativeCommit>(
    prisma,
    prismaCommitAggregateTypes.narrativeCommit,
    payload => payload as unknown as NarrativeCommit,
    capabilityPersistencePayloadCodec,
  );
}

async function clearRows(): Promise<void> {
  await prisma.domainEvent.deleteMany({ where: { novelId } });
  await prisma.currentObject.deleteMany({ where: { aggregateType: { in: aggregateTypes } } });
  await prisma.revisionRecord.deleteMany({ where: { aggregateType: { in: aggregateTypes } } });
}

async function seedScene(input: {
  readonly id: string;
  readonly revisionId: string;
  readonly text?: string;
}): Promise<Scene> {
  const scene = commitSceneText({
    scene: createScene({
      id: input.id,
      novelId,
      chapterId: "chapter-1",
      title: "The Northern Gate",
      revisionId: input.revisionId,
      commitId: "initial",
      createdAt: now,
    }),
    text: input.text ?? "Old text",
    revisionId: input.revisionId,
    commitId: "initial",
    updatedAt: now,
  });
  await sceneRepository().save(scene);
  return scene;
}

async function currentSceneRevisionId(id: string): Promise<string | undefined> {
  const record = await prisma.currentObject.findFirst({
    where: { aggregateType: prismaCommitAggregateTypes.scene, objectId: id },
  });
  return record?.revisionId ?? undefined;
}

async function seedEvent(eventId: string): Promise<void> {
  await new PrismaEventStore(prisma).append(
    createDomainEvent({
      eventId,
      name: "SceneCommitted",
      context: "manuscript",
      novelId,
      objectId: "scene-seed",
      revisionId: "scene-seed:r1",
      commitId: "initial",
      payload: { seeded: true },
      occurredAt: now,
    }),
  );
}

function updatedScene(scene: Scene, text: string, revisionId: string): Scene {
  return commitSceneText({
    scene,
    text,
    revisionId,
    commitId: "manual",
    updatedAt: now,
  });
}

function domainEvent(eventId: string): DomainEvent {
  return createDomainEvent({
    eventId,
    name: "SceneCommitted",
    context: "manuscript",
    novelId,
    objectId: "scene-2",
    revisionId: "scene-2:r1",
    commitId: "commit-1",
    payload: { text: "New text" },
    occurredAt: now,
  });
}

function manuscriptChange(basedOnRevisionId: string) {
  return createChange({
    id: "change-manuscript-scene-1",
    sourceType: "author_edit",
    sourceReference: { identity: "author-1", version: "r1", hash: "hash-1" },
    targetAddress: { targetType: "manuscript", objectId: "scene-1" },
    payload: { text: "New text" },
    basedOnVersionSet: createVersionSet({
      target: createVersionReference("Scene", "scene-1", basedOnRevisionId),
    }),
  });
}

describe("[task:R1] Prisma commit transaction", () => {
  beforeAll(async () => {
    await clearRows();
  });

  afterAll(async () => {
    await clearRows();
    await prisma.$disconnect();
  });

  it("[persistence] [transaction] rejects a scene compare-and-set against a stale revision without writing", async () => {
    await clearRows();
    const seeded = await seedScene({ id: "scene-1", revisionId: "scene-1:r2" });
    const transaction = createPrismaCommitTransaction(prisma);

    await expect(
      transaction.run(async work => {
        await work.repositories.scenes.saveSceneIfCurrent(
          "scene-1:r1",
          updatedScene(seeded, "Stale write", "scene-1:r3"),
        );
      }),
    ).rejects.toThrow();

    expect(await currentSceneRevisionId("scene-1")).toBe("scene-1:r2");
    expect(
      await prisma.revisionRecord.count({
        where: { aggregateType: prismaCommitAggregateTypes.scene, objectId: "scene-1", revisionId: "scene-1:r3" },
      }),
    ).toBe(0);
  });

  it("[persistence] [transaction] rolls back canonical writes when event append fails on a duplicate eventId", async () => {
    await clearRows();
    const seeded = await seedScene({ id: "scene-2", revisionId: "scene-2:r1" });
    await seedEvent("event-dup");
    const transaction = createPrismaCommitTransaction(prisma);

    await expect(
      transaction.run(async work => {
        await work.repositories.scenes.saveSceneIfCurrent(
          "scene-2:r1",
          updatedScene(seeded, "New text", "scene-2:r1:commit-1"),
        );
        await work.eventStore.appendEventsIfAbsent([domainEvent("event-dup")]);
      }),
    ).rejects.toThrow();

    expect(await currentSceneRevisionId("scene-2")).toBe("scene-2:r1");
    expect(
      await prisma.domainEvent.count({ where: { novelId, eventId: "event-dup" } }),
    ).toBe(1);
  });

  it("[persistence] [transaction] rejects a narrative commit status compare-and-set against a conflicting status", async () => {
    await clearRows();
    const repository = narrativeCommitRepository();
    const conflicting: NarrativeCommit = {
      id: "commit-status-1",
      novelId,
      changeSetRevisionId: "cs-status-r1",
      validationRunIds: [],
      reviewDecisionIds: [],
      basedOnVersionSet: {},
      status: "committed",
      createdAt: now,
      updatedAt: now,
    };
    await repository.save(conflicting);
    const transaction = createPrismaCommitTransaction(prisma);

    await expect(
      transaction.run(async work => {
        await work.repositories.narrativeCommits.saveNarrativeCommitIfCurrent("pending", {
          ...conflicting,
          status: "pending",
        });
      }),
    ).rejects.toThrow();

    expect((await repository.findById("commit-status-1"))?.status).toBe("committed");
  });

  it("[persistence] [transaction] commits a change set revision through the frozen flow and reads it back", async () => {
    await clearRows();
    const seeded = await seedScene({ id: "scene-1", revisionId: "scene-1:r1" });
    const transaction = createPrismaCommitTransaction(prisma);
    const revision = Object.freeze({
      ...createInitialChangeSetRevision({
        revisionId: "cs-1-r1",
        changeSetId: "cs-1",
        novelId,
        createdAt: now,
      }),
      changes: Object.freeze([manuscriptChange("scene-1:r1")]),
    });
    const validation = createValidationRun({
      id: "validation-1",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      validatorId: "validator",
      entryResults: [],
      executionState: "completed",
      outcome: "pass",
      createdAt: now,
    });
    const review = createReviewDecision({
      id: "review-manuscript-scene-1",
      changeSetRevisionId: "cs-1-r1",
      approvalScope: { requirementDomain: "manuscript", targetType: "manuscript", objectId: "scene-1" },
      decision: "approve",
      decidedBy: "human",
      actorId: "reviewer-1",
      reason: "",
      evidenceReferences: ["validation-1"],
      createdAt: now,
    });

    const commit = await commitChangeSetRevision({
      transaction,
      input: {
        commitId: "commit-1",
        changeSetRevision: revision,
        validationRuns: [validation],
        reviewDecisions: [review],
        currentRevisionFacts: { unresolvedConflict: false, stale: false },
        targetInvariantViolations: [],
        requiredApproval: true,
        now,
      },
    });

    expect(commit.status).toBe("committed");
    expect(await currentSceneRevisionId("scene-1")).toBe(`${seeded.currentRevisionId}:commit-1`);

    const persisted = await transaction.run(async work => ({
      commit: await work.repositories.narrativeCommits.findById("commit-1"),
      scene: await work.repositories.scenes.findById("scene-1"),
      revision: await work.repositories.scenes.getRevision(
        "scene-1",
        `${seeded.currentRevisionId}:commit-1`,
      ),
    }));
    expect(persisted.commit?.status).toBe("committed");
    expect(persisted.scene?.text).toBe("New text");
    expect(persisted.revision?.text).toBe("New text");

    const eventIds = (
      await prisma.domainEvent.findMany({ where: { novelId }, orderBy: { sequence: "asc" } })
    ).map(event => event.eventId);
    expect(eventIds).toEqual(["event:commit-1:manuscript:scene-1", "event:commit-1:recorded"]);
  });

  it("[persistence] [transaction] writes compensation records inside the same transaction and rolls them back on failure", async () => {
    await clearRows();
    const transaction = createPrismaCommitTransaction(prisma) as CommitChangeSetRevisionTransaction & {
      runWithCompensationRecords<TRecord extends Identified, T>(
        operation: (
          work: CommitChangeSetRevisionTransactionWork,
          records: UniqueCreatePort<TRecord>,
        ) => Promise<T>,
      ): Promise<T>;
    };

    const record = {
      id: "compensation-record-1",
      runId: "run-1",
      sourceCommitId: "commit-1",
      compensationCommitId: "compensate-1",
      status: "completed" as const,
      createdAt: now,
    };

    const written = await transaction.runWithCompensationRecords(async (_work, records) => {
      await records.saveIfAbsent(record);
      return (await records.findById(record.id))?.id;
    });
    expect(written).toBe(record.id);

    await expect(
      transaction.runWithCompensationRecords(async (_work, records) => {
        await records.saveIfAbsent({ ...record, id: "compensation-record-2" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    const rows = await prisma.currentObject.findMany({
      where: { aggregateType: prismaCommitAggregateTypes.runCompensationRecord },
      orderBy: { objectId: "asc" },
    });
    expect(rows.map(row => row.objectId)).toEqual(["compensation-record-1"]);
  });
});
