import { createFoundationWorkspaceContract } from "../story/application/foundationWorkspaceContract";
import type { NarrativeProposalPersistence } from "../story/application/narrativeProposalPersistence";
import {
  createWorkspaceIntegrationContract,
  type WorkspaceIntegrationQueryInput,
  type WorkspaceIntegrationView,
} from "./workspaceIntegrationContract";

/**
 * Product-facing read model for the workspace. It composes the frozen
 * foundation workspace query with the cross-system integration contract and
 * keeps the shared Narrative Truth boundary intact.
 */
export interface WorkspaceProductQueryService {
  getWorkspaceView(input: WorkspaceIntegrationQueryInput): Promise<WorkspaceIntegrationView>;
}

export interface WorkspaceProductQueryDependencies {
  readonly foundationPersistence: NarrativeProposalPersistence;
}

export function createWorkspaceProductQueryService(
  dependencies: WorkspaceProductQueryDependencies,
): WorkspaceProductQueryService {
  const integration = createWorkspaceIntegrationContract({
    foundation: createFoundationWorkspaceContract({
      persistence: dependencies.foundationPersistence,
    }),
  });

  return {
    async getWorkspaceView(input) {
      return integration.query(input);
    },
  };
}
