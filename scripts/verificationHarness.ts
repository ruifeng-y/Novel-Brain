import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getVerificationTaskProfile,
  verificationGates,
  type VerificationGate,
  type VerificationTaskProfile,
} from "./verificationTaskManifest.ts";

export { verificationGates };
export type { VerificationGate, VerificationTaskProfile };

export type VerificationMode =
  | "unit"
  | "integration"
  | "domain"
  | "system"
  | "contract"
  | "gate";

export interface VerificationCliOptions {
  readonly mode: VerificationMode;
  readonly focus?: string;
  readonly task?: string;
  readonly gate?: VerificationGate;
}

export interface TypecheckStep {
  readonly kind: "typecheck";
}

export interface VitestStep {
  readonly kind: "vitest";
  readonly layer: "Unit Verification" | "Domain Verification" | "Integration Verification";
  readonly config: "vitest.config.ts" | "vitest.domain.config.ts" | "vitest.integration.config.ts";
  readonly filters: readonly string[];
  readonly testNamePattern?: string;
  readonly passWithNoTests: boolean;
}

export interface VerificationPlan {
  readonly mode: VerificationMode;
  readonly label:
    | "Unit Verification"
    | "Domain Verification"
    | "Integration Verification"
    | "System Verification"
    | "Focused Contract Verification"
    | "Focused Gate Verification";
  readonly gates: readonly VerificationGate[];
  readonly steps: readonly (TypecheckStep | VitestStep)[];
}

export interface VitestJsonAssertionResult {
  readonly fullName: string;
  readonly status: string;
  readonly failureMessages: readonly string[];
}

export interface VitestJsonTestResult {
  readonly name: string;
  readonly status: string;
  readonly assertionResults: readonly VitestJsonAssertionResult[];
}

export interface VitestJsonReport {
  readonly numTotalTestSuites: number;
  readonly numPassedTestSuites: number;
  readonly numFailedTestSuites: number;
  readonly numPendingTestSuites: number;
  readonly numTotalTests: number;
  readonly numPassedTests: number;
  readonly numFailedTests: number;
  readonly numPendingTests: number;
  readonly numTodoTests: number;
  readonly testResults: readonly VitestJsonTestResult[];
}

export interface VerificationCounts {
  readonly testFiles: number;
  readonly tests: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface TaskGateEvidence {
  readonly passed: number;
  readonly failed: number;
  readonly todo: number;
  readonly skipped: number;
}

const modes = new Set<VerificationMode>([
  "unit",
  "integration",
  "domain",
  "system",
  "contract",
  "gate",
]);

const gates = new Set<VerificationGate>(verificationGates);

function isVerificationMode(value: string): value is VerificationMode {
  return modes.has(value as VerificationMode);
}

function isVerificationGate(value: string): value is VerificationGate {
  return gates.has(value as VerificationGate);
}

export function parseVerificationCli(argv: readonly string[]): VerificationCliOptions {
  const [modeValue, ...rest] = argv;
  if (!modeValue || !isVerificationMode(modeValue)) {
    throw new Error(
      "usage: verificationHarness <unit|integration|domain|system|contract|gate> [focus] [--task <task-id>] [--gate <gate>]",
    );
  }

  let focus: string | undefined;
  let task: string | undefined;
  let gate: VerificationGate | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--task") {
      task = rest[index + 1];
      if (!task) throw new Error("verification task id is required");
      getVerificationTaskProfile(task);
      index += 1;
      continue;
    }
    if (value === "--gate") {
      const gateValue = rest[index + 1];
      if (!gateValue || !isVerificationGate(gateValue)) {
        throw new Error(`unknown verification gate: ${gateValue ?? "<missing>"}`);
      }
      gate = gateValue;
      index += 1;
      continue;
    }
    if (value?.startsWith("--")) throw new Error(`unknown verification option: ${value}`);
    if (focus !== undefined) throw new Error("only one verification focus is supported");
    focus = value;
  }

  if (modeValue === "contract" && focus === undefined) {
    throw new Error("contract mode requires a test file or name focus");
  }
  if (modeValue === "system" && task === undefined) {
    throw new Error("system mode requires --task <task-id>");
  }
  if (modeValue === "gate" && gate === undefined) {
    throw new Error("gate mode requires --gate <gate>");
  }
  if (modeValue === "gate" && task === undefined) {
    throw new Error("gate mode requires --task <task-id>");
  }

  return {
    mode: modeValue,
    focus,
    task,
    gate,
  };
}

export function verificationTestNamePattern(label: string): string {
  return label.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
}

