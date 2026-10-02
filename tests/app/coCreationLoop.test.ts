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
import { createCanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../src/narrative/state/domain/stateRecord";
import { createStateRecord } from "../../src/narrative/state/domain/stateRecord";
import { commitCandidate } from "../../src/safety/application/commitCandidate";
import type { NarrativeCommit } from "../../src/safety/domain/narrativeCommit";
import { InMemoryEventStore, type EventStore } from "../../src/safety/infrastructure/eventStore";
import {
  createVersionReference,
  createVersionSet,
  type VersionSet,
} from "../../src/shared/domain/versioning";
import { hashContent } from "../../src/shared/domain/contentHash";
import type { CandidateChange } from "../../src/production/domain/candidate";

const now = new Date("2026-10-02T00:00:00.000Z");

function approvedCandidate(
  id: string,
  change: CandidateChange,
  basedOnVersionSet: VersionSet,
) {
  const candidate = selectCandidate(
    markCandidateValidated(
      createCandidate({
        id,
        taskId: "task-1",
        novelId: "novel-1",
        basedOnVersionSet,
        change,
        createdAt: now,
      }),
      now,
    ),
    now,
  );
  return {
    candidate,
    validationRuns: [
      createValidationRun({
        id: `${id}-validation`,
        candidateId: candidate.id,
        candidateRevisionId: candidate.currentRevisionId,
        validatorId: "test-validator",
        outcome: "pass",
        findings: [],
        createdAt: now,
      }),
    ],
    reviewDecision: createReviewDecision({
      id: `${id}-review`,
      candidateId: candidate.id,
      candidateRevisionId: candidate.currentRevisionId,
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "",
      createdAt: now,
    }),
  };
}

class FailingSceneRepository extends InMemoryRevisionedRepository<Scene> {
  failWrites = false;

  override async save(scene: Scene): Promise<void> {
    if (this.failWrites) throw new Error("scene write failed");
    await super.save(scene);
  }
}

class FailingEventStore implements EventStore {
  async append(_event: Parameters<EventStore["append"]>[0]): Promise<void> {
    throw new Error("event write failed");
  }

  async listByNovel(_novelId: string): Promise<readonly never[]> {
    return [];
  }
}

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

  it("commits a canonical fact change", async () => {
    const fact = createCanonicalFact({
      id: "fact-1",
      novelId: "novel-1",
      type: "world_rule",
      content: { rule: "Old rule" },
      revisionId: "fact-rev-1",
      commitId: "initial-commit",
      createdAt: now,
    });
    const canonicalFacts = new InMemoryRevisionedRepository<CanonicalFact>();
    await canonicalFacts.save(fact);
    const evidence = approvedCandidate(
      "candidate-canonical",
      { type: "canonical_fact", canonicalFactId: fact.id, content: { rule: "New rule" } },
      createVersionSet({
        canonicalFact: createVersionReference("CanonicalFact", fact.id, fact.currentRevisionId),
      }),
    );
    const scenes = new InMemoryRevisionedRepository<Scene>();
    const candidates = new InMemoryRevisionedRepository<Candidate>();
    const commits = new InMemoryRepository<NarrativeCommit>();
    const events = new InMemoryEventStore();
    await candidates.save(evidence.candidate);

    const commit = await commitCandidate({
      repositories: {
        scenes,
        candidates,
        canonicalFacts,
        stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
        narrativeCommits: commits,
      },
      eventStore: events,
      input: {
        commitId: "commit-canonical",
        candidateId: evidence.candidate.id,
        validationRuns: evidence.validationRuns,
        reviewDecision: evidence.reviewDecision,
        now: new Date("2026-10-03T00:00:00.000Z"),
      },
    });

    expect(commit.status).toBe("committed");
    expect((await canonicalFacts.findById(fact.id))?.content).toEqual({ rule: "New rule" });
    expect((await events.listByNovel("novel-1")).map(event => event.name)).toEqual([
      "CanonicalFactChanged",
    ]);
  });

  it("commits a position-aware state record change", async () => {
    const record = createStateRecord({
      id: "state-1",
      novelId: "novel-1",
      type: "character_state",
      subjectId: "fact-1",
      position: { sceneId: "scene-1", ordinal: 1 },
      content: { condition: "healthy" },
      revisionId: "state-rev-1",
      commitId: "initial-commit",
      createdAt: now,
    });
    const stateRecords = new InMemoryRevisionedRepository<StateRecord>();
    await stateRecords.save(record);
    const evidence = approvedCandidate(
      "candidate-state",
      {
        type: "structured_state",
        stateRecordId: record.id,
        content: { condition: "injured" },
      },
      createVersionSet({
        stateRecord: createVersionReference("StateRecord", record.id, record.currentRevisionId),
      }),
    );
    const candidates = new InMemoryRevisionedRepository<Candidate>();
    const commits = new InMemoryRepository<NarrativeCommit>();
    const events = new InMemoryEventStore();
    await candidates.save(evidence.candidate);

    await commitCandidate({
      repositories: {
        scenes: new InMemoryRevisionedRepository<Scene>(),
        candidates,
        canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
        stateRecords,
        narrativeCommits: commits,
      },
      eventStore: events,
      input: {
        commitId: "commit-state",
        candidateId: evidence.candidate.id,
        validationRuns: evidence.validationRuns,
        reviewDecision: evidence.reviewDecision,
        now: new Date("2026-10-03T00:00:00.000Z"),
      },
    });

    expect((await stateRecords.findById(record.id))?.content).toEqual({ condition: "injured" });
    expect((await events.listByNovel("novel-1")).map(event => event.name)).toEqual([
      "CharacterStateChanged",
    ]);
  });

  it("commits local text and rebinds the target anchor", async () => {
    const initial = createScene({
      id: "scene-local",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "Local Text",
      revisionId: "scene-rev-1",
      commitId: "initial-commit",
      createdAt: now,
    });
    const scene = commitSceneText({
      scene: initial,
      text: "First paragraph. Second paragraph. Third paragraph.",
      spanAnchors: { "span-2": "Second paragraph." },
      revisionId: "scene-rev-2",
      commitId: "initial-commit",
      updatedAt: now,
    });
    const scenes = new InMemoryRevisionedRepository<Scene>();
    await scenes.save(scene);
    const evidence = approvedCandidate(
      "candidate-local",
      {
        type: "local_text",
        sceneId: scene.id,
        targetSpan: {
          anchorId: "span-2",
          text: "Second paragraph.",
          sourceContentHash: hashContent("Second paragraph."),
        },
        replacement: "Changed paragraph.",
      },
      createVersionSet({
        scene: createVersionReference("Scene", scene.id, scene.currentRevisionId),
      }),
    );
    const candidates = new InMemoryRevisionedRepository<Candidate>();
    const commits = new InMemoryRepository<NarrativeCommit>();
    const events = new InMemoryEventStore();
    await candidates.save(evidence.candidate);

    await commitCandidate({
      repositories: {
        scenes,
        candidates,
        canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
        stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
        narrativeCommits: commits,
      },
      eventStore: events,
      input: {
        commitId: "commit-local",
        candidateId: evidence.candidate.id,
        validationRuns: evidence.validationRuns,
        reviewDecision: evidence.reviewDecision,
        now: new Date("2026-10-03T00:00:00.000Z"),
      },
    });

    const committed = await scenes.findById(scene.id);
    expect(committed?.text).toBe("First paragraph. Changed paragraph. Third paragraph.");
    expect(committed?.spanAnchors).toEqual({ "span-2": "Changed paragraph." });
  });

  it("commits composite text, state, and canonical changes in one transition", async () => {
    const initial = createScene({
      id: "scene-composite",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "Composite",
      revisionId: "scene-rev-1",
      commitId: "initial-commit",
      createdAt: now,
    });
    const scene = commitSceneText({
      scene: initial,
      text: "Old scene",
      revisionId: "scene-rev-2",
      commitId: "initial-commit",
      updatedAt: now,
    });
    const fact = createCanonicalFact({
      id: "fact-composite",
      novelId: "novel-1",
      type: "character_profile",
      content: { name: "Old name" },
      revisionId: "fact-rev-1",
      commitId: "initial-commit",
      createdAt: now,
    });
    const record = createStateRecord({
      id: "state-composite",
      novelId: "novel-1",
      type: "character_state",
      subjectId: fact.id,
      position: { sceneId: scene.id, ordinal: 1 },
      content: { condition: "healthy" },
      revisionId: "state-rev-1",
      commitId: "initial-commit",
      createdAt: now,
    });

    const scenes = new InMemoryRevisionedRepository<Scene>();
    const canonicalFacts = new InMemoryRevisionedRepository<CanonicalFact>();
    const stateRecords = new InMemoryRevisionedRepository<StateRecord>();
    const candidates = new InMemoryRevisionedRepository<Candidate>();
    const commits = new InMemoryRepository<NarrativeCommit>();
    const events = new InMemoryEventStore();
    await scenes.save(scene);
    await canonicalFacts.save(fact);
    await stateRecords.save(record);

    const evidence = approvedCandidate(
      "candidate-composite",
      {
        type: "composite",
        changes: [
          { type: "text", sceneId: scene.id, text: "New scene" },
          {
            type: "canonical_fact",
            canonicalFactId: fact.id,
            content: { name: "New name" },
          },
          {
            type: "structured_state",
            stateRecordId: record.id,
            content: { condition: "injured" },
          },
        ],
      },
      createVersionSet({
        scene: createVersionReference("Scene", scene.id, scene.currentRevisionId),
        canonicalFact: createVersionReference("CanonicalFact", fact.id, fact.currentRevisionId),
        stateRecord: createVersionReference("StateRecord", record.id, record.currentRevisionId),
      }),
    );
    await candidates.save(evidence.candidate);

    const commit = await commitCandidate({
      repositories: {
        scenes,
        candidates,
        canonicalFacts,
        stateRecords,
        narrativeCommits: commits,
      },
      eventStore: events,
      input: {
        commitId: "commit-composite",
        candidateId: evidence.candidate.id,
        validationRuns: evidence.validationRuns,
        reviewDecision: evidence.reviewDecision,
        now: new Date("2026-10-03T00:00:00.000Z"),
      },
    });

    expect(commit.status).toBe("committed");
    expect(Object.keys(commit.resultingVersionSet ?? {})).toHaveLength(3);
    expect((await scenes.findById(scene.id))?.text).toBe("New scene");
    expect((await canonicalFacts.findById(fact.id))?.content).toEqual({ name: "New name" });
    expect((await stateRecords.findById(record.id))?.content).toEqual({ condition: "injured" });
    expect((await events.listByNovel("novel-1")).map(event => event.name)).toEqual([
      "SceneCommitted",
      "CanonicalFactChanged",
      "CharacterStateChanged",
    ]);
  });

  it("records a failed commit when a version dependency object is missing", async () => {
    const evidence = approvedCandidate(
      "candidate-missing-dependency",
      { type: "text", sceneId: "scene-1", text: "New text" },
      createVersionSet({
        scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
      }),
    );
    const candidates = new InMemoryRevisionedRepository<Candidate>();
    const commits = new InMemoryRepository<NarrativeCommit>();
    await candidates.save(evidence.candidate);

    await expect(
      commitCandidate({
        repositories: {
          scenes: new InMemoryRevisionedRepository<Scene>(),
          candidates,
          canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
          stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
          narrativeCommits: commits,
        },
        eventStore: new InMemoryEventStore(),
        input: {
          commitId: "commit-missing",
          candidateId: evidence.candidate.id,
          validationRuns: evidence.validationRuns,
          reviewDecision: evidence.reviewDecision,
          now: new Date("2026-10-03T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("Missing version dependency object: scene");

    expect((await commits.findById("commit-missing"))?.status).toBe("failed");
  });

  it("records a failed commit when a repository write fails", async () => {
    const initial = createScene({
      id: "scene-repo-failure",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "Repository Failure",
      revisionId: "scene-rev-1",
      commitId: "initial-commit",
      createdAt: now,
    });
    const scene = commitSceneText({
      scene: initial,
      text: "Old text",
      revisionId: "scene-rev-2",
      commitId: "initial-commit",
      updatedAt: now,
    });
    const scenes = new FailingSceneRepository();
    await scenes.save(scene);
    const evidence = approvedCandidate(
      "candidate-repo-failure",
      { type: "text", sceneId: scene.id, text: "New text" },
      createVersionSet({
        scene: createVersionReference("Scene", scene.id, scene.currentRevisionId),
      }),
    );
    const candidates = new InMemoryRevisionedRepository<Candidate>();
    const commits = new InMemoryRepository<NarrativeCommit>();
    await candidates.save(evidence.candidate);
    scenes.failWrites = true;

    await expect(
      commitCandidate({
        repositories: {
          scenes,
          candidates,
          canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
          stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
          narrativeCommits: commits,
        },
        eventStore: new InMemoryEventStore(),
        input: {
          commitId: "commit-repo-failure",
          candidateId: evidence.candidate.id,
          validationRuns: evidence.validationRuns,
          reviewDecision: evidence.reviewDecision,
          now: new Date("2026-10-03T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("scene write failed");

    const failedCommit = await commits.findById("commit-repo-failure");
    expect(failedCommit?.status).toBe("failed");
    expect(failedCommit?.failureReason).toBe("scene write failed");
  });

  it("restores canonical state and records failure when event persistence fails", async () => {
    const initial = createScene({
      id: "scene-event-failure",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "Event Failure",
      revisionId: "scene-rev-1",
      commitId: "initial-commit",
      createdAt: now,
    });
    const scene = commitSceneText({
      scene: initial,
      text: "Old text",
      revisionId: "scene-rev-2",
      commitId: "initial-commit",
      updatedAt: now,
    });
    const scenes = new InMemoryRevisionedRepository<Scene>();
    await scenes.save(scene);
    const evidence = approvedCandidate(
      "candidate-event-failure",
      { type: "text", sceneId: scene.id, text: "New text" },
      createVersionSet({
        scene: createVersionReference("Scene", scene.id, scene.currentRevisionId),
      }),
    );
    const candidates = new InMemoryRevisionedRepository<Candidate>();
    const commits = new InMemoryRepository<NarrativeCommit>();
    await candidates.save(evidence.candidate);

    await expect(
      commitCandidate({
        repositories: {
          scenes,
          candidates,
          canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
          stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
          narrativeCommits: commits,
        },
        eventStore: new FailingEventStore(),
        input: {
          commitId: "commit-event-failure",
          candidateId: evidence.candidate.id,
          validationRuns: evidence.validationRuns,
          reviewDecision: evidence.reviewDecision,
          now: new Date("2026-10-03T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("event write failed");

    const failedCommit = await commits.findById("commit-event-failure");
    expect(failedCommit?.status).toBe("failed");
    expect(failedCommit?.failureReason).toBe("event write failed");
    expect((await scenes.findById(scene.id))?.text).toBe("Old text");
  });

  it("rejects unsupported version dependencies as unsupported rather than stale", async () => {
    const evidence = approvedCandidate(
      "candidate-unsupported",
      { type: "text", sceneId: "scene-1", text: "New text" },
      createVersionSet({
        novel: createVersionReference("Novel", "novel-1", "novel-rev-1"),
      }),
    );
    const candidates = new InMemoryRevisionedRepository<Candidate>();
    const commits = new InMemoryRepository<NarrativeCommit>();
    await candidates.save(evidence.candidate);

    await expect(
      commitCandidate({
        repositories: {
          scenes: new InMemoryRevisionedRepository<Scene>(),
          candidates,
          canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
          stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
          narrativeCommits: commits,
        },
        eventStore: new InMemoryEventStore(),
        input: {
          commitId: "commit-unsupported",
          candidateId: evidence.candidate.id,
          validationRuns: evidence.validationRuns,
          reviewDecision: evidence.reviewDecision,
          now: new Date("2026-10-03T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("Unsupported version dependency type: Novel");

    expect((await commits.findById("commit-unsupported"))?.status).toBe("failed");
  });
});
