import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createTargetSpanResolutionQuery } from "../../src/app/targetSpanResolutionQuery";
import { hashContent } from "../../src/shared/domain/contentHash";
import {
  commitSceneText,
  createScene,
  type Scene,
} from "../../src/manuscript/domain/scene";
import type { TargetSpan } from "../../src/manuscript/domain/targetSpan";

/**
 * The frozen resolver rejects every failure mode with its own message. The
 * query must classify by inspecting the scene data, so this control lets one
 * test force the resolver to throw on an otherwise valid input and prove the
 * unforeseeable case is never absorbed into a product state.
 */
const resolverControl = vi.hoisted(() => ({ throwOnResolve: false }));

vi.mock("../../src/manuscript/domain/targetSpan", async importOriginal => {
  const actual = (await importOriginal()) as typeof import("../../src/manuscript/domain/targetSpan");
  return {
    ...actual,
    resolveTargetSpan: (scene: Scene, span: TargetSpan) => {
      if (resolverControl.throwOnResolve) {
        throw new Error("unforeseen target span resolver failure");
      }
      return actual.resolveTargetSpan(scene, span);
    },
  };
});

const NOVEL = "novel-1";
const OTHER_NOVEL = "novel-2";
const AT = new Date("2026-10-06T00:00:00.000Z");
const LATER = new Date("2026-10-06T00:00:01.000Z");
const TEXT = "第一段。第二段。";
const ANCHOR_TEXT = "第一段";
const ANCHOR_HASH = hashContent(ANCHOR_TEXT);

type Dependencies = ReturnType<typeof createInMemoryEngineDependencies>;

function sceneFixture(input: { readonly id: string; readonly novelId?: string }): Scene {
  return createScene({
    id: input.id,
    novelId: input.novelId ?? NOVEL,
    chapterId: "chapter-1",
    title: `${input.id} 标题`,
    revisionId: `${input.id}:r1`,
    commitId: `commit:${input.id}:r1`,
    createdAt: AT,
  });
}

/** A scene whose current revision carries text and one valid target span anchor. */
function anchoredSceneFixture(input: { readonly id: string; readonly novelId?: string }): Scene {
  return commitSceneText({
    scene: sceneFixture(input),
    text: TEXT,
    spanAnchors: {
      "anchor-1": {
        anchorId: "anchor-1",
        start: 0,
        end: 3,
        text: ANCHOR_TEXT,
        sourceContentHash: ANCHOR_HASH,
      },
    },
    revisionId: `${input.id}:r2`,
    commitId: `commit:${input.id}:r2`,
    updatedAt: LATER,
  });
}

/** The descriptor the author holds for the valid anchor above. */
function matchingSpan(): TargetSpan {
  return { anchorId: "anchor-1", text: ANCHOR_TEXT, sourceContentHash: ANCHOR_HASH };
}

async function dependencies(seed: readonly Scene[]): Promise<Dependencies> {
  const built = createInMemoryEngineDependencies();
  for (const scene of seed) await built.scenes.save(scene);
  return built;
}

beforeEach(() => {
  resolverControl.throwOnResolve = false;
});

