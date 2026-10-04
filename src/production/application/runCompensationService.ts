import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";
import { targetAddressKey } from "../domain/change";
import type { ChangeSetRevision } from "../domain/changeSetRevision";
import type { NarrativeCommit } from "../../safety/domain/narrativeCommit";
import {
  commitChangeSetRevision,
  type CommitChangeSetRevisionInput,
  type CommitChangeSetRevisionTransaction,
} from "../../safety/application/commitChangeSetRevision";
import type { RunAuditProjection } from "./runAuditProjection";

export interface RunCompensationHistory {
  readonly narrativeCommits: readonly NarrativeCommit[];
  readonly changeSetRevisions: readonly ChangeSetRevision[];
}

export interface RunCompensationRequest {
  readonly sourceCommitId: string;
  readonly sourceChangeSetRevision: ChangeSetRevision;
  readonly reversible: boolean;
  readonly commit: Omit<CommitChangeSetRevisionInput, "commitId" | "now">;
}

export type RunCompensationBlocker =
  | "not_run_produced"
  | "not_committed"
  | "not_reversible"
  | "missing_source_revision"
  | "invalid_compensation_revision"
  | "later_commit_touches_same_target";

export interface RunCompensationEligibility {
  readonly eligible: boolean;
  readonly blockers: readonly RunCompensationBlocker[];
}

export interface RunCompensationRecord {
  readonly id: string;
  readonly runId: string;
  readonly sourceCommitId: string;
  readonly compensationCommitId: string;
  readonly status: "completed";
  readonly createdAt: Date;
}

export interface RunCompensationRecordPort {
  findById(id: string): Promise<RunCompensationRecord | undefined>;
  saveIfAbsent(record: RunCompensationRecord): Promise<void>;
}

export interface RunCompensationResult {
  readonly status: "compensated" | "replayed";
  readonly sourceCommitId: string;
  readonly compensationCommitId: string;
  readonly record: RunCompensationRecord;
}

function requiredText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

export function runCompensationIdempotencyKey(runId: string, sourceCommitId: string): string {
  return hashContent(canonicalJson({
    kind: "run-forward-compensation:v1",
    runId: requiredText(runId, "runId"),
    sourceCommitId: requiredText(sourceCommitId, "sourceCommitId"),
  }));
}

export function runCompensationCommitId(runId: string, sourceCommitId: string): string {
  return `compensate:${runCompensationIdempotencyKey(runId, sourceCommitId)}`;
}

function sameTargets(left: ChangeSetRevision, right: ChangeSetRevision): boolean {
  const leftTargets = [...new Set(left.changes.map(change => targetAddressKey(change.targetAddress)))].sort();
  const rightTargets = [...new Set(right.changes.map(change => targetAddressKey(change.targetAddress)))].sort();
  return (
    leftTargets.length > 0 &&
    leftTargets.length === rightTargets.length &&
    leftTargets.every((target, index) => target === rightTargets[index])
  );
}

export function evaluateRunCompensationEligibility(input: {
  readonly audit: RunAuditProjection;
  readonly history: RunCompensationHistory;
  readonly request: RunCompensationRequest;
}): RunCompensationEligibility {
  const blockers = new Set<RunCompensationBlocker>();
  const auditCommit = input.audit.commits.find(
    commit => commit.commitId === input.request.sourceCommitId,
  );
  if (
    !auditCommit ||
    auditCommit.candidateIds.length === 0 ||
    auditCommit.attemptIds.length === 0
  ) {
    blockers.add("not_run_produced");
  }
  const sourceCommit = input.history.narrativeCommits.find(
    commit => commit.id === input.request.sourceCommitId,
  );
  if (!sourceCommit || sourceCommit.status !== "committed") blockers.add("not_committed");
  if (!input.request.reversible) blockers.add("not_reversible");

  const sourceRevision = input.history.changeSetRevisions.find(
    revision => revision.revisionId === input.request.sourceChangeSetRevision.revisionId,
  );
  if (
    !sourceCommit ||
    !sourceRevision ||
    sourceRevision.revisionId !== sourceCommit.changeSetRevisionId ||
    sourceRevision.revisionId !== input.request.sourceChangeSetRevision.revisionId
  ) {
    blockers.add("missing_source_revision");
  }

  const compensationRevision = input.request.commit.changeSetRevision;
  const resultingVersionSet = sourceCommit?.resultingVersionSet;
  const compensationIsBound =
    sourceRevision !== undefined &&
    compensationRevision.parentRevisionId === sourceRevision.revisionId &&
    sameTargets(sourceRevision, compensationRevision) &&
    resultingVersionSet !== undefined &&
    canonicalJson(compensationRevision.changes.map(change => change.basedOnVersionSet)) ===
      canonicalJson(compensationRevision.changes.map(() => resultingVersionSet));
  if (!compensationIsBound) blockers.add("invalid_compensation_revision");

  const sourceIndex = input.history.narrativeCommits.findIndex(
    commit => commit.id === input.request.sourceCommitId,
  );
  if (sourceIndex >= 0 && sourceRevision) {
    const sourceTargets = new Set(
      sourceRevision.changes.map(change => targetAddressKey(change.targetAddress)),
    );
    for (const laterCommit of input.history.narrativeCommits.slice(sourceIndex + 1)) {
      const laterRevision = input.history.changeSetRevisions.find(
        revision => revision.revisionId === laterCommit.changeSetRevisionId,
      );
      if (
        laterRevision?.changes.some(change => sourceTargets.has(targetAddressKey(change.targetAddress)))
      ) {
        blockers.add("later_commit_touches_same_target");
        break;
      }
    }
  }

  return deepFreeze({
    eligible: blockers.size === 0,
    blockers: [...blockers].sort(),
  });
}

