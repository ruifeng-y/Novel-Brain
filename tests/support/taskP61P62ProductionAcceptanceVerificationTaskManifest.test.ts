import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createVerificationPlan,
  assertTaskGateCoverage,
  parseVerificationCli,
  type VitestJsonReport,
} from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";
import { workspacePresentationContract } from "../../src/app/workspaceQueryPresentationContract";
import { productionRunRecallSurfaceContracts } from "../../src/app/productionRunRecallSurfaceContract";
import { observabilityBoundaryContract } from "../../src/platform/observabilityBoundary";
import { securityBoundaryContract } from "../../src/platform/securityBoundary";

type RequiredGate =
  | "domain"
  | "integration"
  | "persistence"
  | "concurrency"
  | "recovery"
  | "cross-system"
  | "regression";

function passedGateReport(
  entries: readonly (readonly [string, RequiredGate])[],
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
        name: "tests/platform/taskP61DeploymentTopology.test.ts",
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

function section(
  document: string,
  heading: string,
  nextHeading: string,
): readonly string[] {
  const lines = document.split(/\r?\n/);
  const start = lines.indexOf(heading);
  const end = lines.indexOf(nextHeading, start + 1);
  if (start < 0 || end < 0) throw new Error(`missing section: ${heading}`);
  const fenceStart = lines.indexOf("```text", start + 1);
  const fenceEnd = lines.indexOf("```", fenceStart + 1);
  if (fenceStart < 0 || fenceEnd < 0 || fenceEnd > end) {
    throw new Error(`missing deferred list: ${heading}`);
  }
  return lines.slice(fenceStart + 1, fenceEnd).filter(line => line.length > 0);
}

describe("[task:P6.2] [regression] Production acceptance verification registration", () => {
  it("registers P6.1-P6.2 with global tests and typecheck system steps", () => {
    expect(getVerificationTaskProfile("P6.1-P6.2")).toEqual({
      id: "P6.1-P6.2",
      label: "[task:P6.1-P6.2]",
      evidenceLabels: ["[task:P6.1]", "[task:P6.2]", "[task:P5.1]", "[task:P5.2]"],
      requiredGates: [
        "domain",
        "integration",
        "persistence",
        "concurrency",
        "recovery",
        "cross-system",
        "regression",
      ],
    });
    expect(() => parseVerificationCli(["system", "--task", "P6.1-P6.2"])).not.toThrow();

    const plan = createVerificationPlan("system", { task: "P6.1-P6.2" });
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[0]).toEqual({ kind: "typecheck" });
    expect(plan.steps.slice(1)).toMatchObject([
      { kind: "vitest", layer: "Unit Verification", config: "vitest.config.ts" },
      { kind: "vitest", layer: "Domain Verification", config: "vitest.domain.config.ts" },
      { kind: "vitest", layer: "Integration Verification", config: "vitest.integration.config.ts" },
    ]);
  });

  it("accepts deployment and security/operations evidence for the combined profile", () => {
    const profile = getVerificationTaskProfile("P6.1-P6.2");
    const report = passedGateReport([
      ["[task:P6.1] topology ownership", "domain"],
      ["[task:P6.1] startup and shutdown", "integration"],
      ["[task:P6.1] migration ordering", "persistence"],
      ["[task:P6.1] migration idempotency", "concurrency"],
      ["[task:P6.1] crash restart", "recovery"],
      ["[task:P6.2] cross-system contracts", "cross-system"],
      ["[task:P6.2] deferred audit", "regression"],
    ]);
    const securityOpsReport = passedGateReport([
      ["[task:P5.1] security boundary", "cross-system"],
      ["[task:P5.2] operational boundary", "cross-system"],
    ]);

    expect(() => assertTaskGateCoverage([report, securityOpsReport], profile)).not.toThrow();
  });

  it("proves security, operational, and cross-system authority boundaries", async () => {
    const { deploymentTopologyContract } = await import("../../src/platform/deploymentTopology");
    expect(securityBoundaryContract).toMatchObject({
      owner: "platform-security",
      novelDomainOwnership: false,
    });
    expect(observabilityBoundaryContract).toMatchObject({
      owner: "operational-platform",
      health: ["liveness", "readiness"],
      changesNovelDomain: false,
    });
    expect(deploymentTopologyContract).toMatchObject({
      owner: "operational-platform",
      processes: ["application", "worker"],
      migrations: "before-process-start",
      changesNovelDomain: false,
    });

    expect(workspacePresentationContract).toMatchObject({
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
    });
    expect(productionRunRecallSurfaceContracts.attention.authority).toEqual({
      authoritative: false,
      mayMutateNarrativeTruth: false,
      mayCreateTaskDirectly: false,
      mayCommit: false,
      proposedActionChannel: "production-run-policy",
    });
    expect(productionRunRecallSurfaceContracts.presentation).toMatchObject({
      workspacePresentationId: workspacePresentationContract.id,
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
    });
  });

  it("audits that explicit deferred scope remains unchanged", async () => {
    const { deploymentTopologyContract } = await import("../../src/platform/deploymentTopology");
    const spec = readFileSync(
      "docs/superpowers/specs/2026-10-05-novel-brain-productionization-architecture.md",
      "utf8",
    );
    const plan = readFileSync(
      "docs/superpowers/plans/2026-10-05-novel-brain-productionization-roadmap.md",
      "utf8",
    );

    expect(section(spec, "## 16. Explicit Deferred Work", "## 17. Architecture Review Checklist")).toEqual([
      "Field-level database schema",
      "DTO fields",
      "API parameter details",
      "Pixel-level UI design",
      "Recall scoring/vector retrieval",
      "Prompt framework",
      "Provider-specific implementation",
      "Advanced validator catalog",
      "Cost optimization details",
    ]);
    expect(section(plan, "## 11. Explicitly Deferred Work", "## 12. Recommended First Implementation Task")).toEqual([
      "Field-level database schema",
      "DTO fields",
      "API parameter details",
      "Pixel-level UI",
      "Recall scoring/vector retrieval",
      "Prompt framework",
      "Provider-specific implementation",
      "Advanced validator catalog",
      "Cost optimization details",
    ]);
    expect(JSON.stringify(deploymentTopologyContract)).not.toMatch(
      /dto|apiParams|pixel|prompt|provider|advancedValidator|costOptimization/i,
    );
  });
});