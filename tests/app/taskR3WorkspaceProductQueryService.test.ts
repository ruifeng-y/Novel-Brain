import { describe, expect, it } from "vitest";
import { createWorkspaceProductQueryService } from "../../src/app/workspaceProductQueryService";
import { createInMemoryNarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";
import { saveNarrativeProposalRevision } from "../../src/story/application/narrativeProposalService";
import {
  createNarrativeProposal,
  type ProposalSectionProvenance,
} from "../../src/story/domain/narrativeProposal";
import { createSourceReference } from "../../src/shared/domain/observationSource";

const authorReference = createSourceReference({
  identity: "author-1",
  version: "1",
  hash: "author-reference-hash",
});

const provenance: ProposalSectionProvenance = {
  origin: { type: "author_created", references: [authorReference] },
  editLineage: [],
  evidenceReferences: [],
  adoptionDecisionReferences: [],
};

function proposalFor(novelId: string, proposalId: string) {
  return createNarrativeProposal({
    id: proposalId,
    novelId,
    proposalType: "story_concept",
    scope: { kind: "novel" },
    sections: [{ id: "section-1", content: { text: "A city remembers every promise." }, provenance }],
    createdAt: new Date("2026-10-05T00:00:00.000Z"),
  });
}

describe("[task:R3] [integration] workspace product query service", () => {
  it("rejects workspace query fragments from different novels", async () => {
    const service = createWorkspaceProductQueryService({
      foundationPersistence: createInMemoryNarrativeProposalPersistence(),
    });

    await expect(
      service.getWorkspaceView({
        novelId: "novel-1",
        focus: { object: "story-foundation", mode: "design" },
        run: {
          runId: "run-1",
          novelId: "novel-2",
          status: "running",
          planRevisionReference: authorReference,
          stepStates: [],
        },
      }),
    ).rejects.toThrow("Workspace contracts must share one Novel identity");
  });
});

describe("[task:R3] [cross-system] workspace product view composition", () => {
  it("composes the foundation proposal into a read-only workspace view", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    await saveNarrativeProposalRevision(persistence, proposalFor("novel-1", "proposal-1"));
    const service = createWorkspaceProductQueryService({ foundationPersistence: persistence });

    const view = await service.getWorkspaceView({
      novelId: "novel-1",
      focus: { object: "proposal", objectId: "proposal-1", mode: "review" },
    });

    expect(view.novelId).toBe("novel-1");
    expect(view.proposal.proposals.map(entry => entry.id)).toEqual(["proposal-1"]);
    expect(view.proposal.narrativeTruth.automaticCommit).toBe(false);
    expect(view.sharedTruth).toEqual({
      owner: "shared-novel-engine",
      foundationOwnsNarrativeTruth: false,
      runOwnsNarrativeTruth: false,
      recallOwnsNarrativeTruth: false,
    });
    expect(view.attention).toEqual({ novelId: "novel-1", items: [], dispositions: [] });
  });
});
