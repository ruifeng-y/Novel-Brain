import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { verificationTaskProfiles } from "../../scripts/verificationTaskManifest";

describe("verificationTaskManifest combined Task 3.3 + 3.4", () => {
  it("registers all Foundation Partial Adoption and Workspace Integration gates", () => {
    expect(verificationTaskProfiles["3.3-3.4"]).toEqual({
      id: "3.3-3.4",
      label: "[task:3.3-3.4]",
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
    expect(() => parseVerificationCli(["system", "--task", "3.3-3.4"])).not.toThrow();
  });
});
