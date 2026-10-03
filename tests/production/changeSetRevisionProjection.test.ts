import { describe, expect, it } from "vitest";
import {
  projectRevision,
  type RevisionProjectionFacts,
} from "../../src/production/domain/changeSetRevisionProjection";

function facts(overrides: Partial<RevisionProjectionFacts> = {}): RevisionProjectionFacts {
  return {
    committed: false,
    unresolvedConflict: false,
    stale: false,
    approved: false,
    submitted: false,
    hasChanges: false,
    ...overrides,
  };
}

describe("revision status projection", () => {
  it("reports assembling for an empty, unsubmitted revision", () => {
    expect(projectRevision(facts()).headline).toBe("assembling");
  });

  it("reports ready once the revision has changes", () => {
    expect(projectRevision(facts({ hasChanges: true })).headline).toBe("ready");
  });

  it("reports submitted before validation", () => {
    expect(projectRevision(facts({ hasChanges: true, submitted: true })).headline).toBe("submitted");
  });

  it("maps validation outcomes to validated, failed, or needs_review", () => {
    expect(projectRevision(facts({ submitted: true, validationOutcome: "pass" })).headline).toBe(
      "validated",
    );
    expect(projectRevision(facts({ submitted: true, validationOutcome: "fail" })).headline).toBe(
      "failed",
    );
    expect(
      projectRevision(facts({ submitted: true, validationOutcome: "needs_review" })).headline,
    ).toBe("needs_review");
  });

  it("prioritises committed over invalid, stale, and approved", () => {
    expect(
      projectRevision(
        facts({ committed: true, unresolvedConflict: true, stale: true, approved: true }),
      ).headline,
    ).toBe("committed");
    expect(
      projectRevision(facts({ unresolvedConflict: true, stale: true, approved: true })).headline,
    ).toBe("invalid");
    expect(projectRevision(facts({ stale: true, approved: true })).headline).toBe("stale");
    expect(projectRevision(facts({ approved: true, validationOutcome: "pass" })).headline).toBe(
      "approved",
    );
    expect(projectRevision(facts({ approved: true, validationOutcome: "fail" })).headline).toBe(
      "approved",
    );
    expect(projectRevision(facts({ approved: true, validationOutcome: "needs_review" })).headline).toBe(
      "approved",
    );
  });

  it("keeps blocking facts visible alongside the headline", () => {
    const projection = projectRevision(
      facts({ unresolvedConflict: true, stale: true, validationOutcome: "pass", approved: true }),
    );
    expect(projection.headline).toBe("invalid");
    expect(projection.unresolvedConflict).toBe(true);
    expect(projection.stale).toBe(true);
    expect(projection.validationOutcome).toBe("pass");
    expect(projection.approved).toBe(true);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(() => Object.assign(projection, { headline: "committed" as const })).toThrow(TypeError);
  });
});