export function verificationTaskGateTestNamePattern(
  taskId?: string,
  gate?: VerificationGate,
): string | undefined {
  const patterns: string[] = [];
  if (taskId !== undefined) {
    patterns.push(`(?=.*${verificationTestNamePattern(`[task:${taskId}]`)})`);
  }
  if (gate !== undefined) {
    patterns.push(`(?=.*${verificationTestNamePattern(`[${gate}]`)})`);
  }
  return patterns.length === 0 ? undefined : patterns.join("");
}

function vitestStep(
  layer: VitestStep["layer"],
  config: VitestStep["config"],
  options: VerificationCliOptions,
  passWithNoTests: boolean,
): VitestStep {
  return {
    kind: "vitest",
    layer,
    config,
    filters: options.focus === undefined ? [] : [options.focus],
    testNamePattern:
      options.mode === "gate" || (options.mode === "contract" && options.gate !== undefined)
        ? verificationTaskGateTestNamePattern(options.task, options.gate)
        : undefined,
    passWithNoTests,
  };
}

export function createVerificationPlan(
  mode: VerificationMode,
  options: Omit<VerificationCliOptions, "mode"> = {},
): VerificationPlan {
  const normalized: VerificationCliOptions = { ...options, mode };
  const unit = vitestStep("Unit Verification", "vitest.config.ts", normalized, false);
  const domain = vitestStep("Domain Verification", "vitest.domain.config.ts", normalized, false);
  const integration = vitestStep(
    "Integration Verification",
    "vitest.integration.config.ts",
    normalized,
    false,
  );
  const taskProfile =
    options.task === undefined ? undefined : getVerificationTaskProfile(options.task);

  switch (mode) {
    case "unit":
      return {
        mode,
        label: "Unit Verification",
        gates: ["domain", "regression"],
        steps: [unit],
      };
    case "domain":
      return {
        mode,
        label: "Domain Verification",
        gates: ["domain", "regression"],
        steps: [domain],
      };
    case "integration":
      return {
        mode,
        label: "Integration Verification",
        gates: [
          "integration",
          "persistence",
          "transaction",
          "concurrency",
          "recovery",
          "replay",
          "cross-system",
        ],
        steps: [integration],
      };
    case "system":
      return {
        mode,
        label: "System Verification",
        gates: taskProfile?.requiredGates ?? verificationGates,
        steps: [{ kind: "typecheck" }, unit, domain, integration],
      };
    case "contract":
      return {
        mode,
        label: "Focused Contract Verification",
        gates:
          taskProfile?.requiredGates ?? (options.gate === undefined ? verificationGates : [options.gate]),
        steps: [
          vitestStep("Unit Verification", "vitest.config.ts", normalized, true),
          vitestStep("Integration Verification", "vitest.integration.config.ts", normalized, true),
        ],
      };
    case "gate":
      return {
        mode,
        label: "Focused Gate Verification",
        gates: taskProfile?.requiredGates ?? [options.gate ?? "domain"],
        steps: [
          vitestStep("Unit Verification", "vitest.config.ts", normalized, true),
          vitestStep("Integration Verification", "vitest.integration.config.ts", normalized, true),
        ],
      };
  }
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Vitest JSON report field ${field} must be numeric`);
  }
  return value;
}

function requireReport(value: unknown): VitestJsonReport {
  if (value === null || typeof value !== "object") {
    throw new Error("Vitest JSON report must be an object");
  }
  const report = value as Partial<VitestJsonReport>;
  if (!Array.isArray(report.testResults)) {
    throw new Error("Vitest JSON report field testResults must be an array");
  }
  return report as VitestJsonReport;
}

export function summarizeVitestReport(report: unknown): VerificationCounts {
  const value = requireReport(report);
  const pending = requireNumber(value.numPendingTests, "numPendingTests");
  const todo = requireNumber(value.numTodoTests, "numTodoTests");
  return {
    testFiles: value.testResults.length,
    tests: requireNumber(value.numTotalTests, "numTotalTests"),
    passed: requireNumber(value.numPassedTests, "numPassedTests"),
    failed: requireNumber(value.numFailedTests, "numFailedTests"),
    skipped: pending + todo,
  };
}

export function collectTaskGateEvidence(
  reports: readonly unknown[],
  profile: VerificationTaskProfile,
  gate: VerificationGate,
): TaskGateEvidence {
  const taskLabel = profile.label.toLowerCase();
  const gateLabel = `[${gate}]`;
  let evidence: TaskGateEvidence = { passed: 0, failed: 0, todo: 0, skipped: 0 };

  for (const reportValue of reports) {
    const report = requireReport(reportValue);
    for (const result of report.testResults) {
      for (const assertion of result.assertionResults) {
        const fullName = assertion.fullName.toLowerCase();
        if (!fullName.includes(taskLabel) || !fullName.includes(gateLabel)) continue;
        if (assertion.status === "passed") {
          evidence = { ...evidence, passed: evidence.passed + 1 };
        } else if (assertion.status === "failed") {
          evidence = { ...evidence, failed: evidence.failed + 1 };
        } else if (assertion.status === "todo") {
          evidence = { ...evidence, todo: evidence.todo + 1 };
        } else {
          evidence = { ...evidence, skipped: evidence.skipped + 1 };
        }
      }
    }
  }

  return evidence;
}

export function assertTaskGateCoverage(
  reports: readonly unknown[],
  profile: VerificationTaskProfile,
  requiredGates: readonly VerificationGate[] = profile.requiredGates,
): void {
  const invalid: string[] = [];
  const missing: string[] = [];

  for (const gate of requiredGates) {
    const evidence = collectTaskGateEvidence(reports, profile, gate);
    if (evidence.failed > 0 || evidence.todo > 0) invalid.push(gate);
    if (evidence.passed === 0) missing.push(gate);
  }

  if (invalid.length > 0) {
    throw new Error(
      `Task ${profile.id} gate evidence contains failed/todo tests: ${invalid.join(", ")}`,
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `Task ${profile.id} gate evidence has no passed tests: ${missing.join(", ")}`,
    );
  }
}

export function formatVerificationCounts(label: string, counts: VerificationCounts): string {
  return (
    `${label} counts: files=${counts.testFiles} tests=${counts.tests} ` +
    `passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped}`
  );
}

function aggregateCounts(counts: readonly VerificationCounts[]): VerificationCounts {
  return counts.reduce<VerificationCounts>(
    (total, count) => ({
      testFiles: total.testFiles + count.testFiles,
      tests: total.tests + count.tests,
      passed: total.passed + count.passed,
      failed: total.failed + count.failed,
      skipped: total.skipped + count.skipped,
    }),
    { testFiles: 0, tests: 0, passed: 0, failed: 0, skipped: 0 },
  );
}

function runCommand(command: string, args: readonly string[]): number {
  const result = spawnSync(command, [...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return result.status ?? 1;
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runVitestStep(step: VitestStep, temporaryDirectory: string, index: number): {
  readonly exitCode: number;
  readonly counts: VerificationCounts;
  readonly report: unknown;
} {
  const outputFile = join(temporaryDirectory, `vitest-${index}.json`);
  const args = [
    "exec",
    "--",
    "vitest",
    "run",
    "--config",
    step.config,
    "--reporter=json",
    `--outputFile=${outputFile}`,
  ];
  if (step.testNamePattern !== undefined) {
    args.push("--testNamePattern", step.testNamePattern);
  }
  if (step.passWithNoTests) args.push("--passWithNoTests");
  args.push(...step.filters);

  const exitCode = runCommand(npmCommand(), args);
  const report: unknown = JSON.parse(readFileSync(outputFile, "utf8"));
  return {
    exitCode,
    counts: summarizeVitestReport(report),
    report,
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let options: VerificationCliOptions;
  try {
    options = parseVerificationCli(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }

  const plan = createVerificationPlan(options.mode, options);
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "novel-brain-verification-"));
  const counts: VerificationCounts[] = [];
  const reports: unknown[] = [];
  let exitCode = 0;

  try {
    for (const [index, step] of plan.steps.entries()) {
      if (step.kind === "typecheck") {
        const code = runCommand(npmCommand(), ["run", "typecheck"]);
        if (code !== 0) exitCode = code;
        continue;
      }

      const result = runVitestStep(step, temporaryDirectory, index);
      counts.push(result.counts);
      reports.push(result.report);
      console.log(formatVerificationCounts(step.layer, result.counts));
      if (result.exitCode !== 0) exitCode = result.exitCode;
    }

    if (options.task !== undefined) {
      const profile = getVerificationTaskProfile(options.task);
      const requiredGates =
        options.mode === "gate" && options.gate !== undefined
          ? [options.gate]
          : profile.requiredGates;
      assertTaskGateCoverage(reports, profile, requiredGates);
    }
    if (options.mode === "contract" && aggregateCounts(counts).tests === 0) {
      throw new Error(`no focused contract tests matched: ${options.focus ?? "<missing>"}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    exitCode = exitCode === 0 ? 1 : exitCode;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  console.log(formatVerificationCounts(`${plan.label} total`, aggregateCounts(counts)));
  return exitCode;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await main();
}
