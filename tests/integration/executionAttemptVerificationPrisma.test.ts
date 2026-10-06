import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createPrismaExecutionAttemptPersistence,
} from "../../src/production/application/executionAttemptPersistence";
import {
  recordExecutionAttemptFromRuntimeResult,
} from "../../src/production/application/executionAttemptService";
import { candidateSourceReference } from "../../src/production/domain/executionAttempt";
import { isImmutableTimestamp } from "../../src/shared/domain/observationSource";
import { createExecutionAttemptVerificationFixture } from "../support/executionAttemptFixtures";
import {
  runExecutionAttemptVerificationSmokeContract,
} from "../support/executionAttemptVerificationContract";
import {
  runExecutionAttemptPersistenceCorruptionContract,
} from "../support/executionAttemptPersistenceCorruptionContract";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain_test?schema=public";
const prisma = new PrismaClient();
const aggregateType = "ExecutionAttemptTask21";

async function clearExecutionAttempts(): Promise<void> {
  await prisma.currentObject.deleteMany({ where: { aggregateType } });
  await prisma.revisionRecord.deleteMany({ where: { aggregateType } });
}

beforeEach(clearExecutionAttempts);
afterAll(async () => {
  await clearExecutionAttempts();
  await prisma.$disconnect();
});

runExecutionAttemptVerificationSmokeContract("Prisma", "2.1", async () =>
  createExecutionAttemptVerificationFixture(
    createPrismaExecutionAttemptPersistence(prisma, aggregateType),
  ),
);

describe("Prisma [task:2.1] execution attempt capability persistence", () => {
  it("keeps generic CurrentObject and RevisionRecord history without schema changes", async () => {
    const environment = createExecutionAttemptVerificationFixture(
      createPrismaExecutionAttemptPersistence(prisma, aggregateType),
    );
    const recorded = await recordExecutionAttemptFromRuntimeResult({
      persistence: environment.persistence,
      executionKey: "prisma-parity-1",
      relation: "initial",
      generationTask: environment.generationTask,
      routingDecision: environment.routingDecision,
      runtimeRequest: environment.runtimeRequest,
      runtimeResult: environment.runtimeResult,
      startedAt: new Date("2026-10-04T00:00:00.000Z"),
      completedAt: new Date("2026-10-04T00:01:00.000Z"),
      candidate: environment.candidate,
    });

    const current = await prisma.currentObject.findUnique({
      where: {
        aggregateType_objectId: { aggregateType, objectId: recorded.id },
      },
    });
    const revisions = await prisma.revisionRecord.findMany({
      where: { aggregateType, objectId: recorded.id },
      orderBy: { revisionId: "asc" },
    });

    expect(current?.revisionId).toBe(recorded.currentRevisionId);
    expect(revisions).toHaveLength(3);
    expect(await environment.persistence.attempts.findById(recorded.id)).toEqual(recorded);
    expect(recorded.candidateReference).toEqual(candidateSourceReference(environment.candidate));
    const loaded = await environment.persistence.attempts.findById(recorded.id);
    expect(isImmutableTimestamp(loaded?.createdAt)).toBe(true);
    expect(isImmutableTimestamp(loaded?.updatedAt)).toBe(true);
    expect(isImmutableTimestamp(loaded?.startedAt)).toBe(true);
    expect(isImmutableTimestamp(loaded?.endedAt)).toBe(true);
  });
});

runExecutionAttemptPersistenceCorruptionContract("Prisma", async () => {
  const persistence = createPrismaExecutionAttemptPersistence(prisma, aggregateType);
  return {
    persistence,
    makeCurrentStale: async (current, stale) => {
      await persistence.attempts.saveIfCurrent(current.currentRevisionId, stale);
    },
    removeHistoryRevision: async (attempt, revisionId) => {
      await prisma.revisionRecord.delete({
        where: {
          aggregateType_objectId_revisionId: {
            aggregateType,
            objectId: attempt.id,
            revisionId,
          },
        },
      });
    },
  };
});
