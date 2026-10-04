import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { verificationTaskProfiles } from "../../scripts/verificationTaskManifest";

describe("verificationTaskManifest combined Task 7.1-7.3", () => {
  it("registers all persistence, concurrency, and recovery hardening gates", () => {
    expect(verificationTaskProfiles["7.1-7.3"]).toEqual({
      id: "7.1-7.3",
      label: "[task:7.1-7.3]",
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
    expect(() => parseVerificationCli(["system", "--task", "7.1-7.3"])).not.toThrow();
  });
});
