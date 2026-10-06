import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaChangeSetPersistence } from "../../src/production/application/changeSetPersistence";
import { createChangeSetRevisionService } from "../../src/app/changeSetRevisionService";
import { createChangeSetDiffQuery } from "../../src/app/changeSetDiffQuery";
import { createCandidate, type Candidate } from "../../src/production/domain/candidate";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain_test?schema=public";

const novelId = "novel-w3-change-set";
const changeSetId = "cs-w3";
const at = new Date("2026-10-06T00:00:00.000Z");
const later = new Date("2026-10-06T00:00:01.000Z");
const aggregateTypes = ["ChangeSet"];

const prisma = new PrismaClient();
const readerPrisma = new PrismaClient();

async function clear(): Promise<void> {
  await prisma.currentObject.deleteMany({
    where: { novelId, aggregateType: { in: aggregateTypes } },
  });
  await prisma.revisionRecord.deleteMany({
    where: { novelId, aggregateType: { in: aggregateTypes } },
  });
}

function candidateFixture(id: string, text: string): Candidate {
  return createCandidate({
    id,
    taskId: `task-${id}`,
    novelId,
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-w3", "scene-w3:rev-1"),
    }),
    change: { type: "text", sceneId: "scene-w3", text },
    createdAt: at,
  });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
  await readerPrisma.$disconnect();
});

describe("[task:W3] [integration] Prisma change set persistence", () => {
  it("reads a change set revision through a fresh Prisma composition root", async () => {
    const writer = createChangeSetRevisionService({
      changeSets: createPrismaChangeSetPersistence(prisma).changeSets,
    });
    const reader = createChangeSetRevisionService({
      changeSets: createPrismaChangeSetPersistence(readerPrisma).changeSets,
    });

    await writer.adoptCandidate({
      candidate: candidateFixture("candidate-w3", "第一版文本。"),
      changeSetId,
      revisionId: `${changeSetId}:r1`,
      createdAt: at,
    });

    const stored = await reader.getRevision({ changeSetId, revisionId: `${changeSetId}:r1` });
    expect(stored?.revisionId).toBe(`${changeSetId}:r1`);
    expect(stored?.changeSetId).toBe(changeSetId);
    expect(stored?.novelId).toBe(novelId);
    expect(stored?.changes).toHaveLength(1);
    expect(stored?.createdAt).toBeInstanceOf(Date);
    expect((await reader.getCurrentRevision({ changeSetId }))?.revisionId).toBe(`${changeSetId}:r1`);
  });

  it("keeps adoption idempotent across roots and answers a diff of two revisions", async () => {
    const writer = createChangeSetRevisionService({
      changeSets: createPrismaChangeSetPersistence(prisma).changeSets,
    });
    const readerPersistence = createPrismaChangeSetPersistence(readerPrisma);
    const reader = createChangeSetRevisionService({ changeSets: readerPersistence.changeSets });
    const diff = createChangeSetDiffQuery({ changeSets: readerPersistence.changeSets });

    const first = await writer.adoptCandidate({
      candidate: candidateFixture("candidate-w3", "第一版文本。"),
      changeSetId,
      revisionId: `${changeSetId}:r1`,
      createdAt: at,
    });
    const again = await reader.adoptCandidate({
      candidate: candidateFixture("candidate-w3", "第一版文本。"),
      changeSetId,
      revisionId: `${changeSetId}:r1`,
      createdAt: later,
    });
    expect(again.revisionId).toBe(first.revisionId);
    expect(again.changes).toEqual(first.changes);

    const second = await writer.adoptCandidate({
      candidate: candidateFixture("candidate-w3-b", "第二版文本。"),
      changeSetId,
      revisionId: `${changeSetId}:r2`,
      parentRevision: first,
      createdAt: later,
    });
    expect(second.revisionNumber).toBe(2);
    expect(second.parentRevisionId).toBe(`${changeSetId}:r1`);

    const entries = await diff.diffRevisions({
      changeSetId,
      fromRevisionId: `${changeSetId}:r1`,
      toRevisionId: `${changeSetId}:r2`,
    });
    expect(entries?.map(entry => entry.action)).toContain("added");
    expect((await reader.getCurrentRevision({ changeSetId }))?.revisionId).toBe(`${changeSetId}:r2`);
    expect(
      await diff.diffRevisions({
        changeSetId,
        fromRevisionId: `${changeSetId}:r1`,
        toRevisionId: `${changeSetId}:missing`,
      }),
    ).toBeUndefined();
  });
});
