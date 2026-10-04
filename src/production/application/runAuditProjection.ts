import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";
import type { Candidate } from "../domain/candidate";
import { targetAddressKey, type ChangeSourceType } from "../domain/change";
import type { ChangeSetRevision } from "../domain/changeSetRevision";
import type { ExecutionAttempt } from "../domain/executionAttempt";
import type { GenerationTask } from "../domain/generationTask";
import type { ProductionRun } from "../domain/productionRun";
import type { RunCheckpoint } from "../domain/runCheckpoint";
import type { ReviewDecision } from "../domain/reviewDecision";
import type { ValidationRun } from "../domain/validationRun";
import type { NarrativeCommit } from "../../safety/domain/narrativeCommit";
import type { BudgetThresholdActionDecision } from "../domain/runBudgetPolicy";

export interface RunCostRecord {
  readonly id: string;
  readonly runId: string;
  readonly scope: "run" | "task" | "attempt";
  readonly subjectId: string;
  readonly amount: number;
  readonly currency: string;
  readonly occurredAt: Date;
}

export interface RunAuditInput {
  readonly run: ProductionRun;
  readonly generationTasks: readonly GenerationTask[];
  readonly attempts: readonly ExecutionAttempt[];
  readonly candidates: readonly Candidate[];
  readonly changeSetRevisions: readonly ChangeSetRevision[];
  readonly validationRuns: readonly ValidationRun[];
  readonly reviewDecisions: readonly ReviewDecision[];
  readonly narrativeCommits: readonly NarrativeCommit[];
  readonly thresholdDecisions: readonly BudgetThresholdActionDecision[];
  readonly checkpoints: readonly RunCheckpoint[];
  readonly costs: readonly RunCostRecord[];
}

export type RunAuditEventKind =
  | "run"
  | "task"
  | "attempt"
  | "candidate"
  | "change_set_revision"
  | "validation"
  | "review_decision"
  | "narrative_commit"
  | "budget_threshold"
  | "checkpoint"
  | "cost";

export interface RunAuditEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly kind: RunAuditEventKind;
  readonly runId: string;
  readonly novelId: string;
  readonly subjectId: string;
  readonly occurredAt: Date;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface RunAttemptAuditRecord {
  readonly attemptId: string;
  readonly generationTaskId: string;
  readonly stepId: string;
  readonly relation: ExecutionAttempt["relation"];
  readonly status: ExecutionAttempt["status"];
  readonly candidateIds: readonly string[];
  readonly costIds: readonly string[];
  readonly failure?: ExecutionAttempt["failureEvidence"];
}

export interface RunAttemptChainAuditRecord {
  readonly executionKey: string;
  readonly generationTaskId: string;
  readonly attemptIds: readonly string[];
  readonly relations: readonly ExecutionAttempt["relation"][];
  readonly routingDecisionIds: readonly string[];
  readonly predecessorAttemptIds: readonly (string | null)[];
}

export type RunDecisionAuditRecord =
  | { readonly kind: "review"; readonly decision: ReviewDecision }
  | { readonly kind: "checkpoint"; readonly checkpoint: RunCheckpoint }
  | { readonly kind: "budget_threshold"; readonly decision: BudgetThresholdActionDecision };

export interface RunCommitAuditRecord {
  readonly commitId: string;
  readonly changeSetRevisionId: string;
  readonly status: NarrativeCommit["status"];
  readonly candidateIds: readonly string[];
  readonly attemptIds: readonly string[];
  readonly taskIds: readonly string[];
  readonly sourceTypes: readonly ChangeSourceType[];
  readonly targets: readonly string[];
}

export type RunFailureAuditSourceKind = "attempt" | "commit";

export interface RunFailureAuditRecord {
  readonly sourceKind: RunFailureAuditSourceKind;
  readonly sourceId: string;
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly occurredAt: Date;
}

