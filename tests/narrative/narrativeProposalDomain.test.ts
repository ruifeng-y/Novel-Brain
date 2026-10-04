import { describe, expect, it } from "vitest";
import {
  branchNarrativeProposal,
  compareNarrativeProposals,
  createNarrativeProposal,
  proposalSectionInput,
  narrativeProposalSourceReference,
  proposalSectionHash,
  reviseNarrativeProposal,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";
import {
  createAdoptionChangeSetInputs,
  createAdoptionDecision,
  adoptionDecisionSourceReference,
} from "../../src/story/domain/adoptionDecision";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import { isImmutableTimestamp } from "../../src/shared/domain/observationSource";

const createdAt = new Date("2026-10-04T00:00:00.000Z");

function section(id: string, text: string): NarrativeProposalSectionInput {
  return {
    id,
    content: { text },
    provenance: {
      origin: { type: "author_created", references: [] },
      editLineage: [],
      evidenceReferences: [],
      adoptionDecisionReferences: [],
    },
  };
}

function proposal() {
  return createNarrativeProposal({
    id: "proposal-1",
    novelId: "novel-1",
    proposalType: "story_concept",
    scope: { dimension: "story-concept", question: "What is the story?" },
    sections: [section("section-a", "A brave cartographer"), section("section-b", "Maps a forbidden city")],
    createdAt,
  });
}

describe("Narrative Proposal domain [task:2.2]", () => {
  it("[domain] creates an immutable independent proposal revision without target-domain state", () => {
    const sourceDate = new Date(createdAt);
    const result = proposal();
    sourceDate.setTime(Date.parse("2027-01-01T00:00:00.000Z"));

    expect(result.currentRevisionId).toBe("proposal-1:r1");
    expect(result.revisionNumber).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sections)).toBe(true);
    expect(Object.isFrozen(result.sections[0]?.provenance.origin.references)).toBe(true);
    expect(isImmutableTimestamp(result.createdAt)).toBe(true);
    expect(result.createdAt.iso).toBe("2026-10-04T00:00:00.000Z");
    expect(Object.prototype.hasOwnProperty.call(result, "canon")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "manuscript")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "storyState")).toBe(false);
  });

  it("[domain] creates immutable full-snapshot revisions and keeps section identity stable", () => {
    const initial = proposal();
    const revised = reviseNarrativeProposal({
      proposal: initial,
      sections: initial.sections.map((entry) =>
        entry.id === "section-a"
          ? { ...proposalSectionInput(entry), content: { text: "A reluctant cartographer" } }
           : proposalSectionInput(entry),
      ),
      trigger: "content_change",
      revisedAt: new Date("2026-10-04T01:00:00.000Z"),
    });

    expect(revised.currentRevisionId).toBe("proposal-1:r2");
    expect(revised.revisionNumber).toBe(2);
    expect(revised.sections).toHaveLength(2);
    expect(revised.sections.map((entry) => entry.id)).toEqual(initial.sections.map((entry) => entry.id));
    expect(revised.sections[0]?.content).toEqual({ text: "A reluctant cartographer" });
    expect(revised.sections[0]?.provenance.editLineage.at(-1)?.identity).toBe("section-a");
    expect(initial.sections[0]?.content).toEqual({ text: "A brave cartographer" });
  });

  it("[domain] rejects revision-only metadata changes", () => {
    const initial = proposal();

    expect(() =>
      reviseNarrativeProposal({
        proposal: initial,
        sections: [...initial.sections].reverse().map(proposalSectionInput),
        trigger: "content_change",
        revisedAt: new Date("2026-10-04T01:00:00.000Z"),
      }),
    ).toThrow("revision must change semantic proposal content");
  });

  it("[domain] branches into a new identity with lineage and no source mutation", () => {
    const source = proposal();
    const branch = branchNarrativeProposal({
      sourceProposal: source,
      id: "proposal-branch",
      createdAt: new Date("2026-10-04T02:00:00.000Z"),
    });

    expect(branch.id).toBe("proposal-branch");
    expect(branch.currentRevisionId).toBe("proposal-branch:r1");
    expect(branch.lineage.parent).toEqual(narrativeProposalSourceReference(source));
    expect(branch.sections[0]?.provenance.editLineage.at(-1)).toEqual({
      identity: "section-a",
      version: source.currentRevisionId,
      hash: proposalSectionHash(source.sections[0]!),
    });
    expect(source.id).toBe("proposal-1");
    expect(source.lineage.parent).toBeUndefined();
  });

  it("[domain] compares proposals by semantic section content", () => {
    const source = proposal();
    const branch = branchNarrativeProposal({
      sourceProposal: source,
      id: "proposal-branch",
      createdAt: new Date("2026-10-04T02:00:00.000Z"),
    });
    const changed = reviseNarrativeProposal({
      proposal: branch,
      sections: branch.sections.map((entry) =>
        entry.id === "section-b" ? { ...proposalSectionInput(entry), content: { text: "Maps a living city" } } : proposalSectionInput(entry),
      ),
      trigger: "content_change",
      revisedAt: new Date("2026-10-04T03:00:00.000Z"),
    });

    expect(compareNarrativeProposals(source, changed)).toEqual({
      scopeChanged: false,
      addedSectionIds: [],
      removedSectionIds: [],
      changedSectionIds: ["section-a", "section-b"],
      unchangedSectionIds: [],
      changedSectionAspects: [
        { sectionId: "section-a", aspects: ["provenance"] },
        { sectionId: "section-b", aspects: ["content", "provenance"] },
      ],
      addedOpenQuestionIds: [],
      removedOpenQuestionIds: [],
      changedOpenQuestionIds: [],
      unchangedOpenQuestionIds: [],
    });
  });
});

