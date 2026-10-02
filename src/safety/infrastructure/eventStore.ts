import type { DomainEvent } from "../domain/domainEvent";
import { cloneJsonPayload } from "../domain/domainEvent";
import { deepFreeze } from "../../shared/domain/immutable";

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  listByNovel(novelId: string): Promise<readonly DomainEvent[]>;
}

export class InMemoryEventStore implements EventStore {
  private readonly events: DomainEvent[] = [];
  private readonly eventIds = new Set<string>();

  async append(event: DomainEvent): Promise<void> {
    if (this.eventIds.has(event.eventId)) {
      throw new Error(`Duplicate event id: ${event.eventId}`);
    }
    this.eventIds.add(event.eventId);
    this.events.push(
      deepFreeze({
        ...event,
        payload: cloneJsonPayload(event.payload),
      }),
    );
  }

  async listByNovel(novelId: string): Promise<readonly DomainEvent[]> {
    return Object.freeze([...this.events.filter((event) => event.novelId === novelId)]);
  }
}
