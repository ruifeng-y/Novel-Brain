import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createPrismaEngineDependencies,
  createPrismaEngineServer,
} from "../../src/app/prismaComposition";
import { prismaCommitAggregateTypes } from "../../src/app/prismaCommitTransaction";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain_test?schema=public";
const prisma = new PrismaClient();

const novelId = "novel-prisma-composition";
const aggregateTypes = [
  "Novel",
  "GenerationTask",
  "Candidate",
  prismaCommitAggregateTypes.scene,
  prismaCommitAggregateTypes.canonicalFact,
  prismaCommitAggregateTypes.stateRecord,
  prismaCommitAggregateTypes.narrativeCommit,
  "NarrativeProposalTask22:Proposal",
  "NarrativeProposalTask22:Decision",
  "RunPlanRevision",
  "RunPlanApproval",
  "ProductionRun",
  "AttentionDisposition",
];

async function clear(): Promise<void> {
  await prisma.domainEvent.deleteMany({ where: { novelId } });
  await prisma.currentObject.deleteMany({ where: { aggregateType: { in: aggregateTypes } } });
  await prisma.revisionRecord.deleteMany({ where: { aggregateType: { in: aggregateTypes } } });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("Prisma [task:runtime-2] engine composition root", () => {
  it("persists a foundation proposal across a fresh composition root", async () => {
    const first = createPrismaEngineServer(prisma);
    const created = await first.inject({
      method: "POST",
      url: "/foundation/entries",
      headers: { "x-author-id": "author-1", "x-workspace-id": novelId },
      payload: {
        entryId: "entry-durable",
        novelId,
        proposalId: "proposal-durable",
        mode: "idea",
        idea: "A city remembers every promise it breaks.",
        generation: {
          taskId: "task-durable",
          agentRole: "planner",
          modelPolicy: {
            provider: "deterministic",
            model: "foundation-reference",
            maxOutputTokens: 512,
          },
          basedOnVersionSet: {
            novel: {
              aggregateType: "Novel",
              objectId: novelId,
              revisionId: "rev-1",
            },
          },
        },
      },
    });
    expect(created.statusCode).toBe(201);
    await first.close();

    const second = createPrismaEngineServer(prisma);
    const workspace = await second.inject({ method: "GET", url: `/workspace/${novelId}` });
    expect(workspace.statusCode).toBe(200);
    expect(workspace.body).toContain("proposal-durable");
    await second.close();
  });

  it("binds every canonical repository and the commit transaction to Prisma", () => {
    const dependencies = createPrismaEngineDependencies(prisma);

    expect(dependencies.commitTransaction.constructor.name).toBe("PrismaCommitTransaction");
    expect(dependencies.novels.constructor.name).toBe("PrismaRepository");
    expect(dependencies.generationTasks.constructor.name).toBe("PrismaRepository");
    expect(dependencies.candidates.constructor.name).toBe("PrismaRevisionedRepository");
    expect(dependencies.scenes.constructor.name).toBe("PrismaRevisionedRepository");
    expect(dependencies.canonicalFacts.constructor.name).toBe("PrismaRevisionedRepository");
    expect(dependencies.stateRecords.constructor.name).toBe("PrismaRevisionedRepository");
    expect(dependencies.eventStore.constructor.name).toBe("PrismaEventStore");
    expect(dependencies.product?.foundationPersistence).toBeDefined();
  });
});
