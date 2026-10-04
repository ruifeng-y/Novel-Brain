import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import {
  assessDependencyFactStaleness,
  type DependencyRegistryView,
  type DependencyRelationFact,
  type DependencyStalenessStatus,
} from "../../dependency/domain/dependencyRegistry";
import type { ImpactAnalysisResult } from "../../dependency/domain/impactAnalysis";
import {
  isMemoryProjectionStale,
  type MemoryProjection,
} from "../../memory/projections/memoryProjection";
import type { StateRecord } from "../../narrative/state/domain/stateRecord";
import type {
  RunAuditProjection,
  RunFailureAuditRecord,
} from "../../production/application/runAuditProjection";
import type { ValidationRun } from "../../production/domain/validationRun";
import type { ReviewDecision } from "../../production/domain/reviewDecision";
import type { NarrativeCommit } from "../../safety/domain/narrativeCommit";
import type { VersionSet } from "../../shared/domain/versioning";
import type {
  RecallObservationLoad,
  RecallObservationRecord,
  RecallObservationStaleness,
} from "./sourceAdapters";

function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, withoutUndefined(entry)]),
    );
  }
  return value;
}

function evidenceHash(value: unknown): string {
  return hashContent(canonicalJson(withoutUndefined(value)));
}
function requireText(value: string, field: string): string {
  if (!value.trim()) throw new Error(`${field} is required`);
  return value;
}

function domainRecord<T>(input: {
  readonly evidenceReference: string;
  readonly sourceVersion: string;
  readonly sourceHash: string;
  readonly ordinal: number;
  readonly staleness: RecallObservationStaleness;
  readonly value: T;
}): RecallObservationRecord<T> {
  const evidenceReference = requireText(input.evidenceReference, "evidenceReference");
  return {
    evidenceReference,
    sourceReference: {
      identity: evidenceReference,
      version: requireText(input.sourceVersion, "sourceVersion"),
      hash: requireText(input.sourceHash, "sourceHash"),
    },
    ordinal: input.ordinal,
    staleness: input.staleness,
    value: input.value,
  };
}

function sourceVersion(prefix: string, revisions: readonly string[]): string {
  return revisions.length === 0 ? `${prefix}:empty` : [...new Set(revisions)].sort().join("|");
}

function recallStaleness(status: DependencyStalenessStatus): RecallObservationStaleness {
  return status;
}

export function createNarrativeObservationLoad(input: {
  readonly sourceIdentity: string;
  readonly records: readonly StateRecord[];
}): RecallObservationLoad<StateRecord> {
  const records = [...input.records].sort((left, right) => left.id.localeCompare(right.id));
  return {
    sourceIdentity: requireText(input.sourceIdentity, "sourceIdentity"),
    sourceVersion: sourceVersion("narrative", records.map((record) => record.currentRevisionId)),
    records: records.map((record, index) =>
      domainRecord({
        evidenceReference: `StateRecord:${record.id}`,
        sourceVersion: record.currentRevisionId,
        sourceHash: hashContent(canonicalJson(record)),
        ordinal: index + 1,
        staleness: "fresh",
        value: record,
      }),
    ),
  };
}

export function createDependencyObservationLoad(input: {
  readonly sourceIdentity: string;
  readonly view: DependencyRegistryView;
  readonly currentVersionSet: VersionSet;
}): RecallObservationLoad<DependencyRelationFact> {
  const byId = new Map<string, DependencyRelationFact>();
  for (const fact of [...input.view.outgoing, ...input.view.incoming]) {
    byId.set(fact.id, fact);
  }
  const facts = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  return {
    sourceIdentity: requireText(input.sourceIdentity, "sourceIdentity"),
    sourceVersion: sourceVersion(
      "dependency",
      facts.map((fact) => fact.revisionProvenance.changeSet.identity.revisionId),
    ),
    records: facts.map((fact, index) =>
      domainRecord({
        evidenceReference: `DependencyRelation:${fact.id}`,
        sourceVersion: fact.revisionProvenance.changeSet.identity.revisionId,
        sourceHash: hashContent(canonicalJson(fact)),
        ordinal: index + 1,
        staleness: recallStaleness(
          assessDependencyFactStaleness(fact, input.currentVersionSet),
        ),
        value: fact,
      }),
    ),
  };
}

export function createImpactObservationLoad(input: {
  readonly sourceIdentity: string;
  readonly results: readonly ImpactAnalysisResult[];
}): RecallObservationLoad<ImpactAnalysisResult> {
  const results = [...input.results].sort((left, right) => left.id.localeCompare(right.id));
  return {
    sourceIdentity: requireText(input.sourceIdentity, "sourceIdentity"),
    sourceVersion: sourceVersion(
      "impact",
      results.map((result) => result.readSet.version),
    ),
    records: results.map((result, index) =>
      domainRecord({
        evidenceReference: `ImpactAnalysis:${result.id}`,
        sourceVersion: result.readSet.version,
        sourceHash: result.contentHash,
        ordinal: index + 1,
        staleness:
          result.staleness === "missing"
            ? "missing"
            : result.staleness === "stale" || result.evidenceIntegrityStatus === "degraded"
              ? "stale"
              : "fresh",
        value: result,
      }),
    ),
  };
}

