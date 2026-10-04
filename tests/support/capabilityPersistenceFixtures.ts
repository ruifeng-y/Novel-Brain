import {
  InMemoryRepository,
  InMemoryRevisionedRepository,
} from "../../src/app/inMemoryRepositories";
import {
  InMemoryPersistenceTransaction,
  PrismaPersistenceTransaction,
} from "../../src/shared/infrastructure/persistenceTransaction";
import {
  PrismaRepository,
  PrismaRevisionedRepository,
} from "../../src/shared/infrastructure/prismaRepositories";
import {
  assertSupportedPersistencePayload,
  capabilityPersistencePayloadCodec,
  decodePersistencePayload,
  encodePersistencePayload,
} from "../../src/shared/domain/persistencePayload";
import type {
  CapabilityPersistenceEnvironment,
  CapabilityRecord,
  CapabilityRepositoryEnvironment,
  CapabilityRevisionRecord,
  CapabilityPersistenceWork,
} from "./capabilityPersistenceContract";

export interface CapabilityPersistenceFixture {
  readonly repository: CapabilityRepositoryEnvironment;
  readonly persistence: CapabilityPersistenceEnvironment;
}

type PrismaRepositoryClient = ConstructorParameters<typeof PrismaRepository<CapabilityRecord>>[0];
type PrismaPersistenceClient = ConstructorParameters<
  typeof PrismaPersistenceTransaction<CapabilityPersistenceWork>
>[0];

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

export function createInMemoryCapabilityPersistenceFixture(): CapabilityPersistenceFixture {
  const records = new InMemoryRepository<CapabilityRecord>(capabilityPersistencePayloadCodec);
  const revisions = new InMemoryRevisionedRepository<CapabilityRevisionRecord>(
    capabilityPersistencePayloadCodec,
  );
  const otherRecords = new InMemoryRepository<CapabilityRecord>(capabilityPersistencePayloadCodec);
  const otherRevisions = new InMemoryRevisionedRepository<CapabilityRevisionRecord>(
    capabilityPersistencePayloadCodec,
  );
  const transaction = new InMemoryPersistenceTransaction<CapabilityPersistenceWork>(
    (access) => ({
      records: access.unique(records),
      revisions: access.revisioned(revisions),
      otherRecords: access.unique(otherRecords),
      otherRevisions: access.revisioned(otherRevisions),
    }),
    [records, revisions, otherRecords, otherRevisions],
  );

  return {
    repository: { records, revisions },
    persistence: {
      transaction,
      external: {
        records: transaction.unique(records),
        revisions: transaction.revisioned(revisions),
        otherRecords: transaction.unique(otherRecords),
        otherRevisions: transaction.revisioned(otherRevisions),
      },
      saveRevision: (_work, entity) => transaction.saveRevision(otherRevisions, entity),
    },
  };
}

function recordPort(
  client: PrismaRepositoryClient,
  aggregateType: string,
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
  client: PrismaRepositoryClient,
  aggregateType: string,
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

export interface PrismaCapabilityPersistenceAggregateTypes {
  readonly records: string;
  readonly revisions: string;
  readonly otherRecords: string;
  readonly otherRevisions: string;
}

export function prismaCapabilityPersistenceAggregateTypes(
  fixtureName: string,
): PrismaCapabilityPersistenceAggregateTypes {
  return {
    records: `${fixtureName}Record`,
    revisions: `${fixtureName}Revision`,
    otherRecords: `${fixtureName}RecordOther`,
    otherRevisions: `${fixtureName}RevisionOther`,
  };
}

export function createPrismaCapabilityPersistenceFixture(
  client: PrismaPersistenceClient,
  fixtureName: string,
): CapabilityPersistenceFixture {
  const aggregateTypes = prismaCapabilityPersistenceAggregateTypes(fixtureName);
  const fullRevisionSaves = new WeakMap<
    object,
    (entity: CapabilityRevisionRecord) => Promise<void>
  >();
  const transaction = new PrismaPersistenceTransaction<CapabilityPersistenceWork>(
    client,
    (transactionClient) => {
      const work: CapabilityPersistenceWork = {
        records: recordPort(transactionClient, aggregateTypes.records),
        revisions: revisionPort(transactionClient, aggregateTypes.revisions),
        otherRecords: recordPort(transactionClient, aggregateTypes.otherRecords),
        otherRevisions: revisionPort(transactionClient, aggregateTypes.otherRevisions),
      };
      fullRevisionSaves.set(work, (entity) =>
        new PrismaRevisionedRepository(
          transactionClient,
          aggregateTypes.otherRevisions,
          reviveRevision,
          capabilityCodec,
        ).save(entity),
      );
      return work;
    },
  );

  return {
    repository: {
      records: new PrismaRepository(
        client,
        aggregateTypes.records,
        reviveRecord,
        capabilityCodec,
      ),
      revisions: new PrismaRevisionedRepository(
        client,
        aggregateTypes.revisions,
        reviveRevision,
        capabilityCodec,
      ),
    },
    persistence: {
      transaction,
      external: {
        records: recordPort(client, aggregateTypes.records),
        revisions: revisionPort(client, aggregateTypes.revisions),
        otherRecords: recordPort(client, aggregateTypes.otherRecords),
        otherRevisions: revisionPort(client, aggregateTypes.otherRevisions),
      },
      saveRevision: (work, entity) => {
        const save = fullRevisionSaves.get(work);
        if (!save) throw new Error("Unknown transaction work");
        return save(entity);
      },
    },
  };
}

export async function clearPrismaCapabilityPersistenceFixture(
  client: PrismaPersistenceClient,
  fixtureName: string,
): Promise<void> {
  const aggregateTypes = Object.values(
    prismaCapabilityPersistenceAggregateTypes(fixtureName),
  );
  await client.currentObject.deleteMany({
    where: { aggregateType: { in: aggregateTypes } },
  });
  await client.revisionRecord.deleteMany({
    where: { aggregateType: { in: aggregateTypes } },
  });
}
