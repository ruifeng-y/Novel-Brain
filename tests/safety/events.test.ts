import { describe, expect, it } from "vitest";
import { createDomainEvent } from "../../src/safety/domain/domainEvent";
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
});
