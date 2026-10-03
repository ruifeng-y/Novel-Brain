import { describe, expect, it } from "vitest";
import {
  createValidationRun,
  summarizeValidationOutcome,
} from "../../src/production/domain/validationRun";

const now = new Date("2026-10-03T00:00:00.000Z");

function entry(overrides: Record<string, unknown> = {}) {
  return {
    entryReference: "rule:target-span-preserved",
    executionMode: "full_reexecution" as const,
    verdict: "pass" as const,
    findings: [],
    evidence: [
      {
        id: "evidence-1",
        type: "revision-comparison",
        sourceReference: { identity: "scene-1", version: "scene-rev-1", hash: "hash-1" },
        observation: "Observed revision equals expected revision.",
      },
    ],
    ...overrides,
  };
}

describe("ValidationRun", () => {
  it("binds to a change set revision and a frozen plan version", () => {
    const run = createValidationRun({
      id: "validation-1",
      changeSetRevisionId: "cs-1-r3",
      planVersionId: "cs-1-r3-plan-1",
      validatorId: "target-span-validator",
      entryResults: [entry()],
      executionState: "completed",
      outcome: "pass",
      createdAt: now,
    });
    expect(run.changeSetRevisionId).toBe("cs-1-r3");
    expect(run.planVersionId).toBe("cs-1-r3-plan-1");
    expect(Object.prototype.hasOwnProperty.call(run, "candidateId")).toBe(false);
  });

  it("rejects a missing change set revision or plan version", () => {
    expect(() =>
      createValidationRun({
        id: "validation-1",
        changeSetRevisionId: "",
        planVersionId: "plan-1",
        validatorId: "validator",
        entryResults: [],
        executionState: "completed",
        outcome: "pass",
        createdAt: now,
      }),
    ).toThrow("changeSetRevisionId is required");
    expect(() =>
      createValidationRun({
        id: "validation-1",
        changeSetRevisionId: "cs-1-r3",
        planVersionId: "",
        validatorId: "validator",
        entryResults: [],
        executionState: "completed",
        outcome: "pass",
        createdAt: now,
      }),
    ).toThrow("planVersionId is required");
  });

  it("allows a not-applicable entry to carry no verdict", () => {
    const run = createValidationRun({
      id: "validation-1",
      changeSetRevisionId: "cs-1-r3",
      planVersionId: "plan-1",
      validatorId: "validator",
      entryResults: [entry({ executionMode: "not_applicable", verdict: undefined })],
      executionState: "completed",
      outcome: "pass",
      createdAt: now,
    });
    expect(run.entryResults[0]?.verdict).toBeUndefined();
  });

  it("rejects a verdict on a not-applicable entry", () => {
    expect(() =>
      createValidationRun({
        id: "validation-1",
        changeSetRevisionId: "cs-1-r3",
        planVersionId: "plan-1",
        validatorId: "validator",
        entryResults: [entry({ executionMode: "not_applicable" })],
        executionState: "completed",
        outcome: "pass",
        createdAt: now,
      }),
    ).toThrow("A not-applicable entry cannot carry a verdict");
  });

  it("produces an outcome only when completed", () => {
    expect(() =>
      createValidationRun({
        id: "validation-1",
        changeSetRevisionId: "cs-1-r3",
        planVersionId: "plan-1",
        validatorId: "validator",
        entryResults: [entry()],
        executionState: "interrupted",
        outcome: "pass",
        createdAt: now,
      }),
    ).toThrow("Outcome is only available for a completed run");
  });

  it("allows an interrupted run to keep partial evidence without an outcome", () => {
    const run = createValidationRun({
      id: "validation-1",
      changeSetRevisionId: "cs-1-r3",
      planVersionId: "plan-1",
      validatorId: "validator",
      entryResults: [entry()],
      executionState: "interrupted",
      createdAt: now,
    });
    expect(run.outcome).toBeUndefined();
    expect(run.entryResults).toHaveLength(1);
  });

  it("summarises the most severe outcome", () => {
    expect(summarizeValidationOutcome(["pass", "pass"])).toBe("pass");
    expect(summarizeValidationOutcome(["pass", "needs_review"])).toBe("needs_review");
    expect(summarizeValidationOutcome(["needs_review", "fail"])).toBe("fail");
  });
});
