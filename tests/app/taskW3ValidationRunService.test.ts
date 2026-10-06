import { describe, expect, it } from "vitest";
import {
  createInMemoryValidationRunStore,
  createValidationRunService,
} from "../../src/app/validationRunService";
import { createInMemoryChangeSetPersistence } from "../../src/production/application/changeSetPersistence";
import { createChangeSetRevisionService } from "../../src/app/changeSetRevisionService";
import { InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import { createCandidate, type Candidate } from "../../src/production/domain/candidate";
import { createScene, type Scene } from "../../src/manuscript/domain/scene";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const AT = new Date("2026-10-06T00:00:00.000Z");

function candidateFixture(id = "candidate-1", text = "新文本。"): Candidate {
  return createCandidate({
    id,
    taskId: `task-${id}`,
    novelId: "novel-1",
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-1:rev-1"),
    }),
    change: { type: "text", sceneId: "scene-1", text },
    createdAt: AT,
  });
}

function sceneFixture(id = "scene-1"): Scene {
  return createScene({
    id,
    novelId: "novel-1",
    chapterId: "chapter-1",
    title: "开场",
    revisionId: `${id}:rev-1`,
    commitId: "commit-0",
    createdAt: AT,
  });
}

async function harness() {
  const persistence = createInMemoryChangeSetPersistence();
  const changeSetRevisions = createChangeSetRevisionService({
    changeSets: persistence.changeSets,
  });
  const scenes = new InMemoryRevisionedRepository<Scene>();
  const candidates = new InMemoryRevisionedRepository<Candidate>();
  await scenes.save(sceneFixture());
  await candidates.save(candidateFixture());
  await changeSetRevisions.adoptCandidate({
    candidate: candidateFixture(),
    changeSetId: "cs-1",
    revisionId: "cs-1:r1",
    createdAt: AT,
  });

  const validations = createInMemoryValidationRunStore();
  const service = createValidationRunService({
    changeSets: persistence.changeSets,
    validations,
    scenes,
    candidates,
  });
  return { service, validations, changeSetRevisions, candidates, persistence };
}

function validationInput(overrides: Partial<Parameters<
  ReturnType<typeof createValidationRunService>["runValidation"]
>[0]> = {}) {
  return {
    changeSetId: "cs-1",
    revisionId: "cs-1:r1",
    validationId: "run-1",
    planVersionId: "plan-v1",
    candidateId: "candidate-1",
    mustPreserve: ["不在正文里的短语"],
    createdAt: AT,
    ...overrides,
  };
}

