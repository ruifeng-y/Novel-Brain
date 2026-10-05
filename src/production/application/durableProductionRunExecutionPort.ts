import { canonicalJson } from "../../shared/domain/contentHash";
import type { ExecutionAttempt } from "../domain/executionAttempt";
import {
  cancelExecutionAttempt,
  completeExecutionAttempt,
  failExecutionAttempt,
  startExecutionAttempt,
} from "../domain/executionAttempt";
import type { ProductionRun } from "../domain/productionRun";
import { productionRunRevisionId } from "../domain/productionRun";

import {
  recordProductionRunAttemptOutcome,
  scheduleProductionRunAttempt,
} from "./productionRunScheduler";
import type {
  ProductionRunExecutionPort,
  ProductionRunExecutionTransition,
  ScheduleProductionRunExecutionInput,
} from "./productionRunExecutionPort";
import type {
  ExecutionRecoveryPersistence,
  ExecutionRecoveryWork,
} from "./executionRecoveryPersistence";
import type { ScheduledProductionRunAttempt } from "./productionRunScheduler";

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function attemptIdentityMatches(left: ExecutionAttempt, right: ExecutionAttempt): boolean {
  return (
    left.id === right.id &&
    left.novelId === right.novelId &&
    left.generationTaskId === right.generationTaskId &&
    left.executionKey === right.executionKey &&
    left.attemptOrdinal === right.attemptOrdinal &&
    left.relation === right.relation &&
    left.predecessorAttemptReference?.identity === right.predecessorAttemptReference?.identity &&
    canonicalJson(left.generationTaskReference) === canonicalJson(right.generationTaskReference) &&
    canonicalJson(left.routingDecision) === canonicalJson(right.routingDecision)
  );
}

