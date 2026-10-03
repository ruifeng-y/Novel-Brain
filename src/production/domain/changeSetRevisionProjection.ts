export type ValidationOutcome = "pass" | "fail" | "needs_review";

export type RevisionHeadlineStatus =
  | "committed"
  | "invalid"
  | "stale"
  | "approved"
  | "validated"
  | "failed"
  | "needs_review"
  | "submitted"
  | "ready"
  | "assembling";

export interface RevisionProjectionFacts {
  readonly committed: boolean;
  readonly unresolvedConflict: boolean;
  readonly stale: boolean;
  readonly approved: boolean;
  readonly submitted: boolean;
  readonly hasChanges: boolean;
  readonly validationOutcome?: ValidationOutcome;
}

export interface RevisionProjection {
  readonly headline: RevisionHeadlineStatus;
  readonly committed: boolean;
  readonly unresolvedConflict: boolean;
  readonly stale: boolean;
  readonly approved: boolean;
  readonly submitted: boolean;
  readonly validationOutcome?: ValidationOutcome;
}

function resolveHeadline(facts: RevisionProjectionFacts): RevisionHeadlineStatus {
  if (facts.committed) return "committed";
  if (facts.unresolvedConflict) return "invalid";
  if (facts.stale) return "stale";
  if (facts.approved) return "approved";
  if (facts.validationOutcome === "fail") return "failed";
  if (facts.validationOutcome === "needs_review") return "needs_review";
  if (facts.validationOutcome === "pass") return "validated";
  if (facts.submitted) return "submitted";
  if (facts.hasChanges) return "ready";
  return "assembling";
}

export function projectRevision(facts: RevisionProjectionFacts): RevisionProjection {
  return Object.freeze({
    headline: resolveHeadline(facts),
    committed: facts.committed,
    unresolvedConflict: facts.unresolvedConflict,
    stale: facts.stale,
    approved: facts.approved,
    submitted: facts.submitted,
    validationOutcome: facts.validationOutcome,
  });
}
