import { afterAll, beforeAll, describe } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaEventStore } from "../../src/shared/infrastructure/prismaRepositories";
import { createSceneCommittedEvent } from "../../src/manuscript/domain/manuscriptEvents";
import {
  createValidationCompletedEvent,
  createReviewDecisionRecordedEvent,
} from "../../src/production/domain/aiProductionEvents";
import {
  createEventStoreObservationEnvironment,
  runObservationSourceContract,
  type ObservationSourceContractEnvironment,
} from "../support/observationSourceContract";

const novelId = "novel-observation-source-contract";
const sourceIdentity = "prisma-event-store:novel-observation-source-contract";
const now = new Date("2026-10-04T00:00:00.000Z");

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
    async (): Promise<ObservationSourceContractEnvironment<unknown>> =>
      createEventStoreObservationEnvironment({
        eventStore,
        novelId,
        sourceIdentity,
      }),
  );
});
