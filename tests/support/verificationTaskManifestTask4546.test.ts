import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { verificationTaskProfiles } from "../../scripts/verificationTaskManifest";

describe("verificationTaskManifest combined Task 4.5 + 4.6", () => {
  it("registers all Budget Policy and Run Audit Compensation gates", () => {
    expect(verificationTaskProfiles["4.5-4.6"]).toEqual({
      id: "4.5-4.6",
      label: "[task:4.5-4.6]",
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
    expect(() => parseVerificationCli(["system", "--task", "4.5-4.6"])).not.toThrow();
  });
});
