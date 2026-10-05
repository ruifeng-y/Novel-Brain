import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

describe("[task:R1-R2] [regression] runtime and API verification registration", () => {
  it("registers the merged production runtime/API gates", () => {
    expect(getVerificationTaskProfile("R1-R2")).toEqual({
      id: "R1-R2",
      label: "[task:R1-R2]",
      evidenceLabels: ["[task:R1]", "[task:R2]"],
      requiredGates: [
        "domain",
        "integration",
        "concurrency",
        "recovery",
        "cross-system",
        "regression",
      ],
    });
    expect(() => parseVerificationCli(["system", "--task", "R1-R2"])).not.toThrow();
  });
});
