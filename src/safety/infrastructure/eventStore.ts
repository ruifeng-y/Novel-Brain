import type { DomainEvent } from "../domain/domainEvent";
import { deepFreeze } from "../../shared/domain/immutable";

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, cloneValue(nested)]),
    );
  }
  return value;
}

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
        payload: cloneValue(event.payload) as Record<string, unknown>,
      }),
    );
  }

  async listByNovel(novelId: string): Promise<readonly DomainEvent[]> {
    return Object.freeze([...this.events.filter((event) => event.novelId === novelId)]);
  }
}
