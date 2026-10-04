import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  PrismaRepository,
  PrismaRevisionedRepository,
} from "../../src/shared/infrastructure/prismaRepositories";
import {
  assertSupportedPersistencePayload,
  decodePersistencePayload,
  encodePersistencePayload,
} from "../../src/shared/domain/persistencePayload";
import {
  capabilityRevision,
  runCapabilityPersistenceTransactionContract,
  runCapabilityRepositoryContract,
  type CapabilityPersistenceEnvironment,
  type CapabilityRepositoryEnvironment,
  type CapabilityRevisionRecord,
} from "../support/capabilityPersistenceContract";
import {
  clearPrismaCapabilityPersistenceFixture,
  createPrismaCapabilityPersistenceFixture,
} from "../support/capabilityPersistenceFixtures";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public";
const prisma = new PrismaClient();
const fixtureName = "CapabilityContract";
const legacyRecordAggregateType = "CapabilityLegacyCodecRecord";

const capabilityCodec = {
  assertSupported: assertSupportedPersistencePayload,
  encode: encodePersistencePayload,
  decode: decodePersistencePayload,
};

function reviveRevision(payload: Record<string, unknown>): CapabilityRevisionRecord {
  return payload as unknown as CapabilityRevisionRecord;
}

beforeEach(async () => {
  await clearPrismaCapabilityPersistenceFixture(prisma, fixtureName);
  await prisma.currentObject.deleteMany({
    where: { aggregateType: legacyRecordAggregateType },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

runCapabilityRepositoryContract(
  "Prisma",
  async (): Promise<CapabilityRepositoryEnvironment> =>
    createPrismaCapabilityPersistenceFixture(prisma, fixtureName).repository,
);

runCapabilityPersistenceTransactionContract(
  "Prisma",
  async (): Promise<CapabilityPersistenceEnvironment> =>
    createPrismaCapabilityPersistenceFixture(prisma, fixtureName).persistence,
);

describe("Prisma persistence codec boundary", () => {
  it("leaves legacy strings and tagged-looking objects to capability-specific revive", async () => {
    interface LegacyPayload {
      readonly id: string;
      readonly novelId: string;
      readonly state: {
        readonly value: unknown;
      };
    }
    const legacyRepository = new PrismaRepository<LegacyPayload>(
      prisma,
      legacyRecordAggregateType,
      (payload) => payload as unknown as LegacyPayload,
    );

    const legacy = {
      id: "legacy-codec-1",
      novelId: "novel-legacy",
      state: {
        value: { $date: "2026-10-04T00:00:00.000Z", source: "legacy" },
      },
    };
    const legacyString = {
      id: "legacy-codec-2",
      novelId: "novel-legacy",
      state: { value: "2026-10-04T00:00:00.000Z" },
    };

    await legacyRepository.save(legacy);
    await legacyRepository.save(legacyString);

    expect((await legacyRepository.findById("legacy-codec-1"))?.state.value).toEqual({
      $date: "2026-10-04T00:00:00.000Z",
      source: "legacy",
    });
    expect((await legacyRepository.findById("legacy-codec-2"))?.state.value).toBe(
      "2026-10-04T00:00:00.000Z",
    );
  });
});

describe("Prisma immutable revision concurrency", () => {
  it("maps concurrent ordinary save conflicts without overwriting the immutable payload", async () => {
    let findCalls = 0;
    let releaseFind!: () => void;
    const findBarrier = new Promise<void>((resolve) => {
      releaseFind = resolve;
    });
    let savedPayload: unknown;

    function controlledClient(): ConstructorParameters<
      typeof PrismaRevisionedRepository<CapabilityRevisionRecord>
    >[0] {
      return {
        $executeRawUnsafe: async () => 0,
        revisionRecord: {
          findUnique: async () => {
            findCalls += 1;
            if (findCalls <= 2) {
              await findBarrier;
              return undefined;
            }
            return savedPayload === undefined ? undefined : { payload: savedPayload };
          },
          create: async ({ data }: { data: { payload: unknown } }) => {
            if (savedPayload !== undefined) throw { code: "P2002" };
            savedPayload = data.payload;
            return data;
          },
          createMany: async ({ data }: { data: readonly { payload: unknown }[] }) => {
            if (savedPayload !== undefined) return { count: 0 };
            savedPayload = data[0]?.payload;
            return { count: 1 };
          },
          upsert: async ({ create }: { create: { payload: unknown } }) => {
            savedPayload = create.payload;
            return create;
          },
        },
        currentObject: {
          upsert: async () => ({}),
        },
      } as unknown as ConstructorParameters<
        typeof PrismaRevisionedRepository<CapabilityRevisionRecord>
      >[0];
    }

    const first = new PrismaRevisionedRepository(
      controlledClient(),
      "CapabilityControlledRevision",
      reviveRevision,
      capabilityCodec,
    );
    const second = new PrismaRevisionedRepository(
      controlledClient(),
      "CapabilityControlledRevision",
      reviveRevision,
      capabilityCodec,
    );

    const attempts = [
      first.save(capabilityRevision("revision-controlled", "rev-same", "first")),
      second.save(capabilityRevision("revision-controlled", "rev-same", "second")),
    ];
    const resultsPromise = Promise.allSettled(attempts);
    while (findCalls < 2) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    releaseFind();
    const results = await resultsPromise;

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect((rejected[0]?.reason as Error).message).toBe(
      "Revision already exists: revision-controlled:rev-same",
    );
    expect(savedPayload).toMatchObject({
      state: { label: expect.stringMatching(/^(first|second)$/) },
    });
  });
});
