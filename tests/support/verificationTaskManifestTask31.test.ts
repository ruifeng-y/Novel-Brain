import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { verificationTaskProfiles } from "../../scripts/verificationTaskManifest";

describe("verificationTaskManifest Task 3.1", () => {
  it("registers all Foundation Entry Services gates", () => {
    expect(verificationTaskProfiles["3.1"]).toEqual({
      id: "3.1",
      label: "[task:3.1]",
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
    expect(() => parseVerificationCli(["system", "--task", "3.1"])).not.toThrow();
  });
});
