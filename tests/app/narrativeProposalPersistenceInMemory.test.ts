import { describe, expect, it } from "vitest";
import { createInMemoryNarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";
import {
  createNarrativeProposal,
  proposalSectionHash,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";
import { createAdoptionDecision } from "../../src/story/domain/adoptionDecision";
import { isImmutableTimestamp } from "../../src/shared/domain/observationSource";

const now = new Date("2026-10-04T00:00:00.000Z");

const sections: readonly NarrativeProposalSectionInput[] = [{
  id: "section-persist-1",
  content: { value: 1 },
  provenance: {
    origin: { type: "extracted_from_text", references: [] },
    editLineage: [],
    evidenceReferences: [],
    adoptionDecisionReferences: [],
  },
}];

describe("Narrative Proposal persistence [task:2.2]", () => {
  it("[persistence] round-trips immutable snapshots and decision timestamps", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const proposal = createNarrativeProposal({
      id: "proposal-persist-1",
      novelId: "novel-persist-1",
      proposalType: "theme",
      scope: { dimension: "theme" },
      sections,
      createdAt: now,
    });
    const decision = createAdoptionDecision({
      proposal,
      id: "decision-persist-1",
      decisionType: "adopt",
      actor: { type: "author", identity: "author-1" },
      reason: "persist",
      decidedAt: now,
      targets: [{
        id: "target-persist-1",
        scope: {
          proposalIdentity: proposal.id,
          proposalRevision: proposal.currentRevisionId,
          sectionIdentity: sections[0]!.id,
        },
        targetType: "plan",
        objectId: "plan-theme",
        proposedChangeId: "change-persist-1",
        adoptedContent: {
          contentReference: {
            identity: sections[0]!.id,
            version: proposal.currentRevisionId,
            hash: proposalSectionHash({ ...sections[0]! }),
          },
          contentHash: proposalSectionHash({ ...sections[0]! }),
        },
        payload: { value: 1 },
        basedOnVersionSet: { plan: { aggregateType: "StateRecord", objectId: "plan-theme", revisionId: "plan-rev-1" } },
      }],
    });

    await persistence.proposals.saveRevisionIfAbsent(proposal);
    await persistence.decisions.saveIfAbsent(decision);
    now.setTime(Date.parse("2027-01-01T00:00:00.000Z"));

    const loadedProposal = await persistence.proposals.findById(proposal.id);
    const loadedDecision = await persistence.decisions.findById(decision.id);

    expect(loadedProposal).toEqual(proposal);
    expect(loadedDecision).toEqual(decision);
    expect(isImmutableTimestamp(loadedProposal?.createdAt)).toBe(true);
    expect(isImmutableTimestamp(loadedDecision?.decidedAt)).toBe(true);
    expect(isImmutableTimestamp(loadedDecision?.evidence.data.decidedAt)).toBe(true);
    expect(loadedDecision?.decidedAt.iso).toBe("2026-10-04T00:00:00.000Z");
  });

  it("[concurrency] permits one immutable decision winner for the same identity", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const proposal = createNarrativeProposal({
      id: "proposal-concurrent-1",
      novelId: "novel-concurrent-1",
      proposalType: "theme",
      scope: {},
      sections,
      createdAt: now,
    });
    await persistence.proposals.saveRevisionIfAbsent(proposal);
    const first = createAdoptionDecision({
      proposal,
      id: "decision-concurrent-1",
      decisionType: "reject",
      actor: { type: "author", identity: "author-1" },
      reason: "first",
      decidedAt: now,
      targets: [{
        id: "target-concurrent-1",
        scope: {
          proposalIdentity: proposal.id,
          proposalRevision: proposal.currentRevisionId,
          sectionIdentity: sections[0]!.id,
        },
        targetType: "plan",
        objectId: "plan-theme",
      }],
    });
    const second = { ...first, reason: "second" };

    const results = await Promise.allSettled([
      persistence.decisions.saveIfAbsent(first),
      persistence.decisions.saveIfAbsent(second),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await persistence.decisions.findById(first.id))?.reason).toBe("first");
  });

  it("[recovery] preserves create-only evidence after a caught conflict", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const proposal = createNarrativeProposal({
      id: "proposal-recovery-1",
      novelId: "novel-recovery-1",
      proposalType: "theme",
      scope: {},
      sections,
      createdAt: now,
    });
    await persistence.proposals.saveRevisionIfAbsent(proposal);
    const decision = createAdoptionDecision({
      proposal,
      id: "decision-recovery-1",
      decisionType: "defer",
      actor: { type: "policy", identity: "policy-1" },
      reason: "original",
      decidedAt: now,
      targets: [{
        id: "target-recovery-1",
        scope: {
          proposalIdentity: proposal.id,
          proposalRevision: proposal.currentRevisionId,
          sectionIdentity: sections[0]!.id,
        },
        targetType: "plan",
        objectId: "plan-theme",
      }],
    });
    await persistence.decisions.saveIfAbsent(decision);

    await persistence.transaction.run(async (work) => {
      await expect(work.decisions.saveIfAbsent({ ...decision, reason: "conflict" })).rejects.toThrow();
      await work.decisions.saveIfAbsent({ ...decision, id: "decision-recovery-2" });
    });

    expect((await persistence.decisions.findById(decision.id))?.reason).toBe("original");
    expect(await persistence.decisions.findById("decision-recovery-2")).toBeDefined();
  });
});
