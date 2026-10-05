import {
  workspacePresentationContract,
  workspaceQueryContracts,
  type WorkspaceTruthOwner,
} from "./workspaceQueryPresentationContract";

export const foundationEntryModes = Object.freeze([
  "idea",
  "existing_text",
  "blank",
] as const);

export const foundationEntryStatuses = Object.freeze([
  "skipped",
  "proposal_created",
  "empty_narrative_state",
] as const);

export const proposalWorkflowStages = Object.freeze([
  "frame",
  "explore",
  "deepen",
  "refine",
] as const);

export const proposalWorkflowTransitionKinds = Object.freeze([
  "start",
  "advance",
  "revisit",
  "repeat",
] as const);

export const foundationAdoptionPipeline = Object.freeze([
  "narrative-proposal",
  "typed-adoption",
  "change-set",
  "change-set-revision",
  "validation",
  "approval",
  "commit",
] as const);

export const foundationAdoptionPreparationVisibility = Object.freeze({
  partial: true,
  unit: "section",
  visible: Object.freeze([
    "selected-section-ids",
    "unselected-section-ids",
    "adoption-decision",
    "change-set-preparation",
  ] as const),
  canonicalPipeline: foundationAdoptionPipeline,
  automaticCanon: false,
});

export interface StoryFoundationEntrySurfaceContract {
  readonly id: string;
  readonly workspaceQueryId: string;
  readonly kind: "query";
  readonly effect: "read";
  readonly resultChannel: "query-result";
  readonly visibleModes: readonly (typeof foundationEntryModes)[number][];
  readonly visibleStatuses: readonly (typeof foundationEntryStatuses)[number][];
  readonly truthOwner: WorkspaceTruthOwner;
  readonly ownsNarrativeTruth: false;
}

export interface StoryFoundationProposalSurfaceContract {
  readonly id: string;
  readonly workspaceQueryId: string;
  readonly kind: "query";
  readonly effect: "read";
  readonly resultChannel: "query-result";
  readonly visibleStages: readonly (typeof proposalWorkflowStages)[number][];
  readonly visibleTransitionKinds: readonly (typeof proposalWorkflowTransitionKinds)[number][];
  readonly visibleState: readonly string[];
  readonly truthOwner: WorkspaceTruthOwner;
  readonly ownsNarrativeTruth: false;
}

export interface StoryFoundationAdoptionSurfaceContract {
  readonly id: string;
  readonly workspaceQueryId: string;
  readonly kind: "query";
  readonly effect: "read";
  readonly resultChannel: "query-result";
  readonly visibility: typeof foundationAdoptionPreparationVisibility;
  readonly truthOwner: WorkspaceTruthOwner;
  readonly ownsNarrativeTruth: false;
  readonly automaticCanon: false;
}

export interface StoryFoundationPresentationSurfaceContract {
  readonly id: string;
  readonly workspacePresentationId: string;
  readonly workspaceQueryIds: readonly string[];
  readonly kind: "presentation";
  readonly effect: "compose";
  readonly resultChannel: "workspace-view";
  readonly truthOwner: WorkspaceTruthOwner;
  readonly ownsNarrativeTruth: false;
  readonly automaticCanon: false;
}

export interface StoryFoundationProductionSurfaceContracts {
  readonly entry: StoryFoundationEntrySurfaceContract;
  readonly proposal: StoryFoundationProposalSurfaceContract;
  readonly adoption: StoryFoundationAdoptionSurfaceContract;
  readonly presentation: StoryFoundationPresentationSurfaceContract;
}

export const storyFoundationProductionSurfaceContracts: StoryFoundationProductionSurfaceContracts =
  Object.freeze({
    entry: Object.freeze({
      id: "story-foundation.production.entry",
      workspaceQueryId: workspaceQueryContracts.focus.id,
      kind: "query",
      effect: "read",
      resultChannel: "query-result",
      visibleModes: foundationEntryModes,
      visibleStatuses: foundationEntryStatuses,
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
    }),
    proposal: Object.freeze({
      id: "story-foundation.production.proposal",
      workspaceQueryId: workspaceQueryContracts.proposal.id,
      kind: "query",
      effect: "read",
      resultChannel: "query-result",
      visibleStages: proposalWorkflowStages,
      visibleTransitionKinds: proposalWorkflowTransitionKinds,
      visibleState: Object.freeze(["position", "section-work", "decision-space", "open-questions"]),
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
    }),
    adoption: Object.freeze({
      id: "story-foundation.production.adoption",
      workspaceQueryId: workspaceQueryContracts.proposal.id,
      kind: "query",
      effect: "read",
      resultChannel: "query-result",
      visibility: foundationAdoptionPreparationVisibility,
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
      automaticCanon: false,
    }),
    presentation: Object.freeze({
      id: "story-foundation.production.presentation",
      workspacePresentationId: workspacePresentationContract.id,
      workspaceQueryIds: Object.freeze([
        workspaceQueryContracts.focus.id,
        workspaceQueryContracts.proposal.id,
      ]),
      kind: "presentation",
      effect: "compose",
      resultChannel: "workspace-view",
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
      automaticCanon: false,
    }),
  });
