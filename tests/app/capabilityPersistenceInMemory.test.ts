import { describe, expect, it } from "vitest";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
import {
  InMemoryRepository,
  InMemoryRevisionedRepository,
} from "../../src/app/inMemoryRepositories";
import { InMemoryPersistenceTransaction } from "../../src/shared/infrastructure/persistenceTransaction";
import { capabilityPersistencePayloadCodec } from "../../src/shared/domain/persistencePayload";
import {
  capabilityRecord,
  runCapabilityPersistenceTransactionContract,
  runCapabilityRepositoryContract,
  type CapabilityPersistenceEnvironment,
  type CapabilityPersistenceWork,
  type CapabilityRecord,
  type CapabilityRepositoryEnvironment,
  type CapabilityRevisionRecord,
} from "../support/capabilityPersistenceContract";

async function createInMemoryPersistenceEnvironment(): Promise<CapabilityPersistenceEnvironment> {
  const records = new InMemoryRepository<CapabilityRecord>(capabilityPersistencePayloadCodec);
  const revisions = new InMemoryRevisionedRepository<CapabilityRevisionRecord>(capabilityPersistencePayloadCodec);
  const otherRecords = new InMemoryRepository<CapabilityRecord>(capabilityPersistencePayloadCodec);
  const otherRevisions = new InMemoryRevisionedRepository<CapabilityRevisionRecord>(capabilityPersistencePayloadCodec);
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
    transaction,
    external: {
      records: transaction.unique(records),
      revisions: transaction.revisioned(revisions),
      otherRecords: transaction.unique(otherRecords),
      otherRevisions: transaction.revisioned(otherRevisions),
    },
    saveRevision: (_work, entity) => transaction.saveRevision(otherRevisions, entity),
  };
}

runCapabilityRepositoryContract("InMemory", async (): Promise<CapabilityRepositoryEnvironment> => ({
  records: new InMemoryRepository<CapabilityRecord>(capabilityPersistencePayloadCodec),
  revisions: new InMemoryRevisionedRepository<CapabilityRevisionRecord>(capabilityPersistencePayloadCodec),
}));

runCapabilityPersistenceTransactionContract("InMemory", createInMemoryPersistenceEnvironment);

describe("InMemory capability persistence write isolation", () => {
  it("queues external writes until the active transaction boundary completes", async () => {
    const environment = await createInMemoryPersistenceEnvironment();
    let externalWriteSettled = false;
    const started = deferred();
    const release = deferred();

    const active = environment.transaction.run(async (work) => {
      await work.records.saveIfAbsent(capabilityRecord("record-transaction"));
      started.resolve();
      await release.promise;
    });
    await started.promise;

    const externalWrite = environment.external.records
      .saveIfAbsent(capabilityRecord("record-external"))
      .finally(() => {
        externalWriteSettled = true;
      });
    await Promise.resolve();
    expect(externalWriteSettled).toBe(false);

    release.resolve();
    await active;
    await externalWrite;

    expect(externalWriteSettled).toBe(true);
    await environment.transaction.run(async (work) => {
      expect(await work.records.findById("record-transaction")).toBeDefined();
      expect(await work.records.findById("record-external")).toBeDefined();
    });
  });
});
