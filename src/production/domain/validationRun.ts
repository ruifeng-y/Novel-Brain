import type { DomainId, RevisionId } from "../../shared/domain/ids";

export type ValidationOutcome = "pass" | "fail" | "needs_review";
export type ValidationSeverity = "info" | "warning" | "error";

export interface ValidationFinding {
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly confidence: number;
  readonly message: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface ValidationRun {
  readonly id: DomainId;
  readonly candidateId: DomainId;
  readonly candidateRevisionId: RevisionId;
  readonly validatorId: string;
  readonly outcome: ValidationOutcome;
  readonly findings: readonly ValidationFinding[];
  readonly createdAt: Date;
}

export function createValidationRun(input: {
  id: DomainId;
  candidateId: DomainId;
  candidateRevisionId: RevisionId;
  validatorId: string;
  outcome: ValidationOutcome;
  findings: readonly ValidationFinding[];
  createdAt: Date;
}): ValidationRun {
  if (!input.id) throw new Error("id is required");
  if (!input.candidateId) throw new Error("candidateId is required");
  if (!input.candidateRevisionId) throw new Error("candidateRevisionId is required");
  if (!input.validatorId.trim()) throw new Error("validatorId is required");

  for (const finding of input.findings) {
    if (!finding.code.trim()) throw new Error("finding.code is required");
    if (finding.confidence < 0 || finding.confidence > 1) {
      throw new Error("finding.confidence must be between 0 and 1");
    }
  }

  return Object.freeze({
    id: input.id,
    candidateId: input.candidateId,
    candidateRevisionId: input.candidateRevisionId,
    validatorId: input.validatorId.trim(),
    outcome: input.outcome,
    findings: Object.freeze(input.findings.map((finding) => Object.freeze({ ...finding }))),
    createdAt: input.createdAt,
  });
}

export function summarizeValidationOutcome(outcomes: readonly ValidationOutcome[]): ValidationOutcome {
  if (outcomes.length === 0) throw new Error("At least one validation outcome is required");
  if (outcomes.includes("fail")) return "fail";
  if (outcomes.includes("needs_review")) return "needs_review";
  return "pass";
}
