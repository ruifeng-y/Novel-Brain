import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  PrismaRepository,
  PrismaRevisionedRepository,
} from "../../src/shared/infrastructure/prismaRepositories";
import { PrismaPersistenceTransaction } from "../../src/shared/infrastructure/persistenceTransaction";
import {
  assertSupportedPersistencePayload,
  decodePersistencePayload,
  encodePersistencePayload,
} from "../../src/shared/domain/persistencePayload";
import {
  capabilityRecord,
  capabilityRevision,
  runCapabilityPersistenceTransactionContract,
  runCapabilityRepositoryContract,
  type CapabilityPersistenceEnvironment,
  type CapabilityPersistenceWork,
  type CapabilityRecord,
  type CapabilityRepositoryEnvironment,
  type CapabilityRevisionRecord,
} from "../support/capabilityPersistenceContract";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public";
const prisma = new PrismaClient();
const recordAggregateType = "CapabilityContractRecord";
const revisionAggregateType = "CapabilityContractRevision";
const otherRecordAggregateType = "CapabilityContractRecordOther";
const otherRevisionAggregateType = "CapabilityContractRevisionOther";
const legacyRecordAggregateType = "CapabilityLegacyCodecRecord";

const capabilityCodec = {
  assertSupported: assertSupportedPersistencePayload,
  encode: encodePersistencePayload,
  decode: decodePersistencePayload,
};

function reviveRecord(payload: Record<string, unknown>): CapabilityRecord {
  return payload as unknown as CapabilityRecord;
}

function reviveRevision(payload: Record<string, unknown>): CapabilityRevisionRecord {
  return payload as unknown as CapabilityRevisionRecord;
}

function recordPort(
  client: ConstructorParameters<typeof PrismaRepository<CapabilityRecord>>[0],
  aggregateType = recordAggregateType,
): CapabilityPersistenceWork["records"] {
  const repository = new PrismaRepository(
    client,
    aggregateType,
    reviveRecord,
    capabilityCodec,
  );
  return {
    saveIfAbsent: (entity) => repository.saveIfAbsent(entity),
    findById: (id) => repository.findById(id),
    listByNovel: (novelId) => repository.listByNovel(novelId),
  };
}

function revisionPort(
  client: ConstructorParameters<typeof PrismaRevisionedRepository<CapabilityRevisionRecord>>[0],
  aggregateType = revisionAggregateType,
): CapabilityPersistenceWork["revisions"] {
  const repository = new PrismaRevisionedRepository(
    client,
    aggregateType,
    reviveRevision,
    capabilityCodec,
  );
  return {
    saveRevisionIfAbsent: (entity) => repository.saveRevisionIfAbsent(entity),
    saveIfCurrent: (expectedRevisionId, entity) =>
      repository.saveIfCurrent(expectedRevisionId, entity),
    findById: (id) => repository.findById(id),
    getRevision: (id, revisionId) => repository.getRevision(id, revisionId),
    listByNovel: (novelId) => repository.listByNovel(novelId),
  };
}

async function createPrismaPersistenceEnvironment(): Promise<CapabilityPersistenceEnvironment> {
  const fullRevisionSaves = new WeakMap<
    object,
    (entity: CapabilityRevisionRecord) => Promise<void>
  >();
  const transaction = new PrismaPersistenceTransaction<CapabilityPersistenceWork>(
    prisma,
    (client) => {
      const work: CapabilityPersistenceWork = {
        records: recordPort(client),
        revisions: revisionPort(client),
        otherRecords: recordPort(client, otherRecordAggregateType),
        otherRevisions: revisionPort(client, otherRevisionAggregateType),
      };
      fullRevisionSaves.set(work, (entity) =>
        new PrismaRevisionedRepository(
          client,
          otherRevisionAggregateType,
          reviveRevision,
          capabilityCodec,
        ).save(entity),
      );
      return work;
    },
  );
  return {
    transaction,
    external: {
      records: recordPort(prisma),
      revisions: revisionPort(prisma),
      otherRecords: recordPort(prisma, otherRecordAggregateType),
      otherRevisions: revisionPort(prisma, otherRevisionAggregateType),
    },
    saveRevision: (work, entity) => {
      const save = fullRevisionSaves.get(work);
      if (!save) throw new Error("Unknown transaction work");
      return save(entity);
    },
  };
}
beforeEach(async () => {
  await prisma.currentObject.deleteMany({
    where: {
      aggregateType: {
        in: [
          recordAggregateType,
          revisionAggregateType,
          otherRecordAggregateType,
          otherRevisionAggregateType,
          legacyRecordAggregateType,
        ],
      },
    },
  });
  await prisma.revisionRecord.deleteMany({
    where: {
      aggregateType: {
        in: [revisionAggregateType, otherRevisionAggregateType],
      },
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

runCapabilityRepositoryContract("Prisma", async (): Promise<CapabilityRepositoryEnvironment> => ({
  records: new PrismaRepository(prisma, recordAggregateType, reviveRecord, capabilityCodec),
  revisions: new PrismaRevisionedRepository(
    prisma,
    revisionAggregateType,
    reviveRevision,
    capabilityCodec,
  ),
}));

runCapabilityPersistenceTransactionContract("Prisma", createPrismaPersistenceEnvironment);

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
