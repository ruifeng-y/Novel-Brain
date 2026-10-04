import { deepFreeze } from "../shared/domain/immutable";
import type {
  FoundationWorkspaceFocus,
  FoundationWorkspaceQueryContract,
  FoundationWorkspaceView,
} from "../story/application/foundationWorkspaceContract";
import type { RecallItem } from "../recall/projection/recallItemProjection";
import type { AttentionDispositionRecord } from "../recall/attention/attentionDisposition";
import type { ProductionRunStatus, ProductionRunStepState } from "../production/domain/productionRun";
import type { SourceReference } from "../shared/domain/observationSource";

export interface WorkspaceRunProjection {
  readonly runId: string;
  readonly novelId: string;
  readonly status: ProductionRunStatus;
  readonly planRevisionReference: SourceReference;
  readonly stepStates: readonly ProductionRunStepState[];
}

export interface WorkspaceAttentionProjection {
  readonly novelId: string;
  readonly items: readonly RecallItem[];
  readonly dispositions: readonly AttentionDispositionRecord[];
}

export interface WorkspaceIntegrationQueryInput {
  readonly novelId: string;
  readonly focus: FoundationWorkspaceFocus;
  readonly run?: WorkspaceRunProjection;
  readonly attention?: WorkspaceAttentionProjection;
}

export interface WorkspaceSharedTruthBoundary {
  readonly owner: "shared-novel-engine";
  readonly foundationOwnsNarrativeTruth: false;
  readonly runOwnsNarrativeTruth: false;
  readonly recallOwnsNarrativeTruth: false;
}

export interface WorkspaceIntegrationView {
  readonly novelId: string;
  readonly focus: FoundationWorkspaceFocus;
  readonly proposal: FoundationWorkspaceView;
  readonly run?: WorkspaceRunProjection;
  readonly attention: WorkspaceAttentionProjection;
  readonly sharedTruth: WorkspaceSharedTruthBoundary;
}

export interface WorkspaceIntegrationContract {
  readonly ownsNarrativeTruth: false;
  query(input: WorkspaceIntegrationQueryInput): Promise<WorkspaceIntegrationView>;
}

export interface WorkspaceIntegrationDependencies {
  readonly foundation: FoundationWorkspaceQueryContract;
}

function assertCoherentNovel(
  novelId: string,
  run: WorkspaceRunProjection | undefined,
  attention: WorkspaceAttentionProjection | undefined,
): void {
  if (!novelId.trim()) throw new Error("Workspace novelId is required");
  if (run && run.novelId !== novelId) {
    throw new Error("Workspace contracts must share one Novel identity");
  }
  if (attention && attention.novelId !== novelId) {
    throw new Error("Workspace contracts must share one Novel identity");
  }
}

export function createWorkspaceIntegrationContract(
  dependencies: WorkspaceIntegrationDependencies,
): WorkspaceIntegrationContract {
  return {
    ownsNarrativeTruth: false,
    async query(input) {
      assertCoherentNovel(input.novelId, input.run, input.attention);
      const proposal = await dependencies.foundation.query({
        novelId: input.novelId,
        focus: input.focus,
      });
      if (
        proposal.narrativeTruth.owner !== "shared-novel-engine" ||
        proposal.narrativeTruth.foundationOwnsNarrativeTruth ||
        proposal.narrativeTruth.automaticCommit
      ) {
        throw new Error("Foundation Workspace must leave Narrative Truth with the Shared Novel Engine");
      }
      return deepFreeze({
        novelId: input.novelId,
        focus: { ...input.focus },
        proposal,
        ...(input.run === undefined ? {} : { run: input.run }),
        attention: input.attention ?? { novelId: input.novelId, items: [], dispositions: [] },
        sharedTruth: {
          owner: "shared-novel-engine" as const,
          foundationOwnsNarrativeTruth: false as const,
          runOwnsNarrativeTruth: false as const,
          recallOwnsNarrativeTruth: false as const,
        },
      });
    },
  };
}
