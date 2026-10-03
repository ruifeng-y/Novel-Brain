import { describe, expect, it } from "vitest";
import {
  assertTriggerPreconditions,
  type TriggerStatusFacts,
} from "../../src/production/domain/revisionTriggerPolicy";

function facts(overrides: Partial<TriggerStatusFacts> = {}): TriggerStatusFacts {
  return {
    changeSetLifecycle: "open",
    parentCommitted: false,
    unresolvedConflict: false,
    stale: false,
    hasReExecutableSource: false,
    ...overrides,
  };
}

describe("revision trigger preconditions", () => {
  it("always allows initial assembly", () => {
    expect(() =>
      assertTriggerPreconditions({ type: "initial_assembly", references: [] }, facts()),
    ).not.toThrow();
    expect(() =>
      assertTriggerPreconditions(
        { type: "initial_assembly", references: [] },
        facts({
          changeSetLifecycle: "closed",
          parentCommitted: true,
          unresolvedConflict: true,
          stale: true,
          hasReExecutableSource: true,
        }),
      ),
    ).not.toThrow();
  });

  it("allows edit only on an open change set with a non-committed parent", () => {
    expect(() =>
      assertTriggerPreconditions({ type: "edit", references: [] }, facts()),
    ).not.toThrow();
    expect(() =>
      assertTriggerPreconditions(
        { type: "edit", references: [] },
        facts({ changeSetLifecycle: "closed" }),
      ),
    ).toThrow("Edit requires an open change set");
    expect(() =>
      assertTriggerPreconditions(
        { type: "edit", references: [] },
        facts({ parentCommitted: true }),
      ),
    ).toThrow("Edit requires a parent revision that is not committed");
  });

  it("requires an unresolved conflict for conflict resolution", () => {
    expect(() =>
      assertTriggerPreconditions({ type: "conflict_resolution", references: ["c-1"] }, facts()),
    ).toThrow("Conflict resolution requires an unresolved conflict");
    expect(() =>
      assertTriggerPreconditions(
        { type: "conflict_resolution", references: ["c-1"] },
        facts({ unresolvedConflict: true }),
      ),
    ).not.toThrow();
  });

  it("requires staleness for rebase", () => {
    expect(() =>
      assertTriggerPreconditions({ type: "rebase", references: [] }, facts()),
    ).toThrow("Rebase requires a stale revision");
    expect(() =>
      assertTriggerPreconditions({ type: "rebase", references: [] }, facts({ stale: true })),
    ).not.toThrow();
    expect(() =>
      assertTriggerPreconditions(
        { type: "rebase", references: [] },
        facts({ stale: true, unresolvedConflict: true }),
      ),
    ).not.toThrow();
    expect(() =>
      assertTriggerPreconditions(
        { type: "rebase", references: [] },
        facts({ stale: false, unresolvedConflict: true }),
      ),
    ).toThrow("Rebase requires a stale revision");
  });

  it("requires a re-executable source for regenerate", () => {
    expect(() =>
      assertTriggerPreconditions({ type: "regenerate", references: [] }, facts()),
    ).toThrow("Regenerate requires a re-executable source");
    expect(() =>
      assertTriggerPreconditions(
        { type: "regenerate", references: [] },
        facts({ hasReExecutableSource: true }),
      ),
    ).not.toThrow();
  });
});
