import { describe, expect, it } from "vitest";
import {
  assertProposalRevisionSnapshotIntegrity,
  createNarrativeProposal,
  proposalSectionInput,
  proposalSectionHash,
  reviseNarrativeProposal,
  type NarrativeProposalSectionInput,
  type ProposalOpenQuestionInput,
} from "../../src/story/domain/narrativeProposal";
import {
  applyAdoptionDecisionToProposal,
  assertAdoptionDecisionMatchesProposal,
  createAdoptionDecision,
  type AdoptionDecision,
  type CreateAdoptionDecisionInput,
} from "../../src/story/domain/adoptionDecision";
import { createObservation } from "../../src/shared/domain/observationSource";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-04T00:00:00.000Z");

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

function question(id: string, sectionId = "section-a"): ProposalOpenQuestionInput {
  return {
    id,
    text: `Question ${id}`,
    scope: { kind: "section", sectionId },
    state: "open",
    provenance: {
      origin: { type: "author_created", references: [] },
      editLineage: [],
      evidenceReferences: [],
      adoptionDecisionReferences: [],
    },
  };
}

function fixture() {
  return createNarrativeProposal({
    id: "proposal-round2-1",
    novelId: "novel-round2-1",
    proposalType: "story_concept",
    scope: { dimension: "concept" },
    sections: [section("section-a", "A"), section("section-b", "B")],
    openQuestions: [question("question-a")],
    createdAt: now,
  });
}

function target(
  proposal: ReturnType<typeof fixture>,
  sectionId: string,
  id: string,
  decisionType: "adopt" | "reject" | "defer" | "reopen" = "adopt",
) {
  const entry = proposal.sections.find((candidate) => candidate.id === sectionId)!;
  const base = {
    id,
    scope: {
      proposalIdentity: proposal.id,
      proposalRevision: proposal.currentRevisionId,
      sectionIdentity: sectionId,
    },
    targetType: "plan" as const,
    objectId: `plan-${sectionId}`,
  };
  if (decisionType !== "adopt") return base;
  return {
    ...base,
    proposedChangeId: `change-${id}`,
    adoptedContent: {
      contentReference: {
        identity: sectionId,
        version: proposal.currentRevisionId,
        hash: entry.sectionHash,
      },
      contentHash: entry.sectionHash,
    },
    payload: { text: entry.content.text },
    basedOnVersionSet: createVersionSet({
      plan: createVersionReference("StateRecord", `plan-${sectionId}`, "plan-rev-1"),
    }),
  };
}

function decision(
  proposal: ReturnType<typeof fixture>,
  decisionType: "adopt" | "reject" | "defer" | "reopen" = "adopt",
  targets = [target(proposal, "section-a", "target-a", decisionType)],
): AdoptionDecision {
  return createAdoptionDecision({
    proposal,
    id: `decision-round2-${decisionType}`,
    decisionType,
    targets,
    actor: { type: "author", identity: "author-1" },
    reason: `round2 ${decisionType}`,
    decidedAt: now,
  });
}

