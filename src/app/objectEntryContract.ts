/**
 * Workspace Object Entry Contract.
 *
 * Encodes the Spec §5 object entry table verbatim: for each object kind it
 * fixes the default Mode, the primary Working Surface, the default Context
 * Panels, and the default Lens. The table is data, not branching logic, so it
 * is the single source for default Mode / surface / panels / Lens.
 *
 * Spec §5 keeps `Arc / Chapter` on one row; it is split here into two kinds.
 * `World / Character / Plot` stays a single kind.
 */

export type WorkspaceObjectKind =
  | "novel"
  | "story-foundation"
  | "world-character-plot"
  | "arc"
  | "chapter"
  | "scene"
  | "target-span"
  | "proposal"
  | "candidate"
  | "change-set-revision"
  | "commit"
  | "analysis"
  | "process";

export type WorkspaceMode = "explore" | "design" | "write" | "review" | "analyze";

export type WorkspaceLens = "structure" | "semantic" | "temporal" | "thread" | "impact" | "process";

export interface ObjectEntryContract {
  readonly kind: WorkspaceObjectKind;
  readonly defaultMode: WorkspaceMode;
  readonly surfaceKind: string;
  readonly defaultPanels: readonly string[];
  readonly defaultLens: WorkspaceLens;
}

function freezeContract(contract: ObjectEntryContract): ObjectEntryContract {
  return Object.freeze({
    ...contract,
    defaultPanels: Object.freeze([...contract.defaultPanels]),
  });
}

const CONTRACT_TABLE: Readonly<Record<WorkspaceObjectKind, ObjectEntryContract>> = Object.freeze({
  novel: freezeContract({
    kind: "novel",
    defaultMode: "explore",
    surfaceKind: "overview, health, current state",
    defaultPanels: ["Attention", "Recent", "Health"],
    defaultLens: "structure",
  }),
  "story-foundation": freezeContract({
    kind: "story-foundation",
    defaultMode: "design",
    surfaceKind: "five-direction skeleton, proposals",
    defaultPanels: ["Proposals", "Proposal Open Questions"],
    defaultLens: "semantic",
  }),
  "world-character-plot": freezeContract({
    kind: "world-character-plot",
    defaultMode: "design",
    surfaceKind: "object content, proposals",
    defaultPanels: ["Dependencies", "Related Objects", "Proposal Open Questions"],
    defaultLens: "semantic",
  }),
  arc: freezeContract({
    kind: "arc",
    defaultMode: "design",
    surfaceKind: "structure, plan",
    defaultPanels: ["Scenes", "Threads", "Foreshadowing"],
    defaultLens: "structure",
  }),
  chapter: freezeContract({
    kind: "chapter",
    defaultMode: "design",
    surfaceKind: "structure, plan",
    defaultPanels: ["Scenes", "Threads", "Foreshadowing"],
    defaultLens: "structure",
  }),
  scene: freezeContract({
    kind: "scene",
    defaultMode: "write",
    surfaceKind: "manuscript editor",
    defaultPanels: ["Context", "Candidates", "Validation", "Dependencies"],
    defaultLens: "structure",
  }),
  "target-span": freezeContract({
    kind: "target-span",
    defaultMode: "write",
    surfaceKind: "span editor or span provenance",
    defaultPanels: ["Context", "Candidates", "Validation"],
    defaultLens: "structure",
  }),
  proposal: freezeContract({
    kind: "proposal",
    defaultMode: "design",
    surfaceKind: "proposal workbench",
    defaultPanels: ["Proposal Open Questions", "Provenance", "Adoption Preview"],
    defaultLens: "semantic",
  }),
  candidate: freezeContract({
    kind: "candidate",
    defaultMode: "review",
    surfaceKind: "compare, diff",
    defaultPanels: ["Evidence", "Impact", "Validation"],
    defaultLens: "impact",
  }),
  "change-set-revision": freezeContract({
    kind: "change-set-revision",
    defaultMode: "review",
    surfaceKind: "revision content, diff",
    defaultPanels: ["Validation", "Approval", "Impact", "Gate"],
    defaultLens: "impact",
  }),
  commit: freezeContract({
    kind: "commit",
    defaultMode: "review",
    surfaceKind: "commit detail, change",
    defaultPanels: ["Provenance", "Impact", "Audit"],
    defaultLens: "impact",
  }),
  analysis: freezeContract({
    kind: "analysis",
    defaultMode: "analyze",
    surfaceKind: "impact, consistency report",
    defaultPanels: ["Affected Objects", "Findings", "Repair Proposals"],
    defaultLens: "impact",
  }),
  process: freezeContract({
    kind: "process",
    defaultMode: "explore",
    surfaceKind: "Process Center",
    defaultPanels: ["Run Plan", "Progress", "Checkpoints", "Failures"],
    defaultLens: "process",
  }),
});

export const workspaceObjectKinds: readonly WorkspaceObjectKind[] = Object.freeze([
  "novel",
  "story-foundation",
  "world-character-plot",
  "arc",
  "chapter",
  "scene",
  "target-span",
  "proposal",
  "candidate",
  "change-set-revision",
  "commit",
  "analysis",
  "process",
] as const);

const KIND_SET: ReadonlySet<string> = new Set(workspaceObjectKinds);

/**
 * Guards untrusted input against the closed `WorkspaceObjectKind` union. The
 * union cannot be violated statically, so this is the runtime gate for values
 * arriving from HTTP or the browser.
 */
export function isWorkspaceObjectKind(value: unknown): value is WorkspaceObjectKind {
  return typeof value === "string" && KIND_SET.has(value);
}

/**
 * Returns the contract for a known kind. An unknown kind is an unresolvable
 * target, never a partial contract, so this throws rather than degrading.
 */
export function getObjectEntryContract(kind: WorkspaceObjectKind): ObjectEntryContract {
  if (!isWorkspaceObjectKind(kind)) {
    throw new Error(`unknown workspace object kind: ${String(kind)}`);
  }
  return CONTRACT_TABLE[kind];
}
