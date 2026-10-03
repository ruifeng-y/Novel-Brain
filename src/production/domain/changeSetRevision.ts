import type { DomainId, RevisionId } from "../../shared/domain/ids";
import { assertNoDuplicateTargets, type Change } from "./change";

export type RevisionTriggerType =
  | "initial_assembly"
  | "edit"
  | "conflict_resolution"
  | "rebase"
  | "regenerate";

export interface RevisionTrigger {
  readonly type: RevisionTriggerType;
  readonly references: readonly string[];
}

export interface ChangeSetRevision {
  readonly revisionId: RevisionId;
  readonly changeSetId: DomainId;
  readonly novelId: DomainId;
  readonly revisionNumber: number;
  readonly parentRevisionId?: RevisionId;
  readonly trigger: RevisionTrigger;
  readonly changes: readonly Change[];
  readonly createdAt: Date;
}

function freezeRevision(input: {
  revisionId: RevisionId;
  changeSetId: DomainId;
  novelId: DomainId;
  revisionNumber: number;
  parentRevisionId?: RevisionId;
  trigger: RevisionTrigger;
  changes: readonly Change[];
  createdAt: Date;
}): ChangeSetRevision {
  assertNoDuplicateTargets(input.changes);
  return Object.freeze({
    revisionId: input.revisionId,
    changeSetId: input.changeSetId,
    novelId: input.novelId,
    revisionNumber: input.revisionNumber,
    parentRevisionId: input.parentRevisionId,
    trigger: Object.freeze({
      type: input.trigger.type,
      references: Object.freeze([...input.trigger.references]),
    }),
    changes: Object.freeze([...input.changes]),
    createdAt: new Date(input.createdAt.getTime()),
  });
}

export function createInitialChangeSetRevision(input: {
  revisionId: RevisionId;
  changeSetId: DomainId;
  novelId: DomainId;
  createdAt: Date;
}): ChangeSetRevision {
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.changeSetId) throw new Error("changeSetId is required");
  if (!input.novelId) throw new Error("novelId is required");

  return freezeRevision({
    revisionId: input.revisionId,
    changeSetId: input.changeSetId,
    novelId: input.novelId,
    revisionNumber: 1,
    trigger: { type: "initial_assembly", references: [] },
    changes: [],
    createdAt: input.createdAt,
  });
}

export function createChangeSetRevision(input: {
  parent: ChangeSetRevision;
  revisionId: RevisionId;
  trigger: RevisionTrigger;
  changes: readonly Change[];
  createdAt: Date;
}): ChangeSetRevision {
  if (!input.revisionId) throw new Error("revisionId is required");

  return freezeRevision({
    revisionId: input.revisionId,
    changeSetId: input.parent.changeSetId,
    novelId: input.parent.novelId,
    revisionNumber: input.parent.revisionNumber + 1,
    parentRevisionId: input.parent.revisionId,
    trigger: input.trigger,
    changes: input.changes,
    createdAt: input.createdAt,
  });
}
