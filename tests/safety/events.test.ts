import { describe, expect, it } from "vitest";
import { createDomainEvent } from "../../src/safety/domain/domainEvent";
import type { DomainEvent } from "../../src/safety/domain/domainEvent";
import { InMemoryEventStore } from "../../src/safety/infrastructure/eventStore";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("domain events", () => {
  it("binds event semantics to the producing context", () => {
    const event = createDomainEvent({
      eventId: "event-1",
      name: "SceneCommitted",
      context: "manuscript",
      novelId: "novel-1",
      objectId: "scene-1",
      revisionId: "scene-rev-2",
      commitId: "commit-1",
      payload: { textLength: 31 },
      occurredAt: now,
    });

    expect(event.context).toBe("manuscript");
    expect(event.name).toBe("SceneCommitted");
  });

  it("requires event identity and context", () => {
    expect(() =>
      createDomainEvent({
        eventId: "",
        name: "SceneCommitted",
        context: "manuscript",
        novelId: "novel-1",
        objectId: "scene-1",
        revisionId: "scene-rev-2",
        commitId: "commit-1",
        payload: {},
        occurredAt: now,
      }),
    ).toThrow("eventId is required");
  });

  it("rejects event names from the wrong producing context", () => {
    expect(() =>
      createDomainEvent({
        eventId: "event-invalid",
        name: "SceneCommitted",
        context: "narrative_state",
        novelId: "novel-1",
        objectId: "scene-1",
        revisionId: "scene-rev-2",
        payload: {},
        occurredAt: now,
      }),
    ).toThrow("Event SceneCommitted cannot be produced by context narrative_state");
    expect(() =>
      createDomainEvent({
        eventId: "event-invalid-2",
        name: "MemoryProjectionRebuilt",
        context: "platform",
        novelId: "novel-1",
        objectId: "memory-1",
        revisionId: "memory-rev-1",
        payload: {},
        occurredAt: now,
      }),
    ).toThrow("Event MemoryProjectionRebuilt cannot be produced by context platform");
  });

  it("deep-freezes nested event payloads", () => {
    const event = createDomainEvent({
      eventId: "event-nested",
      name: "SceneCommitted",
      context: "manuscript",
      novelId: "novel-1",
      objectId: "scene-1",
      revisionId: "scene-rev-2",
      payload: { nested: { values: [{ id: "one" }] } },
      occurredAt: now,
    });
    const nested = (event.payload as { nested: { values: Array<{ id: string }> } }).nested;
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.values)).toBe(true);
    expect(Object.isFrozen(nested.values[0])).toBe(true);
    expect(() => nested.values.push({ id: "two" })).toThrow();
  });

  it("stores events append-only with strict ordering", async () => {
    const store = new InMemoryEventStore();
    const first = createDomainEvent({
      eventId: "event-1",
      name: "SceneCommitted",
      context: "manuscript",
      novelId: "novel-1",
      objectId: "scene-1",
      revisionId: "scene-rev-2",
      commitId: "commit-1",
      payload: {},
      occurredAt: now,
    });
    const second = createDomainEvent({
      eventId: "event-2",
      name: "CharacterStateChanged",
      context: "narrative_state",
      novelId: "novel-1",
      objectId: "state-1",
      revisionId: "state-rev-2",
      commitId: "commit-1",
      payload: {},
      occurredAt: new Date("2026-10-03T00:00:00.000Z"),
    });

    await store.append(first);
    await store.append(second);
    const events = await store.listByNovel("novel-1");
    expect(events.map((event) => event.eventId)).toEqual(["event-1", "event-2"]);
  });

  it("rejects duplicate event IDs", async () => {
    const store = new InMemoryEventStore();
    const event = createDomainEvent({
      eventId: "event-duplicate",
      name: "SceneCommitted",
      context: "manuscript",
      novelId: "novel-1",
      objectId: "scene-1",
      revisionId: "scene-rev-2",
      payload: {},
      occurredAt: now,
    });
    await store.append(event);
    await expect(store.append({ ...event })).rejects.toThrow("Duplicate event id: event-duplicate");
  });

  it("stores immutable snapshots of mutable raw events", async () => {
    const store = new InMemoryEventStore();
    const raw = {
      eventId: "event-raw",
      name: "SceneCommitted",
      context: "manuscript",
      novelId: "novel-1",
      objectId: "scene-1",
      revisionId: "scene-rev-2",
      payload: { nested: { value: "original" } },
      occurredAt: now,
    } as unknown as DomainEvent & { payload: { nested: { value: string } } };
    await store.append(raw);
    (raw.payload.nested as { value: string }).value = "mutated";
    const [stored] = await store.listByNovel("novel-1");
    expect(Object.isFrozen(stored)).toBe(true);
    expect((stored?.payload as { nested: { value: string } }).nested.value).toBe("original");
  });
});
