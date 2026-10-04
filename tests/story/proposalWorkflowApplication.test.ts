import { describe, expect, it } from "vitest";
import {
  applyProposalWorkflowStep,
  branchProposalWorkflow,
  compareProposalWorkflows,
  openProposalWorkflow,
  queryProposalWorkflow,
  type ProposalWorkflowChange,
} from "../../src/story/application/proposalWorkflowService";
import {
  createInMemoryNarrativeProposalPersistence,
  type NarrativeProposalPersistence,
} from "../../src/story/application/narrativeProposalPersistence";
import { loadNarrativeProposal, saveNarrativeProposalRevision } from "../../src/story/application/narrativeProposalService";
import {
  createNarrativeProposal,
  type NarrativeProposal,
  type NarrativeProposalSectionInput,
  type ProposalOpenQuestionInput,
} from "../../src/story/domain/narrativeProposal";
import { createSourceReference } from "../../src/shared/domain/observationSource";

const now = new Date("2026-10-04T00:00:00.000Z");
const later = new Date("2026-10-04T01:00:00.000Z");
const evidence = createSourceReference({
  identity: "workflow-evidence",
  version: "evidence-1",
  hash: "workflow-evidence-hash-1",
});

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
  type: NarrativeProposalSectionInput["provenance"]["origin"]["type"] = "author_created",
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

async function fixture(persistence = createInMemoryNarrativeProposalPersistence()) {
  const proposal = await saveNarrativeProposalRevision(persistence, createNarrativeProposal({
    id: "proposal-workflow-app",
    novelId: "novel-workflow-app",
    proposalType: "story_concept",
    scope: { dimension: "story-concept" },
    sections: [
      section("section-ai", "AI direction", "ai_generated"),
      section("section-author", "Author direction"),
    ],
    openQuestions: [
      question("question-proposal", "Which ending?"),
      question("question-section", "What is the cost?", "section-ai"),
    ],
    createdAt: now,
  }));
  return { persistence, proposal };
}

function position(proposal: NarrativeProposal, stage: "frame" | "explore" | "deepen" | "refine") {
  return openProposalWorkflow(proposal, stage);
}

function updateSection(id: string, text: string): ProposalWorkflowChange {
  return { kind: "update_section", sectionId: id, content: { text } };
}

