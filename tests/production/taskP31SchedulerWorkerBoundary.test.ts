import { describe, expect, it } from "vitest";
import {
  InMemoryLongRunningProcessBoundary,
  type LongRunningProcessSnapshot,
} from "../../src/application/longRunningProcessBoundary";
import {
  ProductionSchedulerWorkerBoundary,
  schedulerWorkerExecutionContract,
  type SchedulerAdapter,
  type SchedulerExecutionRequest,
  type SchedulerProcessBoundary,
  type SchedulerScheduleRequest,
  type ScheduledWorkOrder,
  type WorkerAdapter,
  type WorkerExecutionControl,
  type WorkerExecutionResult,
} from "../../src/production/runtime/schedulerWorkerBoundary";
import { productionRunExecutionPort } from "../../src/production/application/productionRunExecutionPort";
import {
  approveProductionRun,
  createProductionRun,
  planProductionRun,
  startProductionRun,
} from "../../src/production/domain/productionRun";
import {
  approveRunPlanRevision,
  createRunPlanApproval,
  createRunPlanRevision,
} from "../../src/production/domain/runPlan";
import { createGenerationTask } from "../../src/production/domain/generationTask";
import type {
  ExecutionAttempt,
  ExecutionRoutingDecisionReference,
} from "../../src/production/domain/executionAttempt";
import type { ProductionRun } from "../../src/production/domain/productionRun";
import type { RunPlanRevision } from "../../src/production/domain/runPlan";
import type { RuntimeRequest, RuntimeResult } from "../../src/production/runtime/runtimeAdapter";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-05T12:00:00.000Z");

function routing(id: string): ExecutionRoutingDecisionReference {
  return {
    routingDecisionId: id,
    resolverVersion: "resolver-1",
    routingPolicyVersion: "policy-1",
    provider: "test",
    model: "deterministic",
    reason: "scheduled",
  };
}

function createFixture() {
  const revision: RunPlanRevision = createRunPlanRevision({
    id: "run-plan-p31:r1",
    planId: "run-plan-p31",
    novelId: "novel-p31",
    revisionNumber: 1,
    goal: "Runtime boundary",
    steps: [{ id: "step-a", ordinal: 1, generationTaskId: "task-p31", dependsOn: [] }],
    createdAt: now,
  });
  const approval = createRunPlanApproval({
    id: "approval-p31:r1",
    revision,
    approvedBy: "author-1",
    approvedAt: now,
  });
  expect(approveRunPlanRevision(approval, revision)).toBe(true);
  const run: ProductionRun = startProductionRun(
    approveProductionRun(
      planProductionRun(
        createProductionRun({
          id: "run-p31",
          novelId: revision.novelId,
          runPlanRevision: revision,
          createdAt: now,
        }),
        now,
      ),
      approval,
      now,
    ),
    now,
  );
  const generationTask = createGenerationTask({
    id: "task-p31",
    novelId: revision.novelId,
    operation: "scene_generation",
    targetSceneId: "scene-1",
    intent: "Generate scene",
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-1:r1"),
    }),
    createdAt: now,
  });
  const modelPolicy = {
    provider: "test",
    model: "deterministic",
    maxOutputTokens: 100,
  };
  const requestedChange = {
    type: "text" as const,
    sceneId: "scene-1",
    text: "Generated scene",
  };
  const runtimeRequest: RuntimeRequest = {
    taskId: generationTask.id,
    agentRole: "writer",
    modelPolicy,
    basedOnVersionSet: generationTask.basedOnVersionSet,
    context: {},
    requestedChange,
  };
  const runtimeResult: RuntimeResult = {
    taskId: generationTask.id,
    agentRole: "writer",
    modelPolicy,
    change: requestedChange,
    basedOnVersionSet: generationTask.basedOnVersionSet,
  };
  return {
    revision,
    run,
    generationTask,
    routingDecision: routing("routing-p31"),
    fallbackRoutingDecision: routing("routing-p31-fallback"),
    runtimeRequest,
    runtimeResult,
  };
}

