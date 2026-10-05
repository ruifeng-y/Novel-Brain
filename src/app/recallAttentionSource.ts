import type { DependencyImpactPersistence } from "../dependency/application/dependencyImpactPersistence";
import { createImpactObservationAdapter } from "../recall/observation/sourceAdapters";
import { createImpactObservationLoad } from "../recall/observation/domainSourceLoads";
import { runRecallPipeline } from "../recall/detection/recallPipeline";
import {
  projectRecallItems,
  type RecallItem,
} from "../recall/projection/recallItemProjection";
import { canonicalJson, hashContent } from "../shared/domain/contentHash";
import { deepFreeze } from "../shared/domain/immutable";

/**
 * A projected recall item bound to its Novel and to the evidence it was
 * derived from. The fingerprint is a derived projection value; it is not a
 * Domain field and it is never supplied by a client.
 */
export interface RecallAttentionItem extends RecallItem {
  readonly novelId: string;
  readonly evidenceFingerprint: string;
}

export interface RecallAttentionSourceDependencies {
  readonly impactPersistence: DependencyImpactPersistence;
  readonly sourceIdentity?: string;
}

export interface RecallAttentionSource {
  getAttentionItems(input: {
    readonly novelId: string;
  }): Promise<readonly RecallAttentionItem[]>;
}

function requiredText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  return trimmed;
}

/**
 * Deterministic evidence fingerprint: the sorted evidence source references
 * (identity, version, hash) hashed together. `applyAttentionAction` compares
 * this value to decide replay versus changed evidence, so it must be stable
 * for identical evidence and differ when evidence moves.
 */
function evidenceFingerprint(item: RecallItem): string {
  const references = item.evidence
    .map((evidence) => ({
      identity: evidence.sourceReference.identity,
      version: evidence.sourceReference.version,
      hash: evidence.sourceReference.hash,
    }))
    .sort(
      (left, right) =>
        (left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0) ||
        (left.version < right.version ? -1 : left.version > right.version ? 1 : 0) ||
        (left.hash < right.hash ? -1 : left.hash > right.hash ? 1 : 0),
    );
  return hashContent(canonicalJson(references));
}

/**
 * Read-only attention source. It observes persisted domain evidence through
 * the frozen recall pipeline and projects it; Recall never owns Narrative
 * Truth and this source never writes.
 */
export function createRecallAttentionSource(
  dependencies: RecallAttentionSourceDependencies,
): RecallAttentionSource {
  const sourceIdentity = dependencies.sourceIdentity ?? "dependency-impact";
  return deepFreeze({
    async getAttentionItems(input) {
      const novelId = requiredText(input.novelId, "novelId");
      const impactResults =
        await dependencies.impactPersistence.impactResults.listByNovel(novelId);
      const pipeline = await runRecallPipeline({
        sources: {
          impact: createImpactObservationAdapter(async () =>
            createImpactObservationLoad({ sourceIdentity, results: impactResults }),
          ),
        },
      });
      return deepFreeze(
        projectRecallItems({ candidates: pipeline.candidates }).map((item) =>
          deepFreeze({
            ...item,
            novelId,
            evidenceFingerprint: evidenceFingerprint(item),
          }),
        ),
      );
    },
  });
}
