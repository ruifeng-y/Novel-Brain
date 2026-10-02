import type { DomainEvent } from "../domain/domainEvent";
import { cloneJsonPayload } from "../domain/domainEvent";
import { deepFreeze } from "../../shared/domain/immutable";

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  appendMany(events: readonly DomainEvent[]): Promise<void>;
  listByNovel(novelId: string): Promise<readonly DomainEvent[]>;
}

export class InMemoryEventStore implements EventStore {
  private readonly events: DomainEvent[] = [];
  private readonly eventIds = new Set<string>();

  async append(event: DomainEvent): Promise<void> {
    await this.appendMany([event]);
  }

  async appendMany(events: readonly DomainEvent[]): Promise<void> {
    const ids = new Set<string>();
    for (const event of events) {
      if (this.eventIds.has(event.eventId) || ids.has(event.eventId)) {
        throw new Error(`Duplicate event id: ${event.eventId}`);
      }
      ids.add(event.eventId);
    }
    const snapshots = events.map(event =>
      deepFreeze({
        ...event,
        payload: cloneJsonPayload(event.payload),
      }),
    );
    for (const snapshot of snapshots) this.eventIds.add(snapshot.eventId);
    this.events.push(...snapshots);
  }

  async listByNovel(novelId: string): Promise<readonly DomainEvent[]> {
    return Object.freeze([...this.events.filter((event) => event.novelId === novelId)]);
  }
}
