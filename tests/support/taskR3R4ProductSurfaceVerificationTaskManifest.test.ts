import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

describe("[task:R3-R4] [regression] product surface verification registration", () => {
  it("registers the merged workspace/foundation and run/recall gates", () => {
    expect(getVerificationTaskProfile("R3-R4")).toEqual({
      id: "R3-R4",
      label: "[task:R3-R4]",
      evidenceLabels: ["[task:R3]", "[task:R4]"],
      requiredGates: ["domain", "integration", "cross-system", "regression"],
    });
    expect(() => parseVerificationCli(["system", "--task", "R3-R4"])).not.toThrow();
  });
});
