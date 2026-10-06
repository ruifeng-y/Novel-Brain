import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runSharedPrerequisiteIntegrationContract } from "../support/sharedPrerequisiteIntegrationContract";
import { createPrismaSharedPrerequisiteEnvironment } from "../support/sharedPrerequisiteFixtures";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain_test?schema=public";

const prisma = new PrismaClient();
const aggregateType = "SharedPrerequisiteTask24";

async function clearSharedPrerequisiteRecords(): Promise<void> {
  await prisma.currentObject.deleteMany({
    where: { aggregateType: { startsWith: aggregateType } },
  });
  await prisma.revisionRecord.deleteMany({
    where: { aggregateType: { startsWith: aggregateType } },
  });
}

beforeEach(clearSharedPrerequisiteRecords);
afterAll(async () => {
  await clearSharedPrerequisiteRecords();
  await prisma.$disconnect();
});

runSharedPrerequisiteIntegrationContract("Prisma", async () =>
  createPrismaSharedPrerequisiteEnvironment(prisma, aggregateType),
);

describe("Prisma [task:2.4] shared prerequisite fixture availability", () => {
  it("[integration] constructs one coherent fixture", async () => {
    const environment = await createPrismaSharedPrerequisiteEnvironment(prisma, aggregateType);
    expect(environment.fixture.novelId).toBe("novel-shared-prerequisite-2.4");
  });
});
