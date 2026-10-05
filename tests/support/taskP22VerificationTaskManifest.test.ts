import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

describe("[task:P2.2] [regression] long-running process verification registration", () => {
  it("registers lifecycle, cancellation, identity, and boundary gates", () => {
    expect(getVerificationTaskProfile("P2.2")).toEqual({
      id: "P2.2",
      label: "[task:P2.2]",
      requiredGates: ["domain", "integration", "concurrency", "cross-system", "regression"],
    });
    expect(() => parseVerificationCli(["system", "--task", "P2.2"])).not.toThrow();
  });
});
