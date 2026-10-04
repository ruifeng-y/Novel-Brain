import { describe, expect, it } from "vitest";
import {
  assertTaskGateCoverage,
  createVerificationPlan,
  formatVerificationCounts,
  parseVerificationCli,
  summarizeVitestReport,
  verificationTaskGateTestNamePattern,
  verificationTestNamePattern,
  type VitestJsonReport,
} from "../../scripts/verificationHarness";
import { verificationTaskProfiles } from "../../scripts/verificationTaskManifest";

describe("verification command conventions", () => {
  it("keeps Unit Verification on the complete unit Vitest config", () => {
    const plan = createVerificationPlan("unit");

    expect(plan.label).toBe("Unit Verification");
    expect(plan.steps).toEqual([
      {
        kind: "vitest",
        layer: "Unit Verification",
        config: "vitest.config.ts",
        filters: [],
        testNamePattern: undefined,
        passWithNoTests: false,
      },
    ]);
  });

  it("keeps Domain Verification on a domain-focused Vitest config", () => {
    const plan = createVerificationPlan("domain", { focus: "capabilityVerification" });

    expect(plan.label).toBe("Domain Verification");
    expect(plan.steps).toEqual([
      {
        kind: "vitest",
        layer: "Domain Verification",
        config: "vitest.domain.config.ts",
        filters: ["capabilityVerification"],
        testNamePattern: undefined,
        passWithNoTests: false,
      },
    ]);
  });

  it("keeps Integration Verification on the existing integration Vitest config", () => {
    const plan = createVerificationPlan("integration");

    expect(plan.label).toBe("Integration Verification");
    expect(plan.steps).toEqual([
      {
        kind: "vitest",
        layer: "Integration Verification",
        config: "vitest.integration.config.ts",
        filters: [],
        testNamePattern: undefined,
        passWithNoTests: false,
      },
    ]);
  });

  it("runs typecheck, all unit tests, domain focus, and integration for a task-scoped system", () => {
    const options = parseVerificationCli(["system", "--task", "1.3"]);
    const plan = createVerificationPlan(options.mode, options);

    expect(options.task).toBe("1.3");
    expect(plan.label).toBe("System Verification");
    expect(plan.steps).toEqual([
      { kind: "typecheck" },
      {
        kind: "vitest",
        layer: "Unit Verification",
        config: "vitest.config.ts",
        filters: [],
        testNamePattern: undefined,
        passWithNoTests: false,
      },
      {
        kind: "vitest",
        layer: "Domain Verification",
        config: "vitest.domain.config.ts",
        filters: [],
        testNamePattern: undefined,
        passWithNoTests: false,
      },
      {
        kind: "vitest",
        layer: "Integration Verification",
        config: "vitest.integration.config.ts",
        filters: [],
        testNamePattern: undefined,
        passWithNoTests: false,
      },
    ]);
  });

  it("requires an explicit task profile for System Verification", () => {
    expect(() => parseVerificationCli(["system"])).toThrow(
      "system mode requires --task <task-id>",
    );
  });

  it("focuses task-scoped contract commands across unit and integration", () => {
    const options = parseVerificationCli([
      "contract",
      "capabilityVerificationHarness",
      "--task",
      "1.3",
      "--gate",
      "persistence",
    ]);
    const plan = createVerificationPlan(options.mode, options);

    expect(options).toEqual({
      mode: "contract",
      focus: "capabilityVerificationHarness",
      task: "1.3",
      gate: "persistence",
    });
    expect(plan.steps.map((step) => step.kind)).toEqual(["vitest", "vitest"]);
    expect(plan.steps).toMatchObject([
      {
        config: "vitest.config.ts",
        filters: ["capabilityVerificationHarness"],
        testNamePattern: "(?=.*\\[task:1\\.3\\])(?=.*\\[persistence\\])",
        passWithNoTests: true,
      },
      {
        config: "vitest.integration.config.ts",
        filters: ["capabilityVerificationHarness"],
        testNamePattern: "(?=.*\\[task:1\\.3\\])(?=.*\\[persistence\\])",
        passWithNoTests: true,
      },
    ]);
  });

  it("escapes gate labels so Vitest treats brackets literally", () => {
    expect(verificationTestNamePattern("[persistence]")).toBe("\\[persistence\\]");
    expect(verificationTaskGateTestNamePattern("1.3", "cross-system")).toBe(
      "(?=.*\\[task:1\\.3\\])(?=.*\\[cross\\-system\\])",
    );
  });

  it("rejects focused contract execution without a focus filter", () => {
    expect(() => parseVerificationCli(["contract"])).toThrow(
      "contract mode requires a test file or name focus",
    );
  });
});

