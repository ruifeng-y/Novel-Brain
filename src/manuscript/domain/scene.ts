import type { DomainId, RevisionId } from "../../shared/domain/ids";
import { hashContent } from "../../shared/domain/contentHash";

export { resolveTargetSpan, replaceTargetSpan } from "./targetSpan";
export type { ResolvedSpan, TargetSpan } from "./targetSpan";

export interface SceneSpanAnchor {
  readonly anchorId: string;
  readonly revisionId: RevisionId;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly sourceContentHash: string;
}

export interface SceneSpanAnchorInput {
  readonly anchorId: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly sourceContentHash: string;
}

export interface Scene {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly chapterId: DomainId;
  readonly title: string;
  readonly text: string;
  readonly spanAnchors: Readonly<Record<string, SceneSpanAnchor>>;
  readonly currentRevisionId: RevisionId;
  readonly lastCommitId: DomainId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SceneRevision {
  readonly sceneId: DomainId;
  readonly revisionId: RevisionId;
  readonly text: string;
  readonly spanAnchors: Readonly<Record<string, SceneSpanAnchor>>;
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
  revisionId: RevisionId,
  spanAnchors: Readonly<Record<string, SceneSpanAnchorInput>>,
): Readonly<Record<string, SceneSpanAnchor>> {
  const normalized: Record<string, SceneSpanAnchor> = {};
  for (const [key, input] of Object.entries(spanAnchors)) {
    if (!key.trim()) throw new Error("spanAnchors keys must not be empty");
    if (input.anchorId !== key) throw new Error(`Target span anchor id mismatch: ${key}`);
    if (!Number.isInteger(input.start) || !Number.isInteger(input.end) || input.start < 0 || input.end <= input.start || input.end > text.length) {
      throw new Error(`Target span anchor range is invalid: ${key}`);
    }
    const actualText = text.slice(input.start, input.end);
    if (actualText !== input.text) {
      throw new Error(`Target span anchor text does not match scene text: ${key}`);
    }
    if (hashContent(actualText) !== input.sourceContentHash) {
      throw new Error(`Target span source hash does not match scene text: ${key}`);
    }
    normalized[key] = Object.freeze({
      anchorId: key,
      revisionId,
      start: input.start,
      end: input.end,
      text: input.text,
      sourceContentHash: input.sourceContentHash,
    });
  }
  return Object.freeze(normalized);
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
  spanAnchors?: Readonly<Record<string, SceneSpanAnchorInput>>;
  revisionId: RevisionId;
  commitId: DomainId;
  updatedAt: Date;
}): Scene {
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.commitId) throw new Error("commitId is required");
  if (input.updatedAt < input.scene.updatedAt) throw new Error("updatedAt cannot move backward");
  const spanAnchors = input.spanAnchors ?? {};
  const normalizedAnchors = assertSpanAnchors(input.text, input.revisionId, spanAnchors);
  return Object.freeze({
    ...input.scene,
    text: input.text,
    spanAnchors: normalizedAnchors,
    currentRevisionId: input.revisionId,
    lastCommitId: input.commitId,
    updatedAt: input.updatedAt,
  });
}
