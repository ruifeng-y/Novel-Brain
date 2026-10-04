import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import {
  commitChangeSetRevision,
  type CommitChangeSetRevisionInput,
  type CommitChangeSetRevisionTransaction,
  type CommitChangeSetRevisionTransactionWork,
} from "../../src/safety/application/commitChangeSetRevision";
import {
  createCandidate,
  markCandidateValidated,
  selectCandidate,
  type Candidate,
} from "../../src/production/domain/candidate";
import { createChange, type Change } from "../../src/production/domain/change";
import {
  createChangeSet,
  replaceChangeSetChanges,
  type ChangeSet,
} from "../../src/production/domain/changeSet";
import {
  createChangeSetRevision,
  createInitialChangeSetRevision,
  type ChangeSetRevision,
} from "../../src/production/domain/changeSetRevision";
import { createValidationRun } from "../../src/production/domain/validationRun";
import {
  createReviewDecision,
  type ApprovalScope,
} from "../../src/production/domain/reviewDecision";
import { commitSceneText, createScene, type Scene } from "../../src/manuscript/domain/scene";
import {
  createVersionReference,
  createVersionSet,
} from "../../src/shared/domain/versioning";
import { canonicalJson, hashContent } from "../../src/shared/domain/contentHash";

const now = new Date("2026-10-04T12:00:00.000Z");
const failureMessage = "injected task-4.3-4.4 commit failure";

type FailurePoint = "transaction" | "event" | "domain";

function baseScene(): Scene {
  return commitSceneText({
    scene: createScene({
      id: "scene-1",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "Recovery Scene",
      revisionId: "scene-rev-1",
      commitId: "initial",
      createdAt: now,
    }),
    text: "Alpha middle Omega.",
    revisionId: "scene-rev-2",
    commitId: "initial",
    updatedAt: now,
  });
}

function candidateFor(scene: Scene): Candidate {
  const candidate = createCandidate({
    id: "candidate-task-4344",
    taskId: "task-4344",
    novelId: "novel-1",
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", scene.id, scene.currentRevisionId),
    }),
    change: { type: "text", sceneId: scene.id, text: "Recovered text" },
    createdAt: now,
  });
  return selectCandidate(markCandidateValidated(candidate, now), now);
}

function changeFromCandidate(candidate: Candidate, scene: Scene): Change {
  return createChange({
    id: "change-task-4344",
    sourceType: "candidate",
    sourceReference: {
      identity: candidate.id,
      version: candidate.currentRevisionId,
      hash: hashContent(canonicalJson(candidate.change)),
    },
    targetAddress: { targetType: "manuscript", objectId: scene.id },
    payload: { text: "Recovered text" },
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", scene.id, scene.currentRevisionId),
    }),
  });
}

function inputFor(
  candidate: Candidate,
  revision: ChangeSetRevision,
  commitId: string,
): CommitChangeSetRevisionInput {
  const approvalScope: ApprovalScope = {
    requirementDomain: "manuscript",
    targetType: "manuscript",
    objectId: "scene-1",
  };
  return {
    commitId,
    changeSetRevision: revision,
    validationRuns: [
      createValidationRun({
        id: `validation-${revision.revisionId}`,
        changeSetRevisionId: revision.revisionId,
        planVersionId: "plan-task-4344",
        validatorId: "basic-validator",
        entryResults: [],
        executionState: "completed",
        outcome: "pass",
        createdAt: now,
      }),
    ],
    reviewDecisions: [
      createReviewDecision({
        id: `review-${revision.revisionId}`,
        changeSetRevisionId: revision.revisionId,
        approvalScope,
        decision: "approve",
        decidedBy: "human",
        actorId: "reviewer-1",
        reason: "",
        evidenceReferences: [candidate.id],
        createdAt: now,
      }),
    ],
    currentRevisionFacts: { unresolvedConflict: false, stale: false },
    targetInvariantViolations: [],
    requiredApproval: false,
    approvalScopeRequirements: [
      {
        approvalScope,
        requirement: "task-4.3-4.4-recovery",
        requirementLevel: "not_required",
      },
    ],
    now,
  };
}

async function setup() {
  const dependencies = createInMemoryEngineDependencies();
  const scene = baseScene();
  await dependencies.scenes.save(scene);
  const candidate = candidateFor(scene);
  await dependencies.candidates.save(candidate);

  const change = changeFromCandidate(candidate, scene);
  const changeSet: ChangeSet = replaceChangeSetChanges({
    changeSet: createChangeSet({
      id: "change-set-task-4344",
      novelId: "novel-1",
      initialRevisionId: "change-set-task-4344:r1",
      createdAt: now,
    }),
    changes: [change],
    revisionId: "change-set-task-4344:r2",
    updatedAt: now,
  });
  const parentRevision = createInitialChangeSetRevision({
    revisionId: "change-set-task-4344:revision:r1",
    changeSetId: changeSet.id,
    novelId: "novel-1",
    createdAt: now,
  });
  const revision = createChangeSetRevision({
    parent: parentRevision,
    revisionId: "change-set-task-4344:revision:r2",
    trigger: { type: "edit", references: [candidate.id] },
    changes: changeSet.changes,
    createdAt: now,
  });

  return { dependencies, scene, candidate, changeSet, revision };
}