describe("[task:W2] [domain] target span resolution query", () => {
  it("classifies a matching anchor as resolvable with the resolved range", async () => {
    const built = await dependencies([anchoredSceneFixture({ id: "scene-1" })]);

    const view = await createTargetSpanResolutionQuery(built).resolveSpan({
      novelId: NOVEL,
      sceneId: "scene-1",
      span: matchingSpan(),
    });

    expect(view?.state).toBe("resolvable");
    expect(view?.span).toEqual({ start: 0, end: 3, text: ANCHOR_TEXT });
    expect(view?.reason).toBe("");
  });

  it("classifies an anchor captured at an older revision as drifted, not resolvable", async () => {
    const base = anchoredSceneFixture({ id: "scene-1" });
    const stale: Scene = Object.freeze({
      ...base,
      spanAnchors: Object.freeze({
        "anchor-1": Object.freeze({
          ...base.spanAnchors["anchor-1"]!,
          revisionId: "scene-1:r1",
        }),
      }),
    });
    const built = await dependencies([stale]);

    const view = await createTargetSpanResolutionQuery(built).resolveSpan({
      novelId: NOVEL,
      sceneId: "scene-1",
      span: matchingSpan(),
    });

    expect(view?.state).toBe("drifted");
    expect(view?.reason).toContain("revision");
    expect(view && "span" in view).toBe(false);
  });

  it("classifies an anchor whose text disagrees with the descriptor as drifted", async () => {
    const built = await dependencies([anchoredSceneFixture({ id: "scene-1" })]);

    const view = await createTargetSpanResolutionQuery(built).resolveSpan({
      novelId: NOVEL,
      sceneId: "scene-1",
      span: { anchorId: "anchor-1", text: "第一段落", sourceContentHash: ANCHOR_HASH },
    });

    expect(view?.state).toBe("drifted");
    expect(view?.reason).toContain("content");
    expect(view && "span" in view).toBe(false);
  });

  it("classifies an anchor whose source hash disagrees with the descriptor as drifted", async () => {
    const built = await dependencies([anchoredSceneFixture({ id: "scene-1" })]);

    const view = await createTargetSpanResolutionQuery(built).resolveSpan({
      novelId: NOVEL,
      sceneId: "scene-1",
      span: {
        anchorId: "anchor-1",
        text: ANCHOR_TEXT,
        sourceContentHash: hashContent("别的文本"),
      },
    });

    expect(view?.state).toBe("drifted");
    expect(view?.reason).toContain("content");
  });

  it("classifies an anchor whose stored range no longer matches the scene as drifted", async () => {
    const base = anchoredSceneFixture({ id: "scene-1" });
    const moved: Scene = Object.freeze({ ...base, text: "改名了。第二段。" });
    const built = await dependencies([moved]);

    const view = await createTargetSpanResolutionQuery(built).resolveSpan({
      novelId: NOVEL,
      sceneId: "scene-1",
      span: matchingSpan(),
    });

    expect(view?.state).toBe("drifted");
    expect(view?.reason).toContain("position");
    expect(view && "span" in view).toBe(false);
  });

  it("[cross-system] rejects a forged but internally consistent span against the stored anchor", async () => {
    const built = await dependencies([anchoredSceneFixture({ id: "scene-1" })]);
    const forged: TargetSpan = {
      anchorId: "anchor-1",
      text: "伪造文本",
      sourceContentHash: hashContent("伪造文本"),
    };

    const view = await createTargetSpanResolutionQuery(built).resolveSpan({
      novelId: NOVEL,
      sceneId: "scene-1",
      span: forged,
    });

    expect(view?.state).toBe("drifted");
    expect(view && "span" in view).toBe(false);
  });

  it("classifies an anchor that is absent from the scene as missing", async () => {
    const built = await dependencies([anchoredSceneFixture({ id: "scene-1" })]);

    const view = await createTargetSpanResolutionQuery(built).resolveSpan({
      novelId: NOVEL,
      sceneId: "scene-1",
      span: { anchorId: "anchor-ghost", text: ANCHOR_TEXT, sourceContentHash: ANCHOR_HASH },
    });

    expect(view?.state).toBe("missing");
    expect(view?.reason).toContain("anchor");
    expect(view && "span" in view).toBe(false);
  });

  it("returns undefined for a scene that cannot be addressed, never a missing anchor", async () => {
    const built = await dependencies([anchoredSceneFixture({ id: "scene-1" })]);

    const query = createTargetSpanResolutionQuery(built);
    expect(await query.resolveSpan({ novelId: NOVEL, sceneId: "scene-ghost", span: matchingSpan() }))
      .toBeUndefined();
    expect(
      await query.resolveSpan({ novelId: OTHER_NOVEL, sceneId: "scene-1", span: matchingSpan() }),
    ).toBeUndefined();
  });

  it("[cross-system] surfaces an unforeseen resolver failure instead of absorbing it", async () => {
    const built = await dependencies([anchoredSceneFixture({ id: "scene-1" })]);
    const query = createTargetSpanResolutionQuery(built);

    resolverControl.throwOnResolve = true;
    try {
      await expect(
        query.resolveSpan({ novelId: NOVEL, sceneId: "scene-1", span: matchingSpan() }),
      ).rejects.toThrow("unforeseen target span resolver failure");
    } finally {
      resolverControl.throwOnResolve = false;
    }
  });
});
