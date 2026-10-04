import { describe, expect, it } from "vitest";
import {
  createNarrativeProposal,
  proposalSectionInput,
  reviseNarrativeProposal,
  proposalAdoptionSummary,
  type NarrativeProposalSectionInput,
  type ProposalOpenQuestionInput,
} from "../../src/story/domain/narrativeProposal";
import {
  applyAdoptionDecisionToProposal,
  createAdoptionDecision,
} from "../../src/story/domain/adoptionDecision";
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

function question(id: string, text: string, sectionId?: string): ProposalOpenQuestionInput {
  return {
    id,
    text,
    scope: sectionId ? { kind: "section", sectionId } : { kind: "proposal" },
    state: "open",
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
    id: "proposal-disposition-1",
    novelId: "novel-disposition-1",
    proposalType: "story_concept",
    scope: { dimension: "concept" },
    sections: [section("section-a", "A"), section("section-b", "B")],
    openQuestions: [question("question-1", "Which ending?", "section-a")],
    createdAt: now,
  });
}

function target(proposal: ReturnType<typeof fixture>, sectionId: string, id: string) {
  const entry = proposal.sections.find((candidate) => candidate.id === sectionId)!;
  const hash = entry.sectionHash;
  return {
    id,
    scope: {
      proposalIdentity: proposal.id,
      proposalRevision: proposal.currentRevisionId,
      sectionIdentity: entry.id,
    },
    targetType: "plan" as const,
    objectId: `plan-${sectionId}`,
    proposedChangeId: `change-${id}`,
    adoptedContent: {
      contentReference: { identity: entry.id, version: proposal.currentRevisionId, hash },
      contentHash: hash,
    },
    payload: { text: entry.content.text },
    basedOnVersionSet: createVersionSet({
      plan: createVersionReference("StateRecord", `plan-${sectionId}`, "plan-rev-1"),
    }),
  };
}

describe("Narrative Proposal disposition and open questions [task:2.2]", () => {
  it("[domain] starts sections as Pending and exposes decided/undecided partial-adoption audit", () => {
    const proposal = fixture();

    expect(proposal.sections.map((entry) => entry.adoptionDisposition)).toEqual(["pending", "pending"]);
    expect(proposalAdoptionSummary(proposal)).toEqual({
      decidedSectionIds: [],
      undecidedSectionIds: ["section-a", "section-b"],
      adoptedSectionIds: [],
      rejectedSectionIds: [],
      deferredSectionIds: [],
    });
  });

  it("[domain] applies one/many Adoption Decisions as disposition-only revisions", () => {
    const proposal = fixture();
    const decision = createAdoptionDecision({
      proposal,
      id: "decision-disposition-1",
      decisionType: "adopt",
      actor: { type: "author", identity: "author-1" },
      reason: "adopt section A only",
      decidedAt: now,
      targets: [target(proposal, "section-a", "target-a")],
    });

    const applied = applyAdoptionDecisionToProposal({
      proposal,
      decision,
      revisedAt: new Date("2026-10-04T01:00:00.000Z"),
    });

    expect(applied.currentRevisionId).toBe("proposal-disposition-1:r2");
    expect(applied.sections.map((entry) => entry.adoptionDisposition)).toEqual(["adopted", "pending"]);
    expect(proposalAdoptionSummary(applied)).toEqual({
      decidedSectionIds: ["section-a"],
      undecidedSectionIds: ["section-b"],
      adoptedSectionIds: ["section-a"],
      rejectedSectionIds: [],
      deferredSectionIds: [],
    });
    expect(applied.sections[0]?.provenance.adoptionDecisionReferences.at(-1)?.identity).toBe(decision.id);
  });

  it("[domain] invalidates Adopted back to Pending only for changed content", () => {
    const proposal = fixture();
    const adopted = applyAdoptionDecisionToProposal({
      proposal,
      decision: createAdoptionDecision({
        proposal,
        id: "decision-content-invalidation",
        decisionType: "adopt",
        actor: { type: "author", identity: "author-1" },
        reason: "adopt both",
        decidedAt: now,
        targets: [target(proposal, "section-a", "target-a"), target(proposal, "section-b", "target-b")],
      }),
      revisedAt: now,
    });
    const {
      adoptedContent: _adoptedContent,
      payload: _payload,
      basedOnVersionSet: _basedOnVersionSet,
      proposedChangeId: _proposedChangeId,
      ...rejectTarget
    } = target(adopted, "section-b", "target-reject-b");
    const rejectedB = applyAdoptionDecisionToProposal({
      proposal: adopted,
      decision: createAdoptionDecision({
        proposal: adopted,
        id: "decision-content-reject-b",
        decisionType: "reject",
        actor: { type: "author", identity: "author-1" },
        reason: "reject B",
        decidedAt: now,
        targets: [rejectTarget],
      }),
      revisedAt: new Date("2026-10-04T02:00:00.000Z"),
    });
    const changedA = reviseNarrativeProposal({
      proposal: rejectedB,
      sections: rejectedB.sections.map((entry) =>
        entry.id === "section-a" ? { ...proposalSectionInput(entry), content: { text: "A changed" } } : proposalSectionInput(entry),
      ),
      openQuestions: rejectedB.openQuestions,
      trigger: "content_change",
      revisedAt: new Date("2026-10-04T03:00:00.000Z"),
    });

    expect(changedA.sections.map((entry) => entry.adoptionDisposition)).toEqual(["pending", "rejected"]);
  });

  it("[domain] snapshots open questions and requires a new revision for state changes", () => {
    const proposal = fixture();
    expect(proposal.openQuestions[0]?.state).toBe("open");

    const resolved = reviseNarrativeProposal({
      proposal,
      sections: proposal.sections.map(proposalSectionInput),
      openQuestions: proposal.openQuestions.map((entry) => ({
        ...entry,
        state: "resolved" as const,
        resolutionReference: {
          identity: "decision-answer-1",
          version: "answer-rev-1",
          hash: "answer-hash-1",
        },
      })),
      trigger: "open_question_state_change",
      revisedAt: new Date("2026-10-04T04:00:00.000Z"),
    });

    expect(resolved.currentRevisionId).toBe("proposal-disposition-1:r2");
    expect(resolved.openQuestions[0]?.state).toBe("resolved");
    expect(resolved.openQuestions[0]?.resolutionReference?.identity).toBe("decision-answer-1");
  });

  it("[domain] rejects invalid open-question states and unchanged revisions", () => {
    const proposal = fixture();

    expect(() =>
      reviseNarrativeProposal({
        proposal,
        sections: proposal.sections.map(proposalSectionInput),
        openQuestions: proposal.openQuestions.map((entry) => ({ ...entry, state: "resolved" as const })),
        trigger: "open_question_state_change",
        revisedAt: now,
      }),
    ).toThrow("Resolved open question requires resolutionReference");

    expect(() =>
      reviseNarrativeProposal({
        proposal,
        sections: proposal.sections.map(proposalSectionInput),
        openQuestions: proposal.openQuestions,
        trigger: "open_question_state_change",
        revisedAt: now,
      }),
    ).toThrow("revision must change semantic proposal content");
  });
});
