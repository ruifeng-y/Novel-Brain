import { describe, expect, it } from "vitest";
import { createCommitProvenanceQuery } from "../../src/app/commitProvenanceQuery";
import {
  createInMemoryReviewDecisionStore,
  createReviewDecisionService,
} from "../../src/app/reviewDecisionService";
import {
  createInMemoryValidationRunStore,
  storedValidationRun,
} from "../../src/app/validationRunService";
import { createInMemoryChangeSetPersistence } from "../../src/production/application/changeSetPersistence";
import { createChangeSetRevisionService } from "../../src/app/changeSetRevisionService";
import { InMemoryRepository, InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import { InMemoryEventStore } from "../../src/safety/infrastructure/eventStore";
import { createDomainEvent } from "../../src/safety/domain/domainEvent";
import {
  createNarrativeCommit,
  markNarrativeCommitCommitted,
  type NarrativeCommit,
} from "../../src/safety/domain/narrativeCommit";
import { createCandidate, type Candidate } from "../../src/production/domain/candidate";
import { createValidationRun } from "../../src/production/domain/validationRun";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const AT = new Date("2026-10-06T00:00:00.000Z");
const NOVEL = "novel-1";
const CHANGE_SET = "cs-1";
const REVISION = "cs-1:r1";

function candidateFixture(id = "candidate-1", novelId = NOVEL): Candidate {
  return createCandidate({
    id,
    taskId: `task-${id}`,
    novelId,
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-1:rev-1"),
    }),
    change: { type: "text", sceneId: "scene-1", text: "新文本。" },
    createdAt: AT,
  });
}

async function harness() {
  const persistence = createInMemoryChangeSetPersistence();
  const changeSetRevisions = createChangeSetRevisionService({
    changeSets: persistence.changeSets,
  });
  const candidates = new InMemoryRevisionedRepository<Candidate>();
  await candidates.save(candidateFixture());
  const revision = await changeSetRevisions.adoptCandidate({
    candidate: candidateFixture(),
    changeSetId: CHANGE_SET,
    revisionId: REVISION,
    createdAt: AT,
  });

  const validations = createInMemoryValidationRunStore();
  const reviews = createInMemoryReviewDecisionStore();
  const decisions = createReviewDecisionService({
    reviews,
    changeSets: persistence.changeSets,
  });
  const run = createValidationRun({
    id: "run-1",
    changeSetRevisionId: REVISION,
    planVersionId: "plan-v1",
    validatorId: "validator-1",
    entryResults: [],
    executionState: "completed",
    outcome: "pass",
    createdAt: AT,
  });
  await validations.saveIfAbsent(storedValidationRun(run, CHANGE_SET));
  const decision = await decisions.recordReview({
    reviewDecisionId: "review-1",
    changeSetId: CHANGE_SET,
    revisionId: REVISION,
    approvalScope: {
      requirementDomain: "manuscript",
      targetType: "manuscript",
      objectId: "scene-1",
    },
    decision: "approve",
    decidedBy: "human",
    actorId: "author-1",
    reason: "可以提交。",
    evidenceReferences: ["run-1"],
    createdAt: AT,
  });

  const commits = new InMemoryRepository<NarrativeCommit>();
  const eventStore = new InMemoryEventStore();
  const commit = markNarrativeCommitCommitted({
    commit: createNarrativeCommit({
      id: "commit-1",
      novelId: NOVEL,
      changeSetRevision: revision,
      validationRuns: [run],
      reviewDecisions: [decision],
      createdAt: AT,
    }),
    resultingVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-1:rev-9"),
    }),
    committedAt: AT,
  });
  await commits.save(commit);
  await eventStore.append(
    createDomainEvent({
      eventId: "event-commit",
      name: "NarrativeCommitRecorded",
      context: "platform",
      novelId: NOVEL,
      objectId: commit.id,
      revisionId: REVISION,
      commitId: commit.id,
      payload: { commitId: commit.id },
      occurredAt: AT,
    }),
  );
  await eventStore.append(
    createDomainEvent({
      eventId: "event-other",
      name: "SceneCommitted",
      context: "manuscript",
      novelId: NOVEL,
      objectId: "scene-1",
      revisionId: "scene-1:rev-9",
      payload: {},
      occurredAt: AT,
    }),
  );

  const query = createCommitProvenanceQuery({
    commits,
    validations,
    reviews,
    eventStore,
  });
  return { query, commits, validations, reviews, commit, revision, decision, run };
}

describe("[task:W3] [domain] commit provenance query", () => {
  it("reads the commit, its revision reference, its artefacts and its audit events", async () => {
    const { query } = await harness();

    const provenance = await query.get({ novelId: NOVEL, commitId: "commit-1" });

    expect(provenance?.commit.id).toBe("commit-1");
    expect(provenance?.commit.status).toBe("committed");
    expect(provenance?.changeSetRevisionId).toBe(REVISION);
    expect(provenance?.validationRuns.map(run => run.id)).toEqual(["run-1"]);
    expect(provenance?.reviewDecisions.map(decision => decision.id)).toEqual(["review-1"]);
    // Only the events this commit produced, not the whole novel's history.
    expect(provenance?.auditEvents.map(event => event.eventId)).toEqual(["event-commit"]);
  });

  it("does not answer for an unknown commit or another novel's commit", async () => {
    const { query } = await harness();

    expect(await query.get({ novelId: NOVEL, commitId: "commit-missing" })).toBeUndefined();
    expect(await query.get({ novelId: "novel-other", commitId: "commit-1" })).toBeUndefined();
  });

  it("reports the referenced artefacts it can resolve and never invents one", async () => {
    const { commits, validations, reviews, revision, decision, run } = await harness();
    // A commit whose referenced run is no longer stored.
    const commit = markNarrativeCommitCommitted({
      commit: createNarrativeCommit({
        id: "commit-2",
        novelId: NOVEL,
        changeSetRevision: revision,
        validationRuns: [run],
        reviewDecisions: [decision],
        createdAt: AT,
      }),
      resultingVersionSet: createVersionSet({
        scene: createVersionReference("Scene", "scene-1", "scene-1:rev-9"),
      }),
      committedAt: AT,
    });
    await commits.save(commit);
    const queryWithoutArtefacts = createCommitProvenanceQuery({
      commits,
      // Neither store holds anything: provenance reports what it can resolve.
      validations: createInMemoryValidationRunStore(),
      reviews: createInMemoryReviewDecisionStore(),
      eventStore: new InMemoryEventStore(),
    });

    const provenance = await queryWithoutArtefacts.get({ novelId: NOVEL, commitId: "commit-2" });

    expect(provenance?.commit.id).toBe("commit-2");
    expect(provenance?.validationRuns).toHaveLength(0);
    expect(provenance?.reviewDecisions).toHaveLength(0);
  });
});
