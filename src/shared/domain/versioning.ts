import type { DomainId, RevisionId } from "./ids";

export type { DomainId, RevisionId } from "./ids";

export type AggregateType =
  | "Novel"
  | "Arc"
  | "Chapter"
  | "Scene"
  | "CanonicalFact"
  | "StateRecord"
  | "GenerationTask"
  | "Candidate"
  | "ValidationRun"
  | "ReviewDecision"
  | "NarrativeCommit";

export interface VersionReference {
  readonly aggregateType: AggregateType;
  readonly objectId: DomainId;
  readonly revisionId: RevisionId;
}

export type VersionSet = Readonly<Record<string, VersionReference>>;

export function createVersionReference(
  aggregateType: AggregateType,
  objectId: DomainId,
  revisionId: RevisionId,
): VersionReference {
  if (!objectId) throw new Error("objectId is required");
  if (!revisionId) throw new Error("revisionId is required");
  return Object.freeze({ aggregateType, objectId, revisionId });
}

export function createVersionSet(entries: Record<string, VersionReference>): VersionSet {
  return Object.freeze({ ...entries });
}

export function mergeVersionSets(left: VersionSet, right: VersionSet): VersionSet {
  return Object.freeze({ ...left, ...right });
}

export function assertCovers(versionSet: VersionSet, dependencyNames: readonly string[]): void {
  for (const dependencyName of dependencyNames) {
    if (!versionSet[dependencyName]) {
      throw new Error(`Version set is missing dependency: ${dependencyName}`);
    }
  }
}
