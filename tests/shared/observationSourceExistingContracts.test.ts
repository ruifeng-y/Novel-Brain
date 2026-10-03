import { describe, expect, it } from "vitest";
import { commitSceneText, createScene } from "../../src/manuscript/domain/scene";
import { rebuildMemoryProjection } from "../../src/memory/projections/memoryProjection";
import {
  createValidationRun,
  type ValidationEvidence,
} from "../../src/production/domain/validationRun";
import {
  createReviewDecision,
  type ReviewDecision,
} from "../../src/production/domain/reviewDecision";
import {
  createNarrativeCommit,
  markNarrativeCommitCommitted,
  type NarrativeCommit,
} from "../../src/safety/domain/narrativeCommit";
import { createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import { createSceneCommittedEvent } from "../../src/manuscript/domain/manuscriptEvents";
import {
  createValidationCompletedEvent,
  createReviewDecisionRecordedEvent,
} from "../../src/production/domain/aiProductionEvents";
import { InMemoryEventStore, type EventStore } from "../../src/safety/infrastructure/eventStore";
import { canonicalJson, hashContent } from "../../src/shared/domain/contentHash";
import {
  createObservation,
  createObservationSnapshot,
  type Observation,
  type ObservationSnapshot,
  type ObservationSource,
  type SourceReference,
} from "../../src/shared/domain/observationSource";
import {
  domainEventSourceContent,
  domainEventSourceReference,
  runObservationSourceContract,
  type ExpectedObservationReference,
  type ObservationSourceContractEnvironment,
} from "../support/observationSourceContract";

const now = new Date("2026-10-04T00:00:00.000Z");

class EventStoreObservationSource implements ObservationSource<unknown> {
  constructor(
    private readonly eventStore: EventStore,
    private readonly novelId: string,
    private readonly sourceIdentity: string,
  ) {}

  async snapshot(): Promise<ObservationSnapshot<unknown>> {
    const events = await this.eventStore.listByNovel(this.novelId);
    const sourceContent = events.map(domainEventSourceContent);
    const sourceReference: SourceReference = {
      identity: this.sourceIdentity,
      version: `events:${events.length}:${events.at(-1)?.revisionId ?? "empty"}`,
      hash: hashContent(canonicalJson(sourceContent)),
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

class ExistingEvidenceObservationSource implements ObservationSource<unknown> {
  constructor(
    private readonly observations: readonly Observation<unknown>[],
    private readonly sourceReference: SourceReference,
  ) {}

  async snapshot(): Promise<ObservationSnapshot<unknown>> {
    return createObservationSnapshot({
      sourceReference: this.sourceReference,
      observations: this.observations,
    });
  }
}

describe("Task 1.2 observation source contracts", () => {
  runObservationSourceContract<unknown>("DomainEvent/EventStore", async () => {
    const eventStore = new InMemoryEventStore();
    await eventStore.appendMany([
      createSceneCommittedEvent({
        eventId: "event-1",
        novelId: "novel-evidence",
        objectId: "scene-1",
        revisionId: "scene-rev-1",
        commitId: "commit-1",
        payload: { textLength: 12 },
        occurredAt: now,
      }),
      createValidationCompletedEvent({
        eventId: "event-2",
        novelId: "novel-evidence",
        objectId: "validation-run-1",
        revisionId: "validation-rev-1",
        payload: { outcome: "pass" },
        occurredAt: now,
      }),
      createReviewDecisionRecordedEvent({
        eventId: "event-3",
        novelId: "novel-evidence",
        objectId: "review-decision-1",
        revisionId: "review-rev-1",
        payload: { decision: "approve" },
        occurredAt: now,
      }),
    ]);

    const savedEvents = await eventStore.listByNovel("novel-evidence");
    const sourceReference: SourceReference = {
      identity: "event-store:novel-evidence",
      version: `events:${savedEvents.length}:${savedEvents.at(-1)?.revisionId ?? "empty"}`,
      hash: hashContent(canonicalJson(savedEvents.map(domainEventSourceContent))),
    };
    return {
      source: new EventStoreObservationSource(eventStore, "novel-evidence", sourceReference.identity),
      expectedSourceReference: sourceReference,
      expectedObservations: savedEvents.map((event, index) => ({
        evidenceReference: event.eventId,
        sourceReference: domainEventSourceReference(event),
        ordinal: index + 1,
      })),
      captureSourceState: async () =>
        (await eventStore.listByNovel("novel-evidence")).map((event) => ({
          eventId: event.eventId,
          objectId: event.objectId,
          revisionId: event.revisionId,
          payload: event.payload,
        })),
      attemptObservedDataMutation: (snapshot) => {
        const payload = (snapshot.observations[0]?.data as { payload: { readonly textLength: number } })
          .payload;
        (payload as { textLength: number }).textLength = -1;
      },
    } satisfies ObservationSourceContractEnvironment<unknown>;
  });

  runObservationSourceContract<unknown>("existing evidence and version sources", async () => {
    const scene = commitSceneText({
      scene: createScene({
        id: "scene-1",
        novelId: "novel-1",
        chapterId: "chapter-1",
        title: "Opening",
        revisionId: "scene-rev-1",
        commitId: "commit-0",
        createdAt: now,
      }),
      text: "Stable text",
      revisionId: "scene-rev-2",
      commitId: "commit-1",
      updatedAt: now,
    });
    const memoryProjection = rebuildMemoryProjection([], [scene]);

    const validationEvidence: ValidationEvidence = {
      id: "validation-evidence-1",
      type: "revision-comparison",
      sourceReference: {
        identity: "scene-1",
        version: "scene-rev-2",
        hash: hashContent(scene.text),
      },
      observation: "Scene text matches the referenced revision.",
    };
    const validationRun = createValidationRun({
      id: "validation-1",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "cs-1-r1-plan-1",
      validatorId: "target-span-validator",
      entryResults: [
        {
          entryReference: "rule:target-span-preserved",
          executionMode: "full_reexecution",
          verdict: "pass",
          findings: [],
          evidence: [validationEvidence],
        },
      ],
      executionState: "completed",
      outcome: "pass",
      createdAt: now,
    });
    const reviewDecision: ReviewDecision = createReviewDecision({
      id: "review-decision-1",
      changeSetRevisionId: "cs-1-r1",
      approvalScope: {
        requirementDomain: "manuscript",
        targetType: "manuscript",
        objectId: "scene-1",
      },
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "",
      evidenceReferences: [validationEvidence.id],
      createdAt: now,
    });
    const changeSetRevision = createInitialChangeSetRevision({
      revisionId: "cs-1-r1",
      changeSetId: "cs-1",
      novelId: "novel-1",
      createdAt: now,
    });
    const narrativeCommit: NarrativeCommit = markNarrativeCommitCommitted({
      commit: createNarrativeCommit({
        id: "commit-1",
        novelId: "novel-1",
        changeSetRevision,
        validationRuns: [validationRun],
        reviewDecisions: [reviewDecision],
        basedOnVersionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
        }),
        createdAt: now,
      }),
      resultingVersionSet: createVersionSet({
        scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
      }),
      committedAt: now,
    });
    const versionSet = narrativeCommit.resultingVersionSet ?? {};

    const sourceContent = {
      memoryProjection,
      validationEvidence,
      reviewEvidenceReferences: reviewDecision.evidenceReferences,
      validationRunIds: narrativeCommit.validationRunIds,
      reviewDecisionIds: narrativeCommit.reviewDecisionIds,
      basedOnVersionSet: narrativeCommit.basedOnVersionSet,
      resultingVersionSet: narrativeCommit.resultingVersionSet,
    };
    const sourceReference: SourceReference = {
      identity: "existing-evidence-sources",
      version: "evidence-version-1",
      hash: hashContent(canonicalJson(sourceContent)),
    };
    const memorySourceReference: SourceReference = {
      identity: "memory-projection-1",
      version: "memory-rev-1",
      hash: hashContent(canonicalJson(memoryProjection)),
    };
    const reviewSourceContent = {
      id: reviewDecision.id,
      changeSetRevisionId: reviewDecision.changeSetRevisionId,
      approvalScope: reviewDecision.approvalScope,
      decision: reviewDecision.decision,
      decidedBy: reviewDecision.decidedBy,
      actorId: reviewDecision.actorId,
      reason: reviewDecision.reason ?? null,
      policyVersion: reviewDecision.policyVersion ?? null,
      decisionRule: reviewDecision.decisionRule ?? null,
      evidenceReferences: reviewDecision.evidenceReferences,
      createdAt: reviewDecision.createdAt,
    };
    const reviewSourceReference: SourceReference = {
      identity: reviewDecision.id,
      version: "review-rev-1",
      hash: hashContent(canonicalJson(reviewSourceContent)),
    };
    const commitSourceContent = {
      id: narrativeCommit.id,
      novelId: narrativeCommit.novelId,
      changeSetRevisionId: narrativeCommit.changeSetRevisionId,
      validationRunIds: narrativeCommit.validationRunIds,
      reviewDecisionIds: narrativeCommit.reviewDecisionIds,
      basedOnVersionSet: narrativeCommit.basedOnVersionSet,
      resultingVersionSet: narrativeCommit.resultingVersionSet ?? null,
      status: narrativeCommit.status,
      failureReason: narrativeCommit.failureReason ?? null,
      createdAt: narrativeCommit.createdAt,
      updatedAt: narrativeCommit.updatedAt,
    };
    const commitSourceReference: SourceReference = {
      identity: narrativeCommit.id,
      version: "commit-rev-1",
      hash: hashContent(canonicalJson(commitSourceContent)),
    };
    const versionSetSourceReference: SourceReference = {
      identity: "scene-1",
      version: "scene-rev-2",
      hash: hashContent(canonicalJson(versionSet)),
    };
    const observations = [
      createObservation({
        evidenceReference: "memory-projection-1",
        sourceReference: memorySourceReference,
        ordinal: 1,
        data: memoryProjection,
      }),
      createObservation({
        evidenceReference: validationEvidence.id,
        sourceReference: validationEvidence.sourceReference,
        ordinal: 2,
        data: validationEvidence,
      }),
      createObservation({
        evidenceReference: reviewDecision.id,
        sourceReference: reviewSourceReference,
        ordinal: 3,
        data: reviewDecision,
      }),
      createObservation({
        evidenceReference: narrativeCommit.id,
        sourceReference: commitSourceReference,
        ordinal: 4,
        data: narrativeCommit,
      }),
      createObservation({
        evidenceReference: "version-set-1",
        sourceReference: versionSetSourceReference,
        ordinal: 5,
        data: versionSet,
      }),
    ];
    const expectedObservations: readonly ExpectedObservationReference[] = observations.map(
      (observation) => ({
        evidenceReference: observation.evidenceReference,
        sourceReference: observation.sourceReference,
        ordinal: observation.ordinal,
      }),
    );

    return {
      source: new ExistingEvidenceObservationSource(observations, sourceReference),
      expectedSourceReference: sourceReference,
      expectedObservations,
      captureSourceState: async () => ({
        sourceContent,
        validationRunIds: narrativeCommit.validationRunIds,
        reviewDecisionIds: narrativeCommit.reviewDecisionIds,
        reviewEvidenceReferences: reviewDecision.evidenceReferences,
        basedOnVersionSet: narrativeCommit.basedOnVersionSet,
        resultingVersionSet: narrativeCommit.resultingVersionSet,
      }),
      attemptObservedDataMutation: (snapshot) => {
        (snapshot.observations[0]?.data as { novelId: string }).novelId = "changed";
      },
    } satisfies ObservationSourceContractEnvironment<unknown>;
  });
});
