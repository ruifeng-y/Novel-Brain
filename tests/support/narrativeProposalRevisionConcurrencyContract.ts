import { describe, expect, it } from "vitest";
import {
  createNarrativeProposal,
  reviseNarrativeProposal,
  type NarrativeProposal,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";
import { saveNarrativeProposalRevision } from "../../src/story/application/narrativeProposalService";
import type { NarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";

const now = new Date("2026-10-04T00:00:00.000Z");

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

function proposal(id: string, text: string): NarrativeProposal {
  return createNarrativeProposal({
    id,
    novelId: `novel-${id}`,
    proposalType: "story_concept",
    scope: {},
    sections: [section("section-a", text)],
    createdAt: now,
  });
}

export function runNarrativeProposalRevisionConcurrencyContract(
  adapterName: string,
  createPersistence: () => NarrativeProposalPersistence,
): void {
  describe(`${adapterName} [task:2.2] proposal revision concurrency`, () => {
    it("[concurrency] reserves one current winner for conflicting first revisions", async () => {
      const persistence = createPersistence();
      const left = proposal("proposal-first-race", "left");
      const right = proposal("proposal-first-race", "right");

      const outcomes = await Promise.allSettled([
        saveNarrativeProposalRevision(persistence, left),
        saveNarrativeProposalRevision(persistence, right),
      ]);
      const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        message: "Proposal current revision conflict: proposal-first-race",
      });
      const winner = (fulfilled[0] as PromiseFulfilledResult<NarrativeProposal>).value;
      expect(await persistence.proposals.findById("proposal-first-race")).toEqual(winner);
    });

    it("[concurrency] gives one current winner to sibling revisions and rolls back the loser", async () => {
      const persistence = createPersistence();
      const initial = proposal("proposal-sibling-race", "initial");
      await saveNarrativeProposalRevision(persistence, initial);
      const left = reviseNarrativeProposal({
        proposal: initial,
        sections: [section("section-a", "left")],
        trigger: "content_change",
        revisedAt: now,
      });
      const right = reviseNarrativeProposal({
        proposal: initial,
        sections: [section("section-a", "right")],
        trigger: "content_change",
        revisedAt: now,
      });

      const outcomes = await Promise.allSettled([
        saveNarrativeProposalRevision(persistence, left, initial),
        saveNarrativeProposalRevision(persistence, right, initial),
      ]);
      const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        message: "Proposal current revision conflict: proposal-sibling-race",
      });
      const winner = (fulfilled[0] as PromiseFulfilledResult<NarrativeProposal>).value;
      expect(await persistence.proposals.findById(initial.id)).toEqual(winner);
      await expect(persistence.proposals.getRevision(initial.id, winner.currentRevisionId))
        .resolves.toEqual(winner);
    });
  });
}
