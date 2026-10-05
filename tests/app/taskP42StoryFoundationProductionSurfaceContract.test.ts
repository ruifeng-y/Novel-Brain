import { describe, expect, it } from "vitest";
import {
  foundationAdoptionPipeline,
  foundationAdoptionPreparationVisibility,
  foundationEntryModes,
  foundationEntryStatuses,
  proposalWorkflowStages,
  proposalWorkflowTransitionKinds,
  storyFoundationProductionSurfaceContracts,
} from "../../src/app/storyFoundationProductionSurfaceContract";
import {
  workspacePresentationContract,
  workspaceQueryContracts,
} from "../../src/app/workspaceQueryPresentationContract";

describe("[task:P4.2] [domain] Story Foundation production surface contracts", () => {
  it("exposes all Foundation entry modes and visible entry outcomes", () => {
    expect(foundationEntryModes).toEqual(["idea", "existing_text", "blank"]);
    expect(foundationEntryStatuses).toEqual([
      "skipped",
      "proposal_created",
      "empty_narrative_state",
    ]);
    expect(storyFoundationProductionSurfaceContracts.entry).toEqual({
      id: "story-foundation.production.entry",
      workspaceQueryId: "workspace.query.focus",
      kind: "query",
      effect: "read",
      resultChannel: "query-result",
      visibleModes: ["idea", "existing_text", "blank"],
      visibleStatuses: ["skipped", "proposal_created", "empty_narrative_state"],
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
    });
  });

  it("exposes the Proposal workflow stages and transition flow", () => {
    expect(proposalWorkflowStages).toEqual(["frame", "explore", "deepen", "refine"]);
    expect(proposalWorkflowTransitionKinds).toEqual([
      "start",
      "advance",
      "revisit",
      "repeat",
    ]);
    expect(storyFoundationProductionSurfaceContracts.proposal).toEqual({
      id: "story-foundation.production.proposal",
      workspaceQueryId: "workspace.query.proposal",
      kind: "query",
      effect: "read",
      resultChannel: "query-result",
      visibleStages: ["frame", "explore", "deepen", "refine"],
      visibleTransitionKinds: ["start", "advance", "revisit", "repeat"],
      visibleState: ["position", "section-work", "decision-space", "open-questions"],
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
    });
  });
});

describe("[task:P4.2] [integration] Story Foundation partial adoption visibility", () => {
  it("shows selected and unselected sections while preserving the canonical adoption pipeline", () => {
    expect(foundationAdoptionPipeline).toEqual([
      "narrative-proposal",
      "typed-adoption",
      "change-set",
      "change-set-revision",
      "validation",
      "approval",
      "commit",
    ]);
    expect(foundationAdoptionPreparationVisibility).toEqual({
      partial: true,
      unit: "section",
      visible: [
        "selected-section-ids",
        "unselected-section-ids",
        "adoption-decision",
        "change-set-preparation",
      ],
      canonicalPipeline: [
        "narrative-proposal",
        "typed-adoption",
        "change-set",
        "change-set-revision",
        "validation",
        "approval",
        "commit",
      ],
      automaticCanon: false,
    });
    expect(storyFoundationProductionSurfaceContracts.adoption).toEqual({
      id: "story-foundation.production.adoption",
      workspaceQueryId: "workspace.query.proposal",
      kind: "query",
      effect: "read",
      resultChannel: "query-result",
      visibility: {
        partial: true,
        unit: "section",
        visible: [
          "selected-section-ids",
          "unselected-section-ids",
          "adoption-decision",
          "change-set-preparation",
        ],
        canonicalPipeline: [
          "narrative-proposal",
          "typed-adoption",
          "change-set",
          "change-set-revision",
          "validation",
          "approval",
          "commit",
        ],
        automaticCanon: false,
      },
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
      automaticCanon: false,
    });
  });
});

describe("[task:P4.2] [cross-system] Story Foundation Workspace reuse and truth boundary", () => {
  it("reuses P4.1 Workspace query and presentation identities without owning Narrative Truth", () => {
    expect(storyFoundationProductionSurfaceContracts.entry.workspaceQueryId).toBe(
      workspaceQueryContracts.focus.id,
    );
    expect(storyFoundationProductionSurfaceContracts.proposal.workspaceQueryId).toBe(
      workspaceQueryContracts.proposal.id,
    );
    expect(storyFoundationProductionSurfaceContracts.adoption.workspaceQueryId).toBe(
      workspaceQueryContracts.proposal.id,
    );
    expect(storyFoundationProductionSurfaceContracts.presentation).toEqual({
      id: "story-foundation.production.presentation",
      workspacePresentationId: workspacePresentationContract.id,
      workspaceQueryIds: ["workspace.query.focus", "workspace.query.proposal"],
      kind: "presentation",
      effect: "compose",
      resultChannel: "workspace-view",
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
      automaticCanon: false,
    });
    for (const contract of Object.values(storyFoundationProductionSurfaceContracts)) {
      expect(contract.truthOwner).toBe("shared-novel-engine");
      expect(contract.ownsNarrativeTruth).toBe(false);
    }
  });
});

describe("[task:P4.2] [regression] Story Foundation surface remains primitive-only", () => {
  it("does not import Domain contracts or expose DTO/API parameter shapes", () => {
    expect(Object.keys(storyFoundationProductionSurfaceContracts).sort()).toEqual([
      "adoption",
      "entry",
      "presentation",
      "proposal",
    ]);
    expect(JSON.stringify(storyFoundationProductionSurfaceContracts)).not.toMatch(
      /DomainId|SourceReference|NarrativeProposal|ChangeSetRevision|dto|apiParams/i,
    );
  });
});