export interface RunAuditProjection {
  readonly schemaVersion: "run-audit:v1";
  readonly runId: string;
  readonly novelId: string;
  readonly run: ProductionRun;
  readonly tasks: readonly GenerationTask[];
  readonly attempts: readonly RunAttemptAuditRecord[];
  readonly attemptChains: readonly RunAttemptChainAuditRecord[];
  readonly candidates: readonly Candidate[];
  readonly changeSetRevisions: readonly ChangeSetRevision[];
  readonly validationRuns: readonly ValidationRun[];
  readonly decisions: readonly RunDecisionAuditRecord[];
  readonly commits: readonly RunCommitAuditRecord[];
  readonly costs: readonly RunCostRecord[];
  readonly failures: readonly RunFailureAuditRecord[];
  readonly events: readonly RunAuditEvent[];
  readonly hash: string;
}

const eventKindOrder: Readonly<Record<RunAuditEventKind, number>> = {
  run: 1,
  task: 2,
  attempt: 3,
  candidate: 4,
  change_set_revision: 5,
  validation: 6,
  review_decision: 7,
  narrative_commit: 8,
  budget_threshold: 9,
  checkpoint: 10,
  cost: 11,
};

function requiredText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function uniqueById<T extends { readonly id: string }>(items: readonly T[], name: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const id = requiredText(item.id, `${name}.id`);
    if (seen.has(id)) throw new Error(`duplicate ${name} id: ${id}`);
    seen.add(id);
  }
}

function auditHash(value: unknown): string {
  return hashContent(canonicalJson(JSON.parse(JSON.stringify(value))));
}

function eventId(kind: RunAuditEventKind, subjectId: string): string {
  return `run-audit:${kind}:${subjectId}`;
}

function event(
  kind: RunAuditEventKind,
  run: ProductionRun,
  subjectId: string,
  occurredAt: Date,
  payload: Readonly<Record<string, unknown>>,
): RunAuditEvent {
  return {
    eventId: eventId(kind, subjectId),
    sequence: 0,
    kind,
    runId: run.id,
    novelId: run.novelId,
    subjectId,
    occurredAt: new Date(occurredAt.getTime()),
    payload,
  };
}

function timestampDate(value: Date | { readonly epochMilliseconds: number }): Date {
  return new Date(value instanceof Date ? value.getTime() : value.epochMilliseconds);
}

function eventComparator(left: RunAuditEvent, right: RunAuditEvent): number {
  const byKind = eventKindOrder[left.kind] - eventKindOrder[right.kind];
  if (byKind !== 0) return byKind;
  const bySubject = left.subjectId.localeCompare(right.subjectId);
  return bySubject !== 0 ? bySubject : left.eventId.localeCompare(right.eventId);
}

function normalizeEvent(input: RunAuditEvent, sequence: number): RunAuditEvent {
  requiredText(input.eventId, "event.eventId");
  requiredText(input.runId, "event.runId");
  requiredText(input.novelId, "event.novelId");
  requiredText(input.subjectId, "event.subjectId");
  if (!(input.kind in eventKindOrder)) throw new Error("event.kind is invalid");
  if (Number.isNaN(input.occurredAt.getTime())) throw new Error("event.occurredAt must be valid");
  return deepFreeze({
    eventId: input.eventId,
    sequence,
    kind: input.kind,
    runId: input.runId,
    novelId: input.novelId,
    subjectId: input.subjectId,
    occurredAt: new Date(input.occurredAt.getTime()),
    payload: deepFreeze({ ...input.payload }),
  });
}

export function replayRunAuditEvents(events: readonly RunAuditEvent[]): {
  readonly events: readonly RunAuditEvent[];
  readonly hash: string;
} {
  const byId = new Map<string, RunAuditEvent>();
  for (const candidate of events) {
    const existing = byId.get(candidate.eventId);
    if (existing && canonicalJson(JSON.parse(JSON.stringify(existing))) !== canonicalJson(JSON.parse(JSON.stringify({ ...candidate, sequence: existing.sequence })))) {
      throw new Error(`conflicting run audit event: ${candidate.eventId}`);
    }
    if (!existing) byId.set(candidate.eventId, candidate);
  }
  const replayed = [...byId.values()]
    .sort(eventComparator)
    .map((candidate, index) => normalizeEvent(candidate, index + 1));
  return deepFreeze({
    events: replayed,
    hash: auditHash(replayed),
  });
}

