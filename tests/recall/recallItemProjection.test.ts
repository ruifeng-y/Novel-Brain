import { describe, expect, it } from "vitest";
import {
  projectRecallItems,
  queryRecallItems,
  type RecallItemProjectionInput,
} from "../../src/recall/projection/recallItemProjection";
import {
  baselineRecallClassifier,
  baselineRecallDetector,
  baselineRecallPrioritizer,
  detectRecallCandidates,
  classifyRecallCandidates,
  prioritizeRecallCandidates,
  type RecallCandidateSignal,
  type RecallObservationBatch,
} from "../../src/recall/detection/recallPipeline";

const observations: RecallObservationBatch = {
  observations: [
    {
      sourceKind: "validation",
      evidenceReference: "ValidationRun:validation-1",
      sourceReference: { identity: "ValidationRun:validation-1", version: "validation-v1", hash: "validation-hash-1" },
      ordinal: 1,
      staleness: "fresh",
      value: { id: "validation-1", outcome: "fail" },
    },
    {
      sourceKind: "dependency",
      evidenceReference: "DependencyRelation:relation-1",
      sourceReference: { identity: "DependencyRelation:relation-1", version: "dependency-v1", hash: "dependency-hash-1" },
      ordinal: 1,
      staleness: "stale",
      value: { id: "relation-1" },
    },
  ],
};

function input(): RecallItemProjectionInput {
  const detected = detectRecallCandidates(observations, [baselineRecallDetector]);
  const classified = classifyRecallCandidates(detected, observations, baselineRecallClassifier);
  const candidates = prioritizeRecallCandidates(classified, observations, baselineRecallPrioritizer);
  return { candidates };
}

