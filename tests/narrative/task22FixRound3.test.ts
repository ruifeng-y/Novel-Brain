import { describe, expect, it } from "vitest";
import {
  createNarrativeProposal,
  proposalRevisionHash,
  proposalSectionHash,
  reviseNarrativeProposal,
  reviseNarrativeProposalFromAdoptionDecision,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";
import {
  applyAdoptionDecisionToProposal,
  createAdoptionDecision,
} from "../../src/story/domain/adoptionDecision";
import {
  createInMemoryNarrativeProposalPersistence,
} from "../../src/story/application/narrativeProposalPersistence";
import {
  loadNarrativeProposal,
  saveNarrativeProposalRevision,
} from "../../src/story/application/narrativeProposalService";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

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

function proposal(id = "proposal-round3-1") {
  return createNarrativeProposal({
    id,
    novelId: "novel-round3-1",
    proposalType: "story_concept",
    scope: {},
    sections: [section("section-a", "A")],
    createdAt: now,
  });
}

function target(source: ReturnType<typeof proposal>, sectionId: string, id: string) {
  const entry = source.sections.find((candidate) => candidate.id === sectionId)!;
  return {
    id,
    scope: {
      proposalIdentity: source.id,
      proposalRevision: source.currentRevisionId,
      sectionIdentity: sectionId,
    },
    targetType: "plan" as const,
    objectId: `plan-${sectionId}`,
    proposedChangeId: `change-${id}`,
    adoptedContent: {
      contentReference: {
        identity: sectionId,
        version: source.currentRevisionId,
        hash: entry.sectionHash,
      },
      contentHash: entry.sectionHash,
    },
    payload: { text: entry.content.text },
    basedOnVersionSet: createVersionSet({
      plan: createVersionReference("StateRecord", `plan-${sectionId}`, "plan-rev-1"),
    }),
  };
}

function decision(source: ReturnType<typeof proposal>, id = "decision-round3-1") {
  return createAdoptionDecision({
    proposal: source,
    id,
    decisionType: "adopt",
    actor: { type: "author", identity: "author-1" },
    reason: "adopt",
    decidedAt: now,
    targets: [target(source, "section-a", `target-${id}`)],
  });
}

describe("Task 2.2 fix round 3 authority API [task:2.2]", () => {
  it("[domain] rejects forged sectionHash/adoptionDisposition snapshots in create and revise", () => {
    expect(() =>
      createNarrativeProposal({
        ...proposal("proposal-forge-create"),
        sections: [{
          ...section("section-a", "A"),
          adoptionDisposition: "adopted",
          sectionHash: "forged",
        } as NarrativeProposalSectionInput],
        createdAt: now,
      } as never),
    ).toThrow(/adoptionDisposition|sectionHash/);

    const source = proposal("proposal-forge-revise");
    expect(() =>
      reviseNarrativeProposal({
        proposal: source,
        sections: [{
          ...section("section-a", "A2"),
          adoptionDisposition: "adopted",
          sectionHash: "forged",
        } as NarrativeProposalSectionInput],
        trigger: "content_change",
        revisedAt: now,
      }),
    ).toThrow(/adoptionDisposition|sectionHash/);
  });

  it("[domain] public adoption revision API requires a fully validated AdoptionDecision", () => {
    const source = proposal("proposal-authority-1");
    expect(() =>
      reviseNarrativeProposalFromAdoptionDecision({
        proposal: source,
        decisionReference: { identity: "decision", version: "1", hash: "hash" },
        dispositions: [{ sectionId: "section-a", disposition: "adopted" }],
        revisedAt: now,
      } as never),
    ).toThrow("Adoption Decision is required");

    const other = proposal("proposal-authority-2");
    const wrongDecision = decision(other, "decision-wrong-proposal");
    expect(() =>
      reviseNarrativeProposalFromAdoptionDecision({
        proposal: source,
        decision: wrongDecision,
        revisedAt: now,
      }),
    ).toThrow(/validated AdoptionDecision|retained Proposal Revision/);
  });

  it("[persistence] rejects self-consistent rehashed forged trigger/duplicate/disposition snapshots", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const initial = proposal("proposal-forge-persist");
    await saveNarrativeProposalRevision(persistence, initial);
    const revised = reviseNarrativeProposal({
      proposal: initial,
      sections: [section("section-a", "A2")],
      trigger: "content_change",
      revisedAt: now,
    });
    const forgedTrigger = {
      ...revised,
      revisionTrigger: "disposition_change" as const,
    };
    const forgedTriggerWithHash = {
      ...forgedTrigger,
      revisionHash: proposalRevisionHash(forgedTrigger),
    };

    await expect(saveNarrativeProposalRevision(persistence, forgedTriggerWithHash, initial))
      .rejects.toThrow("revision trigger does not match actual snapshot changes");

    const duplicate = {
      ...revised,
      sections: [revised.sections[0]!, revised.sections[0]!],
      sectionHashes: [
        revised.sectionHashes[0]!,
        revised.sectionHashes[0]!,
      ],
    };
    await expect(saveNarrativeProposalRevision(persistence, {
      ...duplicate,
      revisionHash: proposalRevisionHash(duplicate),
    }, initial)).rejects.toThrow("Proposal section id must be unique");
  });

  it("[persistence] requires persisted Adoption Decision evidence for non-Pending dispositions", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const initial = proposal("proposal-traceability");
    await saveNarrativeProposalRevision(persistence, initial);
    const adopted = applyAdoptionDecisionToProposal({
      proposal: initial,
      decision: decision(initial, "decision-traceability"),
      revisedAt: now,
    });

    await expect(saveNarrativeProposalRevision(persistence, adopted, initial))
      .rejects.toThrow(/No valid Adoption Decision|Non-Pending section requires valid Adoption Decision evidence/);
  });

  it("[persistence] validates idempotent current loads instead of trusting stored snapshots", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const initial = proposal("proposal-load-validation");
    await saveNarrativeProposalRevision(persistence, initial);
    const revised = reviseNarrativeProposal({
      proposal: initial,
      sections: [section("section-a", "A2")],
      trigger: "content_change",
      revisedAt: now,
    });
    const forgedSection = {
      ...revised.sections[0]!,
      adoptionDisposition: "adopted" as const,
      provenance: {
        ...revised.sections[0]!.provenance,
        adoptionDecisionReferences: [{
          identity: "forged-decision",
          version: "1",
          hash: "forged-decision-hash",
        }],
      },
    };
    const forgedSnapshotSection = {
      ...forgedSection,
      sectionHash: proposalSectionHash(forgedSection),
    };
    const forged = {
      ...revised,
      sections: [forgedSnapshotSection],
      sectionHashes: [{
        sectionId: forgedSnapshotSection.id,
        hash: forgedSnapshotSection.sectionHash,
      }],
    };
    const forgedWithHash = {
      ...forged,
      revisionHash: proposalRevisionHash(forged),
    };

    await persistence.proposals.saveIfCurrent(initial.currentRevisionId, forgedWithHash);
    await expect(loadNarrativeProposal(persistence, initial.id))
      .rejects.toThrow(/Adoption Decision|snapshot|revision/);
  });
});
