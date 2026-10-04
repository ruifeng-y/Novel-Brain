import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { verificationTaskProfiles } from "../../scripts/verificationTaskManifest";

describe("verificationTaskManifest Task 3.2", () => {
  it("registers all Proposal Explore / Deepen / Refine Workflow gates", () => {
    expect(verificationTaskProfiles["3.2"]).toEqual({
      id: "3.2",
      label: "[task:3.2]",
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
    expect(() => parseVerificationCli(["system", "--task", "3.2"])).not.toThrow();
  });
});
