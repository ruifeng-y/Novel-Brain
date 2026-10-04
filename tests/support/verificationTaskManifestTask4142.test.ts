import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { verificationTaskProfiles } from "../../scripts/verificationTaskManifest";

describe("verificationTaskManifest combined Task 4.1 + 4.2", () => {
  it("registers all Run Plan Baseline and Production Run Lifecycle gates", () => {
    expect(verificationTaskProfiles["4.1-4.2"]).toEqual({
      id: "4.1-4.2",
      label: "[task:4.1-4.2]",
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
    expect(() => parseVerificationCli(["system", "--task", "4.1-4.2"])).not.toThrow();
  });
});
