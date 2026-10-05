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
      evidenceLabels: ["[task:R7]", "[task:R8]", "[task:R9]"],
      requiredGates: ["domain", "integration", "cross-system", "regression"],
    });
    expect(() => parseVerificationCli(["system", "--task", "R7-R9"])).not.toThrow();
  });
});

describe("[task:R9] [cross-system] recall attention disposition surface", () => {
  it("exposes the frozen author actions through the disposition endpoint", () => {
    const source = publicFile("app.js");

    expect(source).toContain('data-action="record-disposition"');
    expect(source).toContain("data-disposition-action");
    expect(source).toContain('"/attention/" + encodeURIComponent');
    expect(source).toContain("/dispositions");
    expect(source).toContain("evidenceFingerprint");
    for (const action of ["inspect", "dismiss", "snooze", "confirm", "ignore", "why"]) {
      expect(source).toContain(`action: "${action}"`);
    }
  });

  it("keeps the recall view read-only, Chinese, and free of commit or task creation", () => {
    const source = publicFile("app.js");

    expect(source).toContain("召回只读");
    expect(source).toContain("不提交、不创建任务");
    expect(source).toContain("可修改叙事真相");
    expect(source).toContain("建议动作通道");
    expect(source).not.toContain("/change-sets/");
    expect(source).not.toMatch(/data-action="commit"/);
  });

  it("renders the frozen disposition state set with Chinese copy", () => {
    const source = publicFile("app.js");

    for (const state of [
      "active",
      "inspected",
      "dismissed",
      "snoozed",
      "confirmed",
      "ignored",
      "why_requested",
    ]) {
      expect(source).toContain(`${state}: "`);
    }
    expect(source).toContain("处置状态：");
  });
});
