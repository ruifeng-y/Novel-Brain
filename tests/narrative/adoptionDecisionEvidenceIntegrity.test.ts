import { describe, expect, it } from "vitest";
import {
  adoptionTargetScopeKey,
  assertAdoptionDecisionMatchesProposal,
  createAdoptionDecision,
  type AdoptionDecision,
  type AdoptionTarget,
} from "../../src/story/domain/adoptionDecision";
import {
  createNarrativeProposal,
  proposalSectionHash,
  type NarrativeProposal,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";
import { createObservation, createImmutableTimestamp } from "../../src/shared/domain/observationSource";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-04T00:00:00.000Z");

function section(id: string): NarrativeProposalSectionInput {
  return {
    id,
    content: { value: id },
    provenance: {
      origin: { type: "author_created", references: [] },
      editLineage: [],
      evidenceReferences: [],
      adoptionDecisionReferences: [],
    },
  };
}

function fixture(): NarrativeProposal {
  return createNarrativeProposal({
    id: "proposal-evidence-1",
    novelId: "novel-evidence-1",
    proposalType: "story_concept",
    scope: {},
    sections: [section("section-a"), section("section-b")],
    createdAt: now,
  });
}

function target(
  proposal: NarrativeProposal,
  sectionId: string,
  id: string,
  changeId = `change-${id}`,
): AdoptionTarget {
  const entry = proposal.sections.find((candidate) => candidate.id === sectionId)!;
  return {
    id,
    scope: {
      proposalIdentity: proposal.id,
      proposalRevision: proposal.currentRevisionId,
      sectionIdentity: sectionId,
    },
    targetType: "plan",
    objectId: `plan-${sectionId}`,
    proposedChangeId: changeId,
    adoptedContent: {
      contentReference: {
        identity: sectionId,
        version: proposal.currentRevisionId,
        hash: proposalSectionHash(entry),
      },
      contentHash: proposalSectionHash(entry),
    },
    payload: { value: sectionId },
    basedOnVersionSet: createVersionSet({
      plan: createVersionReference("StateRecord", `plan-${sectionId}`, "plan-rev-1"),
    }),
  };
}

function decision(proposal: NarrativeProposal, targets = [target(proposal, "section-a", "target-a")]): AdoptionDecision {
  return createAdoptionDecision({
    proposal,
    id: "decision-evidence-1",
    decisionType: "adopt",
    targets,
    actor: { type: "author", identity: "author-1" },
    reason: "adopt",
    decidedAt: now,
  });
}

describe("Adoption Decision evidence integrity [task:2.2]", () => {
  it("[domain] revalidates evidenceReference, ordinal, targetScopes, and top-level decision fields", () => {
    const proposal = fixture();
    const base = decision(proposal);
    const mismatches: readonly AdoptionDecision[] = [
      { ...base, reason: "different reason" },
      { ...base, evidence: createObservation({ ...base.evidence, evidenceReference: "other-evidence" }) },
      { ...base, evidence: createObservation({ ...base.evidence, ordinal: 2 }) },
      {
        ...base,
        evidence: createObservation({
          ...base.evidence,
          data: { ...base.evidence.data, decisionType: "reject" },
        }),
      },
      {
        ...base,
        evidence: createObservation({
          ...base.evidence,
          data: { ...base.evidence.data, actor: { type: "policy", identity: "policy-1" } },
        }),
      },
      {
        ...base,
        evidence: createObservation({
          ...base.evidence,
          data: {
            ...base.evidence.data,
            decidedAt: createImmutableTimestamp({
              iso: "2026-10-05T00:00:00.000Z",
              epochMilliseconds: Date.parse("2026-10-05T00:00:00.000Z"),
            }),
          },
        }),
      },
      {
        ...base,
        evidence: createObservation({
          ...base.evidence,
          data: { ...base.evidence.data, targetScopes: [] },
        }),
      },
    ];

    for (const mismatch of mismatches) {
      expect(() => assertAdoptionDecisionMatchesProposal(mismatch, proposal))
        .toThrow("Adoption Decision evidence must match top-level decision fields");
    }
  });

  it("[domain] rejects duplicate target IDs and duplicate proposedChange IDs", () => {
    const proposal = fixture();
    const first = target(proposal, "section-a", "target-duplicate");
    const second = target(proposal, "section-b", "target-duplicate", "change-unique");

    expect(() => decision(proposal, [first, second])).toThrow("Adoption target id must be unique");

    expect(() =>
      decision(proposal, [
        first,
        target(proposal, "section-b", "target-b", first.proposedChangeId),
      ]),
    ).toThrow("proposedChange id must be unique");
  });

  it("[domain] uses collision-resistant scope keys and rejects duplicate target addresses in revalidation", () => {
    const left = {
      proposalIdentity: "p:x",
      proposalRevision: "r",
      sectionIdentity: "s",
    };
    const right = {
      proposalIdentity: "p",
      proposalRevision: "x:r",
      sectionIdentity: "s",
    };
    expect(adoptionTargetScopeKey(left)).not.toBe(adoptionTargetScopeKey(right));

    const proposal = fixture();
    const original = decision(proposal);
    const duplicateTargets = [
      original.targets[0]!,
      {
        ...target(proposal, "section-b", "target-b", "change-b"),
        targetType: original.targets[0]!.targetType,
        objectId: original.targets[0]!.objectId,
      },
    ];
    const duplicateAddress: AdoptionDecision = {
      ...original,
      targets: duplicateTargets,
      evidence: createObservation({
        ...original.evidence,
        data: {
          ...original.evidence.data,
          targetScopes: duplicateTargets.map((entry) => ({ ...entry.scope })),
        },
      }),
    };

    expect(() => assertAdoptionDecisionMatchesProposal(duplicateAddress, proposal))
      .toThrow("Adoption target address must be unique");
  });

  it("[domain] keeps exact adopted-content hash validation", () => {
    const proposal = fixture();
    const original = target(proposal, "section-a", "target-a");
    const bad = {
      ...original,
      adoptedContent: { ...original.adoptedContent!, contentHash: "wrong-hash" },
    };

    expect(() => decision(proposal, [bad]))
      .toThrow("Adopted content hash must match Proposal Section");
  });
});