describe("Typed Adoption Decision domain [task:2.2]", () => {
  const basedOnVersionSet = createVersionSet({
    plan: createVersionReference("StateRecord", "plan-story", "plan-rev-1"),
  });

  function decisionInput() {
    const source = proposal();
    return {
      proposal: source,
      id: "decision-1",
      decisionType: "adopt" as const,
      actor: { type: "author" as const, identity: "author-1" },
      reason: "Adopt the concept into Plan",
      decidedAt: new Date("2026-10-04T04:00:00.000Z"),
      targets: source.sections.map((entry, index) => ({
        id: `target-${index + 1}`,
        scope: {
          proposalIdentity: source.id,
          proposalRevision: source.currentRevisionId,
          sectionIdentity: entry.id,
        },
        targetType: "plan" as const,
        objectId: `plan-object-${index + 1}`,
        proposedChangeId: `change-${index + 1}`,
        adoptedContent: {
          contentReference: {
            identity: entry.id,
            version: source.currentRevisionId,
            hash: proposalSectionHash(entry),
          },
          contentHash: proposalSectionHash(entry),
        },
        payload: { text: entry.content.text },
        basedOnVersionSet,
      })),
    };
  }

  it("[domain] maps one or many separated adoption targets to exactly one proposed Change each", () => {
    const input = decisionInput();
    const decision = createAdoptionDecision(input);
    const result = createAdoptionChangeSetInputs(decision);

    expect(decision.targets).toHaveLength(2);
    expect(result.proposedChanges).toHaveLength(2);
    expect(result.changes).toHaveLength(2);
    expect(result.changes.map((change) => change.id)).toEqual(["change-1", "change-2"]);
    expect(result.changes.every((change) => change.sourceType === "proposal_adoption")).toBe(true);
    expect(result.proposedChanges[0]?.scope.sectionIdentity).toBe("section-a");
    expect(result.proposedChanges[1]?.scope.sectionIdentity).toBe("section-b");
    expect(result).not.toHaveProperty("commit");
  });

  it("[domain] supports partial adoption without changing the proposal", () => {
    const input = decisionInput();
    const before = input.proposal;
    const partial = createAdoptionDecision({
      ...input,
      id: "decision-partial",
      targets: input.targets.slice(0, 1),
    });

    const result = createAdoptionChangeSetInputs(partial);

    expect(result.changes).toHaveLength(1);
    expect(result.proposedChanges[0]?.scope.sectionIdentity).toBe("section-a");
    expect(input.proposal).toEqual(before);
  });

  it("[domain] rejects duplicate target scopes and content-hash mismatches", () => {
    const input = decisionInput();

    expect(() =>
      createAdoptionDecision({
        ...input,
        targets: [input.targets[0]!, { ...input.targets[1]!, id: "target-duplicate", scope: input.targets[0]!.scope }],
      }),
    ).toThrow("Adoption target scope must be unique");

    expect(() =>
      createAdoptionDecision({
        ...input,
        targets: [
          { ...input.targets[0]!, adoptedContent: { ...input.targets[0]!.adoptedContent!, contentHash: "wrong" } },
          input.targets[1]!,
        ],
      }),
    ).toThrow("Adopted content hash must match Proposal Section");
  });

  it("[domain] freezes decision evidence and derives a stable source reference", () => {
    const input = decisionInput();
    const decision = createAdoptionDecision(input);
    const replay = createAdoptionDecision(input);

    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.targets)).toBe(true);
    expect(Object.isFrozen(decision.evidence)).toBe(true);
    expect(decision.evidence.sourceReference).toEqual(narrativeProposalSourceReference(input.proposal));
    expect(adoptionDecisionSourceReference(decision)).toEqual(adoptionDecisionSourceReference(replay));
    expect(isImmutableTimestamp(decision.decidedAt)).toBe(true);
    expect(decision.decidedAt.iso).toBe("2026-10-04T04:00:00.000Z");
  });

  it("[domain] maps reject, defer, and reopen to zero ChangeSet inputs", () => {
    const input = decisionInput();
    for (const decisionType of ["reject", "defer", "reopen"] as const) {
      const decision = createAdoptionDecision({
        ...input,
        id: `decision-${decisionType}`,
        decisionType,
        targets: input.targets.map(({ adoptedContent, payload, basedOnVersionSet: _basedOn, proposedChangeId, ...target }) => target),
      });
      expect(createAdoptionChangeSetInputs(decision).changes).toEqual([]);
    }
  });
});
