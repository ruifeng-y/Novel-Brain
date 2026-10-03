import type { DomainId, RevisionId } from "../../shared/domain/ids";
import { assertNoDuplicateTargets, type Change } from "./change";

export type ChangeSetLifecycle = "open" | "closed";
export type ChangeSetClosureDisposition = "committed" | "abandoned" | "superseded";

export interface ChangeSet {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly changes: readonly Change[];
  readonly currentRevisionId: RevisionId;
  readonly lifecycle: ChangeSetLifecycle;
  readonly closureDisposition?: ChangeSetClosureDisposition;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function createChangeSet(input: {
  id: DomainId;
  novelId: DomainId;
  initialRevisionId: RevisionId;
  createdAt: Date;
}): ChangeSet {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.initialRevisionId) throw new Error("initialRevisionId is required");

  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    changes: Object.freeze([]),
    currentRevisionId: input.initialRevisionId,
    lifecycle: "open",
    createdAt: new Date(input.createdAt.getTime()),
    updatedAt: new Date(input.createdAt.getTime()),
  });
}

export function replaceChangeSetChanges(input: {
  changeSet: ChangeSet;
  changes: readonly Change[];
  revisionId: RevisionId;
  updatedAt: Date;
}): ChangeSet {
  if (input.changeSet.lifecycle === "closed") {
    throw new Error("Closed change set cannot be modified");
  }
  if (!input.revisionId) throw new Error("revisionId is required");
  if (input.revisionId === input.changeSet.currentRevisionId) {
    throw new Error("revisionId must differ from the current revision");
  }
  if (input.updatedAt < input.changeSet.updatedAt) {
    throw new Error("updatedAt cannot move backward");
  }
  assertNoDuplicateTargets(input.changes);

  return Object.freeze({
    ...input.changeSet,
    changes: Object.freeze([...input.changes]),
    currentRevisionId: input.revisionId,
    updatedAt: new Date(input.updatedAt.getTime()),
  });
}

export function closeChangeSet(input: {
  changeSet: ChangeSet;
  disposition: ChangeSetClosureDisposition;
  updatedAt: Date;
}): ChangeSet {
  if (input.changeSet.lifecycle === "closed") {
    throw new Error("Change set is already closed");
  }
  if (input.updatedAt < input.changeSet.updatedAt) {
    throw new Error("updatedAt cannot move backward");
  }

  return Object.freeze({
    ...input.changeSet,
    lifecycle: "closed",
    closureDisposition: input.disposition,
    updatedAt: new Date(input.updatedAt.getTime()),
  });
}
