import { afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaAttentionDispositionPersistence } from "../../src/recall/attention/attentionDispositionPersistence";
import { runTask7173AttentionHardeningContract } from "../support/task7173AttentionHardeningContract";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public";

const prisma = new PrismaClient();
const aggregateType = "AttentionDispositionTask7173";

async function clear(): Promise<void> {
  await prisma.currentObject.deleteMany({ where: { aggregateType } });
  await prisma.revisionRecord.deleteMany({ where: { aggregateType } });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

runTask7173AttentionHardeningContract("Prisma", () =>
  createPrismaAttentionDispositionPersistence(prisma, aggregateType),
);