export function createValidationObservationLoad(input: {
  readonly sourceIdentity: string;
  readonly runs: readonly ValidationRun[];
}): RecallObservationLoad<ValidationRun> {
  const runs = [...input.runs].sort((left, right) => left.id.localeCompare(right.id));
  return {
    sourceIdentity: requireText(input.sourceIdentity, "sourceIdentity"),
    sourceVersion: sourceVersion(
      "validation",
      runs.map((run) => run.changeSetRevisionId),
    ),
    records: runs.map((run, index) =>
      domainRecord({
        evidenceReference: `ValidationRun:${run.id}`,
        sourceVersion: run.changeSetRevisionId,
        sourceHash: hashContent(canonicalJson(run)),
        ordinal: index + 1,
        staleness: "fresh",
        value: run,
      }),
    ),
  };
}

export function createMemoryObservationLoad(input: {
  readonly sourceIdentity: string;
  readonly projection: MemoryProjection;
  readonly versionSet: VersionSet;
}): RecallObservationLoad<MemoryProjection> {
  const novelId = requireText(input.projection.novelId, "projection.novelId");
  const version = `memory:${hashContent(canonicalJson(input.projection.sourceRevisionSet))}`;
  return {
    sourceIdentity: requireText(input.sourceIdentity, "sourceIdentity"),
    sourceVersion: version,
    records: [
      domainRecord({
        evidenceReference: `MemoryProjection:${novelId}`,
        sourceVersion: version,
        sourceHash: hashContent(canonicalJson(input.projection)),
        ordinal: 1,
        staleness: isMemoryProjectionStale(input.projection, input.versionSet)
          ? "stale"
          : "fresh",
        value: input.projection,
      }),
    ],
  };
}

function runFailureRecord(
  failure: RunFailureAuditRecord,
  ordinal: number,
  sourceVersionValue: string,
): RecallObservationRecord<RunFailureAuditRecord> {
  return domainRecord({
    evidenceReference: `RunFailure:${failure.sourceKind}:${failure.sourceId}`,
    sourceVersion: sourceVersionValue,
    sourceHash: hashContent(canonicalJson(failure)),
    ordinal,
    staleness: "fresh",
    value: failure,
  });
}

export function createRunSignalsObservationLoad(input: {
  readonly sourceIdentity: string;
  readonly projection: RunAuditProjection;
}): RecallObservationLoad<RunFailureAuditRecord | Pick<RunAuditProjection, "runId" | "run">> {
  const sourceVersionValue = requireText(input.projection.hash, "projection.hash");
  const failures = [...input.projection.failures].sort(
    (left, right) =>
      left.sourceKind.localeCompare(right.sourceKind) || left.sourceId.localeCompare(right.sourceId),
  );
  const records =
    failures.length > 0
      ? failures.map((failure, index) => runFailureRecord(failure, index + 1, sourceVersionValue))
      : [
          domainRecord({
            evidenceReference: `RunSignal:${input.projection.runId}`,
            sourceVersion: sourceVersionValue,
            sourceHash: hashContent(
              canonicalJson({
                runId: input.projection.runId,
                status: input.projection.run.status,
              }),
            ),
            ordinal: 1,
            staleness: "fresh",
            value: {
              runId: input.projection.runId,
              run: input.projection.run,
            },
          }),
        ];
  return {
    sourceIdentity: requireText(input.sourceIdentity, "sourceIdentity"),
    sourceVersion: sourceVersionValue,
    records,
  };
}

export function createReviewDecisionObservationLoad(input: {
  readonly sourceIdentity: string;
  readonly decisions: readonly ReviewDecision[];
}): RecallObservationLoad<ReviewDecision> {
  const decisions = [...input.decisions].sort((left, right) => left.id.localeCompare(right.id));
  return {
    sourceIdentity: requireText(input.sourceIdentity, "sourceIdentity"),
    sourceVersion: sourceVersion(
      "review",
      decisions.map((decision) => decision.changeSetRevisionId),
    ),
    records: decisions.map((decision, index) =>
      domainRecord({
        evidenceReference: `ReviewDecision:${decision.id}`,
        sourceVersion: decision.changeSetRevisionId,
        sourceHash: evidenceHash(decision),
        ordinal: index + 1,
        staleness: "fresh",
        value: withoutUndefined(decision) as ReviewDecision,
      }),
    ),
  };
}

export function createNarrativeCommitObservationLoad(input: {
  readonly sourceIdentity: string;
  readonly commits: readonly NarrativeCommit[];
}): RecallObservationLoad<NarrativeCommit> {
  const commits = [...input.commits].sort((left, right) => left.id.localeCompare(right.id));
  return {
    sourceIdentity: requireText(input.sourceIdentity, "sourceIdentity"),
    sourceVersion: sourceVersion(
      "commit",
      commits.map((commit) => commit.changeSetRevisionId),
    ),
    records: commits.map((commit, index) =>
      domainRecord({
        evidenceReference: `NarrativeCommit:${commit.id}`,
        sourceVersion: commit.changeSetRevisionId,
        sourceHash: evidenceHash(commit),
        ordinal: index + 1,
        staleness: "fresh",
        value: withoutUndefined(commit) as NarrativeCommit,
      }),
    ),
  };
}