class RecordingSchedulerAdapter implements SchedulerAdapter {
  readonly scheduled: SchedulerScheduleRequest[] = [];
  readonly cancelled: { workId: string; reason: string }[] = [];

  async schedule(request: SchedulerScheduleRequest): Promise<ScheduledWorkOrder> {
    this.scheduled.push(request);
    return { ...request, workId: request.attempt.id };
  }

  async cancel(workId: string, reason: string) {
    this.cancelled.push({ workId, reason });
    return {
      workId,
      disposition: "cancelled" as const,
      cancellationRequested: true as const,
    };
  }
}

class ObservedProcessBoundary implements SchedulerProcessBoundary {
  readonly requestDispositions: string[] = [];
  readonly observations: LongRunningProcessSnapshot<RuntimeResult>[] = [];
  private readonly delegate = new InMemoryLongRunningProcessBoundary<RuntimeResult>();

  submit(id: string) {
    return this.delegate.submit({ id, kind: "generation" });
  }

  markRunning(id: string) {
    return this.delegate.markRunning(id);
  }

  complete(id: string, result: Parameters<InMemoryLongRunningProcessBoundary<RuntimeResult>["complete"]>[1]) {
    return this.delegate.complete(id, result);
  }

  async requestCancellation(id: string) {
    const receipt = await this.delegate.requestCancellation(id);
    this.requestDispositions.push(receipt.disposition);
    return receipt;
  }

  async observe(id: string) {
    const snapshot = await this.delegate.observe(id);
    this.observations.push(snapshot);
    return snapshot;
  }
}

function worker(
  execute: (
    order: ScheduledWorkOrder,
    control: WorkerExecutionControl,
  ) => Promise<WorkerExecutionResult>,
): WorkerAdapter {
  return { execute };
}

function requestFor(
  fixture: ReturnType<typeof createFixture>,
  policy: SchedulerExecutionRequest["policy"],
): SchedulerExecutionRequest {
  return {
    run: fixture.run,
    runPlanRevision: fixture.revision,
    generationTask: fixture.generationTask,
    stepId: "step-a",
    executionKey: "execution-p31",
    routingDecision: fixture.routingDecision,
    fallbackRoutingDecision: fixture.fallbackRoutingDecision,
    runtimeRequest: fixture.runtimeRequest,
    policy,
    process: { id: "process-p31" },
  };
}

