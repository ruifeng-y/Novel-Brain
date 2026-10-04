import { deepFreeze } from "../../shared/domain/immutable";
import type { RecallCandidateSignal } from "../detection/recallPipeline";
import {
  assertRecallProposedAction,
  type RecallProposedAction,
} from "../run/runAwareRecall";

export interface RecallItemExplanation {
  readonly reason: string;
  readonly evidenceReferences: readonly string[];
}

export interface RecallItemEvidence {
  readonly sourceKind: string;
  readonly evidenceReference: string;
  readonly sourceReference: {
    readonly identity: string;
    readonly version: string;
    readonly hash: string;
  };
  readonly staleness: string;
}

export interface RecallItem {
  readonly itemId: string;
  readonly candidateId: string;
  readonly detectionKind: string;
  readonly classification: string;
  readonly priority: string;
  readonly explanation: RecallItemExplanation;
  readonly evidence: readonly RecallItemEvidence[];
  readonly proposedAction?: RecallProposedAction;
}

export interface RecallItemProjectionInput {
  readonly candidates: readonly RecallCandidateSignal[];
  readonly proposedActions?: Readonly<Record<string, unknown>>;
}

export interface RecallItemQuery {
  readonly classifications?: readonly string[];
  readonly priorities?: readonly string[];
  readonly evidenceReferences?: readonly string[];
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("RecallItem requires non-empty explanation and evidence");
  }
  return value.trim();
}

function normalizeEvidence(candidate: RecallCandidateSignal): readonly RecallItemEvidence[] {
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) {
    throw new Error("RecallItem requires non-empty explanation and evidence");
  }
  return candidate.evidence.map((entry) => {
    const sourceReference = entry.sourceReference;
    if (
      sourceReference === null ||
      typeof sourceReference !== "object"
    ) {
      throw new Error("RecallItem requires non-empty explanation and evidence");
    }
    return {
      sourceKind: requiredText(entry.sourceKind, "evidence.sourceKind"),
      evidenceReference: requiredText(entry.evidenceReference, "evidence.evidenceReference"),
      sourceReference: {
        identity: requiredText(sourceReference.identity, "evidence.sourceReference.identity"),
        version: requiredText(sourceReference.version, "evidence.sourceReference.version"),
        hash: requiredText(sourceReference.hash, "evidence.sourceReference.hash"),
      },
      staleness: requiredText(entry.staleness, "evidence.staleness"),
    };
  });
}

function projectItem(
  candidate: RecallCandidateSignal,
  proposedAction: unknown,
): RecallItem {
  const reason = requiredText(candidate.reason, "explanation.reason");
  const evidence = normalizeEvidence(candidate);
  return deepFreeze({
    itemId: candidate.candidateId,
    candidateId: candidate.candidateId,
    detectionKind: candidate.detectionKind,
    classification: candidate.classification,
    priority: candidate.priority,
    explanation: deepFreeze({
      reason,
      evidenceReferences: evidence.map((entry) => entry.evidenceReference),
    }),
    evidence,
    ...(proposedAction === undefined
      ? {}
      : { proposedAction: assertRecallProposedAction(proposedAction) }),
  });
}

export function projectRecallItems(
  input: RecallItemProjectionInput,
): readonly RecallItem[] {
  return deepFreeze(
    input.candidates.map((candidate) =>
      projectItem(candidate, input.proposedActions?.[candidate.candidateId]),
    ),
  );
}

function includes<T>(allowed: readonly T[] | undefined, value: T): boolean {
  return allowed === undefined || allowed.length === 0 || allowed.includes(value);
}

export function queryRecallItems(
  items: readonly RecallItem[],
  query: RecallItemQuery,
): readonly RecallItem[] {
  return deepFreeze(
    items.filter(
      (item) =>
        includes(query.classifications, item.classification) &&
        includes(query.priorities, item.priority) &&
        (query.evidenceReferences === undefined ||
          query.evidenceReferences.length === 0 ||
          item.evidence.some((evidence) =>
            query.evidenceReferences?.includes(evidence.evidenceReference),
          )),
    ),
  );
}
