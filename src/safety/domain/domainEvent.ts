import type { DomainId, RevisionId } from "../../shared/domain/ids";

export type DomainEventName =
  | "NovelCreated"
  | "SceneCommitted"
  | "CanonicalFactChanged"
  | "CharacterStateChanged"
  | "WorldStateChanged"
  | "PlotStateChanged"
  | "CandidateCreated"
  | "ValidationCompleted"
  | "ReviewDecisionRecorded"
  | "NarrativeCommitRecorded"
  | "MemoryProjectionRebuilt";

export type ProducingContext =
  | "narrative_state"
  | "manuscript"
  | "ai_production"
  | "memory"
  | "platform";

export interface DomainEvent {
  readonly eventId: DomainId;
  readonly name: DomainEventName;
  readonly context: ProducingContext;
  readonly novelId: DomainId;
  readonly objectId: DomainId;
  readonly revisionId: RevisionId;
  readonly commitId?: DomainId;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export function createDomainEvent(input: {
  eventId: DomainId;
  name: DomainEventName;
  context: ProducingContext;
  novelId: DomainId;
  objectId: DomainId;
  revisionId: RevisionId;
  commitId?: DomainId;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
}): DomainEvent {
  if (!input.eventId) throw new Error("eventId is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.objectId) throw new Error("objectId is required");
  if (!input.revisionId) throw new Error("revisionId is required");

  return Object.freeze({
    eventId: input.eventId,
    name: input.name,
    context: input.context,
    novelId: input.novelId,
    objectId: input.objectId,
    revisionId: input.revisionId,
    commitId: input.commitId,
    payload: Object.freeze({ ...input.payload }),
    occurredAt: input.occurredAt,
  });
}