describe("[task:3.2] Proposal Explore / Deepen / Refine Workflow application contracts", () => {
  it("[integration] applies Frame -> Explore -> Deepen -> Refine transitions through persisted Proposal revisions", async () => {
    const { persistence, proposal } = await fixture();
    const frame = position(proposal, "frame");

    const explore = await applyProposalWorkflowStep({
      persistence,
      position: frame,
      toStage: "explore",
      actor: "ai",
      evidence,
      revisedAt: now,
      changes: [updateSection("section-ai", "Explore alternate direction")],
    });
    const deepen = await applyProposalWorkflowStep({
      persistence,
      position: explore.position,
      toStage: "deepen",
      actor: "author",
      evidence,
      revisedAt: later,
      changes: [{
        kind: "add_open_question",
        question: question("question-deepen", "What must the protagonist sacrifice?", "section-author"),
      }],
    });
    const refine = await applyProposalWorkflowStep({
      persistence,
      position: deepen.position,
      toStage: "refine",
      actor: "author",
      evidence,
      revisedAt: later,
      changes: [updateSection("section-author", "Refined author direction")],
    });

    expect(explore.transition).toEqual({ from: "frame", to: "explore", kind: "advance" });
    expect(deepen.transition).toEqual({ from: "explore", to: "deepen", kind: "advance" });
    expect(refine.transition).toEqual({ from: "deepen", to: "refine", kind: "advance" });
    expect(refine.position).toEqual({
      proposalId: "proposal-workflow-app",
      revisionId: "proposal-workflow-app:r4",
      stage: "refine",
    });
    expect((await loadNarrativeProposal(persistence, "proposal-workflow-app")).revisionNumber).toBe(4);
  });

  it("[persistence] queries current or retained revisions without creating a second workflow truth", async () => {
    const { persistence, proposal } = await fixture();
    const stepped = await applyProposalWorkflowStep({
      persistence,
      position: position(proposal, "explore"),
      toStage: "deepen",
      actor: "author",
      evidence,
      revisedAt: now,
      changes: [updateSection("section-ai", "Deepened direction")],
    });

    const current = await queryProposalWorkflow({ persistence, position: stepped.position });
    const retained = await queryProposalWorkflow({
      persistence,
      position: position(proposal, "frame"),
    });

    expect(current.position).toEqual(stepped.position);
    expect(current.partialAdoption.supported).toBe(true);
    expect(current.decisionSpace.openQuestionIds).toEqual(["question-proposal", "question-section"]);
    expect(retained.revisionNumber).toBe(1);
    expect(await persistence.proposals.listByNovel("novel-workflow-app")).toHaveLength(1);
  });

  it("[transaction] rejects non-author open-question decisions and persists no revision", async () => {
    const { persistence, proposal } = await fixture();

    await expect(applyProposalWorkflowStep({
      persistence,
      position: position(proposal, "deepen"),
      toStage: "refine",
      actor: "ai",
      evidence,
      revisedAt: now,
      changes: [{
        kind: "resolve_open_question",
        questionId: "question-proposal",
        resolutionReference: createSourceReference({
          identity: "answer-ai",
          version: "answer-rev-1",
          hash: "answer-hash-1",
        }),
      }],
    })).rejects.toThrow(/author/i);

    expect((await loadNarrativeProposal(persistence, "proposal-workflow-app")).revisionNumber).toBe(1);

    await expect(applyProposalWorkflowStep({
      persistence,
      position: position(proposal, "deepen"),
      toStage: "refine",
      actor: "ai",
      evidence,
      revisedAt: now,
      changes: [{
        kind: "add_open_question",
        question: {
          ...question("question-ai-resolved", "AI supplied an answer"),
          state: "resolved",
          resolutionReference: createSourceReference({
            identity: "answer-ai-create",
            version: "answer-rev-1",
            hash: "answer-hash-1",
          }),
        },
      }],
    })).rejects.toThrow(/author/i);
  });

  it("[concurrency] accepts identical concurrent steps idempotently and rejects conflicting revisions", async () => {
    const { persistence, proposal } = await fixture();
    const input = {
      persistence,
      position: position(proposal, "explore"),
      toStage: "deepen" as const,
      actor: "author" as const,
      evidence,
      revisedAt: now,
      changes: [updateSection("section-ai", "Concurrent identical direction")],
    };

    const results = await Promise.all([
      applyProposalWorkflowStep(input),
      applyProposalWorkflowStep(input),
    ]);
    expect(results[1]).toEqual(results[0]);

    const conflicting = await Promise.allSettled([
      applyProposalWorkflowStep({
        ...input,
        position: results[0].position,
        changes: [updateSection("section-ai", "Conflict A")],
      }),
      applyProposalWorkflowStep({
        ...input,
        position: results[0].position,
        changes: [updateSection("section-ai", "Conflict B")],
      }),
    ]);
    expect(conflicting.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(conflicting.filter((entry) => entry.status === "rejected")).toHaveLength(1);
  });

  it("[recovery] preserves the retained revision after conflict and allows retry from the current position", async () => {
    const { persistence, proposal } = await fixture();
    const first = await applyProposalWorkflowStep({
      persistence,
      position: position(proposal, "explore"),
      toStage: "deepen",
      actor: "author",
      evidence,
      revisedAt: now,
      changes: [updateSection("section-ai", "Recovered base")],
    });
    await expect(applyProposalWorkflowStep({
      persistence,
      position: position(proposal, "explore"),
      toStage: "deepen",
      actor: "author",
      evidence,
      revisedAt: later,
      changes: [updateSection("section-ai", "Stale retry")],
    })).rejects.toThrow(/conflict|mismatch/i);

    const recovered = await applyProposalWorkflowStep({
      persistence,
      position: first.position,
      toStage: "refine",
      actor: "author",
      evidence,
      revisedAt: later,
      changes: [updateSection("section-author", "Recovered refinement")],
    });
    expect(recovered.position.revisionId).toBe("proposal-workflow-app:r3");
    expect((await queryProposalWorkflow({
      persistence,
      position: position(proposal, "explore"),
    })).revisionNumber).toBe(1);
  });

  it("[replay] returns identical branch and comparison results without duplicating Proposal identities", async () => {
    const { persistence, proposal } = await fixture();
    const input = {
      persistence,
      sourcePosition: position(proposal, "refine"),
      branchProposalId: "proposal-workflow-branch",
      occurredAt: now,
    };
    const first = await branchProposalWorkflow(input);
    const replay = await branchProposalWorkflow(input);
    expect(replay).toEqual(first);
    expect((await persistence.proposals.listByNovel("novel-workflow-app")).map((entry) => entry.id).sort()).toEqual([
      "proposal-workflow-app",
      "proposal-workflow-branch",
    ]);

    const comparison = await compareProposalWorkflows({
      persistence,
      left: position(proposal, "refine"),
      right: first.position,
    });
    const comparisonReplay = await compareProposalWorkflows({
      persistence,
      left: position(proposal, "refine"),
      right: replay.position,
    });
    expect(comparisonReplay).toEqual(comparison);
  });

  it("[cross-system] branch preserves lineage and undecided work without creating Adoption or Canon mutations", async () => {
    const { persistence, proposal } = await fixture();
    const branched = await branchProposalWorkflow({
      persistence,
      sourcePosition: position(proposal, "refine"),
      branchProposalId: "proposal-workflow-branch",
      occurredAt: now,
    });

    expect(branched.proposal.id).toBe("proposal-workflow-branch");
    expect(branched.proposal.lineage.parent).toEqual({
      identity: proposal.id,
      version: proposal.currentRevisionId,
      hash: proposal.revisionHash,
    });
    expect(branched.proposal.lineage.sourceSectionDispositions).toEqual([
      { sectionId: "section-ai", disposition: "pending" },
      { sectionId: "section-author", disposition: "pending" },
    ]);
    expect(branched.proposal.sections.map((entry) => entry.adoptionDisposition)).toEqual(["pending", "pending"]);
    expect(branched.view.decisionSpace.openQuestionIds).toEqual(["question-proposal", "question-section"]);
    expect(await persistence.decisions.listByNovel("novel-workflow-app")).toEqual([]);
  });

  it("[regression] dismissed questions drop stale resolution references while preserving the question identity", async () => {
    const { persistence, proposal } = await fixture();
    const resolved = await applyProposalWorkflowStep({
      persistence,
      position: position(proposal, "deepen"),
      toStage: "refine",
      actor: "author",
      evidence,
      revisedAt: now,
      changes: [{
        kind: "resolve_open_question",
        questionId: "question-proposal",
        resolutionReference: createSourceReference({
          identity: "answer-author",
          version: "answer-rev-1",
          hash: "answer-hash-1",
        }),
      }],
    });
    const dismissed = await applyProposalWorkflowStep({
      persistence,
      position: resolved.position,
      toStage: "refine",
      actor: "author",
      evidence,
      revisedAt: later,
      changes: [{ kind: "dismiss_open_question", questionId: "question-proposal" }],
    });

    expect(dismissed.proposal.openQuestions[0]).toMatchObject({
      id: "question-proposal",
      state: "dismissed",
    });
    expect(dismissed.proposal.openQuestions[0]?.resolutionReference).toBeUndefined();
    expect(dismissed.view.decisionSpace.openQuestionIds).toEqual(["question-section"]);
  });

  it("[regression] refine preserves undecided sections and open questions while exposing section-level partial adoption", async () => {
    const { persistence, proposal } = await fixture();
    const refined = await applyProposalWorkflowStep({
      persistence,
      position: position(proposal, "refine"),
      toStage: "refine",
      actor: "author",
      evidence,
      revisedAt: now,
      changes: [updateSection("section-ai", "Only AI section changes")],
    });

    expect(refined.view.decisionSpace.undecidedSectionIds).toEqual(["section-ai", "section-author"]);
    expect(refined.view.decisionSpace.openQuestionIds).toEqual(["question-proposal", "question-section"]);
    expect(refined.view.partialAdoption).toMatchObject({
      supported: true,
      unit: "section",
      selectableSectionIds: ["section-ai", "section-author"],
    });
    expect(refined.proposal.sections.find((entry) => entry.id === "section-author")?.content)
      .toEqual({ text: "Author direction" });
    expect(refined.proposal.openQuestions.map((entry) => entry.state)).toEqual(["open", "open"]);
  });
});
