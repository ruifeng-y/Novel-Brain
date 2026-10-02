import { describe, expect, it } from "vitest";
import { InMemoryRepository, InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import {
  createCandidate,
  markCandidateValidated,
  selectCandidate,
  type Candidate,
} from "../../src/production/domain/candidate";
import { createReviewDecision, type ReviewDecision } from "../../src/production/domain/reviewDecision";
import { createValidationRun, type ValidationRun } from "../../src/production/domain/validationRun";
import {
  commitSceneText,
  createScene,
  type Scene,
} from "../../src/manuscript/domain/scene";
import type { CanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../src/narrative/state/domain/stateRecord";
import { commitCandidate } from "../../src/safety/application/commitCandidate";
import type { NarrativeCommit } from "../../src/safety/domain/narrativeCommit";
import { InMemoryEventStore } from "../../src/safety/infrastructure/eventStore";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");

async function setup() {
  const scene = createScene({
    id: "scene-1",
    novelId: "novel-1",
    chapterId: "chapter-1",
    title: "The Northern Gate",
    revisionId: "scene-rev-1",
    commitId: "initial-commit",
    createdAt: now,
  });
  const committedScene = commitSceneText({
    scene,
    text: "Old text",
    revisionId: "scene-rev-2",
    commitId: "initial-commit",
    updatedAt: now,
  });

  const candidate = selectCandidate(
    markCandidateValidated(
      createCandidate({
        id: "candidate-1",
        taskId: "task-1",
        novelId: "novel-1",
        basedOnVersionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
        }),
        change: { type: "text", sceneId: "scene-1", text: "New text" },
        createdAt: now,
      }),
      now,
    ),
    now,
  );
  const validationRuns: ValidationRun[] = [
    createValidationRun({
      id: "validation-1",
      candidateId: candidate.id,
      candidateRevisionId: candidate.currentRevisionId,
      validatorId: "text-validator",
      outcome: "pass",
      findings: [],
      createdAt: now,
    }),
  ];
  const reviewDecision: ReviewDecision = createReviewDecision({
    id: "review-1",
    candidateId: candidate.id,
    candidateRevisionId: candidate.currentRevisionId,
    decision: "approve",
    decidedBy: "human",
    actorId: "author-1",
    reason: "",
    createdAt: now,
  });

  const scenes = new InMemoryRevisionedRepository<Scene>();
  const candidates = new InMemoryRevisionedRepository<Candidate>();
  const commits = new InMemoryRepository<NarrativeCommit>();
  const events = new InMemoryEventStore();
  await scenes.save(committedScene);
  await candidates.save(candidate);

  return {
    scenes,
    candidates,
    commits,
    events,
    candidate,
    validationRuns,
    reviewDecision,
  };
}

describe("commitCandidate", () => {
  it("commits an approved candidate as a coherent canonical transition", async () => {
    const context = await setup();
    const commit = await commitCandidate({
      repositories: {
        scenes: context.scenes,
        candidates: context.candidates,
        canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
        stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
        narrativeCommits: context.commits,
      },
      eventStore: context.events,
      input: {
        commitId: "commit-1",
        candidateId: context.candidate.id,
        validationRuns: context.validationRuns,
        reviewDecision: context.reviewDecision,
        now: new Date("2026-10-03T00:00:00.000Z"),
      },
    });

    const scene = await context.scenes.findById("scene-1");
    const events = await context.events.listByNovel("novel-1");
    expect(commit.status).toBe("committed");
    expect(scene?.text).toBe("New text");
    expect(events.map((event) => event.name)).toEqual(["SceneCommitted"]);
  });

  it("rejects a candidate based on an outdated scene revision", async () => {
    const context = await setup();
    await commitCandidate({
      repositories: {
        scenes: context.scenes,
        candidates: context.candidates,
        canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
        stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
        narrativeCommits: context.commits,
      },
      eventStore: context.events,
      input: {
        commitId: "commit-1",
        candidateId: context.candidate.id,
        validationRuns: context.validationRuns,
        reviewDecision: context.reviewDecision,
        now: new Date("2026-10-03T00:00:00.000Z"),
      },
    });

    const staleCandidate = selectCandidate(
      markCandidateValidated(
        createCandidate({
          id: "candidate-2",
          taskId: "task-1",
          novelId: "novel-1",
          basedOnVersionSet: createVersionSet({
            scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
          }),
          change: { type: "text", sceneId: "scene-1", text: "Stale text" },
          createdAt: now,
        }),
        now,
      ),
      now,
    );
    const staleValidation = createValidationRun({
      id: "validation-2",
      candidateId: staleCandidate.id,
      candidateRevisionId: staleCandidate.currentRevisionId,
      validatorId: "text-validator",
      outcome: "pass",
      findings: [],
      createdAt: now,
    });
    const staleReview = createReviewDecision({
      id: "review-2",
      candidateId: staleCandidate.id,
      candidateRevisionId: staleCandidate.currentRevisionId,
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "",
      createdAt: now,
    });

    await context.candidates.save(staleCandidate);
    await expect(
      commitCandidate({
        repositories: {
          scenes: context.scenes,
          candidates: context.candidates,
          canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
          stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
          narrativeCommits: context.commits,
        },
        eventStore: context.events,
        input: {
          commitId: "commit-2",
          candidateId: staleCandidate.id,
          validationRuns: [staleValidation],
          reviewDecision: staleReview,
          now: new Date("2026-10-04T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("Stale dependency: scene");

    const failedCommit = await context.commits.findById("commit-2");
    expect(failedCommit?.status).toBe("stale");
  });
});
