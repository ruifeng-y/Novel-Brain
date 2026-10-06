import { describe, expect, it } from "vitest";
import { createInMemoryChangeSetPersistence } from "../../src/production/application/changeSetPersistence";
import { createChangeSetRevisionService } from "../../src/app/changeSetRevisionService";
import { createCandidate, type Candidate } from "../../src/production/domain/candidate";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const AT = new Date("2026-10-06T00:00:00.000Z");
const LATER = new Date("2026-10-06T00:00:01.000Z");

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

function dependencies() {
  return createInMemoryChangeSetPersistence();
}

describe("[task:W3] [domain] change set revision adoption", () => {
  it("adopts a candidate into a persisted change set revision that can be read back", async () => {
    const persistence = dependencies();
    const service = createChangeSetRevisionService({ changeSets: persistence.changeSets });
    const revision = await service.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId: "cs-1",
      revisionId: "cs-1:r1",
      createdAt: AT,
    });

    expect(revision.revisionId).toBe("cs-1:r1");
    expect(revision.changeSetId).toBe("cs-1");
    expect(revision.novelId).toBe("novel-1");
    expect(revision.changes).toHaveLength(1);
    expect(revision.trigger.type).toBe("initial_assembly");
    expect(
      (await service.getRevision({ changeSetId: "cs-1", revisionId: "cs-1:r1" }))?.changes,
    ).toHaveLength(1);
  });

  it("binds the change to the adopted candidate and its target address", async () => {
    const persistence = dependencies();
    const service = createChangeSetRevisionService({ changeSets: persistence.changeSets });
    const revision = await service.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId: "cs-1",
      revisionId: "cs-1:r1",
      createdAt: AT,
    });

    const change = revision.changes[0]!;
    expect(change.sourceType).toBe("candidate");
    expect(change.sourceReference.identity).toBe("candidate-1");
    expect(change.targetAddress).toEqual({ targetType: "manuscript", objectId: "scene-1" });
    expect(change.payload).toEqual({ text: "新文本。" });
  });

  it("is idempotent for the same revision id and content and rejects different content", async () => {
    const persistence = dependencies();
    const service = createChangeSetRevisionService({ changeSets: persistence.changeSets });
    const first = await service.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId: "cs-1",
      revisionId: "cs-1:r1",
      createdAt: AT,
    });
    const again = await service.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId: "cs-1",
      revisionId: "cs-1:r1",
      createdAt: LATER,
    });

    expect(again.revisionId).toBe(first.revisionId);
    expect(again.changes).toEqual(first.changes);

    await expect(
      service.adoptCandidate({
        candidate: candidateFixture("candidate-2", "另一段文本。"),
        changeSetId: "cs-1",
        revisionId: "cs-1:r1",
        createdAt: LATER,
      }),
    ).rejects.toThrow(/different content/);
  });

  it("advances the current revision and keeps history linear", async () => {
    const persistence = dependencies();
    const service = createChangeSetRevisionService({ changeSets: persistence.changeSets });
    const r1 = await service.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId: "cs-1",
      revisionId: "cs-1:r1",
      createdAt: AT,
    });
    const r2 = await service.adoptCandidate({
      candidate: candidateFixture("candidate-2", "第二版文本。"),
      changeSetId: "cs-1",
      revisionId: "cs-1:r2",
      parentRevision: r1,
      createdAt: LATER,
    });

    expect(r2.revisionNumber).toBe(2);
    expect(r2.parentRevisionId).toBe("cs-1:r1");
    expect((await service.getCurrentRevision({ changeSetId: "cs-1" }))?.revisionId).toBe("cs-1:r2");
    expect((await service.getRevision({ changeSetId: "cs-1", revisionId: "cs-1:r1" }))?.changes)
      .toHaveLength(1);
  });

  it("refuses to fork the revision history from a non-current parent", async () => {
    const persistence = dependencies();
    const service = createChangeSetRevisionService({ changeSets: persistence.changeSets });
    const r1 = await service.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId: "cs-1",
      revisionId: "cs-1:r1",
      createdAt: AT,
    });
    await service.adoptCandidate({
      candidate: candidateFixture("candidate-2", "第二版文本。"),
      changeSetId: "cs-1",
      revisionId: "cs-1:r2",
      parentRevision: r1,
      createdAt: LATER,
    });

    await expect(
      service.adoptCandidate({
        candidate: candidateFixture("candidate-3", "分叉文本。"),
        changeSetId: "cs-1",
        revisionId: "cs-1:r3",
        parentRevision: r1,
        createdAt: LATER,
      }),
    ).rejects.toThrow(/not the current revision/);
    expect((await service.getCurrentRevision({ changeSetId: "cs-1" }))?.revisionId).toBe("cs-1:r2");
  });

  it("never answers with a revision from another change set", async () => {
    const persistence = dependencies();
    const service = createChangeSetRevisionService({ changeSets: persistence.changeSets });
    await service.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId: "cs-1",
      revisionId: "cs-1:r1",
      createdAt: AT,
    });

    expect(await service.getRevision({ changeSetId: "cs-2", revisionId: "cs-1:r1" })).toBeUndefined();
    expect(await service.getCurrentRevision({ changeSetId: "cs-2" })).toBeUndefined();
  });
});
