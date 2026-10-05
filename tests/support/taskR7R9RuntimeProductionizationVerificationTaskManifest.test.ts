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
  new URL("../platform/taskR7ProductionSecurityProvider.test.ts", import.meta.url),
);

function passedGateReport(
  entries: readonly (
    readonly [string, "domain" | "integration" | "cross-system" | "regression"]
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
        name: "tests/platform/taskR7ProductionSecurityProvider.test.ts",
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

describe("[task:R7-R9] [regression] runtime productionization verification registration", () => {
  it("registers the combined security, run creation and workspace profile", () => {
    expect(getVerificationTaskProfile("R7-R9")).toEqual({
      id: "R7-R9",
      label: "[task:R7-R9]",
      evidenceLabels: ["[task:R7]", "[task:R8]", "[task:R9]"],
      requiredGates: ["domain", "integration", "cross-system", "regression"],
    });
    expect(() => parseVerificationCli(["system", "--task", "R7-R9"])).not.toThrow();
  });

  it("registers R7 production security evidence for every required gate", () => {
    const source = readFileSync(acceptanceFilePath, "utf8");

    for (const gate of getVerificationTaskProfile("R7-R9").requiredGates) {
      expect(source).toContain(`[task:R7] [${gate}]`);
    }
  });

  it("accepts R7, R8 and R9 evidence for the combined profile", () => {
    const profile = getVerificationTaskProfile("R7-R9");
    const report = passedGateReport([
      ["[task:R7] production security configuration", "domain"],
      ["[task:R7] production security boundary", "integration"],
      ["[task:R7] production process security wiring", "cross-system"],
      ["[task:R7-R9] runtime productionization registration", "regression"],
    ]);

    expect(() => assertTaskGateCoverage([report], profile)).not.toThrow();
    expect(() =>
      assertTaskGateCoverage(
        [passedGateReport([["[task:R7-R9] missing run creation evidence", "regression"]])],
        profile,
      ),
    ).toThrow("has no passed tests");
  });
});
