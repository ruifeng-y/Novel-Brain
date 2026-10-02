import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";

describe("application composition", () => {
  it("creates isolated engine dependencies for one author session", () => {
    const dependencies = createInMemoryEngineDependencies();
    expect(dependencies.novels).toBeDefined();
    expect(dependencies.scenes).toBeDefined();
    expect(dependencies.generationTasks).toBeDefined();
    expect(dependencies.candidates).toBeDefined();
    expect(dependencies.canonicalFacts).toBeDefined();
    expect(dependencies.stateRecords).toBeDefined();
    expect(dependencies.narrativeCommits).toBeDefined();
    expect(dependencies.eventStore).toBeDefined();
    expect(dependencies.runtime).toBeDefined();
  });

  it("does not share mutable storage between engine instances", async () => {
    const first = createInMemoryEngineDependencies();
    const second = createInMemoryEngineDependencies();
    await first.novels.save({
      id: "novel-1",
      authorId: "author-1",
      title: "Novel",
      status: "draft",
      autonomyPolicy: "human_review_required",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(await second.novels.findById("novel-1")).toBeUndefined();
  });
});
