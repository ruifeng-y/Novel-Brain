import {
  createDomainEvent,
  type DomainEvent,
  type JsonPayload,
} from "../../safety/domain/domainEvent";

export interface ManuscriptEventInput {
  readonly eventId: string;
  readonly novelId: string;
  readonly objectId: string;
  readonly revisionId: string;
  readonly commitId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export function createSceneCommittedEvent(input: ManuscriptEventInput): DomainEvent {
  return createDomainEvent({
    ...input,
    name: "SceneCommitted",
    context: "manuscript",
    payload: input.payload as JsonPayload,
  });
}
