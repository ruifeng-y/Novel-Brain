import { describe, expect, it } from "vitest";
import {
  closeChangeSet,
  createChangeSet,
  replaceChangeSetChanges,
} from "../../src/production/domain/changeSet";
import { createChange } from "../../src/production/domain/change";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-03T00:00:00.000Z");
const later = new Date("2026-10-04T00:00:00.000Z");

function change(id: string) {
  return createChange({
    id,
    sourceType: "author_edit",
    sourceReference: { identity: "author-1", version: "r1", hash: `hash-${id}` },
    targetAddress: { targetType: "manuscript", objectId: "scene-1" },
    payload: { text: id },
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
    }),
  });
}

describe("ChangeSet aggregate", () => {
  it("creates an open change set with no changes and an initial revision", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    expect(changeSet).toMatchObject({
      id: "cs-1",
      novelId: "novel-1",
      changes: [],
      currentRevisionId: "cs-1-r1",
      lifecycle: "open",
    });
    expect(changeSet.closureDisposition).toBeUndefined();
  });

  it("requires id, novelId, and initialRevisionId", () => {
    expect(() =>
      createChangeSet({ id: "", novelId: "novel-1", initialRevisionId: "r1", createdAt: now }),
    ).toThrow("id is required");
    expect(() =>
      createChangeSet({ id: "cs-1", novelId: "", initialRevisionId: "r1", createdAt: now }),
    ).toThrow("novelId is required");
    expect(() =>
      createChangeSet({ id: "cs-1", novelId: "novel-1", initialRevisionId: "", createdAt: now }),
    ).toThrow("initialRevisionId is required");
  });

  it("rejects two unresolved changes on the same target", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    expect(() =>
      replaceChangeSetChanges({
        changeSet,
        changes: [change("change-1"), change("change-2")],
        revisionId: "cs-1-r2",
        updatedAt: later,
      }),
    ).toThrow("Duplicate target address in change set revision: manuscript:scene-1");
  });

  it("replaces changes as a new revision without mutating the original", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    const updated = replaceChangeSetChanges({
      changeSet,
      changes: [change("change-1")],
      revisionId: "cs-1-r2",
      updatedAt: later,
    });
    expect(changeSet.changes).toHaveLength(0);
    expect(updated.changes).toHaveLength(1);
    expect(updated.currentRevisionId).toBe("cs-1-r2");
  });

  it("closes with a disposition and refuses a second close", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    const closed = closeChangeSet({ changeSet, disposition: "committed", updatedAt: later });
    expect(closed.lifecycle).toBe("closed");
    expect(closed.closureDisposition).toBe("committed");
    expect(() =>
      closeChangeSet({ changeSet: closed, disposition: "abandoned", updatedAt: later }),
    ).toThrow("Change set is already closed");
  });

  it("refuses to modify a closed change set", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    const closed = closeChangeSet({ changeSet, disposition: "abandoned", updatedAt: later });
    expect(() =>
      replaceChangeSetChanges({
        changeSet: closed,
        changes: [change("change-1")],
        revisionId: "cs-1-r2",
        updatedAt: later,
      }),
    ).toThrow("Closed change set cannot be modified");
  });

  it("requires a revisionId that differs from the current revision", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    expect(() =>
      replaceChangeSetChanges({ changeSet, changes: [], revisionId: "", updatedAt: later }),
    ).toThrow("revisionId is required");
    expect(() =>
      replaceChangeSetChanges({
        changeSet,
        changes: [],
        revisionId: "cs-1-r1",
        updatedAt: later,
      }),
    ).toThrow("revisionId must differ from the current revision");
  });

  it("refuses to move updatedAt backward", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    const earlier = new Date(now.getTime() - 1000);
    expect(() =>
      replaceChangeSetChanges({
        changeSet,
        changes: [],
        revisionId: "cs-1-r2",
        updatedAt: earlier,
      }),
    ).toThrow("updatedAt cannot move backward");
    expect(() =>
      closeChangeSet({ changeSet, disposition: "superseded", updatedAt: earlier }),
    ).toThrow("updatedAt cannot move backward");
  });

  it("closes with the superseded disposition", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    const closed = closeChangeSet({ changeSet, disposition: "superseded", updatedAt: later });
    expect(closed.lifecycle).toBe("closed");
    expect(closed.closureDisposition).toBe("superseded");
  });

  it("copies timestamps so callers cannot mutate a frozen change set", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    const mutable = new Date(later.getTime());
    const updated = replaceChangeSetChanges({
      changeSet,
      changes: [change("change-1")],
      revisionId: "cs-1-r2",
      updatedAt: mutable,
    });
    mutable.setTime(0);
    expect(updated.updatedAt.getTime()).toBe(later.getTime());
    expect(Object.isFrozen(updated)).toBe(true);
  });
});
