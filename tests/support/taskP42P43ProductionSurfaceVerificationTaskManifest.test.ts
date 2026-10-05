import { describe, expect, it } from "vitest";
import {
  assertTaskGateCoverage,
  parseVerificationCli,
  type VitestJsonReport,
} from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

function passedGateReport(
  entries: readonly (readonly [string, "domain" | "integration" | "cross-system" | "regression"])[],
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
        name: "tests/app/taskP42P43GateEvidence.test.ts",
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

describe("[task:P4.2-P4.3] [regression] production surface verification registration", () => {
  it("registers domain, integration, cross-system, and regression gates", () => {
    expect(getVerificationTaskProfile("P4.2-P4.3")).toEqual({
      id: "P4.2-P4.3",
      label: "[task:P4.2-P4.3]",
      evidenceLabels: ["[task:P4.2]", "[task:P4.3]"],
      requiredGates: ["domain", "integration", "cross-system", "regression"],
    });
    expect(() => parseVerificationCli(["system", "--task", "P4.2-P4.3"])).not.toThrow();
  });

  it("accepts P4.2 and P4.3 test labels as combined-profile gate evidence", () => {
    const profile = getVerificationTaskProfile("P4.2-P4.3");
    const report = passedGateReport([
      ["[task:P4.2] Story Foundation surface", "domain"],
      ["[task:P4.3] Run and Recall surface", "integration"],
      ["[task:P4.2] Workspace reuse", "cross-system"],
      ["[task:P4.2-P4.3] manifest", "regression"],
    ]);

    expect(() => assertTaskGateCoverage([report], profile)).not.toThrow();
  });
});
