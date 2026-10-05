import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

describe("[task:P2.1] [regression] command/query verification registration", () => {
  it("registers boundary separation and Domain decoupling gates without deferred process/API gates", () => {
    expect(getVerificationTaskProfile("P2.1")).toEqual({
      id: "P2.1",
      label: "[task:P2.1]",
      requiredGates: ["domain", "integration", "cross-system", "regression"],
    });
    expect(() => parseVerificationCli(["system", "--task", "P2.1"])).not.toThrow();
  });
});
