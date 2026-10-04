import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { verificationTaskProfiles } from "../../scripts/verificationTaskManifest";

describe("verificationTaskManifest combined Task 5.1 + 5.2", () => {
  it("registers all Observation Adapters and Recall Detection gates", () => {
    expect(verificationTaskProfiles["5.1-5.2"]).toEqual({
      id: "5.1-5.2",
      label: "[task:5.1-5.2]",
      requiredGates: [
        "domain",
        "integration",
        "persistence",
        "transaction",
        "concurrency",
        "recovery",
        "replay",
        "cross-system",
        "regression",
      ],
    });
    expect(() => parseVerificationCli(["system", "--task", "5.1-5.2"])).not.toThrow();
  });
});