async function saveRecordIfAbsent(
  records: RunCompensationRecordPort,
  record: RunCompensationRecord,
): Promise<RunCompensationRecord> {
  try {
    await records.saveIfAbsent(record);
    return record;
  } catch {
    const existing = await records.findById(record.id);
    if (existing) return existing;
    throw new Error(`Run compensation record conflict: ${record.id}`);
  }
}

export async function compensateRunCommit(input: {
  readonly audit: RunAuditProjection;
  readonly history: RunCompensationHistory;
  readonly request: RunCompensationRequest;
  readonly transaction: CommitChangeSetRevisionTransaction;
  readonly records: RunCompensationRecordPort;
  readonly now: Date;
}): Promise<RunCompensationResult> {
  requiredText(input.audit.runId, "audit.runId");
  if (input.audit.runId === "" || input.request.sourceCommitId.trim() === "") {
    throw new Error("sourceCommitId is required");
  }
  const eligibility = evaluateRunCompensationEligibility(input);
  if (!eligibility.eligible) {
    throw new Error(`Run compensation is not eligible: ${eligibility.blockers.join(",")}`);
  }

  const id = runCompensationIdempotencyKey(input.audit.runId, input.request.sourceCommitId);
  const compensationCommitId = runCompensationCommitId(
    input.audit.runId,
    input.request.sourceCommitId,
  );

  return input.transaction.run(async work => {
    const existingRecord = await input.records.findById(id);
    if (existingRecord) {
      return deepFreeze({
        status: "replayed" as const,
        sourceCommitId: input.request.sourceCommitId,
        compensationCommitId: existingRecord.compensationCommitId,
        record: existingRecord,
      });
    }

    const existingCommit = await work.repositories.narrativeCommits.findById(compensationCommitId);
    if (existingCommit?.status === "committed") {
      const record = await saveRecordIfAbsent(input.records, {
        id,
        runId: input.audit.runId,
        sourceCommitId: input.request.sourceCommitId,
        compensationCommitId,
        status: "completed",
        createdAt: input.now,
      });
      return deepFreeze({
        status: "replayed" as const,
        sourceCommitId: input.request.sourceCommitId,
        compensationCommitId,
        record,
      });
    }

    let compensationCommit: NarrativeCommit;
    let status: "compensated" | "replayed";
    try {
      compensationCommit = await commitChangeSetRevision({
        transaction: input.transaction,
        input: {
          ...input.request.commit,
          commitId: compensationCommitId,
          now: input.now,
        },
      });
      status = "compensated";
    } catch (error) {
      const raced = await work.repositories.narrativeCommits.findById(compensationCommitId);
      if (raced?.status !== "committed") throw error;
      compensationCommit = raced;
      status = "replayed";
    }

    const record = await saveRecordIfAbsent(input.records, {
      id,
      runId: input.audit.runId,
      sourceCommitId: input.request.sourceCommitId,
      compensationCommitId: compensationCommit.id,
      status: "completed",
      createdAt: input.now,
    });
    return deepFreeze({
      status,
      sourceCommitId: input.request.sourceCommitId,
      compensationCommitId: compensationCommit.id,
      record,
    });
  });
}