export function buildRunAuditEvents(input: RunAuditInput): readonly RunAuditEvent[] {
  const runId = requiredText(input.run.id, "run.id");
  const novelId = requiredText(input.run.novelId, "run.novelId");
  if (input.run.novelId !== novelId) throw new Error("run novelId is invalid");
  uniqueById(input.generationTasks, "generationTask");
  uniqueById(input.attempts, "attempt");
  uniqueById(input.candidates, "candidate");
  uniqueById(input.validationRuns, "validationRun");
  uniqueById(input.reviewDecisions, "reviewDecision");
  uniqueById(input.narrativeCommits, "narrativeCommit");
  uniqueById(input.thresholdDecisions, "thresholdDecision");
  uniqueById(input.checkpoints, "checkpoint");
  uniqueById(input.costs, "cost");

  const stepByAttempt = new Map<string, string>();
  for (const state of input.run.stepStates) {
    for (const attemptId of state.attemptIds) {
      if (stepByAttempt.has(attemptId)) throw new Error(`attempt belongs to multiple run steps: ${attemptId}`);
      stepByAttempt.set(attemptId, state.stepId);
    }
  }
  const taskIds = new Set(input.run.stepStates.map(state => state.generationTaskId));
  for (const task of input.generationTasks) {
    if (task.novelId !== novelId) throw new Error(`GenerationTask novel mismatch: ${task.id}`);
    if (!taskIds.has(task.id)) throw new Error(`GenerationTask is not in the Run Plan: ${task.id}`);
  }
  const candidateIds = new Set(input.candidates.map(candidate => candidate.id));
  for (const candidate of input.candidates) {
    if (candidate.novelId !== novelId) throw new Error(`Candidate novel mismatch: ${candidate.id}`);
    if (!taskIds.has(candidate.taskId)) throw new Error(`Candidate task is not in the run: ${candidate.id}`);
  }
  for (const attempt of input.attempts) {
    if (attempt.novelId !== novelId) throw new Error(`Attempt novel mismatch: ${attempt.id}`);
    const stepId = stepByAttempt.get(attempt.id);
    if (!stepId) throw new Error(`Attempt is not attached to a run step: ${attempt.id}`);
    const step = input.run.stepStates.find(state => state.stepId === stepId);
    if (!step || step.generationTaskId !== attempt.generationTaskId) {
      throw new Error(`Attempt task does not match run step: ${attempt.id}`);
    }
    if (attempt.candidateReference && !candidateIds.has(attempt.candidateReference.identity)) {
      throw new Error(`Attempt candidate is missing from the audit: ${attempt.id}`);
    }
  }

  const revisionById = new Map(
    input.changeSetRevisions.map(revision => [revision.revisionId, revision]),
  );
  for (const revision of input.changeSetRevisions) {
    if (revision.novelId !== novelId) throw new Error(`ChangeSetRevision novel mismatch: ${revision.revisionId}`);
  }
  for (const validation of input.validationRuns) {
    if (!revisionById.has(validation.changeSetRevisionId)) {
      throw new Error(`Validation references an unknown revision: ${validation.id}`);
    }
  }
  for (const decision of input.reviewDecisions) {
    if (!revisionById.has(decision.changeSetRevisionId)) {
      throw new Error(`ReviewDecision references an unknown revision: ${decision.id}`);
    }
  }
  for (const commit of input.narrativeCommits) {
    if (commit.novelId !== novelId) throw new Error(`NarrativeCommit novel mismatch: ${commit.id}`);
    const revision = revisionById.get(commit.changeSetRevisionId);
    if (!revision) throw new Error(`NarrativeCommit revision is missing: ${commit.id}`);
    for (const validationId of commit.validationRunIds) {
      const validation = input.validationRuns.find(candidate => candidate.id === validationId);
      if (!validation || validation.changeSetRevisionId !== revision.revisionId) {
        throw new Error(`NarrativeCommit validation is missing or mismatched: ${commit.id}`);
      }
    }
    for (const decisionId of commit.reviewDecisionIds) {
      const decision = input.reviewDecisions.find(candidate => candidate.id === decisionId);
      if (!decision || decision.changeSetRevisionId !== revision.revisionId) {
        throw new Error(`NarrativeCommit review decision is missing or mismatched: ${commit.id}`);
      }
    }
  }
  for (const decision of input.thresholdDecisions) {
    if (decision.runId !== runId) throw new Error(`Budget decision run mismatch: ${decision.id}`);
  }
  for (const checkpoint of input.checkpoints) {
    if (checkpoint.runId !== runId || checkpoint.novelId !== novelId) {
      throw new Error(`Checkpoint run mismatch: ${checkpoint.id}`);
    }
  }
  for (const cost of input.costs) {
    if (cost.runId !== runId) throw new Error(`Cost run mismatch: ${cost.id}`);
    if (!Number.isFinite(cost.amount) || cost.amount < 0) throw new Error(`Cost amount is invalid: ${cost.id}`);
    requiredText(cost.currency, "cost.currency");
    const knownSubject =
      cost.scope === "run"
        ? cost.subjectId === runId
        : cost.scope === "task"
          ? taskIds.has(cost.subjectId)
          : input.attempts.some(attempt => attempt.id === cost.subjectId);
    if (!knownSubject) throw new Error(`Cost subject is missing: ${cost.id}`);
  }

  const events: RunAuditEvent[] = [
    event("run", input.run, input.run.id, timestampDate(input.run.updatedAt), { run: input.run }),
    ...input.generationTasks.map(task =>
      event("task", input.run, task.id, task.updatedAt, { task }),
    ),
    ...input.attempts.map(attempt =>
      event("attempt", input.run, attempt.id, timestampDate(attempt.updatedAt), { attempt }),
    ),
    ...input.candidates.map(candidate =>
      event("candidate", input.run, candidate.id, candidate.updatedAt, { candidate }),
    ),
    ...input.changeSetRevisions.map(revision =>
      event("change_set_revision", input.run, revision.revisionId, revision.createdAt, { revision }),
    ),
    ...input.validationRuns.map(validation =>
      event("validation", input.run, validation.id, validation.createdAt, { validation }),
    ),
    ...input.reviewDecisions.map(decision =>
      event("review_decision", input.run, decision.id, decision.createdAt, { decision }),
    ),
    ...input.narrativeCommits.map(commit =>
      event("narrative_commit", input.run, commit.id, commit.updatedAt, { commit }),
    ),
    ...input.thresholdDecisions.map(decision =>
      event("budget_threshold", input.run, decision.id, decision.decidedAt, { decision }),
    ),
    ...input.checkpoints.map(checkpoint =>
      event("checkpoint", input.run, checkpoint.id, timestampDate(checkpoint.updatedAt), { checkpoint }),
    ),
    ...input.costs.map(cost =>
      event("cost", input.run, cost.id, cost.occurredAt, { cost }),
    ),
  ];
  return replayRunAuditEvents(events).events;
}

