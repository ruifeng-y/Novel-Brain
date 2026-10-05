import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

describe("[task:P3.1] [regression] production scheduler/worker verification registration", () => {
  it("registers scheduling, timeout, cancellation, retry, fallback, and boundary gates", () => {
    expect(getVerificationTaskProfile("P3.1")).toEqual({
      id: "P3.1",
      label: "[task:P3.1]",
      requiredGates: ["domain", "integration", "concurrency", "cross-system", "regression"],
    });
    expect(() => parseVerificationCli(["system", "--task", "P3.1"])).not.toThrow();
  });
});
