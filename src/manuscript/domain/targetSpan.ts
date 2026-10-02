import { hashContent } from "../../shared/domain/contentHash";
import type { Scene } from "./scene";

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
  const anchoredText = scene.spanAnchors[span.anchorId];
  if (anchoredText === undefined) {
    throw new Error(`Target span anchor not found: ${span.anchorId}`);
  }
  if (anchoredText !== span.text) {
    throw new Error(`Target span text does not match anchor: ${span.anchorId}`);
  }
  if (hashContent(anchoredText) !== span.sourceContentHash) {
    throw new Error("Target span source hash does not match scene text");
  }

  const start = scene.text.indexOf(anchoredText);
  if (start < 0) throw new Error(`Target span is not present in scene: ${span.anchorId}`);
  return Object.freeze({ start, end: start + anchoredText.length, text: anchoredText });
}

export function replaceTargetSpan(input: {
  scene: Scene;
  target: TargetSpan;
  replacement: string;
}): string {
  const resolved = resolveTargetSpan(input.scene, input.target);
  return `${input.scene.text.slice(0, resolved.start)}${input.replacement}${input.scene.text.slice(resolved.end)}`;
}
