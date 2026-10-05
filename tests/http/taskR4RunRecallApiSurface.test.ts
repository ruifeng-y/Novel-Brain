import { describe, expect, it } from "vitest";
import { createNovelBrainServer } from "../../src/http/server";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import type { HttpBoundaryPipeline } from "../../src/http/httpBoundaryPipeline";
import { saveRunPlanApproval } from "../../src/production/application/runPlanService";
import { createRunPlanApproval } from "../../src/production/domain/runPlan";

function harness() {
  const calls: string[] = [];
  const pipeline: HttpBoundaryPipeline = {
    async execute(contractId, _context, input, handler) {
      calls.push(contractId);
      return handler(input);
    },
  };
  const dependencies = createInMemoryEngineDependencies();
  const app = createNovelBrainServer(dependencies, { httpBoundaryPipeline: pipeline });
  return { app, calls, dependencies };
}

async function startRun(app: ReturnType<typeof harness>["app"], dependencies: ReturnType<typeof harness>["dependencies"]) {
  const created = await app.inject({
    method: "POST",
    url: "/run-plans",
    payload: {
      id: "plan-revision-1",
      planId: "plan-1",
      novelId: "novel-1",
      revisionNumber: 1,
      goal: "Draft the opening arc",
      steps: [{ id: "step-1", ordinal: 1, generationTaskId: "generation-task-1", dependsOn: [] }],
    },
  });
  expect(created.statusCode).toBe(201);

  const revision = await dependencies.product!.runPersistence.planRevisions.findById("plan-revision-1");
  expect(revision).toBeDefined();
  await saveRunPlanApproval(
    dependencies.product!.runPersistence,
    createRunPlanApproval({
      id: "plan-approval-1",
      revision: revision!,
      approvedBy: "author-1",
      approvedAt: new Date("2026-10-05T00:30:00.000Z"),
    }),
  );

  return app.inject({
    method: "POST",
    url: "/runs",
    payload: { id: "run-1", novelId: "novel-1", runPlanRevisionId: "plan-revision-1" },
  });
}

describe("[task:R4] [integration] production run product API", () => {
  it("creates, starts, pauses, resumes, and reports a production run", async () => {
    const { app, calls, dependencies } = harness();

    const started = await startRun(app, dependencies);
    expect(started.statusCode).toBe(201);
    expect(started.json().run.status).toBe("running");
    expect(started.json().stateBoundary.ownsNarrativeTruth).toBe(false);

    const paused = await app.inject({
      method: "POST",
      url: "/runs/run-1/pause",
      payload: { reason: "awaiting author review" },
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json().run.status).toBe("paused");

    const resumed = await app.inject({ method: "POST", url: "/runs/run-1/resume", payload: {} });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().run.status).toBe("running");

    const status = await app.inject({ method: "GET", url: "/runs/run-1/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json().run.status).toBe("running");

    expect(calls).toEqual([
      "run.command.create-run-plan-revision",
      "run.command.start-run",
      "run.command.pause-run",
      "run.command.resume-run",
      "run.query.run-status",
    ]);
  });
});

describe("[task:R4] [cross-system] recall attention product API", () => {
  it("exposes read-only attention and records a disposition without creating tasks", async () => {
    const { app, calls } = harness();

    const attention = await app.inject({ method: "GET", url: "/novels/novel-1/attention" });
    expect(attention.statusCode).toBe(200);
    expect(attention.json().authority).toMatchObject({
      authoritative: false,
      mayMutateNarrativeTruth: false,
      mayCreateTaskDirectly: false,
      proposedActionChannel: "production-run-policy",
    });

    const disposition = await app.inject({
      method: "POST",
      url: "/attention/attention-1/dispositions",
      payload: {
        novelId: "novel-1",
        candidateId: "candidate-1",
        evidenceFingerprint: "fingerprint-1",
        reason: "stale canon evidence",
        evidenceReferences: ["evidence-1"],
        action: "dismiss",
      },
    });
    expect(disposition.statusCode).toBe(201);
    expect(disposition.json().state).toBe("dismissed");

    expect(calls).toEqual([
      "recall.query.recall-attention",
      "recall.command.record-recall-disposition",
    ]);
  });
});
