import type { RevisionedRepository } from "../shared/application/repository";
import { hashContent } from "../shared/domain/contentHash";
import type { Scene } from "../manuscript/domain/scene";
import { resolveTargetSpan, type TargetSpan } from "../manuscript/domain/targetSpan";

export type SpanResolutionState = "resolvable" | "drifted" | "missing";

export interface SpanResolutionView {
  readonly state: SpanResolutionState;
  readonly reason: string;
  readonly span?: { readonly start: number; readonly end: number; readonly text: string };
}

export interface TargetSpanResolutionQueryDependencies {
  readonly scenes: RevisionedRepository<Scene>;
}

/**
 * Resolves a target span descriptor against a scene's current revision.
 *
 * The classification is decided by inspecting the scene data, never by
 * parsing the frozen resolver's error messages. A scene that cannot be
 * addressed resolves to `undefined` so the route can answer it exactly like
 * the scene read route; `missing` means only "this scene has no such anchor".
 */
export function createTargetSpanResolutionQuery(
  dependencies: TargetSpanResolutionQueryDependencies,
): {
  resolveSpan(input: {
    readonly novelId: string;
    readonly sceneId: string;
    readonly span: TargetSpan;
  }): Promise<SpanResolutionView | undefined>;
} {
  return {
    async resolveSpan(input: {
      readonly novelId: string;
      readonly sceneId: string;
      readonly span: TargetSpan;
    }): Promise<SpanResolutionView | undefined> {
      const scene = await dependencies.scenes.findById(input.sceneId);
      if (!scene || scene.novelId !== input.novelId) return undefined;

      const anchor = scene.spanAnchors[input.span.anchorId];
      if (!anchor) {
        return Object.freeze({
          state: "missing",
          reason: `anchor not found: ${input.span.anchorId}`,
        });
      }
      if (anchor.revisionId !== scene.currentRevisionId) {
        return Object.freeze({ state: "drifted", reason: "anchor revision moved" });
      }
      if (
        anchor.text !== input.span.text ||
        anchor.sourceContentHash !== input.span.sourceContentHash ||
        hashContent(anchor.text) !== input.span.sourceContentHash
      ) {
        return Object.freeze({ state: "drifted", reason: "anchor content moved" });
      }
      if (scene.text.slice(anchor.start, anchor.end) !== anchor.text) {
        return Object.freeze({ state: "drifted", reason: "anchor position moved" });
      }

      // Every branch the frozen resolver rejects on is mirrored above. If it
      // still throws the case is unforeseen, so it must surface as a failure
      // rather than be absorbed into drifted or missing.
      const resolved = resolveTargetSpan(scene, input.span);
      return Object.freeze({
        state: "resolvable",
        reason: "",
        span: Object.freeze({ start: resolved.start, end: resolved.end, text: resolved.text }),
      });
    },
  };
}
