import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaEventStore } from "../../src/shared/infrastructure/prismaRepositories";
import {
  clearPrismaCapabilityPersistenceFixture,
  createPrismaCapabilityPersistenceFixture,
} from "../support/capabilityPersistenceFixtures";
import {
  createEventStoreObservationEnvironment,
} from "../support/observationSourceFixtures";
import {
  runCapabilityVerificationSmokeContract,
  type CapabilityVerificationEnvironment,
} from "../support/capabilityVerificationContract";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain_test?schema=public";

const prisma = new PrismaClient();
const eventStore = new PrismaEventStore(prisma);
const fixtureName = "CapabilityVerificationSmoke";
const novelId = "novel-verification-smoke-prisma";
const sourceIdentity = "event-store:verification-smoke-prisma";

async function createPrismaVerificationEnvironment(): Promise<CapabilityVerificationEnvironment> {
  return {
    ...createPrismaCapabilityPersistenceFixture(prisma, fixtureName),
    eventStore,
    novelId,
    sourceIdentity,
    createObservationEnvironment: async () =>
      createEventStoreObservationEnvironment({
        eventStore,
        novelId,
        sourceIdentity,
      }),
  };
}

beforeAll(async () => {
  await prisma.domainEvent.deleteMany({ where: { novelId } });
});

beforeEach(async () => {
  await prisma.domainEvent.deleteMany({ where: { novelId } });
  await clearPrismaCapabilityPersistenceFixture(prisma, fixtureName);
});

afterAll(async () => {
  await prisma.domainEvent.deleteMany({ where: { novelId } });
  await prisma.$disconnect();
});

describe("Prisma verification harness fixture parity", () => {
  it("keeps fixture cleanup scoped to the smoke adapter namespace", async () => {
    const environment = await createPrismaVerificationEnvironment();
    await environment.repository.records.saveIfAbsent({
      id: "scoped-record",
      novelId,
      state: { label: "scoped", flags: [1] },
    });

    expect(await environment.repository.records.findById("scoped-record")).toBeDefined();
    await clearPrismaCapabilityPersistenceFixture(prisma, fixtureName);
    expect(await environment.repository.records.findById("scoped-record")).toBeUndefined();
  });
});

runCapabilityVerificationSmokeContract("Prisma", "1.3", createPrismaVerificationEnvironment);
