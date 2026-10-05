import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

describe("verification task P1.1 registration", () => {
  it("registers Canonical Persistence Mapping Contract gates without deferred recovery/replay gates", () => {
    expect(getVerificationTaskProfile("P1.1")).toEqual({
      id: "P1.1",
      label: "[task:P1.1]",
      requiredGates: [
        "domain",
        "integration",
        "persistence",
        "transaction",
        "concurrency",
        "cross-system",
        "regression",
      ],
    });
    expect(() => parseVerificationCli(["system", "--task", "P1.1"])).not.toThrow();
  });
});
