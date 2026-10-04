import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { verificationTaskProfiles } from "../../scripts/verificationTaskManifest";

describe("verificationTaskManifest combined Task 4.3 + 4.4", () => {
  it("registers all Checkpoint Coordination and Execution Recovery gates", () => {
    expect(verificationTaskProfiles["4.3-4.4"]).toEqual({
      id: "4.3-4.4",
      label: "[task:4.3-4.4]",
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
    expect(() => parseVerificationCli(["system", "--task", "4.3-4.4"])).not.toThrow();
  });
});
