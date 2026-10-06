import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaEngineDependencies } from "../../src/app/prismaComposition";
import { createChangeSetRevisionService } from "../../src/app/changeSetRevisionService";
import { createValidationRunService } from "../../src/app/validationRunService";
import { createCandidate, type Candidate } from "../../src/production/domain/candidate";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public";

const novelId = "novel-w3-validation";
const changeSetId = "cs-w3-validation";
const revisionId = `${changeSetId}:r1`;
const candidateId = "candidate-w3-validation";
const runId = "run-w3-validation";
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
    where: { aggregateType: "ValidationRun", objectId: { startsWith: "run-w3" } },
  });
}

function candidateFixture(): Candidate {
  return createCandidate({
    id: candidateId,
    taskId: "task-w3-validation",
    novelId,
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-w3", "scene-w3:rev-1"),
    }),
    change: { type: "text", sceneId: "scene-w3", text: "第一版文本。" },
    createdAt: at,
  });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
  await readerPrisma.$disconnect();
});

describe("[task:W3] [integration] Prisma validation run persistence", () => {
  it("persists a run before any commit and reads it through a fresh composition root", async () => {
    const writerDependencies = createPrismaEngineDependencies(prisma);
    await writerDependencies.candidates.save(candidateFixture());
    await createChangeSetRevisionService({ changeSets: writerDependencies.changeSets }).adoptCandidate(
      {
        candidate: candidateFixture(),
        changeSetId,
        revisionId,
        createdAt: at,
      },
    );
    const writer = createValidationRunService({
      changeSets: writerDependencies.changeSets,
      validations: writerDependencies.validations,
      scenes: writerDependencies.scenes,
      candidates: writerDependencies.candidates,
    });

    const run = await writer.runValidation({
      changeSetId,
      revisionId,
      validationId: runId,
      planVersionId: "plan-v1",
      candidateId,
      mustPreserve: ["不在正文里的短语"],
      createdAt: at,
    });
    expect(run.changeSetRevisionId).toBe(revisionId);

    // A separate composition root (its own PrismaClient) reads the run back.
    const readerDependencies = createPrismaEngineDependencies(readerPrisma);
    const reader = createValidationRunService({
      changeSets: readerDependencies.changeSets,
      validations: readerDependencies.validations,
      scenes: readerDependencies.scenes,
      candidates: readerDependencies.candidates,
    });
    const stored = await reader.getValidation({
      validationId: runId,
      changeSetId,
      revisionId,
    });
    expect(stored?.changeSetRevisionId).toBe(revisionId);
    expect(stored?.planVersionId).toBe("plan-v1");
    expect(stored?.createdAt).toBeInstanceOf(Date);
    expect(
      stored?.entryResults.flatMap(entry => entry.findings.map(finding => finding.code)),
    ).toContain("REQUIRED_PHRASE_MISSING");
    expect(
      await reader.getValidation({
        validationId: runId,
        changeSetId,
        revisionId: `${changeSetId}:r2`,
      }),
    ).toBe(undefined);
    expect(
      await reader.getValidation({
        validationId: runId,
        changeSetId: `${changeSetId}-other`,
        revisionId,
      }),
    ).toBe(undefined);
  });
});
