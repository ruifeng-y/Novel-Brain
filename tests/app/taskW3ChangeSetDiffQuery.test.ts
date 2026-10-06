import { describe, expect, it } from "vitest";
import { createInMemoryChangeSetPersistence } from "../../src/production/application/changeSetPersistence";
import {
  storedChangeSetRevision,
  type ChangeSetRevisionRepository,
} from "../../src/production/application/changeSetPersistence";
import { createChangeSetDiffQuery } from "../../src/app/changeSetDiffQuery";
import { createChange } from "../../src/production/domain/change";
import {
  createChangeSetRevision,
  createInitialChangeSetRevision,
  type ChangeSetRevision,
} from "../../src/production/domain/changeSetRevision";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const AT = new Date("2026-10-06T00:00:00.000Z");
const LATER = new Date("2026-10-06T00:00:01.000Z");

const versionSet = createVersionSet({
  scene: createVersionReference("Scene", "scene-1", "scene-1:rev-1"),
});

function change(id: string, text: string, objectId = "scene-1") {
  return createChange({
    id,
    sourceType: "candidate",
    sourceReference: { identity: "candidate-1", version: "v1", hash: "h1" },
    targetAddress: { targetType: "manuscript", objectId },
    payload: { text },
    basedOnVersionSet: versionSet,
  });
}

async function seed(
  changeSets: ChangeSetRevisionRepository,
  changeSetId: string,
  revisionId: string,
  changes: readonly ReturnType<typeof change>[],
  parent?: ChangeSetRevision,
): Promise<ChangeSetRevision> {
  const revision = parent
    ? createChangeSetRevision({
        parent,
        revisionId,
        trigger: { type: "edit", references: [] },
        changes,
        createdAt: LATER,
      })
    : Object.freeze({
        ...createInitialChangeSetRevision({
          revisionId,
          changeSetId,
          novelId: "novel-1",
          createdAt: AT,
        }),
        changes: Object.freeze([...changes]),
      });
  await changeSets.save(storedChangeSetRevision(revision));
  return revision;
}

describe("[task:W3] [domain] change set revision diff", () => {
  it("diffs two revisions of one change set", async () => {
    const persistence = createInMemoryChangeSetPersistence();
    const query = createChangeSetDiffQuery({ changeSets: persistence.changeSets });
    const r1 = await seed(persistence.changeSets, "cs-1", "cs-1:r1", [change("change-1", "第一版")]);
    await seed(persistence.changeSets, "cs-1", "cs-1:r2", [change("change-1", "第二版")], r1);

    const entries = await query.diffRevisions({
      changeSetId: "cs-1",
      fromRevisionId: "cs-1:r1",
      toRevisionId: "cs-1:r2",
    });

    expect(entries?.map(entry => entry.action)).toContain("modified");
  });

  it("reports added, removed and unchanged change identities", async () => {
    const persistence = createInMemoryChangeSetPersistence();
    const query = createChangeSetDiffQuery({ changeSets: persistence.changeSets });
    const r1 = await seed(persistence.changeSets, "cs-1", "cs-1:r1", [
      change("change-keep", "稳定", "scene-keep"),
      change("change-drop", "将被移除", "scene-drop"),
    ]);
    await seed(persistence.changeSets, "cs-1", "cs-1:r2", [
      change("change-keep", "稳定", "scene-keep"),
      change("change-add", "新增", "scene-add"),
    ], r1);

    const entries = await query.diffRevisions({
      changeSetId: "cs-1",
      fromRevisionId: "cs-1:r1",
      toRevisionId: "cs-1:r2",
    });
    const byId = new Map(entries?.map(entry => [entry.changeId, entry.action]));

    expect(byId.get("change-keep")).toBe("unchanged");
    expect(byId.get("change-drop")).toBe("removed");
    expect(byId.get("change-add")).toBe("added");
  });

  it("returns undefined for a missing revision or a cross change set comparison", async () => {
    const persistence = createInMemoryChangeSetPersistence();
    const query = createChangeSetDiffQuery({ changeSets: persistence.changeSets });
    const r1 = await seed(persistence.changeSets, "cs-1", "cs-1:r1", [change("change-1", "第一版")]);
    await seed(persistence.changeSets, "cs-2", "cs-2:r1", [change("change-1", "另一集")]);

    expect(
      await query.diffRevisions({
        changeSetId: "cs-1",
        fromRevisionId: "cs-1:r1",
        toRevisionId: "cs-1:missing",
      }),
    ).toBeUndefined();
    expect(
      await query.diffRevisions({
        changeSetId: "cs-1",
        fromRevisionId: "cs-1:r1",
        toRevisionId: "cs-2:r1",
      }),
    ).toBeUndefined();
    expect(r1.changes).toHaveLength(1);
  });
});
