import { createInMemoryNarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";
import { runNarrativeProposalRevisionConcurrencyContract } from "../support/narrativeProposalRevisionConcurrencyContract";

runNarrativeProposalRevisionConcurrencyContract("InMemory", createInMemoryNarrativeProposalPersistence);
