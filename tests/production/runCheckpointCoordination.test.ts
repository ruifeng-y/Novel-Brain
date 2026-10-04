import { describe, expect, it } from "vitest";
import {
  checkpointAuditProjection,
  decideRunCheckpoint,
  inspectRunCheckpoint,
  pauseRunCheckpoint,
  resumeRunCheckpoint,
  type CheckpointTriggerCategory,
} from "../../src/production/domain/runCheckpoint";
import { createSourceReference } from "../../src/shared/domain/observationSource";

const now = new Date("2026-10-04T12:00:00.000Z");
const later = new Date("2026-10-04T12:01:00.000Z");
const latest = new Date("2026-10-04T12:02:00.000Z");
const final = new Date("2026-10-04T12:03:00.000Z");

const human = { kind: "human" as const, actorId: "author-1" };
const policy = {
  kind: "policy" as const,
  actorId: "policy-runtime",
  policyVersion: "policy-v1",
  policyRule: "risk-threshold",
};

function paused(category: CheckpointTriggerCategory = "risk") {
  return pauseRunCheckpoint({
    id: `checkpoint-${category}`,
    runId: "run-checkpoint",
    novelId: "novel-checkpoint",
    triggerCategory: category,
    triggerReason: `trigger:${category}`,
    evidenceReferences: [`evidence:${category}`],
    control: category === "policy" ? policy : human,
    pausedAt: now,
  });
}

describe("[task:4.3-4.4] [domain] Run Checkpoint coordination", () => {
  it("[domain] accepts every trigger category and starts with pause evidence", () => {
    const categories: readonly CheckpointTriggerCategory[] = [
      "schedule",
      "risk",
      "budget",
      "uncertainty",
      "failure",
      "human",
      "policy",
    ];

    for (const category of categories) {
      const checkpoint = paused(category);
      expect(checkpoint.status).toBe("paused");
      expect(checkpoint.triggerCategory).toBe(category);
      expect(checkpoint.evidence).toHaveLength(1);
      expect(checkpoint.evidence[0]?.data).toMatchObject({
        phase: "pause",
        triggerCategory: category,
        evidenceReferences: [`evidence:${category}`],
      });
    }
  });

  it("[integration] preserves Pause -> Inspect -> Decide -> Resume with human or policy control", () => {
    const inspecting = inspectRunCheckpoint({
      checkpoint: paused("risk"),
      control: human,
      evidenceReferences: ["risk-evidence", "impact-evidence"],
      explanation: "High dependency impact",
      impact: "A downstream scene may become inconsistent",
      inspectedAt: later,
    });
    const decided = decideRunCheckpoint({
      checkpoint: inspecting,
      control: policy,
      action: "fallback",
      reason: "Use a lower-risk route",
      narrativeReviewDecisionReference: createSourceReference({
        identity: "review-decision-1",
        version: "change-set-revision-1",
        hash: "review-hash",
      }),
      decidedAt: latest,
    });
    const resumed = resumeRunCheckpoint({
      checkpoint: decided,
      control: policy,
      resumedAt: final,
    });

    expect(resumed.status).toBe("resumed");
    expect(resumed.decision?.action).toBe("fallback");
    expect(resumed.evidence.map((entry) => entry.data.phase)).toEqual([
      "pause",
      "inspect",
      "decide",
      "resume",
    ]);
    expect(resumed.evidence[1]?.data).toMatchObject({
      control: human,
      explanation: "High dependency impact",
      impact: "A downstream scene may become inconsistent",
      evidenceReferences: ["risk-evidence", "impact-evidence"],
    });
    expect(resumed.evidence[2]?.data.control).toEqual(policy);
  });

  it("[cross-system] keeps Checkpoint decisions separate from Narrative ReviewDecision", () => {
    const reference = createSourceReference({
      identity: "review-decision-2",
      version: "change-set-revision-2",
      hash: "review-hash-2",
    });
    const decided = decideRunCheckpoint({
      checkpoint: inspectRunCheckpoint({
        checkpoint: paused("human"),
        control: human,
        evidenceReferences: ["coordination-evidence"],
        explanation: "Inspect coordination only",
        impact: "No narrative acceptance",
        inspectedAt: later,
      }),
      control: human,
      action: "resume",
      reason: "Coordination only",
      narrativeReviewDecisionReference: reference,
      decidedAt: later,
    });
    const projection = checkpointAuditProjection(decided);

    expect(projection.decisionKind).toBe("run_coordination");
    expect(projection.narrativeReviewDecisionReference).toEqual(reference);
    expect(Object.prototype.hasOwnProperty.call(projection, "changeSetRevisionId")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(projection, "approvalScope")).toBe(false);
    expect(() => decideRunCheckpoint({
      checkpoint: inspectRunCheckpoint({
        checkpoint: paused("human"),
        control: human,
        evidenceReferences: ["invalid-action-evidence"],
        explanation: "Inspect invalid action",
        impact: "None",
        inspectedAt: later,
      }),
      control: human,
      action: "approve" as never,
      reason: "invalid narrative action",
      decidedAt: later,
    })).toThrow("checkpoint action must be resume, retry, fallback, or abort");
  });

  it("[regression] freezes every evidence revision and rejects backward time", () => {
    const checkpoint = paused("schedule");
    expect(Object.isFrozen(checkpoint)).toBe(true);
    expect(Object.isFrozen(checkpoint.evidence)).toBe(true);
    expect(checkpoint.evidence.every(Object.isFrozen)).toBe(true);
    expect(() => inspectRunCheckpoint({
      checkpoint,
      control: human,
      evidenceReferences: ["late-evidence"],
      explanation: "late",
      impact: "none",
      inspectedAt: new Date(now.getTime() - 1),
    })).toThrow("inspectedAt cannot move backward");
  });
});
