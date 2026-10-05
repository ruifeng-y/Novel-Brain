import { describe, expect, it } from "vitest";
import {
  getObjectEntryContract,
  workspaceObjectKinds,
  type ObjectEntryContract,
  type WorkspaceLens,
  type WorkspaceMode,
  type WorkspaceObjectKind,
} from "../../src/app/objectEntryContract";

const EXPECTED_KINDS: readonly WorkspaceObjectKind[] = [
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
];

interface ExpectedRow {
  readonly defaultMode: WorkspaceMode;
  readonly surfaceKind: string;
  readonly defaultPanels: readonly string[];
  readonly defaultLens: WorkspaceLens;
}

// Spec §5 Object Entry Contract, encoded row by row. Arc / Chapter is one spec
// row split into two kinds; World / Character / Plot stays a single kind.
const EXPECTED_TABLE: Record<WorkspaceObjectKind, ExpectedRow> = {
  novel: {
    defaultMode: "explore",
    surfaceKind: "overview, health, current state",
    defaultPanels: ["Attention", "Recent", "Health"],
    defaultLens: "structure",
  },
  "story-foundation": {
    defaultMode: "design",
    surfaceKind: "five-direction skeleton, proposals",
    defaultPanels: ["Proposals", "Proposal Open Questions"],
    defaultLens: "semantic",
  },
  "world-character-plot": {
    defaultMode: "design",
    surfaceKind: "object content, proposals",
    defaultPanels: ["Dependencies", "Related Objects", "Proposal Open Questions"],
    defaultLens: "semantic",
  },
  arc: {
    defaultMode: "design",
    surfaceKind: "structure, plan",
    defaultPanels: ["Scenes", "Threads", "Foreshadowing"],
    defaultLens: "structure",
  },
  chapter: {
    defaultMode: "design",
    surfaceKind: "structure, plan",
    defaultPanels: ["Scenes", "Threads", "Foreshadowing"],
    defaultLens: "structure",
  },
  scene: {
    defaultMode: "write",
    surfaceKind: "manuscript editor",
    defaultPanels: ["Context", "Candidates", "Validation", "Dependencies"],
    defaultLens: "structure",
  },
  "target-span": {
    defaultMode: "write",
    surfaceKind: "span editor or span provenance",
    defaultPanels: ["Context", "Candidates", "Validation"],
    defaultLens: "structure",
  },
  proposal: {
    defaultMode: "design",
    surfaceKind: "proposal workbench",
    defaultPanels: ["Proposal Open Questions", "Provenance", "Adoption Preview"],
    defaultLens: "semantic",
  },
  candidate: {
    defaultMode: "review",
    surfaceKind: "compare, diff",
    defaultPanels: ["Evidence", "Impact", "Validation"],
    defaultLens: "impact",
  },
  "change-set-revision": {
    defaultMode: "review",
    surfaceKind: "revision content, diff",
    defaultPanels: ["Validation", "Approval", "Impact", "Gate"],
    defaultLens: "impact",
  },
  commit: {
    defaultMode: "review",
    surfaceKind: "commit detail, change",
    defaultPanels: ["Provenance", "Impact", "Audit"],
    defaultLens: "impact",
  },
  analysis: {
    defaultMode: "analyze",
    surfaceKind: "impact, consistency report",
    defaultPanels: ["Affected Objects", "Findings", "Repair Proposals"],
    defaultLens: "impact",
  },
  process: {
    defaultMode: "explore",
    surfaceKind: "Process Center",
    defaultPanels: ["Run Plan", "Progress", "Checkpoints", "Failures"],
    defaultLens: "process",
  },
};

describe("workspace object entry contract", () => {
  it("declares exactly the spec's thirteen kinds, in declared order", () => {
    expect(workspaceObjectKinds).toEqual(EXPECTED_KINDS);
  });

  it("encodes the spec §5 table verbatim for every kind", () => {
    for (const kind of EXPECTED_KINDS) {
      expect(getObjectEntryContract(kind)).toEqual({
        kind,
        ...EXPECTED_TABLE[kind],
      });
    }
  });

  it("gives every kind a non-empty surface and at least one default panel", () => {
    for (const kind of workspaceObjectKinds) {
      const contract: ObjectEntryContract = getObjectEntryContract(kind);
      expect(contract.surfaceKind.length).toBeGreaterThan(0);
      expect(contract.defaultPanels.length).toBeGreaterThan(0);
      expect(contract.kind).toBe(kind);
    }
  });

  it("never splits or merges kinds the spec keeps on one row", () => {
    // Arc / Chapter is one spec row split into two kinds; World / Character /
    // Plot stays a single kind.
    expect(workspaceObjectKinds).toContain("arc");
    expect(workspaceObjectKinds).toContain("chapter");
    expect(workspaceObjectKinds).toContain("world-character-plot");
    expect(workspaceObjectKinds).not.toContain("world");
    expect(workspaceObjectKinds).not.toContain("character");
    expect(workspaceObjectKinds).not.toContain("plot");
  });

  it("refuses to return a partial contract for an unknown runtime kind", () => {
    expect(() => getObjectEntryContract("not-a-kind" as WorkspaceObjectKind)).toThrow(
      /unknown workspace object kind/i,
    );
  });

  it("returns the freeze-marked contract for a known kind", () => {
    const contract = getObjectEntryContract("scene");
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.defaultPanels)).toBe(true);
  });
});
