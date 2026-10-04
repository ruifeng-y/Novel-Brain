import { afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  clearPrismaCapabilityPersistenceFixture,
  createPrismaCapabilityPersistenceFixture,
} from "../support/capabilityPersistenceFixtures";
import { runTask7173PersistenceStressContract } from "../support/task7173PersistenceStressContract";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public";

const prisma = new PrismaClient();
const fixtureName = "Task7173PersistenceStress";

beforeEach(() => clearPrismaCapabilityPersistenceFixture(prisma, fixtureName));
afterAll(async () => {
  await clearPrismaCapabilityPersistenceFixture(prisma, fixtureName);
  await prisma.$disconnect();
});

runTask7173PersistenceStressContract("Prisma", async () =>
  createPrismaCapabilityPersistenceFixture(prisma, fixtureName).persistence,
);
