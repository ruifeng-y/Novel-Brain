import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaEngineDependencies } from "../../src/app/prismaComposition";
import { createChangeSetRevisionService } from "../../src/app/changeSetRevisionService";
import { createReviewDecisionService } from "../../src/app/reviewDecisionService";
import { createCandidate, type Candidate } from "../../src/production/domain/candidate";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public";

const novelId = "novel-w3-approval";
const changeSetId = "cs-w3-approval";
const revisionId = `${changeSetId}:r1`;
const candidateId = "candidate-w3-approval";
const secondCandidateId = "candidate-w3-approval-2";
const reviewDecisionId = "review-w3-approval";
const at = new Date("2026-10-06T00:00:00.000Z");

const prisma = new PrismaClient();
const readerPrisma = new PrismaClient();

async function clear(): Promise<void> {
  await prisma.currentObject.deleteMany({
    where: { novelId, aggregateType: { in: ["Candidate", "ChangeSet"] } },
  });
  await prisma.revisionRecord.deleteMany({
    where: { novelId, aggregateType: { in: ["Candidate", "ChangeSet"] } },
  });
  await prisma.currentObject.deleteMany({
    where: { aggregateType: "ReviewDecision", objectId: { startsWith: "review-w3" } },
  });
}

function candidateFixture(): Candidate {
  return createCandidate({
    id: candidateId,
    taskId: "task-w3-approval",
    novelId,
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-w3", "scene-w3:rev-1"),
    }),
    change: { type: "text", sceneId: "scene-w3", text: "第一版文本。" },
    createdAt: at,
  });
}

function secondCandidateFixture(): Candidate {
  return createCandidate({
    id: secondCandidateId,
    taskId: "task-w3-approval-2",
    novelId,
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-w3", "scene-w3:rev-1"),
    }),
    change: { type: "text", sceneId: "scene-w3", text: "第二版文本。" },
    createdAt: at,
  });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
  await readerPrisma.$disconnect();
});

describe("[task:W3] [integration] Prisma review decision persistence", () => {
  it("persists a decision before any commit and enumerates it for its revision only", async () => {
    const writerDependencies = createPrismaEngineDependencies(prisma);
    await writerDependencies.candidates.save(candidateFixture());
    await writerDependencies.candidates.save(secondCandidateFixture());
    const changeSetRevisions = createChangeSetRevisionService({
      changeSets: writerDependencies.changeSets,
    });
    await changeSetRevisions.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId,
      revisionId,
      createdAt: at,
    });
    await changeSetRevisions.adoptCandidate({
      candidate: secondCandidateFixture(),
      changeSetId,
      revisionId: `${changeSetId}:r2`,
      parentRevision: await changeSetRevisions.getRevision({ changeSetId, revisionId }),
      createdAt: at,
    });
    const writer = createReviewDecisionService({
      reviews: writerDependencies.reviews,
      changeSets: writerDependencies.changeSets,
    });

    const decision = await writer.recordReview({
      reviewDecisionId,
      changeSetId,
      revisionId,
      approvalScope: {
        requirementDomain: "manuscript",
        targetType: "manuscript",
        objectId: "scene-w3",
      },
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "可以提交。",
      evidenceReferences: ["run-w3-approval"],
      createdAt: at,
    });
    expect(decision.changeSetRevisionId).toBe(revisionId);

    // A separate composition root (its own PrismaClient) reads the decision back.
    const readerDependencies = createPrismaEngineDependencies(readerPrisma);
    const reader = createReviewDecisionService({
      reviews: readerDependencies.reviews,
      changeSets: readerDependencies.changeSets,
    });
    const stored = await reader.listForRevision({ changeSetId, revisionId });
    expect(stored.map(entry => entry.id)).toEqual([reviewDecisionId]);
    expect(stored[0]?.decision).toBe("approve");
    expect(stored[0]?.createdAt).toBeInstanceOf(Date);
    expect(stored[0]?.approvalScope.objectId).toBe("scene-w3");

    expect(await reader.listForRevision({ changeSetId, revisionId: `${changeSetId}:r2` })).toHaveLength(
      0,
    );
  });
});
