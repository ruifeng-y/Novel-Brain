import type { DomainId, RevisionId } from "../../shared/domain/ids";

export { resolveTargetSpan, replaceTargetSpan } from "./targetSpan";
export type { ResolvedSpan, TargetSpan } from "./targetSpan";

export interface Scene {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly chapterId: DomainId;
  readonly title: string;
  readonly text: string;
  readonly spanAnchors: Readonly<Record<string, string>>;
  readonly currentRevisionId: RevisionId;
  readonly lastCommitId: DomainId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SceneRevision {
  readonly sceneId: DomainId;
  readonly revisionId: RevisionId;
  readonly text: string;
  readonly spanAnchors: Readonly<Record<string, string>>;
  readonly commitId: DomainId;
}

export function toSceneRevision(scene: Scene): SceneRevision {
  return Object.freeze({
    sceneId: scene.id,
    revisionId: scene.currentRevisionId,
    text: scene.text,
    spanAnchors: scene.spanAnchors,
    commitId: scene.lastCommitId,
  });
}

function assertSpanAnchors(
  text: string,
  spanAnchors: Readonly<Record<string, string>>,
): void {
  for (const [anchorId, anchoredText] of Object.entries(spanAnchors)) {
    if (!anchorId.trim()) throw new Error("spanAnchors keys must not be empty");
    if (!anchoredText) throw new Error(`Target span anchor text is empty: ${anchorId}`);
    const start = text.indexOf(anchoredText);
    if (start < 0) {
      throw new Error(`Target span anchor text is not present in scene: ${anchorId}`);
    }
    if (text.indexOf(anchoredText, start + 1) >= 0) {
      throw new Error(`Target span anchor text is ambiguous: ${anchorId}`);
    }
  }
}

export function createScene(input: {
  id: DomainId;
  novelId: DomainId;
  chapterId: DomainId;
  title: string;
  revisionId: RevisionId;
  commitId: DomainId;
  createdAt: Date;
}): Scene {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.chapterId) throw new Error("chapterId is required");
  if (!input.title.trim()) throw new Error("title is required");
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.commitId) throw new Error("commitId is required");
  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    chapterId: input.chapterId,
    title: input.title.trim(),
    text: "",
    spanAnchors: Object.freeze({}),
    currentRevisionId: input.revisionId,
    lastCommitId: input.commitId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function commitSceneText(input: {
  scene: Scene;
  text: string;
  spanAnchors?: Readonly<Record<string, string>>;
  revisionId: RevisionId;
  commitId: DomainId;
  updatedAt: Date;
}): Scene {
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.commitId) throw new Error("commitId is required");
  if (input.updatedAt < input.scene.updatedAt) throw new Error("updatedAt cannot move backward");
  const spanAnchors = input.spanAnchors ?? {};
  assertSpanAnchors(input.text, spanAnchors);
  return Object.freeze({
    ...input.scene,
    text: input.text,
    spanAnchors: Object.freeze({ ...spanAnchors }),
    currentRevisionId: input.revisionId,
    lastCommitId: input.commitId,
    updatedAt: input.updatedAt,
  });
}
