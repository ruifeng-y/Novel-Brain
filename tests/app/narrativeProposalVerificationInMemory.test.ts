import { createInMemoryNarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";
import { createNarrativeProposalVerificationEnvironment } from "../support/narrativeProposalFixtures";
import {
  runNarrativeProposalVerificationContract,
  runNarrativeProposalVerificationHarnessSmoke,
} from "../support/narrativeProposalVerificationContract";

runNarrativeProposalVerificationContract("InMemory", async () =>
  createNarrativeProposalVerificationEnvironment(createInMemoryNarrativeProposalPersistence()),
);
runNarrativeProposalVerificationHarnessSmoke();
