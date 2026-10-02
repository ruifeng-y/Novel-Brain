import { describe, expect, it } from "vitest";
import {
  createValidationRun,
  summarizeValidationOutcome,
} from "../../src/production/domain/validationRun";

const now = new Date("2026-10-02T00:00:00.000Z");

function run(outcome: "pass" | "fail" | "needs_review") {
  return createValidationRun({
    id: "validation-1",
    candidateId: "candidate-1",
    candidateRevisionId: "candidate-rev-1",
    validatorId: "target-span-validator",
    outcome,
    findings: [
      {
        code: "PRESERVED_TEXT_MISSING",
        severity: outcome === "pass" ? "info" : "error",
        confidence: 0.96,
        message: "Required phrase was not preserved.",
        evidence: { requiredPhrase: "Northern Sect" },
      },
    ],
    createdAt: now,
  });
}

describe("ValidationRun", () => {
  it("binds validation evidence to one candidate revision", () => {
    expect(run("pass")).toMatchObject({
      candidateId: "candidate-1",
      candidateRevisionId: "candidate-rev-1",
      outcome: "pass",
    });
  });

  it("rejects validation without a candidate revision", () => {
    expect(() =>
      createValidationRun({
        id: "validation-1",
        candidateId: "candidate-1",
        candidateRevisionId: "",
        validatorId: "validator",
        outcome: "pass",
        findings: [],
        createdAt: now,
      }),
    ).toThrow("candidateRevisionId is required");
  });

  it("summarizes the most severe outcome", () => {
    expect(summarizeValidationOutcome(["pass", "pass"])).toBe("pass");
    expect(summarizeValidationOutcome(["pass", "needs_review"])).toBe("needs_review");
    expect(summarizeValidationOutcome(["needs_review", "fail"])).toBe("fail");
  });
});
