import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

describe("[task:P2.3] [regression] production API verification registration", () => {
  it("registers validation, authorization, idempotency, and process-result gates", () => {
    expect(getVerificationTaskProfile("P2.3")).toEqual({
      id: "P2.3",
      label: "[task:P2.3]",
      requiredGates: ["domain", "integration", "cross-system", "regression"],
    });
    expect(() => parseVerificationCli(["system", "--task", "P2.3"])).not.toThrow();
  });
});
