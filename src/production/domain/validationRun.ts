import type { DomainId, RevisionId } from "../../shared/domain/ids";

export type ValidationExecutionMode = "full_reexecution" | "cached_reuse" | "not_applicable";
export type ValidationVerdict = "pass" | "fail" | "needs_review";
export type ValidationOutcome = "pass" | "fail" | "needs_review";
export type ValidationExecutionState = "running" | "completed" | "interrupted" | "failed";
export type ValidationSeverity = "info" | "warning" | "error";

export interface EvidenceSourceReference {
  readonly identity: DomainId;
  readonly version: string;
  readonly hash: string;
}

export interface ValidationEvidence {
  readonly id: string;
  readonly type: string;
  readonly sourceReference: EvidenceSourceReference;
  readonly observation: string;
}

export interface ValidationFinding {
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly confidence: number;
  readonly message: string;
  readonly evidence: readonly ValidationEvidence[];
}

export interface ValidationEntryResult {
  readonly entryReference: string;
  readonly executionMode: ValidationExecutionMode;
  readonly verdict?: ValidationVerdict;
  readonly findings: readonly ValidationFinding[];
  readonly evidence: readonly ValidationEvidence[];
}

export interface ValidationRun {
  readonly id: DomainId;
  readonly changeSetRevisionId: RevisionId;
  readonly planVersionId: string;
  readonly validatorId: string;
  readonly entryResults: readonly ValidationEntryResult[];
  readonly executionState: ValidationExecutionState;
  readonly outcome?: ValidationOutcome;
  readonly createdAt: Date;
}

function freezeEvidence(evidence: ValidationEvidence): ValidationEvidence {
  return Object.freeze({
    id: evidence.id,
    type: evidence.type,
    sourceReference: Object.freeze({ ...evidence.sourceReference }),
    observation: evidence.observation,
  });
}

function freezeEntry(entry: ValidationEntryResult): ValidationEntryResult {
  if (entry.executionMode === "not_applicable" && entry.verdict !== undefined) {
    throw new Error("A not-applicable entry cannot carry a verdict");
  }
  if (entry.executionMode !== "not_applicable" && entry.verdict === undefined) {
    throw new Error("An executed entry requires a verdict");
  }
  for (const finding of entry.findings) {
    if (!finding.code.trim()) throw new Error("finding.code is required");
    if (finding.confidence < 0 || finding.confidence > 1) {
      throw new Error("finding.confidence must be between 0 and 1");
    }
  }
  return Object.freeze({
    entryReference: entry.entryReference,
    executionMode: entry.executionMode,
    verdict: entry.verdict,
    findings: Object.freeze(
      entry.findings.map(finding =>
        Object.freeze({
          ...finding,
          evidence: Object.freeze(finding.evidence.map(freezeEvidence)),
        }),
      ),
    ),
    evidence: Object.freeze(entry.evidence.map(freezeEvidence)),
  });
}

export function createValidationRun(input: {
  id: DomainId;
  changeSetRevisionId: RevisionId;
  planVersionId: string;
  validatorId: string;
  entryResults: readonly ValidationEntryResult[];
  executionState: ValidationExecutionState;
  outcome?: ValidationOutcome;
  createdAt: Date;
}): ValidationRun {
  if (!input.id) throw new Error("id is required");
  if (!input.changeSetRevisionId) throw new Error("changeSetRevisionId is required");
  if (!input.planVersionId) throw new Error("planVersionId is required");
  if (!input.validatorId.trim()) throw new Error("validatorId is required");
  if (input.executionState !== "completed" && input.outcome !== undefined) {
    throw new Error("Outcome is only available for a completed run");
  }
  if (input.executionState === "completed" && input.outcome === undefined) {
    throw new Error("A completed run requires an outcome");
  }

  return Object.freeze({
    id: input.id,
    changeSetRevisionId: input.changeSetRevisionId,
    planVersionId: input.planVersionId,
    validatorId: input.validatorId.trim(),
    entryResults: Object.freeze(input.entryResults.map(freezeEntry)),
    executionState: input.executionState,
    outcome: input.outcome,
    createdAt: input.createdAt,
  });
}

export function summarizeValidationOutcome(
  outcomes: readonly ValidationOutcome[],
): ValidationOutcome {
  if (outcomes.length === 0) throw new Error("At least one validation outcome is required");
  if (outcomes.includes("fail")) return "fail";
  if (outcomes.includes("needs_review")) return "needs_review";
  return "pass";
}
