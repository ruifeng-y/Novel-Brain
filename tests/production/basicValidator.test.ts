import { describe, expect, it } from "vitest";
import { createCandidate } from "../../src/production/domain/candidate";
import { commitSceneText, createScene, type Scene } from "../../src/manuscript/domain/scene";
import { hashContent } from "../../src/shared/domain/contentHash";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import { validateCandidate } from "../../src/production/application/validateCandidate";

const now = new Date("2026-10-02T00:00:00.000Z");

function scene() {
  const initial = createScene({
    id: "scene-1",
    novelId: "novel-1",
    chapterId: "chapter-1",
    title: "The Northern Gate",
    revisionId: "scene-rev-1",
    commitId: "initial-commit",
    createdAt: now,
  });
  return commitSceneText({
    scene: initial,
    text: "Lin Chuan waited. The Northern Sect gate stayed closed.",
    spanAnchors: {
      "span-2": {
        anchorId: "span-2",
        start: 18,
        end: 55,
        text: "The Northern Sect gate stayed closed.",
        sourceContentHash: hashContent("The Northern Sect gate stayed closed."),
      },
    },
    revisionId: "scene-rev-2",
    commitId: "initial-commit",
    updatedAt: now,
  });
}

function candidate(change: Parameters<typeof createCandidate>[0]["change"]) {
  return createCandidate({
    id: "candidate-1",
    taskId: "task-1",
    novelId: "novel-1",
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
    }),
    change,
    createdAt: now,
  });
}

