import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseVerificationCli } from "../../scripts/verificationHarness";
import { getVerificationTaskProfile } from "../../scripts/verificationTaskManifest";

function publicFile(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../public/${name}`, import.meta.url)), "utf8");
}

describe("[task:R8] [cross-system] run view completion", () => {
  it("creates a generation task, a plan revision, approves it, and starts the run", () => {
    const source = publicFile("app.js");

    expect(source).toContain("/run-plans");
    expect(source).toContain("/approvals");
    expect(source).toContain("/generation-tasks");
    expect(source).toContain('data-action="create-generation-task"');
    expect(source).toContain('data-action="create-run-plan"');
    expect(source).toContain('data-action="approve-run-plan"');
    expect(source).toContain('data-action="start-run"');
  });

  it("keeps the run view Chinese, obtainable-id driven, and free of commit actions", () => {
    const source = publicFile("app.js");

    expect(source).toContain("创建生成任务");
    expect(source).toContain("创建计划修订");
    expect(source).toContain("批准计划");
    expect(source).toContain("启动生产运行");
    expect(source).toContain("runPlanRevisionId");
    expect(source).toContain("generationTaskId");
    expect(source).not.toContain("/change-sets/");
    expect(source).not.toMatch(/data-action="commit"/);
  });
});

describe("[task:R8] [regression] run creation release registration", () => {
  it("registers the combined run and recall completion profile", () => {
    expect(getVerificationTaskProfile("R7-R9")).toEqual({
      id: "R7-R9",
      label: "[task:R7-R9]",
      evidenceLabels: ["[task:R8]", "[task:R9]"],
      requiredGates: ["domain", "integration", "cross-system", "regression"],
    });
    expect(() => parseVerificationCli(["system", "--task", "R7-R9"])).not.toThrow();
  });
});
