import { canonicalJson } from "../../shared/domain/contentHash";
import type {
  RevisionCompareAndSwapPort,
  RevisionCreatePort,
} from "../../shared/application/repository";
import type { GenerationTask } from "../domain/generationTask";
import {
  failExecutionAttempt,
  startExecutionAttempt,
  type ExecutionAttempt,
  type ExecutionFailureEvidence,
  type ExecutionRoutingDecisionReference,
} from "../domain/executionAttempt";
import {
  productionRunRevisionId,
  type ProductionRun,
} from "../domain/productionRun";
import type { RunPlanRevision } from "../domain/runPlan";
import {
  recordProductionRunAttemptOutcome,
  scheduleProductionRunAttempt,
} from "./productionRunScheduler";
import {
  createInMemoryExecutionRecoveryPersistence,
  createPrismaExecutionRecoveryPersistence,
  type ExecutionRecoveryPersistence,
  type ExecutionRecoveryWork,
} from "./executionRecoveryPersistence";

export {
  createInMemoryExecutionRecoveryPersistence,
  createPrismaExecutionRecoveryPersistence,
};
export type { ExecutionRecoveryPersistence };

export interface ExecutionRecoveryResult {
  readonly run: ProductionRun;
  readonly attempt: ExecutionAttempt;
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function persistAttemptRevisions(
  port: ExecutionRecoveryWork["attempts"],
  revisions: readonly ExecutionAttempt[],
): Promise<void> {
  let previous: ExecutionAttempt | undefined;
  for (const revision of revisions) {
    const historical = await port.getRevision(revision.id, revision.currentRevisionId);
    if (historical) {
      if (!sameValue(historical, revision)) {
        throw new Error(`Execution Attempt history conflict: ${revision.id}`);
      }
      previous = revision;
      continue;
    }
    const current = await port.findById(revision.id);
    if (current && !previous) {
      if (sameValue(current, revision)) return;
      throw new Error(`Execution Attempt history conflict: ${revision.id}`);
    }
    await port.saveRevisionIfAbsent(revision);
    if (previous) {
      await port.saveIfCurrent(previous.currentRevisionId, revision);
    }
    previous = revision;
  }
}

async function ensureRunRevision(
  port: ExecutionRecoveryWork["runs"],
  run: ProductionRun,
): Promise<void> {
  const historical = await port.getRevision(run.id, run.currentRevisionId);
  if (historical) {
    if (!sameValue(historical, run)) throw new Error("Production Run history conflict");
    return;
  }
  const current = await port.findById(run.id);
  if (current) {
    if (!sameValue(current, run)) throw new Error("Production Run history conflict");
    return;
  }
  await port.saveRevisionIfAbsent(run);
}

async function persistRunTransition(
  port: ExecutionRecoveryWork["runs"],
  previous: ProductionRun,
  next: ProductionRun,
): Promise<ProductionRun> {
  await ensureRunRevision(port, previous);
  const historical = await port.getRevision(next.id, next.currentRevisionId);
  const current = await port.findById(next.id);
  if (historical || current?.currentRevisionId === next.currentRevisionId) {
    const existing = historical ?? current!;
    if (!sameValue(existing, next)) throw new Error("Production Run history conflict");
    return existing;
  }
  if (!current || current.currentRevisionId !== previous.currentRevisionId) {
    throw new Error("Production Run previous revision mismatch");
  }
  if (
    next.revisionNumber !== previous.revisionNumber + 1 ||
    next.currentRevisionId !== productionRunRevisionId(next)
  ) {
    throw new Error("Production Run transition is invalid");
  }
  await port.saveRevisionIfAbsent(next);
  await port.saveIfCurrent(previous.currentRevisionId, next);
  return next;
}

function assertScheduledAttempt(
  run: ProductionRun,
  stepId: string,
  attempt: ExecutionAttempt,
): void {
  const state = run.stepStates.find((candidate) => candidate.stepId === stepId);
  if (!state) throw new Error("unknown run step");
  if (!state.attemptIds.includes(attempt.id)) throw new Error("attempt is not scheduled for the run step");
  if (attempt.generationTaskId !== state.generationTaskId) {
    throw new Error("attempt must belong to the scheduled GenerationTask");
  }
}

export async function failScheduledExecution(input: {
  readonly persistence: ExecutionRecoveryPersistence;
  readonly run: ProductionRun;
  readonly stepId: string;
  readonly createdAttempt: ExecutionAttempt;
  readonly startedAt: Date;
  readonly failure: ExecutionFailureEvidence;
  readonly failedAt: Date;
  readonly retryReason?: string;
}): Promise<ExecutionRecoveryResult> {
  assertScheduledAttempt(input.run, input.stepId, input.createdAttempt);
  if (input.createdAttempt.status !== "created") {
    throw new Error("failure recovery requires a created Attempt");
  }
  const started = startExecutionAttempt(input.createdAttempt, input.startedAt);
  const failed = failExecutionAttempt({
    attempt: started,
    failure: input.failure,
    failedAt: input.failedAt,
    retryReason: input.retryReason,
  });
  const recoveredRun = recordProductionRunAttemptOutcome({
    run: input.run,
    stepId: input.stepId,
    attempt: failed,
    at: input.failedAt,
  });
  return input.persistence.transaction.run(async (work) => {
    await persistAttemptRevisions(work.attempts, [input.createdAttempt, started, failed]);
    const run = await persistRunTransition(work.runs, input.run, recoveredRun);
    return { run, attempt: failed };
  });
}

function requireFailedPredecessor(
  previousAttempt: ExecutionAttempt,
  generationTask: GenerationTask,
): void {
  if (previousAttempt.status !== "failed" && previousAttempt.status !== "cancelled") {
    throw new Error("recovery requires a terminal failed or cancelled predecessor");
  }
  if (previousAttempt.generationTaskId !== generationTask.id) {
    throw new Error("recovery must reuse the same GenerationTask");
  }
}

async function scheduleRecoveryAttempt(input: {
  readonly persistence: ExecutionRecoveryPersistence;
  readonly run: ProductionRun;
  readonly runPlanRevision: RunPlanRevision;
  readonly generationTask: GenerationTask;
  readonly stepId: string;
  readonly previousAttempt: ExecutionAttempt;
  readonly executionKey: string;
  readonly routingDecision: ExecutionRoutingDecisionReference;
  readonly createdAt: Date;
  readonly relation: "retry" | "fallback";
}): Promise<ExecutionRecoveryResult> {
  requireFailedPredecessor(input.previousAttempt, input.generationTask);
  const scheduled = scheduleProductionRunAttempt({
    run: input.run,
    runPlanRevision: input.runPlanRevision,
    generationTask: input.generationTask,
    stepId: input.stepId,
    executionKey: input.executionKey,
    routingDecision: input.routingDecision,
    relation: input.relation,
    previousAttempt: input.previousAttempt,
    createdAt: input.createdAt,
  });
  return input.persistence.transaction.run(async (work) => {
    const persistedPredecessor = await work.attempts.findById(input.previousAttempt.id);
    if (!persistedPredecessor || !sameValue(persistedPredecessor, input.previousAttempt)) {
      throw new Error("predecessor Attempt is not a persisted immutable revision");
    }
    const current = await work.runs.findById(input.run.id);
    const state = current?.stepStates.find((candidate) => candidate.stepId === input.stepId);
    if (state?.attemptIds.includes(scheduled.attempt.id)) {
      const persistedAttempt = await work.attempts.findById(scheduled.attempt.id);
      if (!persistedAttempt || !sameValue(persistedAttempt, scheduled.attempt)) {
        throw new Error("recovery Attempt identity conflict");
      }
      return { run: current!, attempt: persistedAttempt };
    }
    await persistAttemptRevisions(work.attempts, [scheduled.attempt]);
    const run = await persistRunTransition(work.runs, input.run, scheduled.run);
    return { run, attempt: scheduled.attempt };
  });
}

export function retryFailedExecution(input: {
  readonly persistence: ExecutionRecoveryPersistence;
  readonly run: ProductionRun;
  readonly runPlanRevision: RunPlanRevision;
  readonly generationTask: GenerationTask;
  readonly stepId: string;
  readonly previousAttempt: ExecutionAttempt;
  readonly executionKey: string;
  readonly routingDecision: ExecutionRoutingDecisionReference;
  readonly createdAt: Date;
}): Promise<ExecutionRecoveryResult> {
  return scheduleRecoveryAttempt({ ...input, relation: "retry" });
}

export function fallbackFailedExecution(input: {
  readonly persistence: ExecutionRecoveryPersistence;
  readonly run: ProductionRun;
  readonly runPlanRevision: RunPlanRevision;
  readonly generationTask: GenerationTask;
  readonly stepId: string;
  readonly previousAttempt: ExecutionAttempt;
  readonly executionKey: string;
  readonly routingDecision: ExecutionRoutingDecisionReference;
  readonly createdAt: Date;
}): Promise<ExecutionRecoveryResult> {
  return scheduleRecoveryAttempt({ ...input, relation: "fallback" });
}

export async function recoverProductionRunExecution(input: {
  readonly persistence: ExecutionRecoveryPersistence;
  readonly run: ProductionRun;
  readonly stepId: string;
  readonly recoveredAt: Date;
}): Promise<ExecutionRecoveryResult> {
  return input.persistence.transaction.run(async (work) => {
    await ensureRunRevision(work.runs, input.run);
    const run = (await work.runs.findById(input.run.id))!;
    const state = run.stepStates.find((candidate) => candidate.stepId === input.stepId);
    if (!state) throw new Error("unknown run step");
    const attemptId = state.attemptIds[state.attemptIds.length - 1];
    if (!attemptId) return { run, attempt: undefined as never };
    const attempt = await work.attempts.findById(attemptId);
    if (!attempt) throw new Error("scheduled Attempt is missing");
    if (
      state.status !== "running" ||
      attempt.status === "created" ||
      attempt.status === "running"
    ) {
      return { run, attempt };
    }
    const recoveredRun = recordProductionRunAttemptOutcome({
      run,
      stepId: input.stepId,
      attempt,
      at: input.recoveredAt,
    });
    return {
      run: await persistRunTransition(work.runs, run, recoveredRun),
      attempt,
    };
  });
}