describe("verification task manifest", () => {
  it("registers Task 1.3 with all roadmap gates", () => {
    expect(verificationTaskProfiles["1.3"]).toEqual({
      id: "1.3",
      label: "[task:1.3]",
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
  });

  it("registers Task 2.1 with all execution-attempt gate evidence", () => {
    expect(verificationTaskProfiles["2.1"]).toEqual({
      id: "2.1",
      label: "[task:2.1]",
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
  });
  it("rejects unregistered task profiles", () => {
    expect(() => parseVerificationCli(["system", "--task", "9.9"])).toThrow(
      "unknown verification task profile: 9.9",
    );
  });
});

describe("verification count reporting", () => {
  const report: VitestJsonReport = {
    numTotalTestSuites: 3,
    numPassedTestSuites: 2,
    numFailedTestSuites: 1,
    numPendingTestSuites: 0,
    numTotalTests: 7,
    numPassedTests: 5,
    numFailedTests: 1,
    numPendingTests: 1,
    numTodoTests: 0,
    testResults: [
      {
        name: "tests/a.test.ts",
        status: "passed",
        assertionResults: [
          { fullName: "[task:1.3] [domain] a", status: "passed", failureMessages: [] },
        ],
      },
      {
        name: "tests/b.test.ts",
        status: "failed",
        assertionResults: [
          { fullName: "[task:1.3] [persistence] b", status: "failed", failureMessages: ["boom"] },
          { fullName: "[task:1.3] [transaction] c", status: "pending", failureMessages: [] },
        ],
      },
    ],
  };

  it("summarizes Vitest JSON counts and skipped tests", () => {
    expect(summarizeVitestReport(report)).toEqual({
      testFiles: 2,
      tests: 7,
      passed: 5,
      failed: 1,
      skipped: 1,
    });
    expect(formatVerificationCounts("System Verification", summarizeVitestReport(report))).toBe(
      "System Verification counts: files=2 tests=7 passed=5 failed=1 skipped=1",
    );
  });

  function gateReport(
    fullName: string,
    status: "passed" | "failed" | "pending" | "todo",
  ): VitestJsonReport {
    return {
      numTotalTestSuites: 1,
      numPassedTestSuites: status === "passed" ? 1 : 0,
      numFailedTestSuites: status === "failed" ? 1 : 0,
      numPendingTestSuites: status === "pending" ? 1 : 0,
      numTotalTests: 1,
      numPassedTests: status === "passed" ? 1 : 0,
      numFailedTests: status === "failed" ? 1 : 0,
      numPendingTests: status === "pending" ? 1 : 0,
      numTodoTests: status === "todo" ? 1 : 0,
      testResults: [
        {
          name: "tests/gate.test.ts",
          status: status === "failed" ? "failed" : "passed",
          assertionResults: [{ fullName, status, failureMessages: [] }],
        },
      ],
    };
  }

  it("accepts task-scoped gate evidence only when a matching test passed", () => {
    const profile = {
      id: "test-task",
      label: "[task:test-task]",
      requiredGates: ["persistence"] as const,
    };

    expect(() =>
      assertTaskGateCoverage(
        [gateReport("[task:test-task] [persistence] roundtrip", "passed")],
        profile,
      ),
    ).not.toThrow();
  });

  it("does not let Task 1.3 evidence satisfy another task profile", () => {
    const profile = {
      id: "2.1",
      label: "[task:2.1]",
      requiredGates: ["persistence"] as const,
    };

    expect(() =>
      assertTaskGateCoverage(
        [gateReport("[task:1.3] [persistence] roundtrip", "passed")],
        profile,
      ),
    ).toThrow("Task 2.1 gate evidence has no passed tests: persistence");
  });

  it("does not count skipped tests as gate evidence", () => {
    const profile = {
      id: "test-task",
      label: "[task:test-task]",
      requiredGates: ["regression"] as const,
    };

    expect(() =>
      assertTaskGateCoverage(
        [gateReport("[task:test-task] [regression] frozen core", "pending")],
        profile,
      ),
    ).toThrow("Task test-task gate evidence has no passed tests: regression");
  });

  it("rejects failed or todo tests even when another gate test passed", () => {
    const profile = {
      id: "test-task",
      label: "[task:test-task]",
      requiredGates: ["recovery"] as const,
    };

    expect(() =>
      assertTaskGateCoverage(
        [
          gateReport("[task:test-task] [recovery] retry", "passed"),
          gateReport("[task:test-task] [recovery] rollback", "failed"),
        ],
        profile,
      ),
    ).toThrow("Task test-task gate evidence contains failed/todo tests: recovery");

    expect(() =>
      assertTaskGateCoverage(
        [
          gateReport("[task:test-task] [recovery] retry", "passed"),
          gateReport("[task:test-task] [recovery] pending case", "todo"),
        ],
        profile,
      ),
    ).toThrow("Task test-task gate evidence contains failed/todo tests: recovery");
  });
});
