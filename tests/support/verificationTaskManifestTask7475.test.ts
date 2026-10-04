import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { verificationTaskProfiles } from "../../scripts/verificationTaskManifest";

describe("verificationTaskManifest combined Task 7.4-7.5", () => {
  it("registers all observability audit and full acceptance gates", () => {
    expect(verificationTaskProfiles["7.4-7.5"]).toEqual({
      id: "7.4-7.5",
      label: "[task:7.4-7.5]",
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
    expect(() => parseVerificationCli(["system", "--task", "7.4-7.5"])).not.toThrow();
  });
});
