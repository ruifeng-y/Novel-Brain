import type { Candidate } from "../domain/candidate";
import type { GenerationTask } from "../domain/generationTask";
import type {
  ExecutionAttempt,
  ExecutionAttemptRelation,
  ExecutionFailureEvidence,
  ExecutionRoutingDecisionReference,
} from "../domain/executionAttempt";
import {
  completeExecutionAttempt,
  createExecutionAttempt,
  createFallbackExecutionAttempt,
  createRetryExecutionAttempt,
  failExecutionAttempt,
  startExecutionAttempt,
} from "../domain/executionAttempt";
import type { RuntimeRequest, RuntimeResult } from "../runtime/runtimeAdapter";
import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import type { ExecutionAttemptPersistence } from "./executionAttemptPersistence";

export type ExecutionAttemptPersistenceErrorCode =
  | "revision_conflict"
  | "current_revision_mismatch"
  | "history_inconsistency";

export class ExecutionAttemptPersistenceError extends Error {
  constructor(
    readonly code: ExecutionAttemptPersistenceErrorCode,
    message: string,
    readonly attemptId: string,
    readonly expectedRevisionId?: string,
    readonly actualRevisionId?: string,
  ) {
    super(message);
    this.name = "ExecutionAttemptPersistenceError";
  }
}
interface RecordExecutionAttemptBaseInput {
  readonly persistence: ExecutionAttemptPersistence;
  readonly executionKey: string;
  readonly attemptOrdinal?: number;
  readonly relation: ExecutionAttemptRelation;
  readonly generationTask: GenerationTask;
  readonly routingDecision: ExecutionRoutingDecisionReference;
  readonly previousAttempt?: ExecutionAttempt;
  readonly startedAt: Date;
  readonly candidate?: Candidate;
}

export interface RecordExecutionAttemptFromRuntimeResultInput
  extends RecordExecutionAttemptBaseInput {
  readonly runtimeRequest: RuntimeRequest;
  readonly runtimeResult: RuntimeResult;
  readonly completedAt: Date;
}

export interface RecordExecutionAttemptFailureInput extends RecordExecutionAttemptBaseInput {
  readonly failure: ExecutionFailureEvidence;
  readonly failedAt: Date;
  readonly retryReason?: string;
}

function assertTaskIdentity(
  generationTask: GenerationTask,
  taskId: string,
  label: string,
): void {
  if (taskId !== generationTask.id) {
    throw new Error(`${label} taskId must match GenerationTask`);
  }
}

function assertSameRevision(
  existing: ExecutionAttempt,
  expected: ExecutionAttempt,
): void {
  if (hashContent(canonicalJson(existing)) !== hashContent(canonicalJson(expected))) {
    throw new ExecutionAttemptPersistenceError(
      "revision_conflict",
      `Execution attempt revision conflict: ${expected.id}:${expected.currentRevisionId}`,
      expected.id,
      expected.currentRevisionId,
      existing.currentRevisionId,
    );
  }
}

function assertCurrentRevision(
  current: ExecutionAttempt | undefined,
  expected: ExecutionAttempt | undefined,
  kind: "current_revision_mismatch" | "history_inconsistency",
): void {
  if (!expected) return;
  if (!current) {
    throw new ExecutionAttemptPersistenceError(
      "current_revision_mismatch",
      `Execution attempt current revision mismatch: ${expected.id}`,
      expected.id,
      expected.currentRevisionId,
    );
  }
  if (current.currentRevisionId !== expected.currentRevisionId) {
    const code = kind;
    throw new ExecutionAttemptPersistenceError(
      code,
      code === "history_inconsistency"
        ? `Execution attempt history inconsistency: ${expected.id}`
        : `Execution attempt current revision mismatch: ${expected.id}`,
      expected.id,
      expected.currentRevisionId,
      current.currentRevisionId,
    );
  }
  assertSameRevision(current, expected);
}

