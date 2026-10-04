import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

describe("verification task 2.3-H registration", () => {
  it("registers all Impact Persistence Integrity Hardening gates", () => {
    expect(getVerificationTaskProfile("2.3-H")).toEqual({
      id: "2.3-H",
      label: "[task:2.3-H]",
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
    expect(() => parseVerificationCli(["system", "--task", "2.3-H"])).not.toThrow();
  });
});
