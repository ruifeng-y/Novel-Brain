import { afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaDependencyImpactPersistence } from "../../src/dependency/application/dependencyImpactPersistence";
import { createDependencyImpactVerificationEnvironment } from "../support/dependencyImpactFixtures";
import { runImpactPersistenceIntegrityContract } from "../support/impactPersistenceIntegrityContract";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public";

const prisma = new PrismaClient();
const aggregateType = "DependencyImpactTask23H";
const aggregateTypes = [`${aggregateType}:Relation`, `${aggregateType}:Impact`];

async function clear(): Promise<void> {
  await prisma.currentObject.deleteMany({
    where: { aggregateType: { in: aggregateTypes } },
  });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

runImpactPersistenceIntegrityContract("Prisma", async () =>
  createDependencyImpactVerificationEnvironment(
    createPrismaDependencyImpactPersistence(prisma, aggregateType),
  ),
);
