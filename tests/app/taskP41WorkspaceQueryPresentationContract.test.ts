import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  getWorkspaceQueryContract,
  workspacePresentationContract,
  workspaceQueryContracts,
  workspaceQueryViews,
  type WorkspacePresentationContract,
  type WorkspaceQueryContract,
} from "../../src/app/workspaceQueryPresentationContract";

const queryKeys = [
  "effect",
  "id",
  "kind",
  "ownsNarrativeTruth",
  "resultChannel",
  "truthOwner",
  "view",
].sort();

const presentationKeys = [
  "effect",
  "id",
  "kind",
  "ownsNarrativeTruth",
  "queryIds",
  "resultChannel",
  "truthOwner",
  "view",
].sort();

describe("[task:P4.1] workspace query and presentation contracts", () => {
  it("[domain] keeps Focus, Proposal, Run, and Attention query contracts Domain-free and read-only", async () => {
    expect(workspaceQueryViews).toEqual(["focus", "proposal", "run", "attention"]);
    expect(Object.keys(workspaceQueryContracts).sort()).toEqual([...workspaceQueryViews].sort());

    for (const view of workspaceQueryViews) {
      const contract = workspaceQueryContracts[view];
      expect(contract).toEqual({
        id: `workspace.query.${view}`,
        view,
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
        truthOwner: "shared-novel-engine",
        ownsNarrativeTruth: false,
      });
      expect(Object.keys(contract).sort()).toEqual(queryKeys);
      expect(getWorkspaceQueryContract(view)).toBe(contract);
    }

    const source = await readFile(
      new URL("../../src/app/workspaceQueryPresentationContract.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["'].*\/domain\//);
  });

  it("[integration] composes exactly the four workspace views without DTO or API parameter fields", () => {
    const expectedQueryIds = workspaceQueryViews.map(view => `workspace.query.${view}`);
    expect(workspacePresentationContract).toEqual({
      id: "workspace.presentation",
      view: "workspace",
      kind: "presentation",
      effect: "compose",
      resultChannel: "workspace-view",
      queryIds: expectedQueryIds,
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
    });
    expect(Object.keys(workspacePresentationContract).sort()).toEqual(presentationKeys);
    expect(new Set(workspacePresentationContract.queryIds).size).toBe(4);
    expect(workspacePresentationContract.queryIds).toEqual(expectedQueryIds);
  });

  it("[cross-system] preserves Shared Novel Engine truth ownership across every query and presentation contract", () => {
    const contracts: readonly (WorkspaceQueryContract | WorkspacePresentationContract)[] = [
      ...workspaceQueryViews.map(view => workspaceQueryContracts[view]),
      workspacePresentationContract,
    ];
    for (const contract of contracts) {
      expect(contract.truthOwner).toBe("shared-novel-engine");
      expect(contract.ownsNarrativeTruth).toBe(false);
    }
  });

  it("[regression] keeps stable primitive-only workspace contract identities", () => {
    expect(() => getWorkspaceQueryContract("attention" as "focus")).not.toThrow();
    expect(() => getWorkspaceQueryContract("unknown" as "focus")).toThrow(
      "unknown workspace query view: unknown",
    );
    expect(workspaceQueryViews).toHaveLength(4);
  });
});
