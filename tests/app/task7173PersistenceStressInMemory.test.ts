import { createInMemoryCapabilityPersistenceFixture } from "../support/capabilityPersistenceFixtures";
import { runTask7173PersistenceStressContract } from "../support/task7173PersistenceStressContract";

runTask7173PersistenceStressContract("InMemory", async () =>
  createInMemoryCapabilityPersistenceFixture().persistence,
);