describe("[task:W3] [domain] validation run as a reachable stage", () => {
  it("runs validation against a revision and reads the run back with its findings", async () => {
    const { service } = await harness();
    const run = await service.runValidation(validationInput());

    expect(run.changeSetRevisionId).toBe("cs-1:r1");
    expect(run.planVersionId).toBe("plan-v1");
    expect(run.executionState).toBe("completed");
    expect(run.outcome).toBe("fail");

    const readBack = await service.getValidation({
      validationId: run.id,
      changeSetId: "cs-1",
      revisionId: "cs-1:r1",
    });
    expect(readBack?.changeSetRevisionId).toBe("cs-1:r1");
    expect(readBack?.planVersionId).toBe("plan-v1");
    const findings = readBack?.entryResults.flatMap(entry => entry.findings) ?? [];
    expect(findings.map(finding => finding.code)).toContain("REQUIRED_PHRASE_MISSING");
  });

  it("persists the run independently of any commit", async () => {
    const { service, validations } = await harness();
    const run = await service.runValidation(validationInput());

    // A fresh read of the store (not the returned value) sees the run.
    const stored = await validations.findById(run.id);
    expect(stored?.id).toBe(run.id);
    expect(stored?.changeSetRevisionId).toBe("cs-1:r1");
  });

  it("never answers with a run that validated a different revision", async () => {
    const { service } = await harness();
    const run = await service.runValidation(validationInput());

    expect(
      await service.getValidation({
        validationId: "run-for-other-revision",
        changeSetId: "cs-1",
        revisionId: "cs-1:r1",
      }),
    ).toBeUndefined();
    expect(
      await service.getValidation({
        validationId: run.id,
        changeSetId: "cs-1",
        revisionId: "cs-1:r2",
      }),
    ).toBeUndefined();
    expect(
      (
        await service.getValidation({
          validationId: run.id,
          changeSetId: "cs-1",
          revisionId: "cs-1:r1",
        })
      )?.id,
    ).toBe(run.id);
  });

  it("is idempotent for the same validation id and content and rejects different content", async () => {
    const { service } = await harness();
    const first = await service.runValidation(validationInput());
    const again = await service.runValidation(validationInput());
    expect(again.id).toBe(first.id);
    expect(again.entryResults).toEqual(first.entryResults);

    await expect(
      service.runValidation(validationInput({ planVersionId: "plan-v2" })),
    ).rejects.toThrow(/different content/);
  });

  it("refuses to validate a revision with a candidate that is not its content source", async () => {
    const { service, candidates } = await harness();
    await candidates.save(candidateFixture("candidate-2", "另一段文本。"));

    await expect(
      service.runValidation(validationInput({ candidateId: "candidate-2" })),
    ).rejects.toThrow(/not the source of revision/);
  });

  it("refuses to validate a revision that does not exist", async () => {
    const { service } = await harness();
    await expect(
      service.runValidation(validationInput({ revisionId: "cs-1:missing" })),
    ).rejects.toThrow(/Revision not found/);
  });

  it("never answers a run under another Change Set that reuses the same revision id", async () => {
    const persistence = createInMemoryChangeSetPersistence();
    const changeSetRevisions = createChangeSetRevisionService({
      changeSets: persistence.changeSets,
    });
    const scenes = new InMemoryRevisionedRepository<Scene>();
    const candidates = new InMemoryRevisionedRepository<Candidate>();
    await scenes.save(sceneFixture());
    await candidates.save(candidateFixture());
    // The same revision id string in two different Change Sets.
    await changeSetRevisions.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId: "cs-1",
      revisionId: "shared:r1",
      createdAt: AT,
    });
    await changeSetRevisions.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId: "cs-2",
      revisionId: "shared:r1",
      createdAt: AT,
    });

    const service = createValidationRunService({
      changeSets: persistence.changeSets,
      validations: createInMemoryValidationRunStore(),
      scenes,
      candidates,
    });
    const first = await service.runValidation({
      changeSetId: "cs-1",
      revisionId: "shared:r1",
      validationId: "run-cs-1",
      planVersionId: "plan-v1",
      candidateId: "candidate-1",
      mustPreserve: [],
      createdAt: AT,
    });
    await service.runValidation({
      changeSetId: "cs-2",
      revisionId: "shared:r1",
      validationId: "run-cs-2",
      planVersionId: "plan-v1",
      candidateId: "candidate-1",
      mustPreserve: [],
      createdAt: AT,
    });

    expect(
      (await service.getValidation({
        validationId: "run-cs-1",
        changeSetId: "cs-1",
        revisionId: "shared:r1",
      }))?.id,
    ).toBe(first.id);
    expect(
      await service.getValidation({
        validationId: "run-cs-1",
        changeSetId: "cs-2",
        revisionId: "shared:r1",
      }),
    ).toBeUndefined();
  });

  it("treats the same validation id in another Change Set as a conflict, not a substitution", async () => {
    const persistence = createInMemoryChangeSetPersistence();
    const changeSetRevisions = createChangeSetRevisionService({
      changeSets: persistence.changeSets,
    });
    const scenes = new InMemoryRevisionedRepository<Scene>();
    const candidates = new InMemoryRevisionedRepository<Candidate>();
    await scenes.save(sceneFixture());
    await candidates.save(candidateFixture());
    await changeSetRevisions.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId: "cs-1",
      revisionId: "shared:r1",
      createdAt: AT,
    });
    await changeSetRevisions.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId: "cs-2",
      revisionId: "shared:r1",
      createdAt: AT,
    });

    const service = createValidationRunService({
      changeSets: persistence.changeSets,
      validations: createInMemoryValidationRunStore(),
      scenes,
      candidates,
    });
    await service.runValidation({
      changeSetId: "cs-1",
      revisionId: "shared:r1",
      validationId: "run-shared",
      planVersionId: "plan-v1",
      candidateId: "candidate-1",
      mustPreserve: [],
      createdAt: AT,
    });

    await expect(
      service.runValidation({
        changeSetId: "cs-2",
        revisionId: "shared:r1",
        validationId: "run-shared",
        planVersionId: "plan-v1",
        candidateId: "candidate-1",
        mustPreserve: [],
        createdAt: AT,
      }),
    ).rejects.toThrow(/different content/);
  });
});
