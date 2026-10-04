import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { verificationTaskProfiles } from "../../scripts/verificationTaskManifest";

describe("verificationTaskManifest combined Task 6.1-6.5", () => {
  it("registers all cross-system integration gates", () => {
    expect(verificationTaskProfiles["6.1-6.5"]).toEqual({
      id: "6.1-6.5",
      label: "[task:6.1-6.5]",
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
    expect(() => parseVerificationCli(["system", "--task", "6.1-6.5"])).not.toThrow();
  });
});
