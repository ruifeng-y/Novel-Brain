import { describe, expect, it } from "vitest";
import { InMemoryCommitTransaction } from "../../src/app/inMemoryCommitTransaction";
import { createCanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";
import { createScene } from "../../src/manuscript/domain/scene";
import { createStateRecord } from "../../src/narrative/state/domain/stateRecord";
import { createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import { createChangeSet as createChangeSetAggregate } from "../../src/production/domain/changeSet";
import { createCandidate } from "../../src/production/domain/candidate";
import { createGenerationTask } from "../../src/production/domain/generationTask";
import { createInMemoryExecutionAttemptPersistence } from "../../src/production/application/executionAttemptPersistence";
import { createReviewDecision } from "../../src/production/domain/reviewDecision";
import { createValidationRun } from "../../src/production/domain/validationRun";
import { createNarrativeCommit } from "../../src/safety/domain/narrativeCommit";
import {
  createInMemoryNarrativeProposalPersistence,
} from "../../src/story/application/narrativeProposalPersistence";
import { saveNarrativeProposalRevision } from "../../src/story/application/narrativeProposalService";
import {
  createAdoptionDecision,
  type AdoptionDecision,
  type AdoptionTarget,
} from "../../src/story/domain/adoptionDecision";
import {
  createNarrativeProposal,
  proposalSectionHash,
  type NarrativeProposal,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";
import { createFoundationWorkspaceContract } from "../../src/story/application/foundationWorkspaceContract";
import { createRunPlanRevision } from "../../src/production/domain/runPlan";
import { createProductionRun } from "../../src/production/domain/productionRun";
import { projectRecallItems } from "../../src/recall/projection/recallItemProjection";
import {
  createRecallRunObservation,
  createRecallProposedGenerationTaskRequest,
  requestRecallRunPolicy,
} from "../../src/recall/run/runAwareRecall";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import type { RuntimeRequest, RuntimeResult } from "../../src/production/runtime/runtimeAdapter";

const now = new Date("2026-10-05T06:00:00.000Z");
const later = new Date("2026-10-05T06:01:00.000Z");
const novelId = "novel-cross-system-6";

function section(id: string, text: string): NarrativeProposalSectionInput {
  return {
    id,
    content: { text },
    provenance: {
      origin: { type: "author_created", references: [] },
      editLineage: [],
      evidenceReferences: [],
      adoptionDecisionReferences: [],
    },
  };
}

function proposalFixture(): NarrativeProposal {
  return createNarrativeProposal({
    id: "proposal-cross-system-6",
    novelId,
    proposalType: "story_concept",
    scope: { dimension: "cross-system" },
    sections: [
      section("section-adopt", "Adopt this direction"),
      section("section-skip", "Keep this direction independent"),
    ],
    createdAt: now,
  });
}

function adoptionTarget(proposal: NarrativeProposal, sectionId: string, objectId: string): AdoptionTarget {
  const entry = proposal.sections.find((candidate) => candidate.id === sectionId)!;
  return {
    id: `target-${sectionId}`,
    scope: {
      proposalIdentity: proposal.id,
      proposalRevision: proposal.currentRevisionId,
      sectionIdentity: sectionId,
    },
    targetType: "canonical_fact",
    objectId,
    proposedChangeId: `change-${sectionId}`,
    adoptedContent: {
      contentReference: {
        identity: entry.id,
        version: proposal.currentRevisionId,
        hash: proposalSectionHash(entry),
      },
      contentHash: proposalSectionHash(entry),
    },
    payload: { text: entry.content.text },
    basedOnVersionSet: createVersionSet({
      fact: createVersionReference("CanonicalFact", objectId, `${objectId}:r1`),
    }),
  };
}

function adoptionFixture(proposal: NarrativeProposal): AdoptionDecision {
  return createAdoptionDecision({
    proposal,
    id: "decision-cross-system-6",
    decisionType: "adopt",
    actor: { type: "author", identity: "author-6" },
    reason: "Adopt one Foundation direction",
    decidedAt: now,
    targets: [adoptionTarget(proposal, "section-adopt", "fact-cross-system-6")],
  });
}

function emptyChangeSet() {
  const changeSetId = "change-set-cross-system-6";
  const parentRevision = createInitialChangeSetRevision({
    revisionId: `${changeSetId}:r1`,
    changeSetId,
    novelId,
    createdAt: now,
  });
  return {
    changeSet: createChangeSetAggregate({
      id: changeSetId,
      novelId,
      initialRevisionId: parentRevision.revisionId,
      createdAt: now,
    }),
    parentRevision,
  };
}

function runCoreFixture() {
  const versionSet = createVersionSet({
    scene: createVersionReference("Scene", "scene-cross-system-6", "scene-cross-system-6:r1"),
  });
  const task = createGenerationTask({
    id: "task-cross-system-6",
    novelId,
    operation: "rewrite",
    targetSceneId: "scene-cross-system-6",
    intent: "Rewrite the focused scene",
    basedOnVersionSet: versionSet,
    createdAt: now,
  });
  const candidate = createCandidate({
    id: "candidate-cross-system-6",
    taskId: task.id,
    novelId,
    basedOnVersionSet: versionSet,
    change: { type: "text", sceneId: task.targetSceneId, text: "Generated by the Run" },
    createdAt: now,
  });
  const request: RuntimeRequest = {
    taskId: task.id,
    agentRole: "writer",
    modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
    basedOnVersionSet: versionSet,
    context: {},
    requestedChange: candidate.change,
  };
  const result: RuntimeResult = {
    taskId: task.id,
    agentRole: "writer",
    modelPolicy: request.modelPolicy,
    change: candidate.change,
    basedOnVersionSet: versionSet,
  };
  const scene = createScene({
    id: task.targetSceneId,
    novelId,
    chapterId: "chapter-cross-system-6",
    title: "Cross-system scene",
    revisionId: "scene-cross-system-6:r1",
    commitId: "seed-cross-system-6",
    createdAt: now,
  });
  return {
    task,
    candidate,
    request,
    result,
    scene,
    persistence: createInMemoryExecutionAttemptPersistence(),
    routingDecision: {
      routingDecisionId: "routing-cross-system-6",
      resolverVersion: "resolver-6",
      routingPolicyVersion: "run-policy-6",
      provider: "test",
      model: "deterministic",
      reason: "run execution",
    },
    ...emptyChangeSet(),
  };
}

function coreEvidenceFixture() {
  const fact = createCanonicalFact({
    id: "fact-recall-core-6",
    novelId,
    type: "world_rule",
    content: { text: "Canon is read-only to Recall" },
    revisionId: "fact-recall-core-6:r1",
    commitId: "commit-seed-6",
    createdAt: now,
  });
  const state = createStateRecord({
    id: "state-recall-core-6",
    novelId,
    type: "world_state",
    subjectId: "world-6",
    position: { sceneId: "scene-cross-system-6", ordinal: 1 },
    content: { text: "Narrative state evidence" },
    revisionId: "state-recall-core-6:r1",
    commitId: "commit-seed-6",
    createdAt: now,
  });
  const parentRevision = createInitialChangeSetRevision({
    revisionId: "change-set-recall-core-6:r1",
    changeSetId: "change-set-recall-core-6",
    novelId,
    createdAt: now,
  });
  const validation = createValidationRun({
    id: "validation-recall-core-6",
    changeSetRevisionId: parentRevision.revisionId,
    planVersionId: "plan-recall-core-6",
    validatorId: "core-validator",
    entryResults: [],
    executionState: "completed",
    outcome: "pass",
    createdAt: now,
  });
  const approval = createReviewDecision({
    id: "approval-recall-core-6",
    changeSetRevisionId: parentRevision.revisionId,
    approvalScope: {
      requirementDomain: "canon",
      targetType: "canonical_fact",
      objectId: fact.id,
    },
    decision: "approve",
    decidedBy: "human",
    actorId: "author-6",
    reason: "Reviewed core evidence",
    evidenceReferences: [validation.id],
    createdAt: now,
  });
  const commit = createNarrativeCommit({
    id: "commit-recall-core-6",
    novelId,
    changeSetRevision: parentRevision,
    validationRuns: [validation],
    reviewDecisions: [approval],
    createdAt: now,
  });
  return { fact, state, validation, approval, commit };
}

describe("[task:6.1-6.5] cross-system integration contracts", () => {
  it("[domain] Foundation partial adoption stays independent and does not mutate Canon before commit", async () => {
    const { prepareFoundationCoreAdoption } = await import("../../src/story/application/foundationCoreIntegration");
    const persistence = createInMemoryNarrativeProposalPersistence();
    const proposal = await saveNarrativeProposalRevision(persistence, proposalFixture());
    const decision = adoptionFixture(proposal);
    const fact = createCanonicalFact({
      id: "fact-cross-system-6",
      novelId,
      type: "world_rule",
      content: { text: "before" },
      revisionId: "fact-cross-system-6:r1",
      commitId: "commit-seed-6",
      createdAt: now,
    });
    const transaction = new InMemoryCommitTransaction();
    await transaction.canonicalFacts.save(fact);
    const input = { persistence, ...emptyChangeSet(), proposal, decision, revisionId: "change-set-cross-system-6:r2", createdAt: later };
    const result = await prepareFoundationCoreAdoption(input);

    expect(result.preparation.selectedSectionIds).toEqual(["section-adopt"]);
    expect(result.preparation.unselectedSectionIds).toEqual(["section-skip"]);
    expect(result.proposalAfter).toEqual(result.proposalBefore);
    expect(result.preparation.changeSetRevision.changes[0]?.sourceType).toBe("proposal_adoption");
    expect(result.canonicalMutationBeforeCommit).toBe(false);
    expect((await transaction.canonicalFacts.findById(fact.id))?.content).toEqual({ text: "before" });
    expect(await transaction.narrativeCommits.listByNovel(novelId)).toEqual([]);
  });

  it("[persistence] Foundation adoption preparation records one independent Proposal decision", async () => {
    const { prepareFoundationCoreAdoption } = await import("../../src/story/application/foundationCoreIntegration");
    const persistence = createInMemoryNarrativeProposalPersistence();
    const proposal = await saveNarrativeProposalRevision(persistence, proposalFixture());
    const decision = adoptionFixture(proposal);
    const input = { persistence, ...emptyChangeSet(), proposal, decision, revisionId: "change-set-cross-system-6:r2", createdAt: later };

    const first = await prepareFoundationCoreAdoption(input);
    const replay = await prepareFoundationCoreAdoption(input);

    expect(replay.preparation.changeSetRevision).toEqual(first.preparation.changeSetRevision);
    expect(await persistence.decisions.listByNovel(novelId)).toHaveLength(1);
    expect((await persistence.proposals.findById(proposal.id))?.currentRevisionId).toBe(proposal.currentRevisionId);
  });

  it("[concurrency] concurrent identical Foundation adoption requests preserve one decision", async () => {
    const { prepareFoundationCoreAdoption } = await import("../../src/story/application/foundationCoreIntegration");
    const persistence = createInMemoryNarrativeProposalPersistence();
    const proposal = await saveNarrativeProposalRevision(persistence, proposalFixture());
    const decision = adoptionFixture(proposal);
    const input = { persistence, ...emptyChangeSet(), proposal, decision, revisionId: "change-set-cross-system-6:r2", createdAt: later };

    const results = await Promise.all([
      prepareFoundationCoreAdoption(input),
      prepareFoundationCoreAdoption(input),
    ]);

    expect(results[0]?.preparation.changeSetRevision).toEqual(results[1]?.preparation.changeSetRevision);
    expect(await persistence.decisions.listByNovel(novelId)).toHaveLength(1);
  });

  it("[integration] Run execution reuses Task, Attempt, Candidate, ChangeSet, Validation, Approval, and Commit", async () => {
    const { prepareRunCoreExecution } = await import("../../src/production/application/runCoreIntegration");
    const fixture = runCoreFixture();
    const prepared = await prepareRunCoreExecution({
      persistence: fixture.persistence,
      executionKey: "execution-cross-system-6",
      relation: "initial",
      generationTask: fixture.task,
      routingDecision: fixture.routingDecision,
      runtimeRequest: fixture.request,
      runtimeResult: fixture.result,
      startedAt: now,
      completedAt: later,
      candidate: fixture.candidate,
      scene: fixture.scene,
      changeSet: fixture.changeSet,
      parentRevision: fixture.parentRevision,
      changeSetRevisionId: "change-set-cross-system-6:r2",
      validationId: "validation-cross-system-6",
      planVersionId: "run-plan-cross-system-6",
      approval: {
        idPrefix: "approval-cross-system-6",
        decidedBy: "human",
        actorId: "author-6",
        reason: "Approve Run candidate",
        evidenceReferences: ["Run:run-cross-system-6"],
      },
    });

    expect(prepared.generationTask.id).toBe(fixture.task.id);
    expect(prepared.attempt.generationTaskId).toBe(fixture.task.id);
    expect(prepared.attempt.candidateReference?.identity).toBe(fixture.candidate.id);
    expect(prepared.candidate).toEqual(fixture.candidate);
    expect(prepared.changeSetRevision.changes.map((change) => change.sourceType)).toEqual(["candidate"]);
    expect(prepared.validationRun.validatorId).toBe("basic-candidate-validator");
    expect(prepared.reviewDecisions[0]?.decision).toBe("approve");
  });

  it("[transaction] Run preparation does not mutate Narrative Truth until the existing Commit service runs", async () => {
    const { prepareRunCoreExecution, commitRunCoreExecution } = await import("../../src/production/application/runCoreIntegration");
    const fixture = runCoreFixture();
    const transaction = new InMemoryCommitTransaction();
    await transaction.scenes.save(fixture.scene);
    const prepared = await prepareRunCoreExecution({
      persistence: fixture.persistence,
      executionKey: "execution-cross-system-6",
      relation: "initial",
      generationTask: fixture.task,
      routingDecision: fixture.routingDecision,
      runtimeRequest: fixture.request,
      runtimeResult: fixture.result,
      startedAt: now,
      completedAt: later,
      candidate: fixture.candidate,
      scene: fixture.scene,
      changeSet: fixture.changeSet,
      parentRevision: fixture.parentRevision,
      changeSetRevisionId: "change-set-cross-system-6:r2",
      validationId: "validation-cross-system-6",
      planVersionId: "run-plan-cross-system-6",
      approval: {
        idPrefix: "approval-cross-system-6",
        decidedBy: "human",
        actorId: "author-6",
        reason: "Approve Run candidate",
        evidenceReferences: ["Run:run-cross-system-6"],
      },
    });

    expect((await transaction.scenes.findById(fixture.scene.id))?.text).toBe("");
    const commit = await commitRunCoreExecution({
      transaction,
      preparation: prepared,
      commitId: "commit-cross-system-6",
      currentRevisionFacts: { unresolvedConflict: false, stale: false },
      requiredApproval: true,
      now: later,
    });

    expect(commit.status).toBe("committed");
    expect((await transaction.scenes.findById(fixture.scene.id))?.text).toBe("Generated by the Run");
  });

  it("[recovery] Run preparation replays the same execution identity and artifacts", async () => {
    const { prepareRunCoreExecution } = await import("../../src/production/application/runCoreIntegration");
    const fixture = runCoreFixture();
    const input = {
      persistence: fixture.persistence,
      executionKey: "execution-cross-system-6",
      relation: "initial" as const,
      generationTask: fixture.task,
      routingDecision: fixture.routingDecision,
      runtimeRequest: fixture.request,
      runtimeResult: fixture.result,
      startedAt: now,
      completedAt: later,
      candidate: fixture.candidate,
      scene: fixture.scene,
      changeSet: fixture.changeSet,
      parentRevision: fixture.parentRevision,
      changeSetRevisionId: "change-set-cross-system-6:r2",
      validationId: "validation-cross-system-6",
      planVersionId: "run-plan-cross-system-6",
      approval: {
        idPrefix: "approval-cross-system-6",
        decidedBy: "human" as const,
        actorId: "author-6",
        reason: "Approve Run candidate",
        evidenceReferences: ["Run:run-cross-system-6"],
      },
    };

    const first = await prepareRunCoreExecution(input);
    const replay = await prepareRunCoreExecution(input);

    expect(replay).toEqual(first);
    expect(await fixture.persistence.attempts.listByNovel(novelId)).toHaveLength(1);
  });

  it("[replay] Recall consumes read-only Core evidence and projections deterministically", async () => {
    const { observeCoreForRecall } = await import("../../src/recall/application/coreRecallIntegration");
    const fixture = coreEvidenceFixture();
    const input = {
      narrative: { sourceIdentity: "core-narrative-6", records: [fixture.state] },
      validation: { sourceIdentity: "core-validation-6", runs: [fixture.validation] },
      reviewDecisions: { sourceIdentity: "core-review-6", decisions: [fixture.approval] },
      narrativeCommits: { sourceIdentity: "core-commit-6", commits: [fixture.commit] },
    };
    const before = structuredClone(input);

    const first = await observeCoreForRecall(input);
    const replay = await observeCoreForRecall(input);

    expect(replay).toEqual(first);
    expect(input).toEqual(before);
    expect(first.observations.map((entry) => entry.evidenceReference)).toEqual([
      "ValidationRun:validation-recall-core-6",
      "ReviewDecision:approval-recall-core-6",
      "NarrativeCommit:commit-recall-core-6",
      "StateRecord:state-recall-core-6",
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.observations)).toBe(true);
  });

  it("[cross-system] Recall proposed GenerationTask enters normal Run policy without auto task or commit", async () => {
    const { createNormalRunPolicyRequestPort } = await import("../../src/recall/application/runRecallIntegration");
    const plan = createRunPlanRevision({
      id: "run-plan-cross-system-6:r1",
      planId: "run-plan-cross-system-6",
      novelId,
      revisionNumber: 1,
      goal: "Exercise Recall Run policy",
      steps: [{ id: "step-6", ordinal: 1, generationTaskId: "task-cross-system-6", dependsOn: [] }],
      createdAt: now,
    });
    const run = createProductionRun({
      id: "run-cross-system-6",
      novelId,
      runPlanRevision: plan,
      createdAt: now,
    });
    const observation = createRecallRunObservation({
      run,
      checkpoints: [],
      observedAt: "2026-10-05T06:02:00.000Z",
    });
    const action = createRecallProposedGenerationTaskRequest({
      observation,
      proposal: {
        operation: "consistency_analysis",
        targetSceneId: "scene-cross-system-6",
        intent: "Check the scene for consistency risk",
        basedOnVersionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-cross-system-6", "scene-cross-system-6:r1"),
        }),
      },
      reason: "Run evidence suggests a consistency check",
      evidenceReferences: ["RunSignal:run-cross-system-6"],
      actorId: "recall",
      requestedAt: "2026-10-05T06:03:00.000Z",
    });
    const port = createNormalRunPolicyRequestPort({
      run,
      policyVersion: "run-policy-6",
      allowProposedGenerationTask: true,
    });
    const result = await requestRecallRunPolicy({ action, port });

    expect(result.receipt.status).toBe("queued");
    expect(result.blocking).toBe(false);
    expect(port.effects.taskIds).toEqual([]);
    expect(port.effects.commitIds).toEqual([]);
  });

  it("[regression] Workspace Focus, Proposal, Run, and Attention stay coherent under Core truth ownership", async () => {
    const { createWorkspaceIntegrationContract } = await import("../../src/app/workspaceIntegrationContract");
    const persistence = createInMemoryNarrativeProposalPersistence();
    const proposal = await saveNarrativeProposalRevision(persistence, proposalFixture());
    const foundation = createFoundationWorkspaceContract({ persistence });
    const plan = createRunPlanRevision({
      id: "run-plan-workspace-6:r1",
      planId: "run-plan-workspace-6",
      novelId,
      revisionNumber: 1,
      goal: "Workspace coherence",
      steps: [{ id: "step-workspace-6", ordinal: 1, generationTaskId: "task-workspace-6", dependsOn: [] }],
      createdAt: now,
    });
    const run = createProductionRun({ id: "run-workspace-6", novelId, runPlanRevision: plan, createdAt: now });
    const projected = projectRecallItems({
      candidates: [{
        candidateId: "candidate-attention-6",
        detectionKind: "validation_attention",
        classification: "validation",
        priority: "normal",
        reason: "Validation evidence needs attention",
        evidence: [{
          sourceKind: "validation",
          evidenceReference: "ValidationRun:validation-workspace-6",
          sourceReference: {
            identity: "validation-workspace-6",
            version: "change-set-workspace-6:r1",
            hash: "validation-hash-6",
          },
          staleness: "fresh",
        }],
      }],
    })[0]!;
    const item = {
      ...projected,
      novelId,
      evidenceFingerprint: "workspace-attention-fingerprint-6",
    };
    const contract = createWorkspaceIntegrationContract({ foundation });
    const view = await contract.query({
      novelId,
      focus: { object: "proposal", objectId: proposal.id, mode: "design" },
      run: {
        runId: run.id,
        novelId: run.novelId,
        status: run.status,
        planRevisionReference: run.planRevisionReference,
        stepStates: run.stepStates,
      },
      attention: { novelId, items: [item], dispositions: [] },
    });

    expect(view.focus.objectId).toBe(proposal.id);
    expect(view.proposal.narrativeTruth.owner).toBe("shared-novel-engine");
    expect(view.run?.runId).toBe(run.id);
    expect(view.attention.items).toEqual([item]);
    expect(view.sharedTruth).toMatchObject({
      owner: "shared-novel-engine",
      foundationOwnsNarrativeTruth: false,
      runOwnsNarrativeTruth: false,
      recallOwnsNarrativeTruth: false,
    });
    await expect(contract.query({
      novelId,
      focus: { object: "proposal", objectId: proposal.id, mode: "design" },
      run: { ...view.run!, novelId: "other-novel" },
    })).rejects.toThrow("Workspace contracts must share one Novel identity");
  });
});
