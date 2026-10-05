import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertTaskGateCoverage,
  parseVerificationCli,
  type VitestJsonReport,
} from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

const acceptanceFilePath = fileURLToPath(
  new URL("../system/taskR6ProductionCapabilityAcceptance.test.ts", import.meta.url),
);

function passedGateReport(
  entries: readonly (
    readonly [string, "integration" | "cross-system" | "recovery" | "regression"]
  )[],
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
      requiredGates: ["integration", "cross-system", "recovery", "regression"],
    });
    expect(() => parseVerificationCli(["system", "--task", "R5-R6"])).not.toThrow();
  });

  it("registers R6 production acceptance evidence for every required release gate", () => {
    const source = readFileSync(acceptanceFilePath, "utf8");

    for (const gate of getVerificationTaskProfile("R5-R6").requiredGates) {
      expect(source).toContain(`[task:R6] [${gate}]`);
    }
  });

  it("accepts R5 and R6 evidence for the combined profile", () => {
    const profile = getVerificationTaskProfile("R5-R6");
    const report = passedGateReport([
      ["[task:R5] static hosting", "integration"],
      ["[task:R5] workspace shell boundary", "cross-system"],
      ["[task:R5-R6] release registration", "regression"],
      ["[task:R6] release acceptance", "integration"],
      ["[task:R6] crash recovery", "recovery"],
    ]);

    expect(() => assertTaskGateCoverage([report], profile)).not.toThrow();
  });
});
