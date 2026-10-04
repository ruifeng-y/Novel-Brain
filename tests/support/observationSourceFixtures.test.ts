import { describe, expect, it } from "vitest";
import { createSceneCommittedEvent } from "../../src/manuscript/domain/manuscriptEvents";
import { createValidationCompletedEvent } from "../../src/production/domain/aiProductionEvents";
import { InMemoryEventStore } from "../../src/safety/infrastructure/eventStore";
import { canonicalJson, hashContent } from "../../src/shared/domain/contentHash";
import { createObservation, createObservationSnapshot } from "../../src/shared/domain/observationSource";
import {
  createEventStoreObservationSnapshot,
  domainEventSourceContent,
  domainEventSourceReference,
  eventStreamSourceReference,
} from "./observationSourceContract";
import {
  EventStoreObservationSource,
  eventStoreSourceReference,
} from "./observationSourceFixtures";

describe("observation source fixture parity", () => {
  it("reuses the Task 1.2 event stream reference function without drift", () => {
    expect(eventStoreSourceReference).toBe(eventStreamSourceReference);
  });

  it("maps EventStore state through Task 1.2 observation semantics", async () => {
    const eventStore = new InMemoryEventStore();
    const novelId = "novel-fixture-parity";
    const sourceIdentity = "event-store:fixture-parity";
    await eventStore.appendMany([
      createSceneCommittedEvent({
        eventId: "parity-event-1",
        novelId,
        objectId: "scene-1",
        revisionId: "scene-rev-1",
        commitId: "commit-1",
        payload: { textLength: 12 },
        occurredAt: new Date("2026-10-04T00:00:00.000Z"),
      }),
      createValidationCompletedEvent({
        eventId: "parity-event-2",
        novelId,
        objectId: "validation-run-1",
        revisionId: "validation-rev-1",
        payload: { outcome: "pass" },
        occurredAt: new Date("2026-10-04T00:00:00.000Z"),
      }),
    ]);
    const events = await eventStore.listByNovel(novelId);
    const expected = createObservationSnapshot({
      sourceReference: {
        identity: sourceIdentity,
        version: "events:2:validation-rev-1",
        hash: hashContent(canonicalJson(events.map(domainEventSourceContent))),
      },
      observations: events.map((event, index) =>
        createObservation({
          evidenceReference: event.eventId,
          sourceReference: domainEventSourceReference(event),
          ordinal: index + 1,
          data: event,
        }),
      ),
    });

    const fixtureSnapshot = await new EventStoreObservationSource(
      eventStore,
      novelId,
      sourceIdentity,
    ).snapshot();

    expect(fixtureSnapshot).toEqual(expected);
    expect(fixtureSnapshot).toEqual(createEventStoreObservationSnapshot(events, sourceIdentity));
  });
});
