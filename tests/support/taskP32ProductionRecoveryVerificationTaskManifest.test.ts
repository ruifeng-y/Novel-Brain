import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

describe("[task:P3.2] [regression] crash recovery verification registration", () => {
  it("registers restart, idempotency, replay, and compensation gates", () => {
    expect(getVerificationTaskProfile("P3.2")).toEqual({
      id: "P3.2",
      label: "[task:P3.2]",
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
    expect(() => parseVerificationCli(["system", "--task", "P3.2"])).not.toThrow();
  });
});
