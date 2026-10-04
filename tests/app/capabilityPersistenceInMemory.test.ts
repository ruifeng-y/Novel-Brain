import { describe, expect, it } from "vitest";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
import {
  capabilityRecord,
  runCapabilityPersistenceTransactionContract,
  runCapabilityRepositoryContract,
  type CapabilityPersistenceEnvironment,
  type CapabilityRepositoryEnvironment,
} from "../support/capabilityPersistenceContract";
import {
  createInMemoryCapabilityPersistenceFixture,
} from "../support/capabilityPersistenceFixtures";

async function createInMemoryPersistenceEnvironment(): Promise<CapabilityPersistenceEnvironment> {
  return createInMemoryCapabilityPersistenceFixture().persistence;
}

runCapabilityRepositoryContract("InMemory", async (): Promise<CapabilityRepositoryEnvironment> => {
  return createInMemoryCapabilityPersistenceFixture().repository;
});

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
