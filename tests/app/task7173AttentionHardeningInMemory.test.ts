import { createInMemoryAttentionDispositionPersistence } from "../../src/recall/attention/attentionDispositionPersistence";
import { runTask7173AttentionHardeningContract } from "../support/task7173AttentionHardeningContract";

runTask7173AttentionHardeningContract(
  "InMemory",
  createInMemoryAttentionDispositionPersistence,
);
