import { describe, expect, it } from "vitest";
import {
  assertLinearProposalRevision,
  createNarrativeProposal,
  proposalSectionInput,
  proposalRevisionHash,
  reviseNarrativeProposal,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";
import { saveNarrativeProposalRevision } from "../../src/story/application/narrativeProposalService";
import { createInMemoryNarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";

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

function fixture() {
  return createNarrativeProposal({
    id: "proposal-revision-1",
    novelId: "novel-revision-1",
    proposalType: "story_concept",
    scope: { dimension: "concept" },
    sections: [section("section-a", "A")],
    openQuestions: [{
      id: "question-a",
      text: "Open question",
      scope: { kind: "section", sectionId: "section-a" },
      state: "open",
      provenance: {
        origin: { type: "author_created", references: [] },
        editLineage: [],
        evidenceReferences: [],
        adoptionDecisionReferences: [],
      },
    }],
    createdAt: now,
  });
}

describe("Narrative Proposal immutable revision snapshot [task:2.2]", () => {
  it("[domain] snapshots parent, trigger, section hashes, and open questions", () => {
    const initial = fixture();
    const revised = reviseNarrativeProposal({
      proposal: initial,
      sections: initial.sections.map((entry) =>
        entry.id === "section-a" ? { ...proposalSectionInput(entry), content: { text: "A2" } } : proposalSectionInput(entry),
      ),
      openQuestions: initial.openQuestions,
      trigger: "content_change",
      revisedAt: new Date("2026-10-04T01:00:00.000Z"),
    });

    expect(initial.parentRevision).toBeUndefined();
    expect(initial.revisionTrigger).toBe("initial");
    expect(initial.sectionHashes).toEqual(initial.sections.map((entry) => ({
      sectionId: entry.id,
      hash: entry.sectionHash,
    })));
    expect(initial.openQuestions).toEqual(fixture().openQuestions);
    expect(revised.parentRevision).toEqual({
      proposalIdentity: initial.id,
      revisionId: initial.currentRevisionId,
      revisionHash: initial.revisionHash,
    });
    expect(revised.revisionTrigger).toBe("content_change");
    expect(revised.sectionHashes[0]?.hash).toBe(revised.sections[0]?.sectionHash);
  });

  it("[domain] covers identity, parent, and trigger in revisionHash", () => {
    const initial = fixture();
    const contentRevision = reviseNarrativeProposal({
      proposal: initial,
      sections: initial.sections.map((entry) => ({ ...proposalSectionInput(entry), content: { text: "A2" } })),
      openQuestions: initial.openQuestions,
      trigger: "content_change",
      revisedAt: now,
    });
    const questionRevision = reviseNarrativeProposal({
      proposal: initial,
      sections: initial.sections.map(proposalSectionInput),
      openQuestions: initial.openQuestions.map((entry) => ({
        ...entry,
        state: "dismissed" as const,
      })),
      trigger: "open_question_state_change",
      revisedAt: now,
    });

    expect(contentRevision.revisionHash).not.toBe(questionRevision.revisionHash);
    expect(contentRevision.revisionHash).not.toBe(initial.revisionHash);
    expect(contentRevision.revisionHash).not.toBe(
      proposalRevisionHash({ ...contentRevision, revisionTrigger: "disposition_change" as const }),
    );
  });

  it("[domain] rejects non-linear revision numbers, parent hashes, lineage drift, and bad revision ids", () => {
    const initial = fixture();
    const revised = reviseNarrativeProposal({
      proposal: initial,
      sections: initial.sections.map((entry) => ({ ...proposalSectionInput(entry), content: { text: "A2" } })),
      openQuestions: initial.openQuestions,
      trigger: "content_change",
      revisedAt: now,
    });

    expect(() => assertLinearProposalRevision(initial, {
      ...revised,
      revisionNumber: 3,
      currentRevisionId: `${revised.id}:r3`,
    })).toThrow("revisionNumber must equal previous revisionNumber + 1");

    expect(() => assertLinearProposalRevision(initial, {
      ...revised,
      parentRevision: {
        ...revised.parentRevision!,
        proposalIdentity: "wrong-parent-identity",
      },
    })).toThrow("parent revision identity mismatch");

    expect(() => assertLinearProposalRevision(initial, {
      ...revised,
      parentRevision: { ...revised.parentRevision!, revisionHash: "wrong-parent-hash" },
    })).toThrow("parent revision hash mismatch");

    expect(() => assertLinearProposalRevision(initial, {
      ...revised,
      lineage: { ...revised.lineage, mergeSources: [{
        identity: "unexpected-source",
        version: "source-rev-1",
        hash: "source-hash-1",
      }] },
    })).toThrow("Proposal lineage cannot change within linear revision history");

    expect(() => assertLinearProposalRevision(initial, {
      ...revised,
      currentRevisionId: "proposal-revision-1:not-r2",
    })).toThrow("revision id must follow '<proposal-id>:r<revisionNumber>'");
  });

  it("[persistence] save validates the complete linear revision snapshot before writing", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const initial = fixture();
    const revised = reviseNarrativeProposal({
      proposal: initial,
      sections: initial.sections.map((entry) => ({ ...proposalSectionInput(entry), content: { text: "A2" } })),
      openQuestions: initial.openQuestions,
      trigger: "content_change",
      revisedAt: now,
    });
    await saveNarrativeProposalRevision(persistence, initial);

    const invalid = {
      ...revised,
      parentRevision: { ...revised.parentRevision!, revisionHash: "invalid-parent" },
    };
    await expect(saveNarrativeProposalRevision(persistence, invalid, initial))
      .rejects.toThrow("parent revision hash mismatch");
    expect((await persistence.proposals.findById(initial.id))?.currentRevisionId).toBe(initial.currentRevisionId);
    expect(await persistence.proposals.getRevision(initial.id, revised.currentRevisionId)).toBeUndefined();
  });
});
