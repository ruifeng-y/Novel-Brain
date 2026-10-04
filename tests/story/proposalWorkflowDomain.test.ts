import { describe, expect, it } from "vitest";
import {
  buildProposalWorkflowView,
  compareProposalWorkflowViews,
  proposalWorkflowTransition,
} from "../../src/story/domain/proposalWorkflow";
import {
  createNarrativeProposal,
  type NarrativeProposalSectionInput,
  type ProposalOpenQuestionInput,
} from "../../src/story/domain/narrativeProposal";
import {
  applyAdoptionDecisionToProposal,
  createAdoptionDecision,
} from "../../src/story/domain/adoptionDecision";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-04T00:00:00.000Z");

function provenance(type: NarrativeProposalSectionInput["provenance"]["origin"]["type"]) {
  return {
    origin: { type, references: [] },
    editLineage: [],
    evidenceReferences: [],
    adoptionDecisionReferences: [],
  };
}

function section(
  id: string,
  text: string,
  type: NarrativeProposalSectionInput["provenance"]["origin"]["type"],
): NarrativeProposalSectionInput {
  return { id, content: { text }, provenance: provenance(type) };
}

function question(id: string, text: string, sectionId?: string): ProposalOpenQuestionInput {
  return {
    id,
    text,
    scope: sectionId ? { kind: "section", sectionId } : { kind: "proposal" },
    state: "open",
    provenance: provenance("author_created"),
  };
}

function fixture() {
  return createNarrativeProposal({
    id: "proposal-workflow-domain",
    novelId: "novel-workflow-domain",
    proposalType: "story_concept",
    scope: { dimension: "story-concept" },
    sections: [
      section("section-ai", "AI direction", "ai_generated"),
      section("section-author", "Author direction", "author_created"),
    ],
    openQuestions: [
      question("question-proposal", "Which ending?"),
      question("question-section", "What is the cost?", "section-ai"),
    ],
    createdAt: now,
  });
}

function adoptSectionA(proposal: ReturnType<typeof fixture>) {
  const entry = proposal.sections[0]!;
  return applyAdoptionDecisionToProposal({
    proposal,
    decision: createAdoptionDecision({
      proposal,
      id: "decision-workflow-domain",
      decisionType: "adopt",
      actor: { type: "author", identity: "author-1" },
      reason: "adopt one section only",
      decidedAt: now,
      targets: [{
        id: "target-workflow-domain",
        scope: {
          proposalIdentity: proposal.id,
          proposalRevision: proposal.currentRevisionId,
          sectionIdentity: entry.id,
        },
        targetType: "plan",
        objectId: "plan-section-ai",
        proposedChangeId: "change-workflow-domain",
        adoptedContent: {
          contentReference: { identity: entry.id, version: proposal.currentRevisionId, hash: entry.sectionHash },
          contentHash: entry.sectionHash,
        },
        payload: { text: entry.content.text },
        basedOnVersionSet: createVersionSet({
          plan: createVersionReference("StateRecord", "plan-section-ai", "plan-rev-1"),
        }),
      }],
    }),
    revisedAt: now,
  });
}

describe("[task:3.2] Proposal Workflow domain contracts", () => {
  it("[domain] classifies Frame/Explore/Deepen/Refine transitions without forbidding author navigation", () => {
    expect(proposalWorkflowTransition(undefined, "frame")).toEqual({
      from: undefined,
      to: "frame",
      kind: "start",
    });
    expect(proposalWorkflowTransition("frame", "explore")).toEqual({
      from: "frame",
      to: "explore",
      kind: "advance",
    });
    expect(proposalWorkflowTransition("explore", "refine")).toEqual({
      from: "explore",
      to: "refine",
      kind: "advance",
    });
    expect(proposalWorkflowTransition("refine", "deepen")).toEqual({
      from: "refine",
      to: "deepen",
      kind: "revisit",
    });
    expect(proposalWorkflowTransition("deepen", "deepen")).toEqual({
      from: "deepen",
      to: "deepen",
      kind: "repeat",
    });
  });

  it("[domain] exposes partially adoptable section work and preserves undecided/open-question signals", () => {
    const view = buildProposalWorkflowView({
      proposal: adoptSectionA(fixture()),
      position: { proposalId: "proposal-workflow-domain", revisionId: "proposal-workflow-domain:r2", stage: "deepen" },
    });

    expect(view.position).toEqual({
      proposalId: "proposal-workflow-domain",
      revisionId: "proposal-workflow-domain:r2",
      stage: "deepen",
    });
    expect(view.decisionSpace).toEqual({
      alreadyDecidedSectionIds: ["section-ai"],
      aiSuggestedSectionIds: ["section-ai"],
      authorPreferenceSectionIds: ["section-author"],
      undecidedSectionIds: ["section-author"],
      openQuestionIds: ["question-proposal", "question-section"],
    });
    expect(view.partialAdoption).toEqual({
      supported: true,
      unit: "section",
      selectableSectionIds: ["section-ai", "section-author"],
      summary: {
        decidedSectionIds: ["section-ai"],
        undecidedSectionIds: ["section-author"],
        adoptedSectionIds: ["section-ai"],
        rejectedSectionIds: [],
        deferredSectionIds: [],
      },
    });
    expect(view.openQuestions.map((entry) => entry.state)).toEqual(["open", "open"]);
  });

  it("[domain] compares branches while identifying preserved undecided sections and open questions", () => {
    const leftProposal = fixture();
    const rightProposal = createNarrativeProposal({
      id: "proposal-workflow-branch",
      novelId: leftProposal.novelId,
      proposalType: leftProposal.proposalType,
      scope: leftProposal.scope,
      sections: [
        section("section-ai", "AI direction changed", "ai_generated"),
        section("section-author", "Author direction", "author_created"),
      ],
      openQuestions: leftProposal.openQuestions,
      createdAt: now,
      lineage: {
        parent: {
          identity: leftProposal.id,
          version: leftProposal.currentRevisionId,
          hash: leftProposal.revisionHash,
        },
        mergeSources: [],
        sourceSectionDispositions: leftProposal.sections.map((entry) => ({
          sectionId: entry.id,
          disposition: entry.adoptionDisposition,
        })),
      },
    });
    const left = buildProposalWorkflowView({
      proposal: leftProposal,
      position: { proposalId: leftProposal.id, revisionId: leftProposal.currentRevisionId, stage: "explore" },
    });
    const right = buildProposalWorkflowView({
      proposal: rightProposal,
      position: { proposalId: rightProposal.id, revisionId: rightProposal.currentRevisionId, stage: "refine" },
    });

    expect(compareProposalWorkflowViews(left, right)).toEqual({
      addedSectionIds: [],
      removedSectionIds: [],
      changedSectionIds: ["section-ai"],
      unchangedSectionIds: ["section-author"],
      preservedUndecidedSectionIds: ["section-ai", "section-author"],
      preservedOpenQuestionIds: ["question-proposal", "question-section"],
      addedOpenQuestionIds: [],
      removedOpenQuestionIds: [],
      changedOpenQuestionIds: [],
    });
  });
});