describe("Task 2.2 fix round 2 disposition authority [task:2.2]", () => {
  it("[domain] create/revise reject arbitrary adoptionDisposition overrides and default new sections to Pending", () => {
    expect(() =>
      createNarrativeProposal({
        ...fixture(),
        id: "proposal-invalid-create-disposition",
        sections: [{
          ...section("section-a", "A"),
          adoptionDisposition: "adopted",
        } as NarrativeProposalSectionInput],
        openQuestions: [],
        createdAt: now,
      }),
    ).toThrow("adoptionDisposition cannot be set by create/revise");

    const proposal = fixture();
    expect(() =>
      reviseNarrativeProposal({
        proposal,
        sections: [{
          ...section("section-a", "A2"),
          adoptionDisposition: "adopted",
        } as NarrativeProposalSectionInput, section("section-b", "B")],
        openQuestions: proposal.openQuestions,
        trigger: "content_change",
        revisedAt: now,
      }),
    ).toThrow("adoptionDisposition cannot be set by create/revise");
  });

  it("[domain] content change invalidates Adopted to Pending when disposition is omitted", () => {
    const proposal = fixture();
    const adopted = applyAdoptionDecisionToProposal({
      proposal,
      decision: decision(proposal, "adopt", [
        target(proposal, "section-a", "target-a"),
        target(proposal, "section-b", "target-b"),
      ]),
      revisedAt: now,
    });

    const revised = reviseNarrativeProposal({
      proposal: adopted,
      sections: adopted.sections.map((entry) =>
        entry.id === "section-a" ? { ...proposalSectionInput(entry), content: { text: "A changed" } } : proposalSectionInput(entry),
      ),
      openQuestions: adopted.openQuestions,
      trigger: "content_change",
      revisedAt: now,
    });

    expect(adopted.sections.map((entry) => entry.adoptionDisposition)).toEqual(["adopted", "adopted"]);
    expect(revised.sections.map((entry) => entry.adoptionDisposition)).toEqual(["pending", "adopted"]);
    expect(() =>
      reviseNarrativeProposal({
        proposal: adopted,
        sections: adopted.sections.map((entry) =>
          entry.id === "section-a"
            ? { ...proposalSectionInput(entry), adoptionDisposition: "adopted" as const, content: { text: "A changed again" } }
            : proposalSectionInput(entry),
        ),
        openQuestions: adopted.openQuestions,
        trigger: "content_change",
        revisedAt: now,
      }),
    ).toThrow("adoptionDisposition cannot be set by create/revise");
  });

  it("[domain] only Adoption Decision application can transition Adopted/Rejected/Deferred", () => {
    const proposal = fixture();
    const adopted = applyAdoptionDecisionToProposal({
      proposal,
      decision: decision(proposal, "adopt"),
      revisedAt: now,
    });
    const rejected = applyAdoptionDecisionToProposal({
      proposal: adopted,
      decision: createAdoptionDecision({
        proposal: adopted,
        id: "decision-round2-reject-b",
        decisionType: "reject",
        targets: [target(adopted, "section-b", "target-b", "reject")],
        actor: { type: "author", identity: "author-1" },
        reason: "reject B",
        decidedAt: now,
      }),
      revisedAt: now,
    });

    expect(rejected.sections.map((entry) => entry.adoptionDisposition)).toEqual(["adopted", "rejected"]);
  });
});

