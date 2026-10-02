import { describe, expect, it } from "vitest";
import { createCandidate } from "../../src/production/domain/candidate";
import { commitSceneText, createScene } from "../../src/manuscript/domain/scene";
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
    spanAnchors: { "span-2": "The Northern Sect gate stayed closed." },
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
      candidate: candidate({ type: "text", sceneId: "scene-1", text: "Different text" }),
      scene: scene(),
      mustPreserve: ["Northern Sect"],
      createdAt: now,
    });

    expect(result.run.outcome).toBe("fail");
    expect(result.run.findings[0]).toMatchObject({
      code: "REQUIRED_PHRASE_MISSING",
      severity: "error",
    });
  });

  it("validates local target spans against their source hash", () => {
    const currentScene = scene();
    const targetText = "The Northern Sect gate stayed closed.";
    const result = validateCandidate({
      validationId: "validation-1",
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

  it("validates every atomic change in a composite candidate", () => {
    const result = validateCandidate({
      validationId: "validation-composite",
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
});