async function persistLifecycle(
  persistence: ExecutionAttemptPersistence,
  revisions: readonly ExecutionAttempt[],
): Promise<ExecutionAttempt> {
  const terminal = revisions[revisions.length - 1]!;
  return persistence.transaction.run(async (work) => {
    let previous: ExecutionAttempt | undefined;
    for (const [index, revision] of revisions.entries()) {
      const existing = await work.attempts.getRevision(
        revision.id,
        revision.currentRevisionId,
      );
      if (existing) {
        assertSameRevision(existing, revision);
        previous = revision;
        continue;
      }

      const current = await work.attempts.findById(revision.id);
      if (index === 0 && current) {
        throw new ExecutionAttemptPersistenceError(
          "history_inconsistency",
          `Execution attempt history inconsistency: ${revision.id}`,
          revision.id,
          revision.currentRevisionId,
          current.currentRevisionId,
        );
      }
      if (
        current &&
        previous &&
        current.currentRevisionId !== previous.currentRevisionId &&
        revisions.some((candidate) => candidate.currentRevisionId === current.currentRevisionId)
      ) {
        throw new ExecutionAttemptPersistenceError(
          "history_inconsistency",
          `Execution attempt history inconsistency: ${revision.id}`,
          revision.id,
          revision.currentRevisionId,
          current.currentRevisionId,
        );
      }
      assertCurrentRevision(current, previous, "current_revision_mismatch");

      try {
        await work.attempts.saveRevisionIfAbsent(revision);
        if (previous) {
          await work.attempts.saveIfCurrent(previous.currentRevisionId, revision);
        }
      } catch (error) {
        const racedRevision = await work.attempts.getRevision(
          revision.id,
          revision.currentRevisionId,
        );
        const racedCurrent = await work.attempts.findById(revision.id);
        if (!racedRevision) {
          throw new ExecutionAttemptPersistenceError(
            "current_revision_mismatch",
            `Execution attempt current revision mismatch: ${revision.id}`,
            revision.id,
            previous?.currentRevisionId ?? revision.currentRevisionId,
            racedCurrent?.currentRevisionId,
          );
        }
        assertSameRevision(racedRevision, revision);
        const progressed = revisions.some(
          (candidate) => candidate.currentRevisionId === racedCurrent?.currentRevisionId,
        );
        if (!racedCurrent || !progressed) {
          throw new ExecutionAttemptPersistenceError(
            "current_revision_mismatch",
            `Execution attempt current revision mismatch: ${revision.id}`,
            revision.id,
            revision.currentRevisionId,
            racedCurrent?.currentRevisionId,
          );
        }
      }
      previous = revision;
    }

    const current = await work.attempts.findById(terminal.id);
    assertCurrentRevision(current, terminal, "current_revision_mismatch");
    return terminal;
  });
}

function createInputAttempt(
  input: RecordExecutionAttemptBaseInput,
): ExecutionAttempt {
  if (input.previousAttempt) {
    if (input.relation === "initial") {
      throw new Error("initial attempt cannot have a predecessor");
    }
    if (input.relation === "retry") {
      return createRetryExecutionAttempt({
        previousAttempt: input.previousAttempt,
        executionKey: input.executionKey,
        attemptOrdinal: input.attemptOrdinal,
        routingDecision: input.routingDecision,
        createdAt: input.startedAt,
      });
    }
    return createFallbackExecutionAttempt({
      previousAttempt: input.previousAttempt,
      executionKey: input.executionKey,
      attemptOrdinal: input.attemptOrdinal,
      routingDecision: input.routingDecision,
      createdAt: input.startedAt,
    });
  }
  return createExecutionAttempt({
    executionKey: input.executionKey,
    attemptOrdinal: input.attemptOrdinal,
    relation: input.relation,
    generationTask: input.generationTask,
    routingDecision: input.routingDecision,
    createdAt: input.startedAt,
  });
}


export async function recordExecutionAttemptFromRuntimeResult(
  input: RecordExecutionAttemptFromRuntimeResultInput,
): Promise<ExecutionAttempt> {
  assertTaskIdentity(input.generationTask, input.runtimeRequest.taskId, "runtime request");
  assertTaskIdentity(input.generationTask, input.runtimeResult.taskId, "runtime result");
  const created = createInputAttempt(input);
  const running = startExecutionAttempt(created, input.startedAt);
  const completed = completeExecutionAttempt({
    attempt: running,
    runtimeRequest: input.runtimeRequest,
    runtimeResult: input.runtimeResult,
    completedAt: input.completedAt,
    candidate: input.candidate,
  });
  return persistLifecycle(input.persistence, [created, running, completed]);
}

export async function recordExecutionAttemptFailure(
  input: RecordExecutionAttemptFailureInput,
): Promise<ExecutionAttempt> {
  const created = createInputAttempt(input);
  const running = startExecutionAttempt(created, input.startedAt);
  const failed = failExecutionAttempt({
    attempt: running,
    failure: input.failure,
    failedAt: input.failedAt,
    retryReason: input.retryReason,
  });
  return persistLifecycle(input.persistence, [created, running, failed]);
}