describe("Task 2.2 fix round 2 revision integrity [task:2.2]", () => {
  it("[domain] sectionHash covers disposition and provenance while revisionHash covers all snapshots", () => {
    const proposal = fixture();
    const adopted = applyAdoptionDecisionToProposal({
      proposal,
      decision: decision(proposal, "adopt"),
      revisedAt: now,
    });
    const deferred = applyAdoptionDecisionToProposal({
      proposal,
      decision: decision(proposal, "defer"),
      revisedAt: now,
    });

    expect(proposalSectionHash(adopted.sections[0]!)).not.toBe(proposalSectionHash(proposal.sections[0]!));
    expect(proposalSectionHash(deferred.sections[0]!)).not.toBe(proposalSectionHash(adopted.sections[0]!));
    expect(adopted.revisionHash).not.toBe(deferred.revisionHash);
    expect(adopted.revisionHash).not.toBe(proposal.revisionHash);
  });

  it("[domain] persist integrity detects mutations to disposition, provenance, questions, parent, trigger, and identity", () => {
    const proposal = fixture();
    const revised = reviseNarrativeProposal({
      proposal,
      sections: [section("section-a", "A2"), section("section-b", "B")],
      openQuestions: proposal.openQuestions,
      trigger: "content_change",
      revisedAt: now,
    });
    const mutations = [
      {
        ...revised,
        sections: revised.sections.map((entry) =>
          entry.id === "section-a" ? { ...entry, adoptionDisposition: "adopted" as const } : entry,
        ),
      },
      {
        ...revised,
        sections: revised.sections.map((entry) =>
          entry.id === "section-a"
            ? {
                ...entry,
                provenance: {
                  ...entry.provenance,
                  evidenceReferences: [{
                    identity: "forged",
                    version: "forged-rev-1",
                    hash: "forged-hash-1",
                  }],
                },
              }
            : entry,
        ),
      },
      { ...revised, openQuestions: [] },
      { ...revised, parentRevision: { ...revised.parentRevision!, revisionHash: "forged-parent" } },
      { ...revised, revisionTrigger: "disposition_change" as const },
      { ...revised, id: "forged-identity" },
    ];

    for (const mutation of mutations) {
      expect(() => assertProposalRevisionSnapshotIntegrity(mutation)).toThrow();
    }
  });

  it("[domain] trigger matches actual content, disposition, question, and section changes", () => {
    const proposal = fixture();

    expect(() =>
      reviseNarrativeProposal({
        proposal,
        sections: proposal.sections.map(proposalSectionInput),
        openQuestions: proposal.openQuestions.map((entry) => ({ ...entry, state: "dismissed" as const })),
        trigger: "content_change",
        revisedAt: now,
      }),
    ).toThrow("revision trigger does not match actual snapshot changes");

    expect(() =>
      reviseNarrativeProposal({
        proposal,
        sections: [section("section-a", "A"), section("section-b", "B"), section("section-c", "C")],
        openQuestions: proposal.openQuestions,
        trigger: "content_change",
        revisedAt: now,
      }),
    ).toThrow("revision trigger does not match actual snapshot changes");

    expect(() =>
      reviseNarrativeProposal({
        proposal,
        sections: [section("section-a", "A2"), section("section-b", "B")],
        openQuestions: proposal.openQuestions,
        trigger: "disposition_change",
        revisedAt: now,
      }),
    ).toThrow("revision trigger does not match actual snapshot changes");
  });

  it("[domain] makeProposal rejects duplicate section and open-question IDs", () => {
    expect(() =>
      createNarrativeProposal({
        ...fixture(),
        id: "proposal-duplicate-sections",
        sections: [section("section-a", "A"), section("section-a", "B")],
        openQuestions: [],
        createdAt: now,
      }),
    ).toThrow("Proposal section id must be unique");

    expect(() =>
      createNarrativeProposal({
        ...fixture(),
        id: "proposal-duplicate-questions",
        sections: [section("section-a", "A")],
        openQuestions: [question("question-a"), question("question-a")],
        createdAt: now,
      }),
    ).toThrow("Proposal open question id must be unique");
  });
});

describe("Task 2.2 fix round 2 adoption constructor invariants [task:2.2]", () => {
  it("[domain] revalidation rejects empty identity/reason/actor and empty targets", () => {
    const proposal = fixture();
    const base = decision(proposal);
    const invalid: readonly AdoptionDecision[] = [
      { ...base, id: " " },
      { ...base, reason: "" },
      { ...base, actor: { type: "author", identity: "" } },
      { ...base, targets: [] },
    ];

    for (const value of invalid) {
      expect(() => assertAdoptionDecisionMatchesProposal(value, proposal)).toThrow();
    }
  });

  it("[domain] rejects extra fields in top-level decision and complete evidence shape", () => {
    const proposal = fixture();
    const base = decision(proposal);
    const invalid: readonly AdoptionDecision[] = [
      { ...base, forged: true } as unknown as AdoptionDecision,
      {
        ...base,
        evidence: { ...base.evidence, forged: true },
      } as unknown as AdoptionDecision,
      {
        ...base,
        evidence: createObservation({
          ...base.evidence,
          data: { ...base.evidence.data, forged: true },
        }),
      } as unknown as AdoptionDecision,
    ];

    for (const value of invalid) {
      expect(() => assertAdoptionDecisionMatchesProposal(value, proposal))
        .toThrow(/unexpected fields|exact Adoption Decision fields/);
    }
  });

  it("[domain] constructor still enforces non-empty fields and at least one target", () => {
    const proposal = fixture();

    expect(() =>
      createAdoptionDecision({
        ...decision(proposal),
        id: "",
        targets: decision(proposal).targets,
      } as unknown as CreateAdoptionDecisionInput),
    ).toThrow("decision id is required");

    expect(() =>
      createAdoptionDecision({
        proposal,
        id: "decision-empty-targets",
        decisionType: "reject",
        targets: [],
        actor: { type: "author", identity: "author-1" },
        reason: "empty",
        decidedAt: now,
      }),
    ).toThrow("Adoption Decision requires at least one target");
  });
});
