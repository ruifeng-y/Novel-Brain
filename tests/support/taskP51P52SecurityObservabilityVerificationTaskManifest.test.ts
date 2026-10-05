import { describe, expect, it } from "vitest";
import {
  assertTaskGateCoverage,
  parseVerificationCli,
  type VitestJsonReport,
} from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

function passedGateReport(
  entries: readonly (readonly [string, "domain" | "integration" | "cross-system" | "concurrency" | "regression"])[],
): VitestJsonReport {
  return {
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: entries.length,
    numPassedTests: entries.length,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [
      {
        name: "tests/platform/taskP51SecurityBoundary.test.ts",
        status: "passed",
        assertionResults: entries.map(([fullName, gate]) => ({
          fullName: `${fullName} [${gate}]`,
          status: "passed",
          failureMessages: [],
        })),
      },
    ],
  };
}

describe("[task:P5.1-P5.2] [regression] security and observability verification registration", () => {
  it("registers AuthN/AuthZ, isolation, secrets, rates, telemetry, health, and audit gates", () => {
    expect(getVerificationTaskProfile("P5.1-P5.2")).toEqual({
      id: "P5.1-P5.2",
      label: "[task:P5.1-P5.2]",
      evidenceLabels: ["[task:P5.1]", "[task:P5.2]"],
      requiredGates: ["domain", "integration", "concurrency", "cross-system", "regression"],
    });
    expect(() => parseVerificationCli(["system", "--task", "P5.1-P5.2"])).not.toThrow();
  });

  it("accepts P5.1 and P5.2 evidence for the combined profile", () => {
    const profile = getVerificationTaskProfile("P5.1-P5.2");
    const report = passedGateReport([
      ["[task:P5.1] ownership", "domain"],
      ["[task:P5.1] hooks", "integration"],
      ["[task:P5.1] rate limits", "concurrency"],
      ["[task:P5.2] audit correlation", "cross-system"],
      ["[task:P5.1-P5.2] registration", "regression"],
    ]);

    expect(() => assertTaskGateCoverage([report], profile)).not.toThrow();
  });
});