describe("basic validator", () => {
  it("passes a non-empty text candidate", () => {
    const result = validateCandidate({
      validationId: "validation-1",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({ type: "text", sceneId: "scene-1", text: "New text" }),
      scene: scene(),
      mustPreserve: [],
      createdAt: now,
    });

    expect(result.run.outcome).toBe("pass");
  });

  it("fails when a required phrase is missing", () => {
    const result = validateCandidate({
      validationId: "validation-1",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({ type: "text", sceneId: "scene-1", text: "Different text" }),
      scene: scene(),
      mustPreserve: ["Northern Sect"],
      createdAt: now,
    });

    expect(result.run.outcome).toBe("fail");
    expect(result.run.entryResults[0]?.findings[0]).toMatchObject({
      code: "REQUIRED_PHRASE_MISSING",
      severity: "error",
    });
  });

  it("validates local target spans against their source hash", () => {
    const currentScene = scene();
    const targetText = "The Northern Sect gate stayed closed.";
    const result = validateCandidate({
      validationId: "validation-1",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({
        type: "local_text",
        sceneId: "scene-1",
        targetSpan: {
          anchorId: "span-2",
          text: targetText,
          sourceContentHash: hashContent(targetText),
        },
        replacement: "The gate opened slowly.",
      }),
      scene: currentScene,
      mustPreserve: [],
      createdAt: now,
    });

    expect(result.run.outcome).toBe("pass");
  });

  it("checks must-preserve phrases against the resulting local scene text", () => {
    const result = validateCandidate({
      validationId: "validation-local-preserve",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({
        type: "local_text",
        sceneId: "scene-1",
        targetSpan: {
          anchorId: "span-2",
          text: "The Northern Sect gate stayed closed.",
          sourceContentHash: hashContent("The Northern Sect gate stayed closed."),
        },
        replacement: "The gate opened slowly.",
      }),
      scene: scene(),
      mustPreserve: ["Lin Chuan waited."],
      createdAt: now,
    });

    expect(result.run.outcome).toBe("pass");
  });

  it("validates every atomic change in a composite candidate", () => {
    const result = validateCandidate({
      validationId: "validation-composite",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({
        type: "composite",
        changes: [
          { type: "text", sceneId: "scene-1", text: "New text" },
          {
            type: "structured_state",
            stateRecordId: "state-1",
            content: { condition: "injured" },
          },
        ],
      }),
      scene: scene(),
      mustPreserve: [],
      createdAt: now,
    });

    expect(result.run.outcome).toBe("pass");
  });

  it("checks must-preserve phrases against composite resulting scene text", () => {
    const result = validateCandidate({
      validationId: "validation-composite-preserve",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({
        type: "composite",
        changes: [
          {
            type: "local_text",
            sceneId: "scene-1",
            targetSpan: {
              anchorId: "span-2",
              text: "The Northern Sect gate stayed closed.",
              sourceContentHash: hashContent("The Northern Sect gate stayed closed."),
            },
            replacement: "The gate opened slowly.",
          },
          {
            type: "structured_state",
            stateRecordId: "state-1",
            content: { condition: "injured" },
          },
        ],
      }),
      scene: scene(),
      mustPreserve: ["Lin Chuan waited."],
      createdAt: now,
    });

    expect(result.run.outcome).toBe("pass");
  });

  it("rejects an empty structured state target id", () => {
    const result = validateCandidate({
      validationId: "validation-empty-state-id",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({
        type: "structured_state",
        stateRecordId: "",
        content: { condition: "injured" },
      }),
      scene: scene(),
      mustPreserve: [],
      createdAt: now,
    });

    expect(result.run.entryResults[0]?.findings[0]?.code).toBe("EMPTY_STRUCTURED_TARGET_ID");
  });

  it("rejects an empty structured fact target id", () => {
    const result = validateCandidate({
      validationId: "validation-empty-fact-id",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({
        type: "canonical_fact",
        canonicalFactId: "",
        content: { rule: "New rule" },
      }),
      scene: scene(),
      mustPreserve: [],
      createdAt: now,
    });

    expect(result.run.entryResults[0]?.findings[0]?.code).toBe("EMPTY_STRUCTURED_TARGET_ID");
  });

  it("reports a missing target anchor", () => {
    const result = validateCandidate({
      validationId: "validation-missing-anchor",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({
        type: "local_text",
        sceneId: "scene-1",
        targetSpan: {
          anchorId: "missing",
          text: "Missing.",
          sourceContentHash: hashContent("Missing."),
        },
        replacement: "Replacement.",
      }),
      scene: scene(),
      mustPreserve: [],
      createdAt: now,
    });

    expect(result.run.entryResults[0]?.findings[0]?.code).toBe("TARGET_ANCHOR_NOT_FOUND");
  });

  it("reports a target source hash mismatch", () => {
    const result = validateCandidate({
      validationId: "validation-hash-mismatch",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({
        type: "local_text",
        sceneId: "scene-1",
        targetSpan: {
          anchorId: "span-2",
          text: "The Northern Sect gate stayed closed.",
          sourceContentHash: hashContent("Wrong text"),
        },
        replacement: "Replacement.",
      }),
      scene: scene(),
      mustPreserve: [],
      createdAt: now,
    });

    expect(result.run.entryResults[0]?.findings[0]?.code).toBe("TARGET_SOURCE_HASH_MISMATCH");
  });

  it("reports a target text mismatch", () => {
    const result = validateCandidate({
      validationId: "validation-text-mismatch",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({
        type: "local_text",
        sceneId: "scene-1",
        targetSpan: {
          anchorId: "span-2",
          text: "Wrong text",
          sourceContentHash: hashContent("Wrong text"),
        },
        replacement: "Replacement.",
      }),
      scene: scene(),
      mustPreserve: [],
      createdAt: now,
    });

    expect(result.run.entryResults[0]?.findings[0]?.code).toBe("TARGET_TEXT_MISMATCH");
  });

  it("rejects duplicate composite targets", () => {
    const result = validateCandidate({
      validationId: "validation-duplicate-target",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({
        type: "composite",
        changes: [
          { type: "text", sceneId: "scene-1", text: "First" },
          { type: "text", sceneId: "scene-1", text: "Second" },
        ],
      }),
      scene: scene(),
      mustPreserve: [],
      createdAt: now,
    });

    expect(
      result.run.entryResults[0]?.findings.some(
        (finding) => finding.code === "DUPLICATE_CANDIDATE_TARGET",
      ),
    ).toBe(true);
    expect(result.outcome).toBe("fail");
  });

  it("binds the validation run to the change set revision and frozen plan version", () => {
    const result = validateCandidate({
      validationId: "validation-binding",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({ type: "text", sceneId: "scene-1", text: "New text" }),
      scene: scene(),
      mustPreserve: [],
      createdAt: now,
    });

    expect(result.run.changeSetRevisionId).toBe("cs-1-r1");
    expect(result.run.planVersionId).toBe("plan-1");
    expect("candidateId" in result.run).toBe(false);
    expect("candidateRevisionId" in result.run).toBe(false);
    expect(result.run.entryResults[0]?.entryReference).toBe("basic-candidate-validation");
  });
});
