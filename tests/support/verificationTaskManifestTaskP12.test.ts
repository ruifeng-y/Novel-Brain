import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

describe("verification task P1.2 registration", () => {
  it("registers PostgreSQL mapping and migration boundary gates without deferred replay gates", () => {
    expect(getVerificationTaskProfile("P1.2")).toEqual({
      id: "P1.2",
      label: "[task:P1.2]",
      requiredGates: [
        "domain",
        "integration",
        "persistence",
        "transaction",
        "concurrency",
        "recovery",
        "cross-system",
        "regression",
      ],
    });
    expect(() => parseVerificationCli(["system", "--task", "P1.2"])).not.toThrow();
  });
});
