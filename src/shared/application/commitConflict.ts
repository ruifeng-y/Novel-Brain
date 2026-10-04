export type CommitConflictType =
  | "cas_revision"
  | "cas_commit_status"
  | "narrative_commit_id"
  | "narrative_commit_revision"
  | "narrative_commit_binding"
  | "duplicate_event_id"
  | "duplicate_target"
  | "unique_record"
  | "revision_history"
  | "raw_write_in_transaction";

export class CommitConflictError extends Error {
  readonly conflictType: CommitConflictType;

  constructor(conflictType: CommitConflictType, message: string) {
    super(message);
    this.name = "CommitConflictError";
    this.conflictType = conflictType;
  }
}

export function isCommitConflictError(error: unknown): error is CommitConflictError {
  if (error instanceof CommitConflictError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "CommitConflictError" &&
    typeof (error as { conflictType?: unknown }).conflictType === "string"
  );
}
