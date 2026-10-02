import type { DomainId, RevisionId } from "../../../shared/domain/ids";

export type StateRecordType =
  | "character_state"
  | "world_state"
  | "timeline_record"
  | "relationship_state"
  | "knowledge_state"
  | "unresolved_thread"
  | "plot_progress";

export interface NarrativePosition {
  readonly sceneId: DomainId;
  readonly ordinal: number;
}

export type StateContent = Readonly<Record<string, unknown>>;

export interface StateRecord {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly type: StateRecordType;
  readonly subjectId: DomainId;
  readonly position: NarrativePosition;
  readonly content: StateContent;
  readonly currentRevisionId: RevisionId;
  readonly lastCommitId: DomainId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateStateRecordInput {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly type: StateRecordType;
  readonly subjectId: DomainId;
  readonly position: NarrativePosition;
  readonly content: StateContent;
  readonly revisionId: RevisionId;
  readonly commitId: DomainId;
  readonly createdAt: Date;
}

export interface ReplaceStateRecordInput {
  readonly record: StateRecord;
  readonly content: StateContent;
  readonly revisionId: RevisionId;
  readonly commitId: DomainId;
  readonly updatedAt: Date;
}

function assertPosition(position: NarrativePosition): void {
  if (!position.sceneId) throw new Error("position.sceneId is required");
  if (!Number.isInteger(position.ordinal) || position.ordinal < 0) {
    throw new Error("position.ordinal must be a non-negative integer");
  }
}

export function createStateRecord(input: CreateStateRecordInput): StateRecord {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.subjectId) throw new Error("subjectId is required");
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.commitId) throw new Error("commitId is required");
  assertPosition(input.position);

  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    type: input.type,
    subjectId: input.subjectId,
    position: Object.freeze({ ...input.position }),
    content: Object.freeze({ ...input.content }),
    currentRevisionId: input.revisionId,
    lastCommitId: input.commitId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function replaceStateRecord(input: ReplaceStateRecordInput): StateRecord {
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.commitId) throw new Error("commitId is required");
  if (input.updatedAt < input.record.updatedAt) throw new Error("updatedAt cannot move backward");

  return Object.freeze({
    ...input.record,
    content: Object.freeze({ ...input.content }),
    currentRevisionId: input.revisionId,
    lastCommitId: input.commitId,
    updatedAt: input.updatedAt,
  });
}
