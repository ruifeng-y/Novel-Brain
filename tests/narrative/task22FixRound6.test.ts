import { describe, expect, it } from "vitest";
import {
  applyAdoptionDecisionToProposal,
  createAdoptionDecision,
} from "../../src/story/domain/adoptionDecision";
import {
  branchNarrativeProposal,
  createNarrativeProposal,
  proposalRevisionHash,
  proposalSectionHash,
  proposalSectionInput,
  reviseNarrativeProposal,
  type NarrativeProposal,
  type NarrativeProposalSection,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";
import {
  createInMemoryNarrativeProposalPersistence,
} from "../../src/story/application/narrativeProposalPersistence";
import {
  loadNarrativeProposal,
  recordAdoptionDecision,
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

function proposal(id = "proposal-round6-1"): NarrativeProposal {
  return createNarrativeProposal({
    id,
    novelId: "novel-round6-1",
    proposalType: "story_concept",
    scope: {},
    sections: [section("section-a", "A")],
    createdAt: now,
  });
}

function target(
  source: NarrativeProposal,
  decisionType: "adopt" | "reject" | "defer" | "reopen",
  id: string,
) {
  const entry = source.sections[0]!;
  const base = {
    id,
    sourceDisposition: entry.adoptionDisposition,
    scope: {
      proposalIdentity: source.id,
      proposalRevision: source.currentRevisionId,
      sectionIdentity: entry.id,
    },
    targetType: "plan" as const,
    objectId: "plan-section-a",
  };
  if (decisionType !== "adopt") return base;
  return {
    ...base,
    proposedChangeId: `change-${id}`,
    adoptedContent: {
      contentReference: {
        identity: entry.id,
        version: source.currentRevisionId,
        hash: entry.sectionHash,
      },
      contentHash: entry.sectionHash,
    },
    payload: { text: entry.content.text },
    basedOnVersionSet: createVersionSet({
      plan: createVersionReference("StateRecord", "plan-section-a", "plan-rev-1"),
    }),
  };
}

function decision(
  source: NarrativeProposal,
  decisionType: "adopt" | "reject" | "defer" | "reopen",
  id: string,
  decidedAt = now,
) {
  return createAdoptionDecision({
    proposal: source,
    id,
    decisionType,
    actor: { type: "author", identity: "author-1" },
    reason: `${decisionType} ${id}`,
    decidedAt,
    targets: [target(source, decisionType, `target-${id}`)],
  });
}

function forgedPending(parent: NarrativeProposal, trigger: "disposition_change" | "content_change" = "disposition_change") {
  const sections = parent.sections.map((entry) => {
    const changed = {
      ...entry,
      adoptionDisposition: "pending" as const,
    };
    return {
      ...changed,
      sectionHash: proposalSectionHash(changed),
    };
  });
  const base = {
    ...parent,
    currentRevisionId: `${parent.id}:r${parent.revisionNumber + 1}`,
    revisionNumber: parent.revisionNumber + 1,
    parentRevision: {
      proposalIdentity: parent.id,
      revisionId: parent.currentRevisionId,
      revisionHash: parent.revisionHash,
    },
    revisionTrigger: trigger,
    sections,
    sectionHashes: sections.map((entry) => ({ sectionId: entry.id, hash: entry.sectionHash })),
  };
  return {
    ...base,
    revisionHash: proposalRevisionHash(base),
  };
}

describe("Task 2.2 fix round 6 Pending transition authority [task:2.2]", () => {
  it("[persistence] rejects forged adopted/rejected/deferred to Pending without Reopen", async () => {
    for (const [decisionType, label] of [["adopt", "adopted"], ["reject", "rejected"], ["defer", "deferred"]] as const) {
      const persistence = createInMemoryNarrativeProposalPersistence();
      const parent = proposal(`proposal-forge-${label}`);
      const d1 = decision(parent, decisionType, `D1-${label}`);
      await saveNarrativeProposalRevision(persistence, parent);
      await recordAdoptionDecision(persistence, d1);
      const nonPending = applyAdoptionDecisionToProposal({ proposal: parent, decision: d1, revisedAt: now });
      await saveNarrativeProposalRevision(persistence, nonPending, parent);

      const forged = forgedPending(nonPending);
      await expect(saveNarrativeProposalRevision(persistence, forged, nonPending))
        .rejects.toThrow("Pending transition requires latest valid Reopen Decision");
      await persistence.proposals.saveIfCurrent(nonPending.currentRevisionId, forged);
      await expect(loadNarrativeProposal(persistence, parent.id))
        .rejects.toThrow("Pending transition requires latest valid Reopen Decision");
      await expect(saveNarrativeProposalRevision(persistence, forged, nonPending))
        .rejects.toThrow("Pending transition requires latest valid Reopen Decision");
    }
  });

  it("[domain/persistence] allows automatic Adopted content invalidation without Decision", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const parent = proposal("proposal-auto-invalidate");
    const d1 = decision(parent, "adopt", "D1-AUTO");
    await saveNarrativeProposalRevision(persistence, parent);
    await recordAdoptionDecision(persistence, d1);
    const adopted = applyAdoptionDecisionToProposal({ proposal: parent, decision: d1, revisedAt: now });
    await saveNarrativeProposalRevision(persistence, adopted, parent);

    const invalidated = reviseNarrativeProposal({
      proposal: adopted,
      sections: [{ ...proposalSectionInput(adopted.sections[0]!), content: { text: "A changed" } }],
      trigger: "content_change",
      revisedAt: now,
    });
    await saveNarrativeProposalRevision(persistence, invalidated, adopted);
    await expect(loadNarrativeProposal(persistence, parent.id)).resolves.toEqual(invalidated);
  });

  it("[persistence] allows a latest Reopen Decision bound to parent revision", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const parent = proposal("proposal-legal-reopen");
    const dReject = decision(parent, "reject", "D1-REJECT");
    await saveNarrativeProposalRevision(persistence, parent);
    await recordAdoptionDecision(persistence, dReject);
    const rejected = applyAdoptionDecisionToProposal({ proposal: parent, decision: dReject, revisedAt: now });
    await saveNarrativeProposalRevision(persistence, rejected, parent);

    const dReopen = decision(rejected, "reopen", "D2-REOPEN", new Date("2026-10-04T01:00:00.000Z"));
    await recordAdoptionDecision(persistence, dReopen);
    const reopened = applyAdoptionDecisionToProposal({ proposal: rejected, decision: dReopen, revisedAt: now });
    await saveNarrativeProposalRevision(persistence, reopened, rejected);
    await expect(loadNarrativeProposal(persistence, parent.id)).resolves.toEqual(reopened);
  });

  it("[persistence] allows unchanged pending and new/branch Pending snapshots", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const initial = proposal("proposal-pending-safe");
    await saveNarrativeProposalRevision(persistence, initial);
    await expect(saveNarrativeProposalRevision(persistence, initial)).resolves.toEqual(initial);
    const unchanged = forgedPending(initial);
    await expect(saveNarrativeProposalRevision(persistence, unchanged, initial))
      .rejects.toThrow("revision trigger does not match actual snapshot changes");

    const changedPending = {
      ...initial,
      currentRevisionId: `${initial.id}:r2`,
      revisionNumber: 2,
      parentRevision: {
        proposalIdentity: initial.id,
        revisionId: initial.currentRevisionId,
        revisionHash: initial.revisionHash,
      },
      revisionTrigger: "content_change" as const,
      sections: [{ ...section("section-a", "A2"), adoptionDisposition: "pending" as const, sectionHash: proposalSectionHash(section("section-a", "A2")) } as NarrativeProposalSection],
      sectionHashes: [{ sectionId: "section-a", hash: proposalSectionHash(section("section-a", "A2")) }],
    };
    const changedPendingWithHash = {
      ...changedPending,
      revisionHash: proposalRevisionHash(changedPending),
    };
    await saveNarrativeProposalRevision(persistence, changedPendingWithHash, initial);

    const branch = branchNarrativeProposal({
      sourceProposal: changedPendingWithHash,
      id: "proposal-round6-branch",
      createdAt: now,
    });
    await saveNarrativeProposalRevision(persistence, branch);
    expect(branch.sections[0]?.adoptionDisposition).toBe("pending");
  });
});
