import { describe, expect, it } from "vitest";
import {
  branchNarrativeProposal,
  compareNarrativeProposals,
  createNarrativeProposal,
  proposalSectionInput,
  reviseNarrativeProposal,
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

function question(id: string, sectionId: string): ProposalOpenQuestionInput {
  return {
    id,
    text: "Question",
    scope: { kind: "section", sectionId },
    state: "open",
    provenance: {
      origin: { type: "author_created", references: [] },
      editLineage: [],
      evidenceReferences: [],
      adoptionDecisionReferences: [],
    },
  };
}

function fixture(id = "proposal-branch-1", scope: Record<string, unknown> = { dimension: "concept" }) {
  return createNarrativeProposal({
    id,
    novelId: "novel-branch-1",
    proposalType: "story_concept",
    scope,
    sections: [section("section-a", "A"), section("section-b", "B")],
    openQuestions: [question("question-a", "section-a")],
    createdAt: now,
  });
}

function target(proposal: ReturnType<typeof fixture>, sectionId: string, id: string) {
  const entry = proposal.sections.find((candidate) => candidate.id === sectionId)!;
  return {
    id,
    scope: {
      proposalIdentity: proposal.id,
      proposalRevision: proposal.currentRevisionId,
      sectionIdentity: sectionId,
    },
    targetType: "plan" as const,
    objectId: `plan-${sectionId}`,
    proposedChangeId: `change-${id}`,
    adoptedContent: {
      contentReference: {
        identity: sectionId,
        version: proposal.currentRevisionId,
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

describe("Narrative Proposal branch, provenance, and comparison [task:2.2]", () => {
  it("[domain] branch resets decisions to Pending and retains source disposition only as lineage metadata", () => {
    const source = fixture();
    const adopted = applyAdoptionDecisionToProposal({
      proposal: source,
      decision: createAdoptionDecision({
        proposal: source,
        id: "decision-branch-source",
        decisionType: "adopt",
        actor: { type: "author", identity: "author-1" },
        reason: "adopt A",
        decidedAt: now,
        targets: [target(source, "section-a", "target-a")],
      }),
      revisedAt: now,
    });
    const branch = branchNarrativeProposal({
      sourceProposal: adopted,
      id: "proposal-branch-child",
      createdAt: now,
    });

    expect(adopted.sections[0]?.adoptionDisposition).toBe("adopted");
    expect(branch.sections.map((entry) => entry.adoptionDisposition)).toEqual(["pending", "pending"]);
    expect(branch.lineage.sourceSectionDispositions).toEqual([
      { sectionId: "section-a", disposition: "adopted" },
      { sectionId: "section-b", disposition: "pending" },
    ]);
    expect(() =>
      applyAdoptionDecisionToProposal({
        proposal: branch,
        decision: createAdoptionDecision({
          proposal: adopted,
          id: "decision-source-authority",
          decisionType: "reject",
          actor: { type: "author", identity: "author-1" },
          reason: "cannot reuse source authority",
          decidedAt: now,
          targets: [(() => {
            const {
              adoptedContent: _adoptedContent,
              payload: _payload,
              basedOnVersionSet: _basedOnVersionSet,
              proposedChangeId: _proposedChangeId,
              ...rejectTarget
            } = target(adopted, "section-b", "target-b");
            return rejectTarget;
          })()],
        }),
        revisedAt: now,
      }),
    ).toThrow("Adoption Decision evidence must match retained Proposal Revision");
  });

  it("[domain] rejects provenance rewrites and allows append-only evidence additions", () => {
    const proposal = fixture();

    expect(() =>
      reviseNarrativeProposal({
        proposal,
        sections: proposal.sections.map((entry) =>
          entry.id === "section-a"
            ? {
                ...proposalSectionInput(entry),
                provenance: {
                  ...entry.provenance,
                  origin: { type: "ai_generated", references: [] },
                },
              }
             : proposalSectionInput(entry),
        ),
        openQuestions: proposal.openQuestions,
        trigger: "content_change",
        revisedAt: now,
      }),
    ).toThrow("Proposal provenance is immutable and append-only");

    const appended = reviseNarrativeProposal({
      proposal,
      sections: proposal.sections.map((entry) =>
        entry.id === "section-a"
          ? {
              ...proposalSectionInput(entry),
              provenance: {
                ...entry.provenance,
                evidenceReferences: [{
                  identity: "evidence-1",
                  version: "evidence-rev-1",
                  hash: "evidence-hash-1",
                }],
              },
            }
           : proposalSectionInput(entry),
      ),
      openQuestions: proposal.openQuestions,
      trigger: "content_change",
      revisedAt: now,
    });

    expect(appended.sections[0]?.provenance.evidenceReferences).toHaveLength(1);
  });

  it("[domain] compare covers scope, disposition, provenance, and open questions", () => {
    const left = fixture("proposal-compare-left");
    const rightBase = fixture("proposal-compare-left", { dimension: "world" });
    const rightAdopted = applyAdoptionDecisionToProposal({
      proposal: rightBase,
      decision: createAdoptionDecision({
        proposal: rightBase,
        id: "decision-compare-adopted",
        decisionType: "adopt",
        actor: { type: "author", identity: "author-1" },
        reason: "adopt A",
        decidedAt: now,
        targets: [target(rightBase, "section-a", "target-compare-a")],
      }),
      revisedAt: now,
    });
    const right = reviseNarrativeProposal({
      proposal: rightAdopted,
      sections: rightAdopted.sections.map((entry) => ({
        id: entry.id,
        content: entry.content,
        provenance: entry.provenance,
      })),
      openQuestions: rightAdopted.openQuestions.map((entry) => ({ ...entry, state: "dismissed" as const })),
      trigger: "open_question_state_change",
      revisedAt: now,
    });

    expect(compareNarrativeProposals(left, right)).toEqual({
      scopeChanged: true,
      addedSectionIds: [],
      removedSectionIds: [],
      changedSectionIds: ["section-a"],
      unchangedSectionIds: ["section-b"],
      changedSectionAspects: [{
        sectionId: "section-a",
        aspects: ["adoptionDisposition", "provenance"],
      }],
      addedOpenQuestionIds: [],
      removedOpenQuestionIds: [],
      changedOpenQuestionIds: ["question-a"],
      unchangedOpenQuestionIds: [],
    });
  });

  it("[domain] branch copies questions and provenance without copying decision authority", () => {
    const source = fixture();
    const branch = branchNarrativeProposal({
      sourceProposal: source,
      id: "proposal-branch-copy",
      createdAt: now,
    });

    expect(branch.openQuestions).toEqual(source.openQuestions);
    expect(branch.sections[0]?.provenance.origin).toEqual(source.sections[0]?.provenance.origin);
    expect(branch.sections[0]?.provenance.editLineage.slice(0, -1))
      .toEqual(source.sections[0]?.provenance.editLineage);
    expect(branch.sections[0]?.provenance.editLineage).toHaveLength(
      (source.sections[0]?.provenance.editLineage.length ?? 0) + 1,
    );
    expect(branch.lineage.parent?.identity).toBe(source.id);
  });
});