describe("[task:5.3-5.5] [domain] Recall Item evidence and explanation projection", () => {
  it("projects complete evidence-backed explanations without Narrative Truth fields", () => {
    const before = structuredClone(input());
    const items = projectRecallItems(input());

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      candidateId: "baseline:stale-evidence:dependency:DependencyRelation:relation-1",
      detectionKind: "stale_evidence",
      classification: "risk",
      priority: "high",
    });
    expect(items[0]?.explanation).toEqual({
      reason: "dependency evidence is stale",
      evidenceReferences: ["DependencyRelation:relation-1"],
    });
    expect(items[0]?.evidence[0]).toEqual({
      sourceKind: "dependency",
      evidenceReference: "DependencyRelation:relation-1",
      sourceReference: { identity: "DependencyRelation:relation-1", version: "dependency-v1", hash: "dependency-hash-1" },
      staleness: "stale",
    });
    expect(JSON.stringify(items)).not.toContain("Narrative Truth");
    expect(JSON.stringify(items)).not.toContain("narrativeState");
    expect(JSON.stringify(items)).not.toContain("commitId");
    expect(input()).toEqual(before);
    expect(Object.isFrozen(items)).toBe(true);
    expect(Object.isFrozen(items[0])).toBe(true);
  });

  it("rejects empty or missing explanation and evidence", () => {
    const candidate = input().candidates[0] as RecallCandidateSignal;

    expect(() =>
      projectRecallItems({ candidates: [{ ...candidate, reason: "" }] }),
    ).toThrow("RecallItem requires non-empty explanation and evidence");
    expect(() =>
      projectRecallItems({ candidates: [{ ...candidate, evidence: [] }] }),
    ).toThrow("RecallItem requires non-empty explanation and evidence");
    expect(() =>
      projectRecallItems({
        candidates: [
          {
            ...candidate,
            reason: undefined,
            evidence: undefined,
          } as unknown as RecallCandidateSignal,
        ],
      }),
    ).toThrow("RecallItem requires non-empty explanation and evidence");
    expect(() =>
      projectRecallItems({
        candidates: [
          {
            ...candidate,
            evidence: [
              {
                ...candidate.evidence[0]!,
                evidenceReference: "",
              },
            ],
          },
        ],
      }),
    ).toThrow("RecallItem requires non-empty explanation and evidence");
  });

  it("queries by classification, priority, and evidence reference deterministically", () => {
    const items = projectRecallItems(input());
    const query = {
      classifications: ["validation"],
      priorities: ["normal"],
      evidenceReferences: ["ValidationRun:validation-1"],
    };

    expect(queryRecallItems(items, query).map((item) => item.candidateId)).toEqual([
      "baseline:validation-attention:ValidationRun:validation-1",
    ]);
    expect(queryRecallItems(items, {}).map((item) => item.candidateId)).toEqual([
      "baseline:stale-evidence:dependency:DependencyRelation:relation-1",
      "baseline:validation-attention:ValidationRun:validation-1",
    ]);
    expect(projectRecallItems(input())).toEqual(items);
  });

  it("accepts only optional normal Run policy proposed actions", () => {
    const candidateId = input().candidates[0]?.candidateId ?? "";
    const proposedAction = {
      request: {
        kind: "normal_run_policy",
        requestType: "threshold_action",
        requestId: "request-1",
        runId: "run-1",
        action: "ask",
        reason: "ask the author",
        evidenceReferences: ["RunCheckpoint:checkpoint-1"],
        requestedBy: "recall",
        requestedAt: "2026-10-05T00:00:00.000Z",
        observationHash: "observation-hash-1",
      },
    };
    const projected = projectRecallItems({
      ...input(),
      proposedActions: { [candidateId]: proposedAction },
    });

    expect(projected[0]?.proposedAction).toEqual(proposedAction);
    expect(() =>
      projectRecallItems({
        ...input(),
        proposedActions: {
          [candidateId]: {
            request: { kind: "normal_run_policy" },
            taskId: "task-1",
          },
        },
      }),
    ).toThrow("proposedAction must request normal Run policy without direct authority");
    expect(() =>
      projectRecallItems({
        ...input(),
        proposedActions: {
          [candidateId]: { request: { kind: "domain_command" } },
        },
      }),
    ).toThrow("proposedAction must request normal Run policy without direct authority");
  });

  it("fails closed on task, domain, commit, and execution bypass paths", () => {
    const candidateId = input().candidates[0]?.candidateId ?? "";
    const validRequest = {
      kind: "normal_run_policy",
      requestType: "threshold_action",
      requestId: "request-1",
      runId: "run-1",
      action: "ask",
      reason: "ask the author",
      evidenceReferences: ["RunCheckpoint:checkpoint-1"],
      requestedBy: "recall",
      requestedAt: "2026-10-05T00:00:00.000Z",
      observationHash: "observation-hash-1",
    };

    for (const proposedAction of [
      { request: validRequest, execute: { taskId: "task-1" } },
      { request: { ...validRequest, sideEffect: { domainMutation: true } } },
      { request: { ...validRequest, callback: { commit: "NarrativeCommit:commit-1" } } },
      { request: { ...validRequest, action: "execute_task" } },
      { request: { ...validRequest, requestType: "generation_task", create: true } },
    ]) {
      expect(() =>
        projectRecallItems({
          ...input(),
          proposedActions: { [candidateId]: proposedAction },
        }),
      ).toThrow("proposedAction must request normal Run policy without direct authority");
    }
  });
});

describe("[task:5.3-5.5] [replay] deterministic Recall Item projection", () => {
  it("replays the same projection and query result", () => {
    expect(projectRecallItems(input())).toEqual(projectRecallItems(input()));
    expect(queryRecallItems(projectRecallItems(input()), {})).toEqual(
      queryRecallItems(projectRecallItems(input()), {}),
    );
  });
});
describe("[task:7.4-7.5] [cross-system] queryable Recall evidence", () => {
  it("queries evidence-backed Recall items by stable evidence reference", () => {
    const items = projectRecallItems(input());
    const selected = queryRecallItems(items, {
      evidenceReferences: ["ValidationRun:validation-1"],
    });

    expect(selected.map((item) => item.candidateId)).toEqual([
      "baseline:validation-attention:ValidationRun:validation-1",
    ]);
    expect(selected[0]?.evidence).toEqual([
      {
        sourceKind: "validation",
        evidenceReference: "ValidationRun:validation-1",
        sourceReference: {
          identity: "ValidationRun:validation-1",
          version: "validation-v1",
          hash: "validation-hash-1",
        },
        staleness: "fresh",
      },
    ]);
    expect(selected[0]?.explanation.evidenceReferences).toEqual([
      "ValidationRun:validation-1",
    ]);
  });
});
