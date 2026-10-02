import {
  createDomainEvent,
  type DomainEvent,
  type JsonPayload,
} from "../../../safety/domain/domainEvent";

export interface NarrativeStateEventInput {
  readonly eventId: string;
  readonly novelId: string;
  readonly objectId: string;
  readonly revisionId: string;
  readonly commitId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export function createCanonicalFactChangedEvent(input: NarrativeStateEventInput): DomainEvent {
  return createDomainEvent({
    ...input,
    name: "CanonicalFactChanged",
    context: "narrative_state",
    payload: input.payload as JsonPayload,
  });
}

export function createCharacterStateChangedEvent(input: NarrativeStateEventInput): DomainEvent {
  return createDomainEvent({
    ...input,
    name: "CharacterStateChanged",
    context: "narrative_state",
    payload: input.payload as JsonPayload,
  });
}

export function createWorldStateChangedEvent(input: NarrativeStateEventInput): DomainEvent {
  return createDomainEvent({
    ...input,
    name: "WorldStateChanged",
    context: "narrative_state",
    payload: input.payload as JsonPayload,
  });
}

export function createPlotStateChangedEvent(input: NarrativeStateEventInput): DomainEvent {
  return createDomainEvent({
    ...input,
    name: "PlotStateChanged",
    context: "narrative_state",
    payload: input.payload as JsonPayload,
  });
}
