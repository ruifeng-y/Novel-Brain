import {
  workspacePresentationContract,
  workspaceQueryContracts,
  type WorkspaceTruthOwner,
} from "./workspaceQueryPresentationContract";

export const productionRunStatuses = Object.freeze([
  "draft",
  "planned",
  "approved",
  "running",
  "paused",
  "waiting_for_human",
  "completed",
  "failed",
  "cancelled",
] as const);

export const productionRunStepStatuses = Object.freeze([
  "pending",
  "ready",
  "running",
  "succeeded",
  "failed",
  "skipped",
] as const);

export const productionRunEvidenceKinds = Object.freeze([
  "run",
  "attempt",
  "candidate",
  "decision",
  "commit",
  "cost",
  "failure",
] as const);

export const recallPipelineStages = Object.freeze([
  "observe",
  "detect",
  "classify",
  "prioritize",
  "surface",
  "explain",
  "author-action",
  "re-check",
] as const);

export const recallEvidenceKinds = Object.freeze([
  "source-kind",
  "evidence-reference",
  "source-reference",
  "staleness",
] as const);

export const recallAttentionActions = Object.freeze([
  "inspect",
  "dismiss",
  "snooze",
  "confirm",
  "ignore",
  "why",
] as const);

export const recallAttentionStates = Object.freeze([
  "active",
  "inspected",
  "dismissed",
  "snoozed",
  "confirmed",
  "ignored",
  "why_requested",
] as const);

export interface ProductionRunStateBoundary {
  readonly runStateOwner: "production-run";
  readonly narrativeStateOwner: "shared-novel-engine";
  readonly runStateEqualsNarrativeState: false;
  readonly ownsNarrativeTruth: false;
  readonly automaticCommit: false;
}

export interface ProductionRunStatusSurfaceContract {
  readonly id: string;
  readonly workspaceQueryId: string;
  readonly kind: "query";
  readonly effect: "read";
  readonly resultChannel: "query-result";
  readonly visibleStatuses: readonly (typeof productionRunStatuses)[number][];
  readonly visibleStepStatuses: readonly (typeof productionRunStepStatuses)[number][];
  readonly visibleEvidence: readonly (typeof productionRunEvidenceKinds)[number][];
  readonly stateBoundary: ProductionRunStateBoundary;
  readonly truthOwner: WorkspaceTruthOwner;
  readonly ownsNarrativeTruth: false;
}

export interface RecallAuthorityBoundary {
  readonly authoritative: false;
  readonly mayMutateNarrativeTruth: false;
  readonly mayCreateTaskDirectly: false;
  readonly mayCommit: false;
  readonly proposedActionChannel: "production-run-policy";
}

export interface RecallAttentionSurfaceContract {
  readonly id: string;
  readonly workspaceQueryId: string;
  readonly kind: "query";
  readonly effect: "read";
  readonly resultChannel: "query-result";
  readonly visiblePipeline: readonly (typeof recallPipelineStages)[number][];
  readonly evidenceRequired: true;
  readonly visibleEvidence: readonly (typeof recallEvidenceKinds)[number][];
  readonly visibleAuthorActions: readonly (typeof recallAttentionActions)[number][];
  readonly visibleDispositionStates: readonly (typeof recallAttentionStates)[number][];
  readonly authority: RecallAuthorityBoundary;
  readonly truthOwner: WorkspaceTruthOwner;
  readonly ownsNarrativeTruth: false;
}

export interface ProductionRunRecallPresentationSurfaceContract {
  readonly id: string;
  readonly workspacePresentationId: string;
  readonly workspaceQueryIds: readonly string[];
  readonly kind: "presentation";
  readonly effect: "compose";
  readonly resultChannel: "workspace-view";
  readonly truthOwner: WorkspaceTruthOwner;
  readonly ownsNarrativeTruth: false;
}

export interface ProductionRunRecallSurfaceContracts {
  readonly run: ProductionRunStatusSurfaceContract;
  readonly attention: RecallAttentionSurfaceContract;
  readonly presentation: ProductionRunRecallPresentationSurfaceContract;
}

export const productionRunRecallSurfaceContracts: ProductionRunRecallSurfaceContracts =
  Object.freeze({
    run: Object.freeze({
      id: "production-run.production.status",
      workspaceQueryId: workspaceQueryContracts.run.id,
      kind: "query",
      effect: "read",
      resultChannel: "query-result",
      visibleStatuses: productionRunStatuses,
      visibleStepStatuses: productionRunStepStatuses,
      visibleEvidence: productionRunEvidenceKinds,
      stateBoundary: Object.freeze({
        runStateOwner: "production-run",
        narrativeStateOwner: "shared-novel-engine",
        runStateEqualsNarrativeState: false,
        ownsNarrativeTruth: false,
        automaticCommit: false,
      }),
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
    }),
    attention: Object.freeze({
      id: "recall.production.attention",
      workspaceQueryId: workspaceQueryContracts.attention.id,
      kind: "query",
      effect: "read",
      resultChannel: "query-result",
      visiblePipeline: recallPipelineStages,
      evidenceRequired: true,
      visibleEvidence: recallEvidenceKinds,
      visibleAuthorActions: recallAttentionActions,
      visibleDispositionStates: recallAttentionStates,
      authority: Object.freeze({
        authoritative: false,
        mayMutateNarrativeTruth: false,
        mayCreateTaskDirectly: false,
        mayCommit: false,
        proposedActionChannel: "production-run-policy",
      }),
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
    }),
    presentation: Object.freeze({
      id: "production-run-recall.production.presentation",
      workspacePresentationId: workspacePresentationContract.id,
      workspaceQueryIds: Object.freeze([
        workspaceQueryContracts.run.id,
        workspaceQueryContracts.attention.id,
      ]),
      kind: "presentation",
      effect: "compose",
      resultChannel: "workspace-view",
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
    }),
  });