describe("[task:P3.1] production scheduler and worker boundary", () => {
  it("[integration] [cross-system] schedules ProductionRun attempts and exposes P2.2 results", async () => {
    const fixture = createFixture();
    const scheduler = new RecordingSchedulerAdapter();
    const processBoundary = new ObservedProcessBoundary();
    await processBoundary.submit("process-p31");
    const boundary = new ProductionSchedulerWorkerBoundary({
      scheduler,
      worker: worker(async () => ({
        status: "succeeded",
        runtimeResult: fixture.runtimeResult,
      })),
      processBoundary,
      executionPort: productionRunExecutionPort,
    });

    const result = await boundary.execute(requestFor(fixture, {
      timeoutMs: 100,
      maxAttempts: 1,
    }));

    expect(result.status).toBe("succeeded");
    expect(result.attempts.map((attempt: ExecutionAttempt) => attempt.relation)).toEqual(["initial"]);
    expect(result.attempts.map((attempt: ExecutionAttempt) => attempt.attemptOrdinal)).toEqual([1]);
    expect(result.run.stepStates[0]?.attemptIds).toEqual([result.attempts[0]!.id]);
    expect(scheduler.scheduled[0]?.timeoutMs).toBe(100);
    expect(scheduler.scheduled[0]?.attempt.id).toBe(result.attempts[0]!.id);
    expect(await processBoundary.observe("process-p31")).toMatchObject({
      phase: "terminal",
      status: "succeeded",
    });
  });

  it("[integration] enforces scheduler timeout, cancels scheduled work, and avoids parallel retry", async () => {
    const fixture = createFixture();
    const scheduler = new RecordingSchedulerAdapter();
    const processBoundary = new ObservedProcessBoundary();
    await processBoundary.submit("process-p31");
    let active = 0;
    let maxActive = 0;
    let executions = 0;
    const boundary = new ProductionSchedulerWorkerBoundary({
      scheduler,
      worker: worker(async () => {
        executions += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, executions === 1 ? 20 : 0));
        active -= 1;
        return executions === 1
          ? {
              status: "failed",
              error: { code: "transient", message: "late failure", retryable: true },
            }
          : { status: "succeeded", runtimeResult: fixture.runtimeResult };
      }),
      processBoundary,
      executionPort: productionRunExecutionPort,
    });

    const result = await boundary.execute(requestFor(fixture, {
      timeoutMs: 5,
      maxAttempts: 2,
    }));

    expect(result.status).toBe("succeeded");
    expect(result.attempts.map((attempt: ExecutionAttempt) => attempt.relation)).toEqual([
      "initial",
      "retry",
    ]);
    expect(scheduler.scheduled.map(item => item.timeoutMs)).toEqual([5, 5]);
    expect(scheduler.cancelled).toEqual([
      { workId: result.attempts[0]!.id, reason: "timeout" },
    ]);
    expect(maxActive).toBe(1);
  });

  it("[concurrency] waits for P2.2 terminal cancellation disposition and idempotency", async () => {
    const fixture = createFixture();
    const scheduler = new RecordingSchedulerAdapter();
    const processBoundary = new ObservedProcessBoundary();
    await processBoundary.submit("process-p31");
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => {
      started = resolve;
    });
    const boundary = new ProductionSchedulerWorkerBoundary({
      scheduler,
      worker: worker(async (_order, control) => {
        started();
        return new Promise<WorkerExecutionResult>(resolve => {
          control.signal.addEventListener(
            "abort",
            () => setTimeout(() => resolve({ status: "cancelled", reason: "aborted" }), 0),
            { once: true },
          );
        });
      }),
      processBoundary,
      executionPort: productionRunExecutionPort,
    });

    const execution = boundary.execute(requestFor(fixture, {
      timeoutMs: 100,
      maxAttempts: 1,
    }));
    await startedPromise;

    const first = await boundary.cancel("execution-p31", "operator-cancel");
    const second = await boundary.cancel("execution-p31", "operator-cancel");

    expect(first).toMatchObject({
      disposition: "requested",
      status: "cancelled",
      process: { phase: "terminal", status: "cancelled" },
    });
    expect(second).toMatchObject({
      disposition: "already-terminal",
      status: "cancelled",
      process: { phase: "terminal", status: "cancelled" },
    });
    expect(processBoundary.requestDispositions).toEqual(["requested", "already-terminal"]);
    expect(processBoundary.observations.map(snapshot => snapshot.phase)).toEqual([
      "terminal",
      "terminal",
    ]);
    const result = await execution;
    expect(scheduler.cancelled).toEqual([
      { workId: result.attempts[0]!.id, reason: "operator-cancel" },
    ]);
  });

  it("[integration] retries through ExecutionAttempt ports without parallel or synthetic attempt identities", async () => {
    const fixture = createFixture();
    const scheduler = new RecordingSchedulerAdapter();
    const processBoundary = new ObservedProcessBoundary();
    await processBoundary.submit("process-p31");
    let executions = 0;
    const boundary = new ProductionSchedulerWorkerBoundary({
      scheduler,
      worker: worker(async () => {
        executions += 1;
        return executions < 3
          ? {
              status: "failed",
              error: { code: "transient", message: "temporary", retryable: true },
            }
          : { status: "succeeded", runtimeResult: fixture.runtimeResult };
      }),
      fallbackWorker: worker(async () => ({
        status: "succeeded",
        runtimeResult: fixture.runtimeResult,
      })),
      processBoundary,
      executionPort: productionRunExecutionPort,
    });

    const result = await boundary.execute(requestFor(fixture, {
      timeoutMs: 100,
      maxAttempts: 3,
      fallbackEnabled: true,
    }));

    expect(result.status).toBe("succeeded");
    expect(result.attempts.map((attempt: ExecutionAttempt) => attempt.relation)).toEqual([
      "initial",
      "retry",
      "retry",
    ]);
    expect(result.attempts.map((attempt: ExecutionAttempt) => attempt.attemptOrdinal)).toEqual([1, 2, 3]);
    expect(result.attempts.slice(1).map((attempt: ExecutionAttempt) => attempt.predecessorAttemptReference?.identity)).toEqual([
      result.attempts[0]!.id,
      result.attempts[1]!.id,
    ]);
    expect(result.run.stepStates[0]?.attemptIds).toEqual(
      result.attempts.map((attempt: ExecutionAttempt) => attempt.id),
    );
    expect(scheduler.scheduled.map(item => item.attempt.id)).toEqual(
      result.attempts.map((attempt: ExecutionAttempt) => attempt.id),
    );
    expect(scheduler.scheduled.map(item => item.attempt.status)).toEqual([
      "created",
      "created",
      "created",
    ]);
  });

  it("[integration] falls back only after retryable ExecutionAttempt retries are exhausted", async () => {
    const fixture = createFixture();
    const scheduler = new RecordingSchedulerAdapter();
    const processBoundary = new ObservedProcessBoundary();
    await processBoundary.submit("process-p31");
    let fallbackExecutions = 0;
    const boundary = new ProductionSchedulerWorkerBoundary({
      scheduler,
      worker: worker(async () => ({
        status: "failed",
        error: {
          code: "provider-unavailable",
          message: "primary unavailable",
          retryable: true,
        },
      })),
      fallbackWorker: worker(async () => {
        fallbackExecutions += 1;
        return { status: "succeeded", runtimeResult: fixture.runtimeResult };
      }),
      processBoundary,
      executionPort: productionRunExecutionPort,
    });

    const result = await boundary.execute(requestFor(fixture, {
      timeoutMs: 100,
      maxAttempts: 2,
      fallbackEnabled: true,
    }));

    expect(result.status).toBe("succeeded");
    expect(result.attempts.map((attempt: ExecutionAttempt) => attempt.relation)).toEqual([
      "initial",
      "retry",
      "fallback",
    ]);
    expect(fallbackExecutions).toBe(1);
    expect(scheduler.cancelled).toEqual([]);
    expect(result.run.stepStates[0]?.attemptIds).toEqual(
      result.attempts.map((attempt: ExecutionAttempt) => attempt.id),
    );
  });

  it("[domain] [regression] preserves ProductionRun/ExecutionAttempt ports and primitive boundary descriptors", () => {
    expect(schedulerWorkerExecutionContract).toEqual({
      scheduling: {
        identitySource: "ExecutionAttempt.id",
        relationSource: "ExecutionAttempt.relation",
        timeoutSource: "SchedulerScheduleRequest.timeoutMs",
      },
      timeout: {
        enforcedBy: "scheduler",
        failureCode: "timeout",
        cancelsScheduledWork: true,
        retryAfterCancel: true,
      },
      cancellation: {
        source: "P2.2",
        method: "requestCancellation",
        terminalDisposition: "observe",
        idempotent: true,
      },
      retry: {
        relationSource: "ExecutionAttempt",
        predecessorSource: "ExecutionAttempt.predecessorAttemptReference",
      },
      fallback: {
        relationSource: "ExecutionAttempt",
        trigger: "retry-exhausted",
      },
      processBoundary: {
        source: "P2.2",
        resultChannel: "process-result",
      },
    });
    expect(productionRunExecutionPort).toBeDefined();
  });
});
