import { afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaNarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";
import { runNarrativeProposalRevisionConcurrencyContract } from "../support/narrativeProposalRevisionConcurrencyContract";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain_test?schema=public";
const prisma = new PrismaClient();
const aggregateType = "NarrativeProposalRevisionConcurrencyTask22";
const aggregateTypes = [`${aggregateType}:Proposal`, `${aggregateType}:Decision`];

async function clear(): Promise<void> {
  await prisma.currentObject.deleteMany({ where: { aggregateType: { in: aggregateTypes } } });
  await prisma.revisionRecord.deleteMany({ where: { aggregateType: { in: aggregateTypes } } });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

runNarrativeProposalRevisionConcurrencyContract("Prisma", () =>
  createPrismaNarrativeProposalPersistence(prisma, aggregateType),
);
