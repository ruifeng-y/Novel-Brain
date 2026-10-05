import { describe } from "vitest";
import { createInMemoryProductionPersistenceEnvironment } from "../../src/shared/infrastructure/inMemoryProductionPersistenceBoundary";
import { runProductionPersistenceBoundaryContract } from "../support/productionPersistenceBoundaryContract";

describe("[task:P1.2] InMemory production persistence boundary", () => {
  runProductionPersistenceBoundaryContract("InMemory", async () => ({
    environment: createInMemoryProductionPersistenceEnvironment(),
  }));
});
