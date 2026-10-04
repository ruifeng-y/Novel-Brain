import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { verificationTaskProfiles } from "../../scripts/verificationTaskManifest";

describe("verificationTaskManifest combined Task 5.3 + 5.5", () => {
  it("registers all Recall Item, Attention Disposition, and Run-aware Recall gates", () => {
    expect(verificationTaskProfiles["5.3-5.5"]).toEqual({
      id: "5.3-5.5",
      label: "[task:5.3-5.5]",
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
    expect(() => parseVerificationCli(["system", "--task", "5.3-5.5"])).not.toThrow();
  });
});
