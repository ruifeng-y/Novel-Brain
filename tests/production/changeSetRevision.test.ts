import { describe, expect, it } from "vitest";
import { createChange } from "../../src/production/domain/change";
import {
  createChangeSetRevision,
  createInitialChangeSetRevision,
} from "../../src/production/domain/changeSetRevision";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-03T00:00:00.000Z");
const later = new Date("2026-10-04T00:00:00.000Z");

function change(id: string, objectId = "scene-1") {
  return createChange({
    id,
    sourceType: "author_edit",
    sourceReference: { identity: "author-1", version: "r1", hash: `hash-${id}` },
    targetAddress: { targetType: "manuscript", objectId },
    payload: { text: id },
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", objectId, "scene-rev-1"),
    }),
  });
}

function initial() {
  return createInitialChangeSetRevision({
    revisionId: "cs-1-r1",
    changeSetId: "cs-1",
    novelId: "novel-1",
    createdAt: now,
  });
}

describe("ChangeSetRevision", () => {
  it("creates the initial revision with number 1 and no parent", () => {
    const revision = initial();
    expect(revision).toMatchObject({
      revisionId: "cs-1-r1",
      changeSetId: "cs-1",
      revisionNumber: 1,
      changes: [],
    });
    expect(revision.trigger.type).toBe("initial_assembly");
    expect(revision.parentRevisionId).toBeUndefined();
  });

  it("increments the revision number and links to the parent", () => {
    const child = createChangeSetRevision({
      parent: initial(),
      revisionId: "cs-1-r2",
      trigger: { type: "edit", references: [] },
      changes: [change("change-1")],
      createdAt: later,
    });
    expect(child.revisionNumber).toBe(2);
    expect(child.parentRevisionId).toBe("cs-1-r1");
    expect(child.changes).toHaveLength(1);
  });

  it("rejects a duplicate target address inside one revision", () => {
    expect(() =>
      createChangeSetRevision({
        parent: initial(),
        revisionId: "cs-1-r2",
        trigger: { type: "edit", references: [] },
        changes: [change("change-1"), change("change-2")],
        createdAt: later,
      }),
    ).toThrow("Duplicate target address in change set revision: manuscript:scene-1");
  });

  it("defensively copies createdAt so later input mutation cannot change the revision", () => {
    const inputCreatedAt = new Date(now.getTime());
    const revision = createInitialChangeSetRevision({
      revisionId: "cs-1-r1",
      changeSetId: "cs-1",
      novelId: "novel-1",
      createdAt: inputCreatedAt,
    });

    expect(revision.createdAt).not.toBe(inputCreatedAt);
    const snapshotTime = revision.createdAt.getTime();

    inputCreatedAt.setTime(later.getTime());

    expect(revision.createdAt).not.toBe(inputCreatedAt);
    expect(revision.createdAt.getTime()).toBe(snapshotTime);
    expect(revision.createdAt).toEqual(now);
  });

  it("copies trigger references and changes before later input mutation", () => {
    const trigger = { type: "edit" as const, references: ["reference-1"] };
    const changes = [change("change-1")];
    const revision = createChangeSetRevision({
      parent: initial(),
      revisionId: "cs-1-r2",
      trigger,
      changes,
      createdAt: later,
    });

    trigger.references.push("reference-2");
    changes.push(change("change-2", "scene-2"));

    expect(revision.trigger.references).not.toBe(trigger.references);
    expect(revision.trigger.references).toEqual(["reference-1"]);
    expect(revision.changes).not.toBe(changes);
    expect(revision.changes.map(({ id }) => id)).toEqual(["change-1"]);
  });

  it("is immutable", () => {
    const revision = initial();

    expect(() => {
      (revision as unknown as { revisionNumber: number }).revisionNumber = 99;
    }).toThrow();
    expect(() => {
      (revision.trigger.references as unknown as string[]).push("reference-2");
    }).toThrow();
    expect(() => {
      (revision.changes as unknown as ReturnType<typeof change>[]).push(change("change-2"));
    }).toThrow();
  });

  it("requires identity fields", () => {
    expect(() =>
      createInitialChangeSetRevision({
        revisionId: "",
        changeSetId: "cs-1",
        novelId: "novel-1",
        createdAt: now,
      }),
    ).toThrow("revisionId is required");
    expect(() =>
      createInitialChangeSetRevision({
        revisionId: "cs-1-r1",
        changeSetId: "",
        novelId: "novel-1",
        createdAt: now,
      }),
    ).toThrow("changeSetId is required");
    expect(() =>
      createInitialChangeSetRevision({
        revisionId: "cs-1-r1",
        changeSetId: "cs-1",
        novelId: "",
        createdAt: now,
      }),
    ).toThrow("novelId is required");
    expect(() =>
      createChangeSetRevision({
        parent: initial(),
        revisionId: "",
        trigger: { type: "edit", references: [] },
        changes: [],
        createdAt: later,
      }),
    ).toThrow("revisionId is required");
  });
});
