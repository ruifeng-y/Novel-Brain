import { describe, expect, it } from "vitest";
import {
  productionRunRecallSurfaceContracts,
  productionRunStatuses,
  productionRunStepStatuses,
  recallAttentionActions,
  recallAttentionStates,
  recallEvidenceKinds,
  recallPipelineStages,
} from "../../src/app/productionRunRecallSurfaceContract";
import {
  workspacePresentationContract,
  workspaceQueryContracts,
} from "../../src/app/workspaceQueryPresentationContract";

describe("[task:P4.3] [domain] Production Run status surface contracts", () => {
  it("separates Run status from Narrative state and exposes status/audit visibility", () => {
    expect(productionRunStatuses).toEqual([
      "draft",
      "planned",
      "approved",
      "running",
      "paused",
      "waiting_for_human",
      "completed",
      "failed",
      "cancelled",
    ]);
    expect(productionRunStepStatuses).toEqual([
      "pending",
      "ready",
      "running",
      "succeeded",
      "failed",
      "skipped",
    ]);
    expect(productionRunRecallSurfaceContracts.run).toEqual({
      id: "production-run.production.status",
      workspaceQueryId: "workspace.query.run",
      kind: "query",
      effect: "read",
      resultChannel: "query-result",
      visibleStatuses: [
        "draft",
        "planned",
        "approved",
        "running",
        "paused",
        "waiting_for_human",
        "completed",
        "failed",
        "cancelled",
      ],
      visibleStepStatuses: ["pending", "ready", "running", "succeeded", "failed", "skipped"],
      visibleEvidence: [
        "run",
        "attempt",
        "candidate",
        "decision",
        "commit",
        "cost",
        "failure",
      ],
      stateBoundary: {
        runStateOwner: "production-run",
        narrativeStateOwner: "shared-novel-engine",
        runStateEqualsNarrativeState: false,
        ownsNarrativeTruth: false,
        automaticCommit: false,
      },
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
    });
  });
});

describe("[task:P4.3] [integration] Recall attention evidence surface", () => {
  it("requires evidence-backed attention and exposes the author disposition flow", () => {
    expect(recallPipelineStages).toEqual([
      "observe",
      "detect",
      "classify",
      "prioritize",
      "surface",
      "explain",
      "author-action",
      "re-check",
    ]);
    expect(recallEvidenceKinds).toEqual([
      "source-kind",
      "evidence-reference",
      "source-reference",
      "staleness",
    ]);
    expect(recallAttentionActions).toEqual([
      "inspect",
      "dismiss",
      "snooze",
      "confirm",
      "ignore",
      "why",
    ]);
    expect(recallAttentionStates).toEqual([
      "active",
      "inspected",
      "dismissed",
      "snoozed",
      "confirmed",
      "ignored",
      "why_requested",
    ]);
    expect(productionRunRecallSurfaceContracts.attention).toEqual({
      id: "recall.production.attention",
      workspaceQueryId: "workspace.query.attention",
      kind: "query",
      effect: "read",
      resultChannel: "query-result",
      visiblePipeline: [
        "observe",
        "detect",
        "classify",
        "prioritize",
        "surface",
        "explain",
        "author-action",
        "re-check",
      ],
      evidenceRequired: true,
      visibleEvidence: [
        "source-kind",
        "evidence-reference",
        "source-reference",
        "staleness",
      ],
      visibleAuthorActions: ["inspect", "dismiss", "snooze", "confirm", "ignore", "why"],
      visibleDispositionStates: [
        "active",
        "inspected",
        "dismissed",
        "snoozed",
        "confirmed",
        "ignored",
        "why_requested",
      ],
      authority: {
        authoritative: false,
        mayMutateNarrativeTruth: false,
        mayCreateTaskDirectly: false,
        mayCommit: false,
        proposedActionChannel: "production-run-policy",
      },
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
    });
  });
});

describe("[task:P4.3] [cross-system] Recall remains non-authoritative", () => {
  it("routes proposed actions to normal Run policy and forbids direct truth/task/commit authority", () => {
    expect(productionRunRecallSurfaceContracts.attention.authority).toEqual({
      authoritative: false,
      mayMutateNarrativeTruth: false,
      mayCreateTaskDirectly: false,
      mayCommit: false,
      proposedActionChannel: "production-run-policy",
    });
    expect(productionRunRecallSurfaceContracts.presentation).toEqual({
      id: "production-run-recall.production.presentation",
      workspacePresentationId: workspacePresentationContract.id,
      workspaceQueryIds: ["workspace.query.run", "workspace.query.attention"],
      kind: "presentation",
      effect: "compose",
      resultChannel: "workspace-view",
      truthOwner: "shared-novel-engine",
      ownsNarrativeTruth: false,
    });
  });
});

describe("[task:P4.3] [regression] Run and Recall surface contracts remain stable", () => {
  it("reuses P4.1 Workspace query identities and keeps Run/Recall views separate", () => {
    expect(productionRunRecallSurfaceContracts.run.workspaceQueryId).toBe(
      workspaceQueryContracts.run.id,
    );
    expect(productionRunRecallSurfaceContracts.attention.workspaceQueryId).toBe(
      workspaceQueryContracts.attention.id,
    );
    expect(productionRunRecallSurfaceContracts.run.workspaceQueryId).not.toBe(
      productionRunRecallSurfaceContracts.attention.workspaceQueryId,
    );
    expect(Object.keys(productionRunRecallSurfaceContracts).sort()).toEqual([
      "attention",
      "presentation",
      "run",
    ]);
  });
});
