import { describe, expect, it } from "vitest";
import {
  assertTaskGateCoverage,
  parseVerificationCli,
  type VitestJsonReport,
} from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

function passedGateReport(
  entries: readonly (readonly [string, "integration" | "cross-system" | "regression"])[],
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
        name: "tests/public/taskR5WorkspaceUiContract.test.ts",
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

describe("[task:R5-R6] [regression] release verification registration", () => {
  it("registers the combined browser surface and release acceptance profile", () => {
    expect(getVerificationTaskProfile("R5-R6")).toEqual({
      id: "R5-R6",
      label: "[task:R5-R6]",
      evidenceLabels: ["[task:R5]", "[task:R6]"],
      requiredGates: ["integration", "cross-system", "regression"],
    });
    expect(() => parseVerificationCli(["system", "--task", "R5-R6"])).not.toThrow();
  });

  it("accepts R5 and R6 evidence for the combined profile", () => {
    const profile = getVerificationTaskProfile("R5-R6");
    const report = passedGateReport([
      ["[task:R5] static hosting", "integration"],
      ["[task:R5] workspace shell boundary", "cross-system"],
      ["[task:R5-R6] release registration", "regression"],
      ["[task:R6] release acceptance", "integration"],
    ]);

    expect(() => assertTaskGateCoverage([report], profile)).not.toThrow();
  });
});
