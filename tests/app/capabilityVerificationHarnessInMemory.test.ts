import { describe, expect, it } from "vitest";
import { InMemoryEventStore } from "../../src/safety/infrastructure/eventStore";
import {
  createInMemoryCapabilityPersistenceFixture,
} from "../support/capabilityPersistenceFixtures";
import {
  createEventStoreObservationEnvironment,
} from "../support/observationSourceFixtures";
import {
  runCapabilityVerificationSmokeContract,
  type CapabilityVerificationEnvironment,
} from "../support/capabilityVerificationContract";
import { capabilityRecord } from "../support/capabilityPersistenceContract";

async function createInMemoryVerificationEnvironment(): Promise<CapabilityVerificationEnvironment> {
  const eventStore = new InMemoryEventStore();
  return {
    ...createInMemoryCapabilityPersistenceFixture(),
    eventStore,
    novelId: "novel-verification-smoke",
    sourceIdentity: "event-store:verification-smoke",
    createObservationEnvironment: async () =>
      createEventStoreObservationEnvironment({
        eventStore,
        novelId: "novel-verification-smoke",
        sourceIdentity: "event-store:verification-smoke",
      }),
  };
}

describe("verification fixture builders", () => {
  it("builds independent capability fixture snapshots for isolated smoke cases", async () => {
    const first = createInMemoryCapabilityPersistenceFixture();
    const second = createInMemoryCapabilityPersistenceFixture();
    const input = capabilityRecord("fixture-isolation", "first");

    await first.repository.records.save(input);
    expect(await first.repository.records.findById("fixture-isolation")).toBeDefined();
    expect(await second.repository.records.findById("fixture-isolation")).toBeUndefined();
  });
});

runCapabilityVerificationSmokeContract("InMemory", "1.3", createInMemoryVerificationEnvironment);
