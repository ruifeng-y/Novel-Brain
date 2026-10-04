import {
  createInMemoryExecutionAttemptPersistence,
} from "../../src/production/application/executionAttemptPersistence";
import { createExecutionAttemptVerificationFixture } from "../support/executionAttemptFixtures";
import {
  runExecutionAttemptVerificationSmokeContract,
} from "../support/executionAttemptVerificationContract";

runExecutionAttemptVerificationSmokeContract(
  "InMemory",
  "2.1",
  async () => createExecutionAttemptVerificationFixture(createInMemoryExecutionAttemptPersistence()),
);