export function projectRunAudit(input: RunAuditInput): RunAuditProjection {
  const events = buildRunAuditEvents(input);
  const attemptsByCandidate = new Map<string, string[]>();
  for (const attempt of input.attempts) {
    const identity = attempt.candidateReference?.identity;
    if (!identity) continue;
    const attempts = attemptsByCandidate.get(identity) ?? [];
    attempts.push(attempt.id);
    attemptsByCandidate.set(identity, attempts);
  }
  const taskById = new Map(input.generationTasks.map(task => [task.id, task]));

  const attemptRecords: readonly RunAttemptAuditRecord[] = input.attempts.map(attempt => {
    const stepId = input.run.stepStates.find(state => state.attemptIds.includes(attempt.id))?.stepId ?? "";
    return {
      attemptId: attempt.id,
      generationTaskId: attempt.generationTaskId,
      stepId,
      relation: attempt.relation,
      status: attempt.status,
      candidateIds: attempt.candidateReference ? [attempt.candidateReference.identity] : [],
      costIds: input.costs.filter(cost => cost.scope === "attempt" && cost.subjectId === attempt.id)
        .map(cost => cost.id),
      ...(attempt.failureEvidence === undefined ? {} : { failure: attempt.failureEvidence }),
    };
  });

  const decisions: readonly RunDecisionAuditRecord[] = [
    ...input.reviewDecisions.map((decision): RunDecisionAuditRecord => ({
      kind: "review",
      decision,
    })),
    ...input.checkpoints.map((checkpoint): RunDecisionAuditRecord => ({
      kind: "checkpoint",
      checkpoint,
    })),
    ...input.thresholdDecisions.map((decision): RunDecisionAuditRecord => ({
      kind: "budget_threshold",
      decision,
    })),
  ].sort((left, right) => left.kind.localeCompare(right.kind));

  const commitRecords: readonly RunCommitAuditRecord[] = input.narrativeCommits.map(commit => {
    const revision = input.changeSetRevisions.find(
      candidate => candidate.revisionId === commit.changeSetRevisionId,
    );
    const candidateIds = [...new Set(
      (revision?.changes ?? [])
        .filter(change => change.sourceType === "candidate")
        .map(change => change.sourceReference.identity),
    )].sort();
    const attemptIds = [...new Set(
      candidateIds.flatMap(candidateId => attemptsByCandidate.get(candidateId) ?? []),
    )].sort();
    const taskIds = [...new Set(
      attemptIds
        .map(attemptId => input.attempts.find(attempt => attempt.id === attemptId)?.generationTaskId)
        .filter((taskId): taskId is string => taskId !== undefined),
    )].sort();
    return {
      commitId: commit.id,
      changeSetRevisionId: commit.changeSetRevisionId,
      status: commit.status,
      candidateIds,
      attemptIds,
      taskIds,
      sourceTypes: [...new Set((revision?.changes ?? []).map(change => change.sourceType))].sort(),
      targets: [...new Set((revision?.changes ?? []).map(change => targetAddressKey(change.targetAddress)))].sort(),
    };
  });

  const failures: readonly RunFailureAuditRecord[] = [
    ...input.attempts
      .filter(attempt => attempt.failureEvidence !== undefined)
      .map((attempt): RunFailureAuditRecord => ({
        sourceKind: "attempt",
        sourceId: attempt.id,
        code: attempt.failureEvidence?.data.code ?? "unknown",
        message: attempt.failureEvidence?.data.message ?? "Unknown failure",
        retryable: attempt.failureEvidence?.data.retryable,
        occurredAt: timestampDate(attempt.failureEvidence?.data.occurredAt ?? attempt.updatedAt),
      })),
    ...input.narrativeCommits
      .filter(commit => commit.status === "failed")
      .map((commit): RunFailureAuditRecord => ({
        sourceKind: "commit",
        sourceId: commit.id,
        code: "narrative_commit_failed",
        message: commit.failureReason ?? "NarrativeCommit failed",
        occurredAt: commit.updatedAt,
      })),
  ].sort((left, right) =>
    left.sourceKind.localeCompare(right.sourceKind) || left.sourceId.localeCompare(right.sourceId),
  );

  for (const candidate of input.candidates) {
    if (!taskById.has(candidate.taskId)) {
      throw new Error(`Candidate task is missing: ${candidate.id}`);
    }
  }

  const chainsByExecutionKey = new Map<string, ExecutionAttempt[]>();
  for (const attempt of input.attempts) {
    const chain = chainsByExecutionKey.get(attempt.executionKey) ?? [];
    chain.push(attempt);
    chainsByExecutionKey.set(attempt.executionKey, chain);
  }
  const attemptChains: readonly RunAttemptChainAuditRecord[] = [...chainsByExecutionKey.entries()]
    .map(([executionKey, attempts]) => {
      const ordered = [...attempts].sort(
        (left, right) =>
          left.attemptOrdinal - right.attemptOrdinal ||
          left.createdAt.epochMilliseconds - right.createdAt.epochMilliseconds ||
          left.id.localeCompare(right.id),
      );
      return {
        executionKey,
        generationTaskId: ordered[0]?.generationTaskId ?? "",
        attemptIds: ordered.map(attempt => attempt.id),
        relations: ordered.map(attempt => attempt.relation),
        routingDecisionIds: ordered.map(attempt => attempt.routingDecision.routingDecisionId),
        predecessorAttemptIds: ordered.map(attempt => attempt.predecessorAttemptReference?.identity ?? null),
      };
    })
    .sort((left, right) => left.executionKey.localeCompare(right.executionKey));

  return deepFreeze({
    schemaVersion: "run-audit:v1" as const,
    runId: input.run.id,
    novelId: input.run.novelId,
    run: input.run,
    tasks: [...input.generationTasks].sort((left, right) => left.id.localeCompare(right.id)),
    attempts: [...attemptRecords].sort((left, right) => left.attemptId.localeCompare(right.attemptId)),
    attemptChains,
    candidates: [...input.candidates].sort((left, right) => left.id.localeCompare(right.id)),
    changeSetRevisions: [...input.changeSetRevisions].sort(
      (left, right) => left.revisionId.localeCompare(right.revisionId),
    ),
    validationRuns: [...input.validationRuns].sort((left, right) => left.id.localeCompare(right.id)),
    decisions,
    commits: [...commitRecords].sort((left, right) => left.commitId.localeCompare(right.commitId)),
    costs: [...input.costs].sort((left, right) => left.id.localeCompare(right.id)),
    failures,
    events,
    hash: auditHash(events),
  });
}
export type RunAuditEvidenceKind =
  | "run"
  | "attempt"
  | "candidate"
  | "decision"
  | "commit"
  | "cost"
  | "failure";

