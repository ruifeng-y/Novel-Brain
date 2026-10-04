import { describe, expect, it } from "vitest";
import { InMemoryCommitTransaction } from "../../src/app/inMemoryCommitTransaction";
import { commitChangeSetRevision } from "../../src/safety/application/commitChangeSetRevision";
import { createCanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";
import { createScene } from "../../src/manuscript/domain/scene";
import { createStateRecord } from "../../src/narrative/state/domain/stateRecord";
import { createChange } from "../../src/production/domain/change";
import { createChangeSet } from "../../src/production/domain/changeSet";
import { createChangeSetRevision, createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import { createReviewDecision } from "../../src/production/domain/reviewDecision";
import { createValidationRun } from "../../src/production/domain/validationRun";
import {
  createInMemoryNarrativeProposalPersistence,
  type NarrativeProposalPersistence,
} from "../../src/story/application/narrativeProposalPersistence";
import {
  recordFoundationAdoptionPreparation,
  prepareFoundationAdoptionChangeSet,
  type FoundationAdoptionPreparation,
} from "../../src/story/application/foundationAdoptionService";
import {
  createFoundationWorkspaceContract,
  type FoundationWorkspaceFocus,
} from "../../src/story/application/foundationWorkspaceContract";
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
import { canonicalJson } from "../../src/shared/domain/contentHash";
import { createVersionReference, createVersionSet, type VersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-04T06:00:00.000Z");
const later = new Date("2026-10-04T07:00:00.000Z");

function section(id: string, text: string): NarrativeProposalSectionInput {
  return {
    id,
    content: { text },
    provenance: {
      origin: { type: "ai_generated", references: [] },
      editLineage: [],
      evidenceReferences: [],
      adoptionDecisionReferences: [],
    },
  };
}

function proposalFixture(
  id = "proposal-foundation-adoption",
  novelId = "novel-foundation-adoption",
  sectionIds = ["section-a", "section-b"],
): NarrativeProposal {
  return createNarrativeProposal({
    id,
    novelId,
    proposalType: "story_concept",
    scope: { dimension: "story-concept" },
    sections: sectionIds.map((sectionId) => section(sectionId, `Direction ${sectionId}`)),
    openQuestions: [
      {
        id: `question-${id}`,
        text: "Which ending fits the central conflict?",
        scope: { kind: "proposal" },
        state: "open",
        provenance: {
          origin: { type: "author_created", references: [] },
          editLineage: [],
          evidenceReferences: [],
          adoptionDecisionReferences: [],
        },
      },
    ],
    createdAt: now,
  });
}

function baseVersionSet(key: string, objectId: string): VersionSet {
  return createVersionSet({
    [key]: createVersionReference("StateRecord", objectId, `${objectId}:r1`),
  });
}

function target(
  proposal: NarrativeProposal,
  sectionIdentity: string,
  targetType: AdoptionTarget["targetType"],
  objectId: string,
  proposedChangeId: string,
  basedOnVersionSet: VersionSet = baseVersionSet("base", objectId),
): AdoptionTarget {
  const entry = proposal.sections.find((candidate) => candidate.id === sectionIdentity)!;
  return {
    id: `target-${proposedChangeId}`,
    scope: {
      proposalIdentity: proposal.id,
      proposalRevision: proposal.currentRevisionId,
      sectionIdentity,
    },
    targetType,
    objectId,
    proposedChangeId,
    adoptedContent: {
      contentReference: {
        identity: entry.id,
        version: proposal.currentRevisionId,
        hash: proposalSectionHash(entry),
      },
      contentHash: proposalSectionHash(entry),
    },
    payload: targetType === "manuscript" ? { text: entry.content.text } : { content: { text: entry.content.text } },
    basedOnVersionSet,
  };
}

function decision(
  proposal: NarrativeProposal,
  targets: readonly AdoptionTarget[],
  id = "decision-foundation-adoption",
): AdoptionDecision {
  return createAdoptionDecision({
    proposal,
    id,
    decisionType: "adopt",
    actor: { type: "author", identity: "author-1" },
    reason: "Adopt selected Foundation directions",
    decidedAt: now,
    targets,
  });
}

function emptyChangeSet(novelId: string, changeSetId = "change-set-foundation") {
  const parent = createInitialChangeSetRevision({
    revisionId: `${changeSetId}:r1`,
    changeSetId,
    novelId,
    createdAt: now,
  });
  return {
    changeSet: createChangeSet({
      id: changeSetId,
      novelId,
      initialRevisionId: parent.revisionId,
      createdAt: now,
    }),
    parent,
    parentRevision: parent,
  };
}

async function persistedProposal(
  persistence: NarrativeProposalPersistence,
  proposal = proposalFixture(),
): Promise<NarrativeProposal> {
  return saveNarrativeProposalRevision(persistence, proposal);
}

describe("[task:3.3-3.4] Foundation Partial Adoption and Workspace Integration", () => {
  it("[domain] keeps Plan, Canon, Manuscript, and StoryState adoption targets separated into existing Change inputs", () => {
    const proposal = proposalFixture("proposal-target-separation", "novel-target-separation", [
      "section-plan",
      "section-canon",
      "section-manuscript",
      "section-state",
    ]);
    const adoption = decision(proposal, [
      target(proposal, "section-plan", "plan", "plan-story", "change-plan"),
      target(proposal, "section-canon", "canonical_fact", "fact-story", "change-canon"),
      target(proposal, "section-manuscript", "manuscript", "scene-story", "change-manuscript"),
      target(proposal, "section-state", "story_state", "state-story", "change-state"),
    ], "decision-target-separation");
    const fixture = emptyChangeSet(proposal.novelId, "change-set-target-separation");

    const result = prepareFoundationAdoptionChangeSet({
      ...fixture,
      proposal,
      decision: adoption,
      revisionId: "change-set-target-separation:r2",
      createdAt: later,
    });

    expect(result.changeSetRevision.changes.map((change) => change.targetAddress.targetType)).toEqual([
      "plan",
      "canonical_fact",
      "manuscript",
      "story_state",
    ]);
    expect(result.changeSetRevision.changes.map((change) => change.targetAddress.objectId)).toEqual([
      "plan-story",
      "fact-story",
      "scene-story",
      "state-story",
    ]);
    expect(result.changeSetRevision.changeSetId).toBe(fixture.changeSet.id);
    expect(result.adoptionInputs.proposedChanges).toHaveLength(4);
  });

  it("[integration] records an Adoption Decision and prepares partial adoption through the existing Change Set path", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const proposal = await persistedProposal(persistence, proposalFixture(
      "proposal-integration",
      "novel-integration",
      ["section-adopted", "section-retained"],
    ));
    const adoption = decision(proposal, [
      target(proposal, "section-adopted", "canonical_fact", "fact-integration", "change-integration"),
    ], "decision-integration");
    const fixture = emptyChangeSet(proposal.novelId, "change-set-integration");

    const result = await recordFoundationAdoptionPreparation({
      persistence,
      ...fixture,
      proposal,
      decision: adoption,
      revisionId: "change-set-integration:r2",
      createdAt: later,
    });

    expect(result.changeSetRevision.changes).toHaveLength(1);
    expect(result.changeSetRevision.changes[0]?.targetAddress.objectId).toBe("fact-integration");
    expect(result.selectedSectionIds).toEqual(["section-adopted"]);
    expect(result.unselectedSectionIds).toEqual(["section-retained"]);
    expect((await persistence.decisions.findById(adoption.id))?.decisionType).toBe("adopt");
  });

  it("[persistence] lets the Workspace query retained proposals, adopted changes, open questions, and evidence", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const proposal = await persistedProposal(persistence, proposalFixture(
      "proposal-workspace-query",
      "novel-workspace-query",
    ));
    const adoption = decision(proposal, [
      target(proposal, "section-a", "canonical_fact", "fact-workspace", "change-workspace"),
    ], "decision-workspace-query");
    await recordFoundationAdoptionPreparation({
      persistence,
      ...emptyChangeSet(proposal.novelId, "change-set-workspace-query"),
      proposal,
      decision: adoption,
      revisionId: "change-set-workspace-query:r2",
      createdAt: later,
    });
    const contract = createFoundationWorkspaceContract({ persistence });

    const view = await contract.query({
      novelId: proposal.novelId,
      focus: {
        object: "story-foundation",
        mode: "design",
      },
    });

    expect(view.proposals.map((entry) => entry.id)).toEqual([proposal.id]);
    expect(view.adoptedChanges.map((entry) => entry.change.targetAddress.objectId)).toEqual(["fact-workspace"]);
    expect(view.openQuestions.map((entry) => entry.question.id)).toEqual(["question-proposal-workspace-query"]);
    expect(view.evidence.some((entry) => entry.reference.identity === adoption.id)).toBe(true);
  });

  it("[transaction] rejects preparation conflicts before persisting an Adoption Decision and leaves the Change Set unchanged", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const proposal = await persistedProposal(persistence, proposalFixture(
      "proposal-transaction",
      "novel-transaction",
    ));
    const adoption = decision(proposal, [
      target(proposal, "section-a", "canonical_fact", "fact-transaction", "change-transaction"),
    ], "decision-transaction");
    const fixture = emptyChangeSet(proposal.novelId, "change-set-transaction");
    const occupied = createChange({
      id: "existing-change",
      sourceType: "author_edit",
      sourceReference: { identity: "author-edit", version: "1", hash: "author-edit-hash" },
      targetAddress: { targetType: "canonical_fact", objectId: "fact-transaction" },
      payload: { content: { text: "existing" } },
      basedOnVersionSet: baseVersionSet("base", "fact-transaction"),
    });
    const parentWithOccupiedTarget = createChangeSetRevision({
      parent: fixture.parent,
      revisionId: "change-set-transaction:occupied",
      trigger: { type: "edit", references: ["author-edit"] },
      changes: [occupied],
      createdAt: now,
    });
    const occupiedChangeSet = {
      ...fixture.changeSet,
      changes: [occupied],
      currentRevisionId: parentWithOccupiedTarget.revisionId,
      updatedAt: now,
    };

    await expect(recordFoundationAdoptionPreparation({
      persistence,
      changeSet: occupiedChangeSet,
      parentRevision: parentWithOccupiedTarget,
      proposal,
      decision: adoption,
      revisionId: "change-set-transaction:r3",
      createdAt: later,
    })).rejects.toThrow("Duplicate target address");
    expect(await persistence.decisions.findById(adoption.id)).toBeUndefined();
    expect(occupiedChangeSet.currentRevisionId).toBe("change-set-transaction:occupied");
  });

  it("[concurrency] accepts concurrent identical adoption preparations without duplicating decision or Change identities", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const proposal = await persistedProposal(persistence, proposalFixture(
      "proposal-concurrency",
      "novel-concurrency",
    ));
    const adoption = decision(proposal, [
      target(proposal, "section-a", "story_state", "state-concurrency", "change-concurrency"),
    ], "decision-concurrency");
    const fixture = emptyChangeSet(proposal.novelId, "change-set-concurrency");

    const results = await Promise.all([
      recordFoundationAdoptionPreparation({
        persistence,
        ...fixture,
        proposal,
        decision: adoption,
        revisionId: "change-set-concurrency:r2",
        createdAt: later,
      }),
      recordFoundationAdoptionPreparation({
        persistence,
        ...fixture,
        proposal,
        decision: adoption,
        revisionId: "change-set-concurrency:r2",
        createdAt: later,
      }),
    ]);

    expect(canonicalJson(results[0]!.changeSetRevision)).toBe(canonicalJson(results[1]!.changeSetRevision));
    expect((await persistence.decisions.listByNovel(proposal.novelId)).map((entry) => entry.id)).toEqual([
      adoption.id,
    ]);
  });

  it("[recovery] retries from the current Change Set revision after rejecting a stale parent", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const proposal = await persistedProposal(persistence, proposalFixture(
      "proposal-recovery",
      "novel-recovery",
    ));
    const adoption = decision(proposal, [
      target(proposal, "section-a", "manuscript", "scene-recovery", "change-recovery"),
    ], "decision-recovery");
    const first = emptyChangeSet(proposal.novelId, "change-set-recovery");
    const competing = decision(proposal, [
      target(proposal, "section-b", "manuscript", "scene-competing", "change-competing"),
    ], "decision-competing");
    const advanced = prepareFoundationAdoptionChangeSet({
      ...first,
      proposal,
      decision: competing,
      revisionId: "change-set-recovery:r2",
      createdAt: later,
    });

    expect(() => prepareFoundationAdoptionChangeSet({
      changeSet: advanced.changeSet,
      parentRevision: first.parent,
      proposal,
      decision: adoption,
      revisionId: "change-set-recovery:r3",
      createdAt: later,
    })).toThrow("parent revision");
    const retried = prepareFoundationAdoptionChangeSet({
      changeSet: advanced.changeSet,
      parentRevision: advanced.changeSetRevision,
      proposal,
      decision: adoption,
      revisionId: "change-set-recovery:r3",
      createdAt: later,
    });

    expect(retried.changeSetRevision.parentRevisionId).toBe("change-set-recovery:r2");
    expect(retried.changeSetRevision.revisionNumber).toBe(3);
  });

  it("[replay] derives identical partial-adoption Change Set revisions from the same retained evidence", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const proposal = await persistedProposal(persistence, proposalFixture(
      "proposal-replay",
      "novel-replay",
    ));
    const adoption = decision(proposal, [
      target(proposal, "section-a", "plan", "plan-replay", "change-replay"),
    ], "decision-replay");
    const firstFixture = emptyChangeSet(proposal.novelId, "change-set-replay-a");
    const secondFixture = emptyChangeSet(proposal.novelId, "change-set-replay-b");

    const first = await recordFoundationAdoptionPreparation({
      persistence,
      ...firstFixture,
      proposal,
      decision: adoption,
      revisionId: "change-set-replay-a:r2",
      createdAt: later,
    });
    const second = await recordFoundationAdoptionPreparation({
      persistence,
      ...secondFixture,
      proposal,
      decision: adoption,
      revisionId: "change-set-replay-b:r2",
      createdAt: later,
    });

    expect(canonicalJson(first.changeSetRevision.changes)).toBe(canonicalJson(second.changeSetRevision.changes));
    expect(canonicalJson(first.adoptionInputs.proposedChanges)).toBe(canonicalJson(second.adoptionInputs.proposedChanges));
  });

  it("[cross-system] exposes Foundation activity to Workspace without owning Narrative Truth or auto-committing", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const transaction = new InMemoryCommitTransaction();
    const proposal = await persistedProposal(persistence, proposalFixture(
      "proposal-cross-system",
      "novel-cross-system",
    ));
    const adoption = decision(proposal, [
      target(proposal, "section-a", "canonical_fact", "fact-cross-system", "change-cross-system"),
    ], "decision-cross-system");
    const prepared = await recordFoundationAdoptionPreparation({
      persistence,
      ...emptyChangeSet(proposal.novelId, "change-set-cross-system"),
      proposal,
      decision: adoption,
      revisionId: "change-set-cross-system:r2",
      createdAt: later,
    });
    const fact = createCanonicalFact({
      id: "fact-cross-system",
      novelId: proposal.novelId,
      type: "world_rule",
      content: { text: "before" },
      revisionId: "fact-cross-system:r1",
      commitId: "commit-seed",
      createdAt: now,
    });
    await transaction.canonicalFacts.save(fact);

    const view = await createFoundationWorkspaceContract({ persistence }).query({
      novelId: proposal.novelId,
      focus: { object: "canonical_fact", objectId: "fact-cross-system", mode: "review", taskId: "task-1" },
    });

    expect(view.adoptedChanges[0]?.change.id).toBe("change-cross-system");
    expect(view.narrativeTruth.owner).toBe("shared-novel-engine");
    expect(view.narrativeTruth.foundationOwnsNarrativeTruth).toBe(false);
    expect(await transaction.narrativeCommits.listByNovel(proposal.novelId)).toEqual([]);
    expect((await transaction.canonicalFacts.findById(fact.id))?.content).toEqual({ text: "before" });
    expect(prepared.changeSetRevision.changes).toHaveLength(1);
  });

  it("[regression] preserves partial selection and commits only through the existing validation, approval, and Commit Gate", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const transaction = new InMemoryCommitTransaction();
    const proposal = await persistedProposal(persistence, proposalFixture(
      "proposal-regression",
      "novel-regression",
      ["section-canon", "section-manuscript", "section-state", "section-unselected"],
    ));
    const scene = createScene({
      id: "scene-regression",
      novelId: proposal.novelId,
      chapterId: "chapter-regression",
      title: "Scene",
      revisionId: "scene-regression:r1",
      commitId: "commit-seed",
      createdAt: now,
    });
    const fact = createCanonicalFact({
      id: "fact-regression",
      novelId: proposal.novelId,
      type: "world_rule",
      content: { text: "before" },
      revisionId: "fact-regression:r1",
      commitId: "commit-seed",
      createdAt: now,
    });
    const state = createStateRecord({
      id: "state-regression",
      novelId: proposal.novelId,
      type: "world_state",
      subjectId: "world-regression",
      position: { sceneId: scene.id, ordinal: 1 },
      content: { text: "before" },
      revisionId: "state-regression:r1",
      commitId: "commit-seed",
      createdAt: now,
    });
    await Promise.all([
      transaction.scenes.save(scene),
      transaction.canonicalFacts.save(fact),
      transaction.stateRecords.save(state),
    ]);
    const adoption = decision(proposal, [
      target(proposal, "section-canon", "canonical_fact", "fact-regression", "change-canon-regression", createVersionSet({
        fact: createVersionReference("CanonicalFact", fact.id, fact.currentRevisionId),
      })),
      target(proposal, "section-manuscript", "manuscript", "scene-regression", "change-manuscript-regression", createVersionSet({
        scene: createVersionReference("Scene", scene.id, scene.currentRevisionId),
      })),
      target(proposal, "section-state", "story_state", "state-regression", "change-state-regression", createVersionSet({
        state: createVersionReference("StateRecord", state.id, state.currentRevisionId),
      })),
    ], "decision-regression");
    const prepared = await recordFoundationAdoptionPreparation({
      persistence,
      ...emptyChangeSet(proposal.novelId, "change-set-regression"),
      proposal,
      decision: adoption,
      revisionId: "change-set-regression:r2",
      createdAt: later,
    });
    expect(prepared.unselectedSectionIds).toEqual(["section-unselected"]);
    expect(await transaction.narrativeCommits.listByNovel(proposal.novelId)).toEqual([]);

    const validation = createValidationRun({
      id: "validation-regression",
      changeSetRevisionId: prepared.changeSetRevision.revisionId,
      planVersionId: "validation-plan-1",
      validatorId: "foundation-adoption-validator",
      entryResults: [],
      executionState: "completed",
      outcome: "pass",
      createdAt: later,
    });
    const approval = createReviewDecision({
      id: "approval-regression",
      changeSetRevisionId: prepared.changeSetRevision.revisionId,
      approvalScope: {
        requirementDomain: "canon",
        targetType: "canonical_fact",
        objectId: "fact-regression",
      } as never,
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "Approved selected adoption targets",
      evidenceReferences: [adoption.id],
      createdAt: later,
    });

    const commit = await commitChangeSetRevision({
      transaction,
      input: {
        commitId: "commit-regression",
        changeSetRevision: prepared.changeSetRevision,
        validationRuns: [validation],
        reviewDecisions: [approval],
        currentRevisionFacts: { unresolvedConflict: false, stale: false },
        targetInvariantViolations: [],
        requiredApproval: false,
        now: later,
      },
    });

    expect(commit.status).toBe("committed");
    expect((await transaction.scenes.findById(scene.id))?.text).toBe("Direction section-manuscript");
    expect((await transaction.canonicalFacts.findById(fact.id))?.content).toEqual({
      content: { text: "Direction section-canon" },
    });
    expect((await transaction.stateRecords.findById(state.id))?.content).toEqual({
      content: { text: "Direction section-state" },
    });
  });
});
