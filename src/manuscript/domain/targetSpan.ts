import { hashContent } from "../../shared/domain/contentHash";
import type { Scene, SceneSpanAnchor, SceneSpanAnchorInput } from "./scene";

export interface TargetSpan {
  readonly anchorId: string;
  readonly text: string;
  readonly sourceContentHash: string;
}

export interface ResolvedSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export function resolveTargetSpan(scene: Scene, span: TargetSpan): ResolvedSpan {
  const anchor: SceneSpanAnchor | undefined = scene.spanAnchors[span.anchorId];
  if (!anchor) {
    throw new Error(`Target span anchor not found: ${span.anchorId}`);
  }
  if (anchor.revisionId !== scene.currentRevisionId) {
    throw new Error(`Target span anchor revision does not match scene revision: ${span.anchorId}`);
  }
  if (anchor.text !== span.text) {
    throw new Error(`Target span text does not match anchor: ${span.anchorId}`);
  }
  if (anchor.sourceContentHash !== span.sourceContentHash || hashContent(anchor.text) !== span.sourceContentHash) {
    throw new Error("Target span source hash does not match scene text");
  }
  if (scene.text.slice(anchor.start, anchor.end) !== anchor.text) {
    throw new Error(`Target span anchor text does not match scene text: ${span.anchorId}`);
  }
  return Object.freeze({ start: anchor.start, end: anchor.end, text: anchor.text });
}

export function replaceTargetSpan(input: {
  scene: Scene;
  target: TargetSpan;
  replacement: string;
}): string {
  const resolved = resolveTargetSpan(input.scene, input.target);
  return `${input.scene.text.slice(0, resolved.start)}${input.replacement}${input.scene.text.slice(resolved.end)}`;
}

export function rebaseSpanAnchors(
  scene: Scene,
  target: TargetSpan,
  replacement: string,
): Readonly<Record<string, SceneSpanAnchorInput>> {
  const targetAnchor = scene.spanAnchors[target.anchorId];
  if (!targetAnchor) throw new Error(`Target span anchor not found: ${target.anchorId}`);
  const delta = replacement.length - target.text.length;
  const rebased: Record<string, SceneSpanAnchorInput> = {};
  for (const [anchorId, anchor] of Object.entries(scene.spanAnchors)) {
    const isTarget = anchorId === target.anchorId;
    const shift = !isTarget && anchor.start >= targetAnchor.end ? delta : 0;
    const start = isTarget ? anchor.start : anchor.start + shift;
    const end = isTarget ? start + replacement.length : anchor.end + shift;
    const text = isTarget ? replacement : anchor.text;
    rebased[anchorId] = {
      anchorId,
      start,
      end,
      text,
      sourceContentHash: hashContent(text),
    };
  }
  return Object.freeze(rebased);
}