const runAuditEvidenceKinds: readonly RunAuditEvidenceKind[] = [
  "run",
  "attempt",
  "candidate",
  "decision",
  "commit",
  "cost",
  "failure",
];

export interface RunAuditEvidenceQuery {
  readonly evidenceKinds?: readonly RunAuditEvidenceKind[];
  readonly evidenceIds?: readonly string[];
}

export interface RunAuditEvidenceQueryResult {
  readonly run: readonly ProductionRun[];
  readonly attempts: readonly RunAttemptAuditRecord[];
  readonly candidates: readonly Candidate[];
  readonly decisions: readonly RunDecisionAuditRecord[];
  readonly commits: readonly RunCommitAuditRecord[];
  readonly costs: readonly RunCostRecord[];
  readonly failures: readonly RunFailureAuditRecord[];
}

function decisionEvidenceId(record: RunDecisionAuditRecord): string {
  return record.kind === "checkpoint" ? record.checkpoint.id : record.decision.id;
}

function failureEvidenceId(record: RunFailureAuditRecord): string {
  return `${record.sourceKind}:${record.sourceId}`;
}

export function queryRunAuditEvidence(
  projection: RunAuditProjection,
  query: RunAuditEvidenceQuery = {},
): RunAuditEvidenceQueryResult {
  const kinds = new Set(
    query.evidenceKinds?.length ? query.evidenceKinds : runAuditEvidenceKinds,
  );
  const ids = query.evidenceIds?.length ? new Set(query.evidenceIds) : undefined;
  const selected = (kind: RunAuditEvidenceKind, id: string): boolean =>
    kinds.has(kind) && (ids === undefined || ids.has(id));

  return deepFreeze({
    run: projection.run && selected("run", projection.run.id) ? [projection.run] : [],
    attempts: projection.attempts.filter(attempt =>
      selected("attempt", attempt.attemptId),
    ),
    candidates: projection.candidates.filter(candidate =>
      selected("candidate", candidate.id),
    ),
    decisions: projection.decisions.filter(decision =>
      selected("decision", decisionEvidenceId(decision)),
    ),
    commits: projection.commits.filter(commit =>
      selected("commit", commit.commitId),
    ),
    costs: projection.costs.filter(cost => selected("cost", cost.id)),
    failures: projection.failures.filter(failure =>
      selected("failure", failureEvidenceId(failure)),
    ),
  });
}
