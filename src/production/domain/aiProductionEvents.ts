import {
  createDomainEvent,
  type DomainEvent,
  type JsonPayload,
} from "../../safety/domain/domainEvent";

export interface AIProductionEventInput {
  readonly eventId: string;
  readonly novelId: string;
  readonly objectId: string;
  readonly revisionId: string;
  readonly commitId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export function createCandidateCreatedEvent(input: AIProductionEventInput): DomainEvent {
  return createDomainEvent({ ...input, name: "CandidateCreated", context: "ai_production", payload: input.payload as JsonPayload });
}

export function createValidationCompletedEvent(input: AIProductionEventInput): DomainEvent {
  return createDomainEvent({ ...input, name: "ValidationCompleted", context: "ai_production", payload: input.payload as JsonPayload });
}

export function createReviewDecisionRecordedEvent(input: AIProductionEventInput): DomainEvent {
  return createDomainEvent({ ...input, name: "ReviewDecisionRecorded", context: "ai_production", payload: input.payload as JsonPayload });
}

export function createNarrativeCommitRecordedEvent(input: AIProductionEventInput): DomainEvent {
  return createDomainEvent({ ...input, name: "NarrativeCommitRecorded", context: "ai_production", payload: input.payload as JsonPayload });
}
