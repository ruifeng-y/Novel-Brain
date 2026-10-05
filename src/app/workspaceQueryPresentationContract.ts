export const workspaceQueryViews = Object.freeze([
  "focus",
  "proposal",
  "run",
  "attention",
] as const);

export type WorkspaceQueryView = (typeof workspaceQueryViews)[number];
export type WorkspaceQueryKind = "query";
export type WorkspaceQueryEffect = "read";
export type WorkspaceQueryResultChannel = "query-result";
export type WorkspacePresentationKind = "presentation";
export type WorkspacePresentationEffect = "compose";
export type WorkspacePresentationResultChannel = "workspace-view";
export type WorkspaceTruthOwner = "shared-novel-engine";

export interface WorkspaceQueryContract {
  readonly id: string;
  readonly view: WorkspaceQueryView;
  readonly kind: WorkspaceQueryKind;
  readonly effect: WorkspaceQueryEffect;
  readonly resultChannel: WorkspaceQueryResultChannel;
  readonly truthOwner: WorkspaceTruthOwner;
  readonly ownsNarrativeTruth: false;
}

export interface WorkspacePresentationContract {
  readonly id: string;
  readonly view: "workspace";
  readonly kind: WorkspacePresentationKind;
  readonly effect: WorkspacePresentationEffect;
  readonly resultChannel: WorkspacePresentationResultChannel;
  readonly queryIds: readonly string[];
  readonly truthOwner: WorkspaceTruthOwner;
  readonly ownsNarrativeTruth: false;
}

function workspaceQueryContract(view: WorkspaceQueryView): WorkspaceQueryContract {
  return Object.freeze({
    id: `workspace.query.${view}`,
    view,
    kind: "query",
    effect: "read",
    resultChannel: "query-result",
    truthOwner: "shared-novel-engine",
    ownsNarrativeTruth: false,
  });
}

export const workspaceQueryContracts = Object.freeze({
  focus: workspaceQueryContract("focus"),
  proposal: workspaceQueryContract("proposal"),
  run: workspaceQueryContract("run"),
  attention: workspaceQueryContract("attention"),
} as const satisfies Record<WorkspaceQueryView, WorkspaceQueryContract>);

export const workspacePresentationContract: WorkspacePresentationContract =
  Object.freeze({
    id: "workspace.presentation",
    view: "workspace",
    kind: "presentation",
    effect: "compose",
    resultChannel: "workspace-view",
    queryIds: Object.freeze(workspaceQueryViews.map(view => `workspace.query.${view}`)),
    truthOwner: "shared-novel-engine",
    ownsNarrativeTruth: false,
  });

export function getWorkspaceQueryContract(view: WorkspaceQueryView): WorkspaceQueryContract {
  const contract = workspaceQueryContracts[view];
  if (!contract) throw new Error(`unknown workspace query view: ${String(view)}`);
  return contract;
}