async function persistRunTransition(
  port: ExecutionRecoveryWork["runs"],
  previous: ProductionRun,
  next: ProductionRun,
): Promise<ProductionRun> {
  const current = await port.findById(next.id);
  const historicalNext = await port.getRevision(next.id, next.currentRevisionId);
  if (historicalNext) {
    if (!sameValue(historicalNext, next)) throw new Error("Production Run history conflict");
    return historicalNext;
  }
  if (current?.currentRevisionId === next.currentRevisionId) {
    if (!sameValue(current, next)) throw new Error("Production Run history conflict");
    return current;
  }
  if (!current) {
    await port.saveRevisionIfAbsent(previous);
  } else if (current.currentRevisionId !== previous.currentRevisionId) {
    const historicalPrevious = await port.getRevision(previous.id, previous.currentRevisionId);
    if (!historicalPrevious || !sameValue(historicalPrevious, previous)) {
      throw new Error("Production Run previous revision mismatch");
    }
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

async function persistAttemptTransition(
  port: ExecutionRecoveryWork["attempts"],
  previous: ExecutionAttempt,
  next: ExecutionAttempt,
): Promise<ExecutionAttempt> {
  const historicalNext = await port.getRevision(next.id, next.currentRevisionId);
  if (historicalNext) {
    if (!sameValue(historicalNext, next)) {
      if (
        !attemptIdentityMatches(historicalNext, next) ||
        previous.status !== "created" ||
        next.status !== "running"
      ) {
        throw new Error("Execution Attempt history conflict");
      }
      return historicalNext;
    }
    return historicalNext;
  }
  const current = await port.findById(next.id);
  if (current?.currentRevisionId === next.currentRevisionId) {
    if (!sameValue(current, next)) {
      if (
        !attemptIdentityMatches(current, next) ||
        previous.status !== "created" ||
        next.status !== "running"
      ) {
        throw new Error("Execution Attempt history conflict");
      }
      return current;
    }
    return current;
  }
  if (!current) {
    await port.saveRevisionIfAbsent(previous);
  } else if (current.currentRevisionId !== previous.currentRevisionId) {
    const historicalPrevious = await port.getRevision(previous.id, previous.currentRevisionId);
    if (!historicalPrevious || !sameValue(historicalPrevious, previous)) {
      throw new Error("Execution Attempt previous revision mismatch");
    }
  }
  await port.saveRevisionIfAbsent(next);
  await port.saveIfCurrent(previous.currentRevisionId, next);
  return next;
}

function recordOutcome(
  run: ProductionRun,
  stepId: string,
  attempt: ExecutionAttempt,
  at: Date,
): ProductionRunExecutionTransition {
  return {
    attempt,
    run: recordProductionRunAttemptOutcome({ run, stepId, attempt, at }),
  };
}

async function readScheduledAttempt(
  persistence: ExecutionRecoveryPersistence,
  scheduled: ScheduledProductionRunAttempt,
  stepId: string,
): Promise<ProductionRunExecutionTransition | undefined> {
  const persistedAttempt = await persistence.attempts.findById(scheduled.attempt.id);
  if (!persistedAttempt) return undefined;
  if (!attemptIdentityMatches(persistedAttempt, scheduled.attempt)) {
    throw new Error(`Execution Attempt identity conflict: ${scheduled.attempt.id}`);
  }
  const persistedRun = await persistence.runs.findById(scheduled.run.id);
  const state = persistedRun?.stepStates.find(candidate => candidate.stepId === stepId);
  if (!persistedRun || !state?.attemptIds.includes(persistedAttempt.id)) {
    throw new Error(`Execution Attempt is not attached to Production Run: ${persistedAttempt.id}`);
  }
  return { run: persistedRun, attempt: persistedAttempt };
}

async function persistSchedule(
  persistence: ExecutionRecoveryPersistence,
  input: ScheduleProductionRunExecutionInput,
): Promise<ScheduledProductionRunAttempt> {
  const scheduled = scheduleProductionRunAttempt(input);
  try {
    return await persistence.transaction.run(async (work) => {
      const existing = await work.attempts.findById(scheduled.attempt.id);
      if (existing) {
        if (!attemptIdentityMatches(existing, scheduled.attempt)) {
          throw new Error(`Execution Attempt identity conflict: ${scheduled.attempt.id}`);
        }
        const currentRun = await work.runs.findById(scheduled.run.id);
        const state = currentRun?.stepStates.find(
          candidate => candidate.stepId === input.stepId,
        );
        if (!currentRun || !state?.attemptIds.includes(existing.id)) {
          throw new Error(
            `Execution Attempt is not attached to Production Run: ${existing.id}`,
          );
        }
        return { run: currentRun, attempt: existing, generationTask: input.generationTask };
      }
      await work.attempts.saveRevisionIfAbsent(scheduled.attempt);
      const run = await persistRunTransition(work.runs, input.run, scheduled.run);
      return { run, attempt: scheduled.attempt, generationTask: input.generationTask };
    });
  } catch (error) {
    const existing = await readScheduledAttempt(persistence, scheduled, input.stepId);
    if (existing) {
      return {
        run: existing.run,
        attempt: existing.attempt,
        generationTask: input.generationTask,
      };
    }
    throw error;
  }
}

async function persistTerminal(
  persistence: ExecutionRecoveryPersistence,
  stepId: string,
  previousAttempt: ExecutionAttempt,
  terminalAttempt: ExecutionAttempt,
  previousRun: ProductionRun,
  terminalRun: ProductionRun,
): Promise<ProductionRunExecutionTransition> {
  try {
    return await persistence.transaction.run(async (work) => {
      const existingAttempt = await work.attempts.findById(terminalAttempt.id);
      if (existingAttempt?.currentRevisionId === terminalAttempt.currentRevisionId) {
        if (!attemptIdentityMatches(existingAttempt, terminalAttempt)) {
          throw new Error("Execution Attempt history conflict");
        }
        const currentRun = await work.runs.findById(terminalRun.id);
        const state = currentRun?.stepStates.find(candidate => candidate.stepId === stepId);
        if (!currentRun || !state?.attemptIds.includes(existingAttempt.id)) {
          throw new Error("Execution Attempt is not attached to Production Run");
        }
        if (state.status === "pending" || state.status === "running") {
          const reconciled = recordOutcome(
            currentRun,
            stepId,
            existingAttempt,
            new Date(existingAttempt.endedAt?.epochMilliseconds ?? existingAttempt.updatedAt.epochMilliseconds),
          );
          return {
            run: await persistRunTransition(work.runs, currentRun, reconciled.run),
            attempt: existingAttempt,
          };
        }
        return { run: currentRun, attempt: existingAttempt };
      }
      const attempt = await persistAttemptTransition(
        work.attempts,
        previousAttempt,
        terminalAttempt,
      );
      const run = await persistRunTransition(work.runs, previousRun, terminalRun);
      return { run, attempt };
    });
  } catch (error) {
    const attempt = await persistence.attempts.findById(terminalAttempt.id);
    const run = await persistence.runs.findById(terminalRun.id);
    const state = run?.stepStates.find(candidate => candidate.stepId === stepId);
    if (
      attempt?.currentRevisionId === terminalAttempt.currentRevisionId &&
      run &&
      state?.attemptIds.includes(attempt.id) &&
      state.status !== "pending" &&
      state.status !== "running"
    ) {
      return { run, attempt };
    }
    throw error;
  }
}

export function createDurableProductionRunExecutionPort(
  persistence: ExecutionRecoveryPersistence,
): ProductionRunExecutionPort {
  return {
    schedule: input => persistSchedule(persistence, input),
    start: async input => {
      if (input.attempt.status === "running") {
        const run = await persistence.runs.findById(input.run.id);
        if (!run) throw new Error("Production Run is missing");
        return { run, attempt: input.attempt };
      }
      const started = startExecutionAttempt(input.attempt, input.at);
      const attempt = await persistence.transaction.run(work =>
        persistAttemptTransition(work.attempts, input.attempt, started),
      );
      const run = await persistence.runs.findById(input.run.id);
      if (!run) throw new Error("Production Run is missing");
      return { run, attempt };
    },
    succeed: async input => {
      const terminal = completeExecutionAttempt({
        attempt: input.attempt,
        runtimeRequest: input.runtimeRequest,
        runtimeResult: input.runtimeResult,
        completedAt: input.at,
      });
      const transition = recordOutcome(input.run, input.stepId, terminal, input.at);
      return persistTerminal(
        persistence,
        input.stepId,
        input.attempt,
        transition.attempt,
        input.run,
        transition.run,
      );
    },
    fail: async input => {
      const terminal = failExecutionAttempt({
        attempt: input.attempt,
        failure: input.failure,
        failedAt: input.at,
        ...(input.retryReason === undefined ? {} : { retryReason: input.retryReason }),
      });
      const transition = recordOutcome(input.run, input.stepId, terminal, input.at);
      return persistTerminal(
        persistence,
        input.stepId,
        input.attempt,
        transition.attempt,
        input.run,
        transition.run,
      );
    },
    cancel: async input => {
      const terminal = cancelExecutionAttempt({
        attempt: input.attempt,
        reason: input.reason,
        cancelledAt: input.at,
      });
      const transition = recordOutcome(input.run, input.stepId, terminal, input.at);
      return persistTerminal(
        persistence,
        input.stepId,
        input.attempt,
        transition.attempt,
        input.run,
        transition.run,
      );
    },
  };
}
