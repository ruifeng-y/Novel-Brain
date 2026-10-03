import type { ChangeSetLifecycle } from "./changeSet";
import type { RevisionTrigger } from "./changeSetRevision";

export interface TriggerStatusFacts {
  readonly changeSetLifecycle: ChangeSetLifecycle;
  readonly parentCommitted: boolean;
  readonly unresolvedConflict: boolean;
  readonly stale: boolean;
  readonly hasReExecutableSource: boolean;
}

export function assertTriggerPreconditions(
  trigger: RevisionTrigger,
  facts: TriggerStatusFacts,
): void {
  switch (trigger.type) {
    case "initial_assembly":
      return;
    case "edit":
      if (facts.changeSetLifecycle !== "open") {
        throw new Error("Edit requires an open change set");
      }
      if (facts.parentCommitted) {
        throw new Error("Edit requires a parent revision that is not committed");
      }
      return;
    case "conflict_resolution":
      if (!facts.unresolvedConflict) {
        throw new Error("Conflict resolution requires an unresolved conflict");
      }
      return;
    case "rebase":
      if (!facts.stale) {
        throw new Error("Rebase requires a stale revision");
      }
      return;
    case "regenerate":
      if (!facts.hasReExecutableSource) {
        throw new Error("Regenerate requires a re-executable source");
      }
      return;
  }
}