import { createInMemoryDependencyImpactPersistence } from "../../src/dependency/application/dependencyImpactPersistence";
import { createDependencyImpactVerificationEnvironment } from "../support/dependencyImpactFixtures";
import { runImpactPersistenceIntegrityContract } from "../support/impactPersistenceIntegrityContract";

runImpactPersistenceIntegrityContract("InMemory", async () =>
  createDependencyImpactVerificationEnvironment(
    createInMemoryDependencyImpactPersistence(),
  ),
);
