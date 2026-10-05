import { describe, expect, it } from "vitest";
import { createNovelBrainServer } from "../../src/http/server";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import type { HttpBoundaryPipeline } from "../../src/http/httpBoundaryPipeline";

function harness() {
  const calls: string[] = [];
  const pipeline: HttpBoundaryPipeline = {
    async execute(contractId, _context, input, handler) {
      calls.push(contractId);
      return handler(input);
    },
  };
  const dependencies = createInMemoryEngineDependencies();
  const app = createNovelBrainServer(dependencies, { httpBoundaryPipeline: pipeline });
  return { app, calls };
}

describe("[task:R3] [integration] workspace and foundation product API", () => {
  it("serves the workspace query through the HTTP boundary pipeline", async () => {
    const { app, calls } = harness();

    const response = await app.inject({ method: "GET", url: "/workspace/novel-1" });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual(["foundation.query.workspace-focus"]);
    expect(response.json().sharedTruth.owner).toBe("shared-novel-engine");
  });

  it("creates a blank foundation entry through its contract", async () => {
    const { app, calls } = harness();

    const response = await app.inject({
      method: "POST",
      url: "/foundation/entries",
      payload: { entryId: "entry-blank", novelId: "novel-1", mode: "blank" },
    });

    expect(response.statusCode).toBe(201);
    expect(calls).toEqual(["foundation.command.create-blank-foundation"]);
    expect(response.json()).toMatchObject({
      mode: "blank",
      status: "empty_narrative_state",
      automaticCommit: false,
    });
  });

  it("creates an idea proposal and advances the workflow without committing", async () => {
    const { app, calls } = harness();

    const entry = await app.inject({
      method: "POST",
      url: "/foundation/entries",
      payload: {
        entryId: "entry-idea",
        novelId: "novel-1",
        proposalId: "proposal-1",
        mode: "idea",
        idea: "A city remembers every promise.",
        proposalType: "story_concept",
        scope: { kind: "novel" },
        generation: {
          taskId: "generation-task-1",
          agentRole: "planner",
          modelPolicy: { provider: "reference", model: "reference-1", maxOutputTokens: 128 },
          basedOnVersionSet: {
            novel: { aggregateType: "Novel", objectId: "novel-1", revisionId: "rev-1" },
          },
        },
      },
    });
    expect(entry.statusCode).toBe(201);
    expect(entry.json().proposalId).toBe("proposal-1");

    const transition = await app.inject({
      method: "POST",
      url: "/foundation/proposals/proposal-1/transitions",
      payload: {
        from: "frame",
        to: "explore",
        changes: [
          { kind: "add_open_question", question: { id: "question-1", text: "Who remembers?" } },
        ],
      },
    });
    expect(transition.statusCode).toBe(201);
    expect(transition.json()).toMatchObject({ stage: "explore", automaticCommit: false });

    expect(calls).toEqual([
      "foundation.command.enter-foundation-idea",
      "foundation.command.revise-proposal",
    ]);
  });
});
