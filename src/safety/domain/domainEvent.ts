import type { DomainId, RevisionId } from "../../shared/domain/ids";
import { deepFreeze } from "../../shared/domain/immutable";

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

const EVENT_CONTEXTS: Readonly<Record<DomainEventName, ProducingContext>> = {
  NovelCreated: "narrative_state",
  SceneCommitted: "manuscript",
  CanonicalFactChanged: "narrative_state",
  CharacterStateChanged: "narrative_state",
  WorldStateChanged: "narrative_state",
  PlotStateChanged: "narrative_state",
  CandidateCreated: "ai_production",
  ValidationCompleted: "ai_production",
  ReviewDecisionRecorded: "ai_production",
  NarrativeCommitRecorded: "ai_production",
  MemoryProjectionRebuilt: "memory",
};

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
  if (EVENT_CONTEXTS[input.name] !== input.context) {
    throw new Error(`Event ${input.name} cannot be produced by context ${input.context}`);
  }

  return Object.freeze({
    eventId: input.eventId,
    name: input.name,
    context: input.context,
    novelId: input.novelId,
    objectId: input.objectId,
    revisionId: input.revisionId,
    commitId: input.commitId,
    payload: deepFreeze({ ...input.payload }),
    occurredAt: input.occurredAt,
  });
}
