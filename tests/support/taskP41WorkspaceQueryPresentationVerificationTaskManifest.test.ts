import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

describe("[task:P4.1] [regression] workspace query presentation verification registration", () => {
  it("registers domain, integration, cross-system, and regression gates", () => {
    expect(getVerificationTaskProfile("P4.1")).toEqual({
      id: "P4.1",
      label: "[task:P4.1]",
      requiredGates: ["domain", "integration", "cross-system", "regression"],
    });
    expect(() => parseVerificationCli(["system", "--task", "P4.1"])).not.toThrow();
  });
});
