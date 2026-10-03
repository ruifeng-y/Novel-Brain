import { afterAll, beforeAll, describe } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaEventStore } from "../../src/shared/infrastructure/prismaRepositories";
import { canonicalJson, hashContent } from "../../src/shared/domain/contentHash";
import { createSceneCommittedEvent } from "../../src/manuscript/domain/manuscriptEvents";
import {
  createValidationCompletedEvent,
  createReviewDecisionRecordedEvent,
} from "../../src/production/domain/aiProductionEvents";
import {
  createObservation,
  createObservationSnapshot,
  type ObservationSnapshot,
  type ObservationSource,
  type SourceReference,
} from "../../src/shared/domain/observationSource";
import {
  domainEventSourceContent,
  domainEventSourceReference,
  runObservationSourceContract,
  type ObservationSourceContractEnvironment,
} from "../support/observationSourceContract";

const novelId = "novel-observation-source-contract";
const sourceIdentity = "prisma-event-store:novel-observation-source-contract";
const now = new Date("2026-10-04T00:00:00.000Z");

class PrismaEventStoreObservationSource implements ObservationSource<unknown> {
  constructor(private readonly eventStore: PrismaEventStore) {}

  async snapshot(): Promise<ObservationSnapshot<unknown>> {
    const events = await this.eventStore.listByNovel(novelId);
    const sourceReference: SourceReference = {
      identity: sourceIdentity,
      version: `events:${events.length}:${events.at(-1)?.revisionId ?? "empty"}`,
      hash: hashContent(canonicalJson(events.map(domainEventSourceContent))),
    };
    return createObservationSnapshot({
      sourceReference,
      observations: events.map((event, index) =>
        createObservation({
          evidenceReference: event.eventId,
          sourceReference: domainEventSourceReference(event),
          ordinal: index + 1,
          data: event,
        }),
      ),
    });
  }
}

const prisma = new PrismaClient();
const eventStore = new PrismaEventStore(prisma);

beforeAll(async () => {
  await prisma.domainEvent.deleteMany({ where: { novelId } });
  await eventStore.appendMany([
    createSceneCommittedEvent({
      eventId: "prisma-observation-event-1",
      novelId,
      objectId: "scene-1",
      revisionId: "scene-rev-1",
      commitId: "commit-1",
      payload: { textLength: 12 },
      occurredAt: now,
    }),
    createValidationCompletedEvent({
      eventId: "prisma-observation-event-2",
      novelId,
      objectId: "validation-run-1",
      revisionId: "validation-rev-1",
      payload: { outcome: "pass" },
      occurredAt: now,
    }),
    createReviewDecisionRecordedEvent({
      eventId: "prisma-observation-event-3",
      novelId,
      objectId: "review-decision-1",
      revisionId: "review-rev-1",
      payload: { decision: "approve" },
      occurredAt: now,
    }),
  ]);
});

afterAll(async () => {
  await prisma.domainEvent.deleteMany({ where: { novelId } });
  await prisma.$disconnect();
});

describe("Task 1.2 Prisma observation source integration", () => {
  runObservationSourceContract<unknown>(
    "Prisma DomainEvent/EventStore",
    async (): Promise<ObservationSourceContractEnvironment<unknown>> => {
      const events = await eventStore.listByNovel(novelId);
      const sourceReference: SourceReference = {
        identity: sourceIdentity,
        version: `events:${events.length}:${events.at(-1)?.revisionId ?? "empty"}`,
        hash: hashContent(canonicalJson(events.map(domainEventSourceContent))),
      };
      return {
        source: new PrismaEventStoreObservationSource(eventStore),
        expectedSourceReference: sourceReference,
        expectedObservations: events.map((event, index) => ({
          evidenceReference: event.eventId,
          sourceReference: domainEventSourceReference(event),
          ordinal: index + 1,
        })),
        captureSourceState: async () =>
          (await eventStore.listByNovel(novelId)).map((event) => ({
            eventId: event.eventId,
            name: event.name,
            context: event.context,
            novelId: event.novelId,
            objectId: event.objectId,
            revisionId: event.revisionId,
            commitId: event.commitId,
            payload: event.payload,
            occurredAt: event.occurredAt,
          })),
        attemptObservedDataMutation: (snapshot) => {
          const payload = (
            snapshot.observations[0]?.data as { payload: { readonly textLength: number } }
          ).payload;
          (payload as { textLength: number }).textLength = -1;
        },
      };
    },
  );
});
