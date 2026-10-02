import { describe, expect, it } from "vitest";
import {
  createCandidate,
  editCandidate,
  markCandidateValidated,
  markCandidateOutdated,
  rejectCandidate,
  selectCandidate,
} from "../../src/production/domain/candidate";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");
const sceneVersion = createVersionReference("Scene", "scene-1", "scene-rev-1");
const basedOnVersionSet = createVersionSet({ scene: sceneVersion });

function candidate() {
  return createCandidate({
    id: "candidate-1",
    taskId: "task-1",
    novelId: "novel-1",
    basedOnVersionSet,
    change: { type: "text", sceneId: "scene-1", text: "Candidate text" },
    createdAt: now,
  });
}

describe("Candidate", () => {
  it("remains separate from canonical content", () => {
    expect(candidate()).toMatchObject({
      status: "generated",
      change: { type: "text", text: "Candidate text" },
    });
  });

  it("requires a precise non-empty based-on version set", () => {
    expect(() =>
      createCandidate({
        id: "candidate-empty",
        taskId: "task-1",
        novelId: "novel-1",
        basedOnVersionSet: createVersionSet({}),
        change: { type: "text", sceneId: "scene-1", text: "Candidate text" },
        createdAt: now,
      }),
    ).toThrow("basedOnVersionSet must contain at least one dependency");
  });

  it("creates a new candidate revision after author edits", () => {
    const original = candidate();
    const edited = editCandidate({
      candidate: original,
      change: { type: "text", sceneId: "scene-1", text: "Edited text" },
      revisionId: "candidate-rev-2",
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });
    expect(original.currentRevisionId).toBe("candidate-1-rev-1");
    expect(edited.currentRevisionId).toBe("candidate-rev-2");
    if (edited.change.type !== "text") throw new Error("Expected a text candidate");
    expect(edited.change.text).toBe("Edited text");
  });

  it("supports selection, rejection, and stale states", () => {
    const original = markCandidateValidated(candidate(), new Date("2026-10-03T00:00:00.000Z"));
    const selected = selectCandidate(original, new Date("2026-10-03T00:00:00.000Z"));
    expect(selected.status).toBe("selected");
    expect(() => rejectCandidate(selected, "Not preferred")).toThrow("Terminal candidate cannot be rejected");

    const rejected = rejectCandidate(candidate(), "Not preferred");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("Not preferred");

    const outdated = markCandidateOutdated(candidate(), new Date("2026-10-03T00:00:00.000Z"));
    expect(outdated.status).toBe("outdated");
  });

  it("rejects edits and terminal transitions after selection", () => {
    const selected = selectCandidate(
      markCandidateValidated(candidate(), new Date("2026-10-03T00:00:00.000Z")),
      new Date("2026-10-03T00:00:00.000Z"),
    );
    expect(() =>
      editCandidate({
        candidate: selected,
        change: { type: "text", sceneId: "scene-1", text: "Late edit" },
        revisionId: "candidate-rev-late",
        updatedAt: new Date("2026-10-04T00:00:00.000Z"),
      }),
    ).toThrow("Terminal candidate cannot be edited");
    expect(() => rejectCandidate(selected, "Late rejection")).toThrow(
      "Terminal candidate cannot be rejected",
    );
    expect(() => markCandidateOutdated(selected, new Date("2026-10-04T00:00:00.000Z"))).toThrow(
      "Terminal candidate cannot become outdated",
    );
  });

  it("rejects edits after rejection, outdated, or archived states", () => {
    const rejected = rejectCandidate(candidate(), "Not preferred");
    const outdated = markCandidateOutdated(candidate(), new Date("2026-10-03T00:00:00.000Z"));
    const archived = Object.freeze({ ...candidate(), status: "archived" as const });
    for (const terminal of [rejected, outdated, archived]) {
      expect(() =>
        editCandidate({
          candidate: terminal,
          change: { type: "text", sceneId: "scene-1", text: "Late edit" },
          revisionId: "candidate-rev-late",
          updatedAt: new Date("2026-10-04T00:00:00.000Z"),
        }),
      ).toThrow("Terminal candidate cannot be edited");
    }
    expect(() => markCandidateOutdated(rejected, new Date("2026-10-04T00:00:00.000Z"))).toThrow(
      "Terminal candidate cannot become outdated",
    );
    expect(() => markCandidateOutdated(archived, new Date("2026-10-04T00:00:00.000Z"))).toThrow(
      "Terminal candidate cannot become outdated",
    );
  });
});
