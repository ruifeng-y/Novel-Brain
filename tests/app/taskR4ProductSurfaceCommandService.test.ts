import { describe, expect, it } from "vitest";
import { createProductSurfaceCommandService } from "../../src/app/productSurfaceCommandService";
import { createInMemoryNarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";
import { createInMemoryRunOrchestrationPersistence } from "../../src/production/application/runPlanPersistence";
import { saveRunPlanApproval } from "../../src/production/application/runPlanService";
import { createRunPlanApproval } from "../../src/production/domain/runPlan";
import { createInMemoryAttentionDispositionPersistence } from "../../src/recall/attention/attentionDispositionPersistence";
import type {
  RuntimeAdapter,
  RuntimeResult,
} from "../../src/production/runtime/runtimeAdapter";
import { createVersionSet } from "../../src/shared/domain/versioning";
import type { ProposalSectionProvenance } from "../../src/story/domain/narrativeProposal";
import { createSourceReference } from "../../src/shared/domain/observationSource";

const revision = createSourceReference({
  identity: "novel-1",
  version: "rev-1",
  hash: "novel-reference-hash",
});

const provenance: ProposalSectionProvenance = {
  origin: { type: "ai_generated", references: [revision] },
  editLineage: [],
  evidenceReferences: [revision],
  adoptionDecisionReferences: [],
};

const runtime: RuntimeAdapter = {
  async execute(request): Promise<RuntimeResult> {
    if (request.requestedChange.type !== "structured_state") {
      throw new Error("foundation design request must be structured_state");
    }
    return {
      taskId: request.taskId,
      agentRole: request.agentRole,
      modelPolicy: request.modelPolicy,
      basedOnVersionSet: request.basedOnVersionSet,
      change: {
        type: "structured_state",
        stateRecordId: request.requestedChange.stateRecordId,
        content: {
          sections: [{ id: "section-1", content: { text: "A city remembers every promise." } }],
          openQuestions: [],
        },
      },
    };
  },
};

function surface() {
  return createProductSurfaceCommandService({
    foundationPersistence: createInMemoryNarrativeProposalPersistence(),
    runPersistence: createInMemoryRunOrchestrationPersistence(),
    attentionPersistence: createInMemoryAttentionDispositionPersistence(),
    runtime,
  });
}

function generationOptions() {
  return {
    taskId: "generation-task-1",
    agentRole: "planner" as const,
    modelPolicy: { provider: "reference", model: "reference-1", maxOutputTokens: 128 },
    basedOnVersionSet: createVersionSet({
      novel: { aggregateType: "Novel" as const, objectId: "novel-1", revisionId: "rev-1" },
    }),
  };
}

describe("[task:R4] [domain] foundation product flow", () => {
  it("creates an idea proposal and advances it without adopting automatically", async () => {
    const service = surface();

    const entry = await service.createFoundationEntry({
      entryId: "foundation-entry-1",
      novelId: "novel-1",
      proposalId: "proposal-1",
      mode: "idea",
      idea: "A city remembers every promise.",
      proposalType: "story_concept",
      scope: { kind: "novel" },
      occurredAt: new Date("2026-10-05T00:00:00.000Z"),
      generation: generationOptions(),
    });

    expect(entry.mode).toBe("idea");
    expect(entry.status).toBe("proposal_created");
    expect(entry.proposalId).toBe("proposal-1");
    expect(entry.automaticCommit).toBe(false);

    const advanced = await service.advanceProposal({
      proposalId: "proposal-1",
      from: "frame",
      to: "explore",
      changes: [
        {
          kind: "add_open_question",
          question: { id: "question-1", text: "Who remembers?", scope: { kind: "proposal" }, state: "open", provenance },
        },
      ],
      revisedAt: new Date("2026-10-05T01:00:00.000Z"),
    });

    expect(advanced.stage).toBe("explore");
    expect(advanced.transition.kind).toBe("advance");
    expect(advanced.automaticCommit).toBe(false);
  });

  it("creates an empty narrative state for blank entry without runtime generation", async () => {
    const service = surface();
    const entry = await service.createFoundationEntry({
      entryId: "foundation-entry-blank",
      novelId: "novel-1",
      mode: "blank",
    });

    expect(entry.mode).toBe("blank");
    expect(entry.status).toBe("empty_narrative_state");
    expect(entry.proposalId).toBeUndefined();
    expect(entry.automaticCommit).toBe(false);
  });
});

describe("[task:R4] [integration] run lifecycle product surface", () => {
  it("starts, pauses, and resumes a run without owning Narrative Truth", async () => {
    const runPersistence = createInMemoryRunOrchestrationPersistence();
    const service = createProductSurfaceCommandService({
      foundationPersistence: createInMemoryNarrativeProposalPersistence(),
      runPersistence,
      attentionPersistence: createInMemoryAttentionDispositionPersistence(),
      runtime,
    });
    const planRevision = await service.createRunPlanRevision({
      id: "plan-revision-1",
      planId: "plan-1",
      novelId: "novel-1",
      revisionNumber: 1,
      goal: "Draft the opening arc",
      steps: [{ id: "step-1", ordinal: 1, generationTaskId: "generation-task-1", dependsOn: [] }],
      createdAt: new Date("2026-10-05T00:00:00.000Z"),
    });
    expect(planRevision.contentHash).toBeTruthy();

    await saveRunPlanApproval(
      runPersistence,
      createRunPlanApproval({
        id: "plan-approval-1",
        revision: planRevision,
        approvedBy: "author-1",
        approvedAt: new Date("2026-10-05T00:30:00.000Z"),
      }),
    );

    const started = await service.startRun({
      id: "run-1",
      novelId: "novel-1",
      runPlanRevision: planRevision,
      createdAt: new Date("2026-10-05T01:00:00.000Z"),
    });
    expect(started.run.status).toBe("running");
    expect(started.stateBoundary.narrativeStateOwner).toBe("shared-novel-engine");
    expect(started.stateBoundary.ownsNarrativeTruth).toBe(false);
    expect(started.stateBoundary.automaticCommit).toBe(false);

    const paused = await service.pauseRun({
      runId: "run-1",
      at: new Date("2026-10-05T02:00:00.000Z"),
      reason: "awaiting author review",
    });
    expect(paused.run.status).toBe("paused");

    const resumed = await service.resumeRun({
      runId: "run-1",
      at: new Date("2026-10-05T03:00:00.000Z"),
    });
    expect(resumed.run.status).toBe("running");

    const status = await service.getRunStatus({ runId: "run-1" });
    expect(status.run.status).toBe("running");
  });

  it("refuses to start a run from an unapproved Run Plan Revision", async () => {
    const service = surface();
    const planRevision = await service.createRunPlanRevision({
      id: "plan-revision-2",
      planId: "plan-2",
      novelId: "novel-1",
      revisionNumber: 1,
      goal: "Ungoverned plan",
      steps: [{ id: "step-1", ordinal: 1, generationTaskId: "generation-task-1", dependsOn: [] }],
      createdAt: new Date("2026-10-05T00:00:00.000Z"),
    });

    await expect(
      service.startRun({
        id: "run-unapproved",
        novelId: "novel-1",
        runPlanRevision: planRevision,
        createdAt: new Date("2026-10-05T01:00:00.000Z"),
      }),
    ).rejects.toThrow("not approved");
  });
});

describe("[task:R4] [cross-system] recall attention product surface", () => {
  it("keeps Recall read-only and routes proposed action through Production Run policy", async () => {
    const service = surface();

    const attention = await service.getAttention({ novelId: "novel-1" });
    expect(attention.authority.authoritative).toBe(false);
    expect(attention.authority.mayMutateNarrativeTruth).toBe(false);
    expect(attention.authority.mayCreateTaskDirectly).toBe(false);
    expect(attention.authority.mayCommit).toBe(false);
    expect(attention.authority.proposedActionChannel).toBe("production-run-policy");
    expect(attention.truthOwner).toBe("shared-novel-engine");
    expect(attention.items).toEqual([]);
    expect(attention.dispositions).toEqual([]);

    const record = await service.disposeAttention({
      item: {
        itemId: "attention-1",
        novelId: "novel-1",
        candidateId: "candidate-1",
        evidenceFingerprint: "fingerprint-1",
        explanation: { reason: "stale canon evidence", evidenceReferences: ["evidence-1"] },
      },
      action: "dismiss",
      actorId: "author-1",
      occurredAt: "2026-10-05T00:00:00.000Z",
    });
    expect(record.state).toBe("dismissed");

    const after = await service.getAttention({ novelId: "novel-1" });
    expect(after.dispositions.map(disposition => disposition.itemId)).toEqual(["attention-1"]);
    expect(after.authority.mayCreateTaskDirectly).toBe(false);
  });
});
