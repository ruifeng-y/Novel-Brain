import { describe, expect, it } from "vitest";
import { runSharedPrerequisiteIntegrationContract } from "../support/sharedPrerequisiteIntegrationContract";
import { createInMemorySharedPrerequisiteEnvironment } from "../support/sharedPrerequisiteFixtures";

runSharedPrerequisiteIntegrationContract("InMemory", async () =>
  createInMemorySharedPrerequisiteEnvironment(),
);

describe("InMemory [task:2.4] shared prerequisite fixture availability", () => {
  it("[integration] constructs one coherent fixture", async () => {
    const environment = await createInMemorySharedPrerequisiteEnvironment();
    expect(environment.fixture.novelId).toBe("novel-shared-prerequisite-2.4");
  });
});
