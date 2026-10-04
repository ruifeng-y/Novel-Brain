import { describe, expect, it } from "vitest";
import {
  createInMemoryNarrativeProposalPersistence,
  type NarrativeProposalPersistence,
} from "../../src/story/application/narrativeProposalPersistence";
import {
  recordAdoptionDecision,
  saveNarrativeProposalRevision,
} from "../../src/story/application/narrativeProposalService";
import {
  branchNarrativeProposal,
  createNarrativeProposal,
  proposalSectionInput,
  reviseNarrativeProposal,
  proposalSectionHash,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";
import { createAdoptionDecision, createAdoptionChangeSetInputs } from "../../src/story/domain/adoptionDecision";
import { createChangeSet, replaceChangeSetChanges } from "../../src/production/domain/changeSet";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-04T00:00:00.000Z");

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

function fixture(persistence: NarrativeProposalPersistence) {
  const proposal = createNarrativeProposal({
    id: "proposal-app-1",
    novelId: "novel-app-1",
    proposalType: "world_direction",
    scope: { dimension: "world" },
    sections: [section("section-a", "Cities dream"), section("section-b", "Rivers remember")],
    createdAt: now,
  });
  return { persistence, proposal };
}

describe("Narrative Proposal application contracts [task:2.2]", () => {
  it("[integration] persists proposal revisions and records decision evidence without committing", async () => {
    const { persistence, proposal } = fixture(createInMemoryNarrativeProposalPersistence());
    await saveNarrativeProposalRevision(persistence, proposal);

    const decision = createAdoptionDecision({
      proposal,
      id: "decision-app-1",
      decisionType: "adopt",
      actor: { type: "author", identity: "author-1" },
      reason: "Use one world direction",
      decidedAt: new Date("2026-10-04T01:00:00.000Z"),
      targets: [{
        id: "target-app-1",
        scope: {
          proposalIdentity: proposal.id,
          proposalRevision: proposal.currentRevisionId,
          sectionIdentity: "section-a",
        },
        targetType: "plan",
        objectId: "plan-world",
        proposedChangeId: "change-app-1",
        adoptedContent: {
          contentReference: {
            identity: "section-a",
            version: proposal.currentRevisionId,
            hash: proposalSectionHash(proposal.sections[0]!),
          },
          contentHash: proposalSectionHash(proposal.sections[0]!),
        },
        payload: { text: "Cities dream" },
        basedOnVersionSet: createVersionSet({
          plan: createVersionReference("StateRecord", "plan-world", "plan-rev-1"),
        }),
      }],
    });

    const recorded = await recordAdoptionDecision(persistence, decision);
    const replay = await recordAdoptionDecision(persistence, decision);
    const input = createAdoptionChangeSetInputs(recorded);
    const changeSet = replaceChangeSetChanges({
      changeSet: createChangeSet({
        id: "change-set-app-1",
        novelId: proposal.novelId,
        initialRevisionId: "change-set-app-1:r0",
        createdAt: now,
      }),
      changes: input.changes,
      revisionId: "change-set-app-1:r1",
      updatedAt: now,
    });

    expect(replay).toEqual(recorded);
    expect(input.changes).toHaveLength(1);
    expect(changeSet.lifecycle).toBe("open");
    expect(changeSet.closureDisposition).toBeUndefined();
    expect(await persistence.decisions.findById(recorded.id)).toEqual(recorded);
    expect((await persistence.proposals.findById(proposal.id))?.currentRevisionId).toBe(proposal.currentRevisionId);
  });

  it("[persistence] retains immutable proposal history across revise and branch", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const { proposal } = fixture(persistence);
    await saveNarrativeProposalRevision(persistence, proposal);
    const revised = reviseNarrativeProposal({
      proposal,
      sections: proposal.sections.map((entry) =>
        entry.id === "section-a" ? { ...proposalSectionInput(entry), content: { text: "Cities dream together" } } : proposalSectionInput(entry),
      ),
      trigger: "content_change",
      revisedAt: new Date("2026-10-04T02:00:00.000Z"),
    });
    await saveNarrativeProposalRevision(persistence, revised, proposal);
    const branch = branchNarrativeProposal({
      sourceProposal: revised,
      id: "proposal-app-branch",
      createdAt: new Date("2026-10-04T03:00:00.000Z"),
    });
    await saveNarrativeProposalRevision(persistence, branch);

    expect((await persistence.proposals.getRevision(proposal.id, proposal.currentRevisionId))?.sections[0]?.content)
      .toEqual({ text: "Cities dream" });
    expect((await persistence.proposals.getRevision(proposal.id, revised.currentRevisionId))?.sections[0]?.content)
      .toEqual({ text: "Cities dream together" });
    expect((await persistence.proposals.findById(branch.id))?.lineage.parent?.identity).toBe(proposal.id);
  });

  it("[transaction] rolls back proposal and decision writes as one unit of work", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const { proposal } = fixture(persistence);
    const decision = createAdoptionDecision({
      proposal,
      id: "decision-rollback",
      decisionType: "reject",
      actor: { type: "policy", identity: "policy-1" },
      reason: "rollback",
      decidedAt: now,
      targets: [{
        id: "target-rollback",
        scope: {
          proposalIdentity: proposal.id,
          proposalRevision: proposal.currentRevisionId,
          sectionIdentity: "section-a",
        },
        targetType: "plan",
        objectId: "plan-world",
      }],
    });

    await expect(
      persistence.transaction.run(async (work) => {
        await work.proposals.saveRevisionIfAbsent(proposal);
        await work.decisions.saveIfAbsent(decision);
        throw new Error("rollback requested");
      }),
    ).rejects.toThrow("rollback requested");

    expect(await persistence.proposals.findById(proposal.id)).toBeUndefined();
    expect(await persistence.decisions.findById(decision.id)).toBeUndefined();
  });

  it("[replay] accepts identical decision replay and rejects identity reuse with different evidence", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const { proposal } = fixture(persistence);
    await saveNarrativeProposalRevision(persistence, proposal);
    const decision = createAdoptionDecision({
      proposal,
      id: "decision-replay",
      decisionType: "defer",
      actor: { type: "author", identity: "author-1" },
      reason: "wait",
      decidedAt: now,
      targets: [{
        id: "target-replay",
        scope: {
          proposalIdentity: proposal.id,
          proposalRevision: proposal.currentRevisionId,
          sectionIdentity: "section-a",
        },
        targetType: "plan",
        objectId: "plan-world",
      }],
    });

    await recordAdoptionDecision(persistence, decision);
    await expect(recordAdoptionDecision(persistence, {
      ...decision,
      reason: "different reason",
    })).rejects.toThrow("Adoption Decision already exists");
    expect((await persistence.decisions.findById(decision.id))?.reason).toBe("wait");
  });

  it("[cross-system] rejects decision evidence that does not match the retained Proposal Revision", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const { proposal } = fixture(persistence);
    await saveNarrativeProposalRevision(persistence, proposal);
    const decision = createAdoptionDecision({
      proposal,
      id: "decision-tampered",
      decisionType: "defer",
      actor: { type: "author", identity: "author-1" },
      reason: "wait",
      decidedAt: now,
      targets: [{
        id: "target-tampered",
        scope: {
          proposalIdentity: proposal.id,
          proposalRevision: proposal.currentRevisionId,
          sectionIdentity: "section-a",
        },
        targetType: "plan",
        objectId: "plan-world",
      }],
    });

    await expect(recordAdoptionDecision(persistence, {
      ...decision,
      proposalReference: { ...decision.proposalReference, hash: "tampered-hash" },
    })).rejects.toThrow("Adoption Decision evidence must match retained Proposal Revision");
  });

  it("[regression] does not create Frozen Core ownership or direct commit state", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const { proposal } = fixture(persistence);
    await saveNarrativeProposalRevision(persistence, proposal);

    expect(Object.prototype.hasOwnProperty.call(proposal, "canonIds")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(proposal, "manuscriptIds")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(proposal, "storyStateIds")).toBe(false);
    expect(await persistence.decisions.listByNovel(proposal.novelId)).toEqual([]);
  });
});