function injectFailure(
  base: CommitChangeSetRevisionTransaction,
  failurePoint: FailurePoint,
): CommitChangeSetRevisionTransaction {
  let injected = false;
  return {
    run<T>(
      operation: (work: CommitChangeSetRevisionTransactionWork) => Promise<T>,
    ): Promise<T> {
      return base.run(async baseWork => {
        let work = baseWork;
        if (failurePoint === "domain") {
          work = {
            ...work,
            repositories: {
              ...work.repositories,
              scenes: {
                ...work.repositories.scenes,
                saveSceneIfCurrent: async (expectedRevisionId, scene) => {
                  await baseWork.repositories.scenes.saveSceneIfCurrent(expectedRevisionId, scene);
                  if (!injected) {
                    injected = true;
                    throw new Error(failureMessage);
                  }
                },
              },
            },
          };
        }
        if (failurePoint === "event") {
          work = {
            ...work,
            eventStore: {
              ...work.eventStore,
              appendEventsIfAbsent: async events => {
                await baseWork.eventStore.appendEventsIfAbsent(events);
                if (!injected) {
                  injected = true;
                  throw new Error(failureMessage);
                }
              },
            },
          };
        }
        const result = await operation(work);
        if (failurePoint === "transaction" && !injected) {
          injected = true;
          throw new Error(failureMessage);
        }
        return result;
      });
    },
  };
}

async function expectNoSuccessfulHalfCommit(
  dependencies: ReturnType<typeof createInMemoryEngineDependencies>,
  candidate: Candidate,
  changeSet: ChangeSet,
) {
  const current = await dependencies.scenes.findById("scene-1");
  expect(current?.text).toBe("Alpha middle Omega.");
  expect(current?.currentRevisionId).toBe("scene-rev-2");
  expect(
    await dependencies.scenes.getRevision("scene-1", "scene-rev-2:commit-initial-failure"),
  ).toBeUndefined();
  expect(await dependencies.eventStore.listByNovel("novel-1")).toEqual([]);

  const commits = await dependencies.narrativeCommits.listByNovel("novel-1");
  expect(commits.every(commit => commit.status !== "committed")).toBe(true);
  expect(commits.filter(commit => commit.status === "committed")).toEqual([]);

  expect((await dependencies.candidates.findById(candidate.id))?.currentRevisionId).toBe(
    candidate.currentRevisionId,
  );
  expect(changeSet.currentRevisionId).toBe("change-set-task-4344:r2");
  expect(changeSet.lifecycle).toBe("open");
}

describe("[task:4.3-4.4] Candidate/ChangeSet/commitChangeSetRevision recovery atomicity", () => {
  it("[transaction] rolls back target, history, events, and committed NarrativeCommit on transaction failure", async () => {
    const fixture = await setup();
    await expect(commitChangeSetRevision({
      transaction: injectFailure(fixture.dependencies.commitTransaction, "transaction"),
      input: inputFor(fixture.candidate, fixture.revision, "commit-initial-failure"),
    })).rejects.toThrow(failureMessage);

    await expectNoSuccessfulHalfCommit(
      fixture.dependencies,
      fixture.candidate,
      fixture.changeSet,
    );
  });

  it("[recovery] rolls back partially appended events and never exposes a committed result", async () => {
    const fixture = await setup();
    await expect(commitChangeSetRevision({
      transaction: injectFailure(fixture.dependencies.commitTransaction, "event"),
      input: inputFor(fixture.candidate, fixture.revision, "commit-initial-failure"),
    })).rejects.toThrow(failureMessage);

    await expectNoSuccessfulHalfCommit(
      fixture.dependencies,
      fixture.candidate,
      fixture.changeSet,
    );
  });

  it("[persistence] rolls back a written target/current/history after domain failure", async () => {
    const fixture = await setup();
    await expect(commitChangeSetRevision({
      transaction: injectFailure(fixture.dependencies.commitTransaction, "domain"),
      input: inputFor(fixture.candidate, fixture.revision, "commit-initial-failure"),
    })).rejects.toThrow(failureMessage);

    await expectNoSuccessfulHalfCommit(
      fixture.dependencies,
      fixture.candidate,
      fixture.changeSet,
    );
  });

  it("[regression] retry and recovery replays produce exactly one committed result", async () => {
    const fixture = await setup();
    await expect(commitChangeSetRevision({
      transaction: injectFailure(fixture.dependencies.commitTransaction, "event"),
      input: inputFor(fixture.candidate, fixture.revision, "commit-initial-failure"),
    })).rejects.toThrow(failureMessage);

    const retry = await commitChangeSetRevision({
      transaction: fixture.dependencies.commitTransaction,
      input: inputFor(fixture.candidate, fixture.revision, "commit-retry"),
    });
    const recovery = await commitChangeSetRevision({
      transaction: fixture.dependencies.commitTransaction,
      input: inputFor(fixture.candidate, fixture.revision, "commit-recovery-replay"),
    });
    const repeatedRecovery = await commitChangeSetRevision({
      transaction: fixture.dependencies.commitTransaction,
      input: inputFor(fixture.candidate, fixture.revision, "commit-retry"),
    });

    expect(retry.status).toBe("committed");
    expect(recovery).toEqual(retry);
    expect(repeatedRecovery).toEqual(retry);
    const commits = await fixture.dependencies.narrativeCommits.listByNovel("novel-1");
    expect(commits.filter(commit => commit.status === "committed")).toEqual([retry]);
    expect(
      await fixture.dependencies.scenes.getRevision(
        "scene-1",
        "scene-rev-2:commit-retry",
      ),
    ).toBeDefined();
    expect(
      await fixture.dependencies.scenes.getRevision(
        "scene-1",
        "scene-rev-2:commit-recovery-replay",
      ),
    ).toBeUndefined();
    const events = await fixture.dependencies.eventStore.listByNovel("novel-1");
    expect(events.filter(event => event.name === "NarrativeCommitRecorded")).toHaveLength(1);
  });
});
