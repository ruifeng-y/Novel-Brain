import { describe, expect, it } from "vitest";
import {
  InMemoryLongRunningProcessBoundary,
} from "../../src/application/longRunningProcessBoundary";
import {
  buildRunAuditEvents,
  replayRunAuditEvents,
} from "../../src/production/application/runAuditProjection";
import {
  ProductionRunRecoveryBoundary,
  productionRunRecoveryContract,
} from "../../src/production/application/productionRunRecoveryIntegration";
import {
  createInMemoryExecutionRecoveryPersistence,
  type ExecutionRecoveryPersistence,
} from "../../src/production/application/executionRecoveryService";
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
import type {
  SchedulerAdapter,
  SchedulerScheduleRequest,
  ScheduledWorkOrder,
  WorkerAdapter,
  WorkerExecutionControl,
  WorkerExecutionResult,
} from "../../src/production/runtime/schedulerWorkerBoundary";
import type {
  RuntimeRequest,
  RuntimeResult,
} from "../../src/production/runtime/runtimeAdapter";
import {
  createVersionReference,
  createVersionSet,
} from "../../src/shared/domain/versioning";
import {
  runCompensationCommitId,
  runCompensationIdempotencyKey,
} from "../../src/production/application/runCompensationService";

const now = new Date("2026-10-05T12:00:00.000Z");
const later = new Date("2026-10-05T12:01:00.000Z");
const final = new Date("2026-10-05T12:02:00.000Z");

function routing(id: string): ExecutionRoutingDecisionReference {
  return {
    routingDecisionId: id,
    resolverVersion: "resolver-1",
    routingPolicyVersion: "policy-1",
    provider: "test",
    model: "deterministic",
    reason: "recovery",
  };
}

