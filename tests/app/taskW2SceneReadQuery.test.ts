import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createSceneReadQuery } from "../../src/app/sceneReadQuery";
import { hashContent } from "../../src/shared/domain/contentHash";
import { commitSceneText, createScene, type Scene } from "../../src/manuscript/domain/scene";

const NOVEL = "novel-1";
const OTHER_NOVEL = "novel-2";
const AT = new Date("2026-10-06T00:00:00.000Z");
const LATER = new Date("2026-10-06T00:00:01.000Z");
const TEXT = "第一段。第二段。";
const ANCHOR_TEXT = "第一段";

type Dependencies = ReturnType<typeof createInMemoryEngineDependencies>;

/** A scene with no manuscript revision beyond its creation revision. */
function sceneFixture(input: {
  readonly id: string;
  readonly novelId?: string;
  readonly chapterId?: string;
}): Scene {
  return createScene({
    id: input.id,
    novelId: input.novelId ?? NOVEL,
    chapterId: input.chapterId ?? "chapter-1",
    title: `${input.id} 标题`,
    revisionId: `${input.id}:r1`,
    commitId: `commit:${input.id}:r1`,
    createdAt: AT,
  });
}

/** A scene whose current revision carries text and one target span anchor. */
function writtenSceneFixture(input: { readonly id: string; readonly novelId?: string }): Scene {
  return commitSceneText({
    scene: sceneFixture(input),
    text: TEXT,
    spanAnchors: {
      "anchor-1": {
        anchorId: "anchor-1",
        start: 0,
        end: 3,
        text: ANCHOR_TEXT,
        sourceContentHash: hashContent(ANCHOR_TEXT),
      },
    },
    revisionId: `${input.id}:r2`,
    commitId: `commit:${input.id}:r2`,
    updatedAt: LATER,
  });
}

async function dependencies(seed: readonly Scene[]): Promise<Dependencies> {
  const built = createInMemoryEngineDependencies();
  for (const scene of seed) await built.scenes.save(scene);
  return built;
}

describe("[task:W2] [domain] scene read query", () => {
  it("returns the current scene revision text and anchor ids", async () => {
    const built = await dependencies([writtenSceneFixture({ id: "scene-1" })]);

    const view = await createSceneReadQuery(built).getScene({
      novelId: NOVEL,
      sceneId: "scene-1",
    });

    expect(view?.sceneId).toBe("scene-1");
    expect(view?.novelId).toBe(NOVEL);
    expect(view?.chapterId).toBe("chapter-1");
    expect(view?.title).toBe("scene-1 标题");
    expect(view?.revisionId).toBe("scene-1:r2");
    expect(view?.text).toBe(TEXT);
    expect(view?.anchorIds).toEqual(["anchor-1"]);
  });

  it("exposes the read shape only, with no domain internals", async () => {
    const built = await dependencies([writtenSceneFixture({ id: "scene-1" })]);

    const view = await createSceneReadQuery(built).getScene({
      novelId: NOVEL,
      sceneId: "scene-1",
    });

    expect(Object.keys(view ?? {}).sort()).toEqual([
      "anchorIds",
      "chapterId",
      "novelId",
      "revisionId",
      "sceneId",
      "text",
      "title",
    ]);
  });

  it("reports an empty anchor list for a scene with no target spans", async () => {
    const built = await dependencies([sceneFixture({ id: "scene-plain" })]);

    const view = await createSceneReadQuery(built).getScene({
      novelId: NOVEL,
      sceneId: "scene-plain",
    });

    expect(view?.anchorIds).toEqual([]);
    expect(view?.text).toBe("");
  });

  it("follows the scene to its latest committed revision", async () => {
    const first = writtenSceneFixture({ id: "scene-1" });
    const second = commitSceneText({
      scene: first,
      text: `${TEXT}第三段。`,
      revisionId: "scene-1:r3",
      commitId: "commit:scene-1:r3",
      updatedAt: new Date("2026-10-06T00:00:02.000Z"),
    });
    const built = await dependencies([first, second]);

    const view = await createSceneReadQuery(built).getScene({
      novelId: NOVEL,
      sceneId: "scene-1",
    });

    expect(view?.revisionId).toBe("scene-1:r3");
    expect(view?.text).toBe(`${TEXT}第三段。`);
    expect(view?.anchorIds).toEqual([]);
  });

  it("[cross-system] does not return a scene that belongs to another novel", async () => {
    const built = await dependencies([writtenSceneFixture({ id: "scene-1" })]);

    expect(
      await createSceneReadQuery(built).getScene({ novelId: OTHER_NOVEL, sceneId: "scene-1" }),
    ).toBeUndefined();
  });

  it("returns undefined for a scene that does not exist", async () => {
    const built = await dependencies([]);

    expect(
      await createSceneReadQuery(built).getScene({ novelId: NOVEL, sceneId: "scene-ghost" }),
    ).toBeUndefined();
  });
});
