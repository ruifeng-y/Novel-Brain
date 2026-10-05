import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

describe("[task:P1.3] projection replay verification registration", () => {
  it("[regression] registers projection rebuild, replay, snapshot recovery, and compensation gates", () => {
    expect(getVerificationTaskProfile("P1.3")).toEqual({
      id: "P1.3",
      label: "[task:P1.3]",
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
    expect(() => parseVerificationCli(["system", "--task", "P1.3"])).not.toThrow();
  });
});