function createFixture() {
  const revision = createRunPlanRevision({
    id: "run-plan-p32:r1",
    planId: "run-plan-p32",
    novelId: "novel-p32",
    revisionNumber: 1,
    goal: "Crash recovery",
    steps: [{ id: "step-a", ordinal: 1, generationTaskId: "task-p32", dependsOn: [] }],
    createdAt: now,
  });
  const approval = createRunPlanApproval({
    id: "approval-p32:r1",
    revision,
    approvedBy: "author-1",
    approvedAt: now,
  });
  expect(approveRunPlanRevision(approval, revision)).toBe(true);
  const run = startProductionRun(
    approveProductionRun(
      planProductionRun(
        createProductionRun({
          id: "run-p32",
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
    id: "task-p32",
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
  return { revision, run, generationTask, runtimeRequest, runtimeResult };
}

class RecordingSchedulerAdapter implements SchedulerAdapter {
  readonly scheduled: SchedulerScheduleRequest[] = [];
  constructor(private readonly failAfterSchedules?: number) {}

  async schedule(request: SchedulerScheduleRequest): Promise<ScheduledWorkOrder> {
    this.scheduled.push(request);
    if (
      this.failAfterSchedules !== undefined &&
      this.scheduled.length > this.failAfterSchedules
    ) {
      throw new Error("process crashed before retry schedule");
    }
    return { ...request, workId: request.attempt.id };
  }

  async cancel(workId: string, reason: string) {
    return {
      workId,
      disposition: "cancelled" as const,
      cancellationRequested: true as const,
    };
  }
}

class IdempotentWorker implements WorkerAdapter {
  readonly callsByAttemptId = new Map<string, number>();
  readonly committedEffects = new Set<string>();

  constructor(
    private readonly resultFor: (attempt: ExecutionAttempt, invocation: number) => WorkerExecutionResult,
  ) {}

  async execute(
    order: ScheduledWorkOrder,
    _control: WorkerExecutionControl,
  ): Promise<WorkerExecutionResult> {
    const attemptId = order.attempt.id;
    const invocation = (this.callsByAttemptId.get(attemptId) ?? 0) + 1;
    this.callsByAttemptId.set(attemptId, invocation);
    if (!this.committedEffects.has(attemptId)) this.committedEffects.add(attemptId);
    return this.resultFor(order.attempt, invocation);
  }
}

function requestFor(
  fixture: ReturnType<typeof createFixture>,
  executionKey = "execution-p32",
) {
  return {
    run: fixture.run,
    runPlanRevision: fixture.revision,
    generationTask: fixture.generationTask,
    stepId: "step-a",
    executionKey,
    routingDecision: routing("routing-p32"),
    runtimeRequest: fixture.runtimeRequest,
    policy: { timeoutMs: 100, maxAttempts: 2, fallbackEnabled: false },
    process: { id: "process-p32" },
  };
}

function terminalCommitFailurePersistence(
  source: ExecutionRecoveryPersistence,
): ExecutionRecoveryPersistence {
  let failuresRemaining = 1;
  return {
    ...source,
    transaction: {
      run: (work) => source.transaction.run(async (transactionWork) => work({
        ...transactionWork,
        attempts: new Proxy(transactionWork.attempts, {
          get(target, property, receiver) {
            if (property === "saveRevisionIfAbsent") {
              return async (attempt: ExecutionAttempt) => {
                if (attempt.status === "succeeded" && failuresRemaining > 0) {
                  failuresRemaining -= 1;
                  throw new Error("process crashed before terminal commit");
                }
                return target.saveRevisionIfAbsent(attempt);
              };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      })),
    },
  };
}

function auditInput(
  fixture: ReturnType<typeof createFixture>,
  run: ReturnType<typeof createFixture>["run"],
  attempts: readonly ExecutionAttempt[],
) {
  return {
    run,
    generationTasks: [fixture.generationTask],
    attempts,
    candidates: [],
    changeSetRevisions: [],
    validationRuns: [],
    reviewDecisions: [],
    narrativeCommits: [],
    thresholdDecisions: [],
    checkpoints: [],
    costs: [],
  };
}

describe("[task:P3.2] crash recovery and duplicate prevention", () => {
  it("[integration] [persistence] [transaction] [recovery] resumes the same Attempt after a pre-commit process crash without a half commit", async () => {
    const fixture = createFixture();
    const persistence = createInMemoryExecutionRecoveryPersistence();
    const crashingPersistence = terminalCommitFailurePersistence(persistence);
    const processBoundary = new InMemoryLongRunningProcessBoundary<RuntimeResult>();
    await processBoundary.submit({ id: "process-p32", kind: "generation" });
    const worker = new IdempotentWorker(() => ({
      status: "succeeded",
      runtimeResult: fixture.runtimeResult,
    }));

    const crashed = new ProductionRunRecoveryBoundary({
      persistence: crashingPersistence,
      scheduler: new RecordingSchedulerAdapter(),
      worker,
      processBoundary,
      now: () => now,
    });

    await expect(crashed.execute(requestFor(fixture))).rejects.toThrow(
      "process crashed before terminal commit",
    );

    const currentRun = await persistence.runs.findById("run-p32");
    const attemptId = currentRun?.stepStates[0]?.attemptIds[0];
    expect(attemptId).toBeDefined();
    expect((await persistence.attempts.findById(attemptId!))?.status).toBe("running");
    expect(currentRun?.stepStates[0]?.status).toBe("running");

    const restarted = new ProductionRunRecoveryBoundary({
      persistence,
      scheduler: new RecordingSchedulerAdapter(),
      worker,
      processBoundary,
      now: () => later,
    });

    const recovered = await restarted.execute(requestFor(fixture));
    expect(recovered.disposition).toBe("resumed");
    expect(recovered.attempts).toHaveLength(1);
    expect(recovered.attempts[0]?.id).toBe(attemptId);
    expect(worker.callsByAttemptId.get(attemptId!)).toBe(2);
    expect(worker.committedEffects).toEqual(new Set([attemptId]));
    expect((await persistence.attempts.findById(attemptId!))?.status).toBe("succeeded");
    expect((await persistence.runs.findById("run-p32"))?.stepStates[0]?.status).toBe("succeeded");
  });

  it("[concurrency] [recovery] converges duplicate retry recovery to one deterministic Attempt and one effect", async () => {
    const fixture = createFixture();
    const persistence = createInMemoryExecutionRecoveryPersistence();
    const processBoundary = new InMemoryLongRunningProcessBoundary<RuntimeResult>();
    await processBoundary.submit({ id: "process-p32", kind: "generation" });
    const firstWorker = new IdempotentWorker(() => ({
      status: "failed",
      error: { code: "transient", message: "temporary", retryable: true },
    }));
    const crashed = new ProductionRunRecoveryBoundary({
      persistence,
      scheduler: new RecordingSchedulerAdapter(1),
      worker: firstWorker,
      processBoundary,
      now: () => now,
    });

    await expect(crashed.execute(requestFor(fixture))).rejects.toThrow(
      "process crashed before retry schedule",
    );

    const retryWorker = new IdempotentWorker(attempt =>
      attempt.attemptOrdinal === 1
        ? { status: "failed", error: { code: "transient", message: "temporary", retryable: true } }
        : { status: "succeeded", runtimeResult: fixture.runtimeResult },
    );
    const leftBoundary = new ProductionRunRecoveryBoundary({
      persistence,
      scheduler: new RecordingSchedulerAdapter(),
      worker: retryWorker,
      processBoundary,
      now: () => later,
    });
    const rightBoundary = new ProductionRunRecoveryBoundary({
      persistence,
      scheduler: new RecordingSchedulerAdapter(),
      worker: retryWorker,
      processBoundary,
      now: () => final,
    });

    const [left, right] = await Promise.all([
      leftBoundary.execute(requestFor(fixture)),
      rightBoundary.execute(requestFor(fixture)),
    ]);

    expect(left.disposition).toBe("resumed");
    expect(right.disposition).toBe("resumed");
    expect(left.attempts.map((attempt: ExecutionAttempt) => attempt.id)).toEqual(
      right.attempts.map((attempt: ExecutionAttempt) => attempt.id),
    );
    expect(left.attempts.map((attempt: ExecutionAttempt) => attempt.relation)).toEqual([
      "initial",
      "retry",
    ]);
    const retryId = left.attempts[1]!.id;
    expect(retryWorker.committedEffects.has(retryId)).toBe(true);
    expect(retryWorker.callsByAttemptId.get(retryId)).toBeGreaterThanOrEqual(1);
    expect((await persistence.runs.findById("run-p32"))?.stepStates[0]?.attemptIds).toEqual(
      left.attempts.map((attempt: ExecutionAttempt) => attempt.id),
    );
  });

  it("[replay] replays terminal state without executing twice or duplicating run audit events", async () => {
    const fixture = createFixture();
    const persistence = createInMemoryExecutionRecoveryPersistence();
    const processBoundary = new InMemoryLongRunningProcessBoundary<RuntimeResult>();
    await processBoundary.submit({ id: "process-p32", kind: "generation" });
    const worker = new IdempotentWorker(() => ({
      status: "succeeded",
      runtimeResult: fixture.runtimeResult,
    }));
    const request = requestFor(fixture);

    const first = await new ProductionRunRecoveryBoundary({
      persistence,
      scheduler: new RecordingSchedulerAdapter(),
      worker,
      processBoundary,
      now: () => now,
    }).execute(request);

    const replay = await new ProductionRunRecoveryBoundary({
      persistence,
      scheduler: new RecordingSchedulerAdapter(),
      worker,
      processBoundary,
      now: () => later,
    }).execute(request);

    expect(replay.disposition).toBe("replayed");
    expect(replay.attempts).toEqual(first.attempts);
    expect(worker.callsByAttemptId.get(first.attempts[0]!.id)).toBe(1);
    expect((await processBoundary.observe("process-p32"))).toMatchObject({
      phase: "terminal",
      status: "succeeded",
    });

    const events = buildRunAuditEvents(auditInput(fixture, replay.run, replay.attempts));
    const replayedEvents = replayRunAuditEvents([...events, ...events]).events;
    expect(replayedEvents.map((event) => event.eventId)).toEqual(
      events.map((event) => event.eventId),
    );
    expect(replayedEvents).toHaveLength(events.length);
  });

  it("[domain] [cross-system] [regression] keeps Narrative Truth and compensation outside recovery ownership", () => {
    expect(productionRunRecoveryContract).toEqual({
      crash: {
        resumeIdentity: "ExecutionAttempt.id",
        schedulerReplay: "same-work-id",
        workerIdempotencyKey: "ExecutionAttempt.id",
      },
      duplicatePrevention: {
        attemptIdentity: "deterministic-ExecutionAttempt-id",
        scheduleDisposition: "return-existing-attempt",
      },
      atomicity: {
        unit: ["ExecutionAttempt", "ProductionRun"],
      },
      replay: {
        terminalDisposition: "return-persisted-result",
        processResult: "idempotent",
      },
      compensation: {
        owner: "runCompensationService",
        idempotencyKeySource: "runId+sourceCommitId",
        commitIdSource: "runId+sourceCommitId",
      },
      narrativeTruth: {
        owned: false,
      },
    });
    expect(runCompensationIdempotencyKey("run-p32", "commit-1")).toBe(
      runCompensationIdempotencyKey("run-p32", "commit-1"),
    );
    expect(runCompensationCommitId("run-p32", "commit-1")).toBe(
      runCompensationCommitId("run-p32", "commit-1"),
    );
  });
});
