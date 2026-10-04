import { createInMemoryDependencyImpactPersistence } from "../../src/dependency/application/dependencyImpactPersistence";
import { runDependencyImpactVerificationContract } from "../support/dependencyImpactVerificationContract";
import { createDependencyImpactVerificationEnvironment } from "../support/dependencyImpactFixtures";

runDependencyImpactVerificationContract("InMemory", "2.3", async () =>
  createDependencyImpactVerificationEnvironment(
    createInMemoryDependencyImpactPersistence(),
  ),
);
