import {
  createDomainEvent,
  type DomainEvent,
  type JsonPayload,
} from "../../safety/domain/domainEvent";

export function createMemoryProjectionRebuiltEvent(input: {
  eventId: string;
  novelId: string;
  objectId: string;
  revisionId: string;
  commitId?: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
}): DomainEvent {
  return createDomainEvent({
    ...input,
    name: "MemoryProjectionRebuilt",
    context: "memory",
    payload: input.payload as JsonPayload,
  });
}
