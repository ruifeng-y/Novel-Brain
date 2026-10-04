import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyAdoptionDecisionToProposal,
  createAdoptionDecision,
  type AdoptionDecision,
} from "../../src/story/domain/adoptionDecision";
import {
  createNarrativeProposal,
  proposalRevisionHash,
  proposalSectionHash,
  proposalSectionInput,
  reviseNarrativeProposal,
  reviseNarrativeProposalFromAdoptionDecision,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";
import {
  createInMemoryNarrativeProposalPersistence,
} from "../../src/story/application/narrativeProposalPersistence";
import {
  loadNarrativeProposal,
  recordAdoptionDecision,
  saveNarrativeProposalRevision,
} from "../../src/story/application/narrativeProposalService";
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

function proposal(id = "proposal-round5-1") {
  return createNarrativeProposal({
    id,
    novelId: "novel-round5-1",
    proposalType: "story_concept",
    scope: {},
    sections: [section("section-a", "A")],
    createdAt: now,
  });
}

function target(
  source: ReturnType<typeof proposal>,
  decisionType: "adopt" | "reject" | "defer" | "reopen",
  id: string,
) {
  const entry = source.sections[0]!;
  const base = {
    id,
    sourceDisposition: entry.adoptionDisposition,
    scope: {
      proposalIdentity: source.id,
      proposalRevision: source.currentRevisionId,
      sectionIdentity: entry.id,
    },
    targetType: "plan" as const,
    objectId: "plan-section-a",
  };
  if (decisionType !== "adopt") return base;
  return {
    ...base,
    proposedChangeId: `change-${id}`,
    adoptedContent: {
      contentReference: {
        identity: entry.id,
        version: source.currentRevisionId,
        hash: entry.sectionHash,
      },
      contentHash: entry.sectionHash,
    },
    payload: { text: entry.content.text },
    basedOnVersionSet: createVersionSet({
      plan: createVersionReference("StateRecord", "plan-section-a", "plan-rev-1"),
    }),
  };
}

function decision(
  source: ReturnType<typeof proposal>,
  decisionType: "adopt" | "reject" | "defer" | "reopen",
  id: string,
  decidedAt = now,
) {
  return createAdoptionDecision({
    proposal: source,
    id,
    decisionType,
    actor: { type: "author", identity: "author-1" },
    reason: `${decisionType} ${id}`,
    decidedAt,
    targets: [target(source, decisionType, `target-${id}`)],
  });
}

describe("Task 2.2 fix round 5 superseded authority [task:2.2]", () => {
  it("[domain] D1 cannot reauthorize after D2 reopen without D3 on parent r3", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const r1 = proposal("proposal-superseded-1");
    const d1 = decision(r1, "adopt", "D1");
    await saveNarrativeProposalRevision(persistence, r1);
    await recordAdoptionDecision(persistence, d1);
    const r2 = applyAdoptionDecisionToProposal({ proposal: r1, decision: d1, revisedAt: now });
    await saveNarrativeProposalRevision(persistence, r2, r1);

    const d2 = decision(r2, "reopen", "D2", new Date("2026-10-04T01:00:00.000Z"));
    await recordAdoptionDecision(persistence, d2);
    const r3 = applyAdoptionDecisionToProposal({ proposal: r2, decision: d2, revisedAt: now });
    await saveNarrativeProposalRevision(persistence, r3, r2);

    const forgedSection = {
      ...r3.sections[0]!,
      adoptionDisposition: "adopted" as const,
      provenance: {
        ...r3.sections[0]!.provenance,
        adoptionDecisionReferences: [
          ...r3.sections[0]!.provenance.adoptionDecisionReferences,
          {
            identity: "D1",
            version: "1",
            hash: d1.id === "D1" ? "d1-hash" : "d1-hash",
          },
        ],
      },
    };
    const forgedSnapshotSection = {
      ...forgedSection,
      sectionHash: proposalSectionHash(forgedSection),
    };
    const forgedBase = {
      ...r3,
      currentRevisionId: `${r3.id}:r4`,
      revisionNumber: 4,
      parentRevision: {
        proposalIdentity: r3.id,
        revisionId: r3.currentRevisionId,
        revisionHash: r3.revisionHash,
      },
      revisionTrigger: "disposition_change" as const,
      sections: [forgedSnapshotSection],
      sectionHashes: [{ sectionId: forgedSnapshotSection.id, hash: forgedSnapshotSection.sectionHash }],
    };
    const forgedR4 = {
      ...forgedBase,
      revisionHash: proposalRevisionHash(forgedBase),
    };

    await expect(saveNarrativeProposalRevision(persistence, forgedR4, r3))
      .rejects.toThrow(/latest valid Adoption Decision|No valid Adoption Decision/);

    const d3 = decision(r3, "adopt", "D3", new Date("2026-10-04T02:00:00.000Z"));
    await recordAdoptionDecision(persistence, d3);
    const validR4 = applyAdoptionDecisionToProposal({ proposal: r3, decision: d3, revisedAt: now });
    await saveNarrativeProposalRevision(persistence, validR4, r3);
    await expect(loadNarrativeProposal(persistence, r1.id)).resolves.toEqual(validR4);
  });

  it("[domain] selects latest applicable decision by decidedAt then id independent of list order", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const r1 = proposal("proposal-order-1");
    await saveNarrativeProposalRevision(persistence, r1);
    const older = decision(r1, "adopt", "A-OLDER", new Date("2026-10-04T01:00:00.000Z"));
    const later = decision(r1, "adopt", "A-LATER", new Date("2026-10-04T02:00:00.000Z"));
    await recordAdoptionDecision(persistence, later);
    await recordAdoptionDecision(persistence, older);

    const current = applyAdoptionDecisionToProposal({ proposal: r1, decision: later, revisedAt: now });
    await saveNarrativeProposalRevision(persistence, current, r1);
    await expect(loadNarrativeProposal(persistence, r1.id)).resolves.toEqual(current);
  });
});

describe("Task 2.2 fix round 5 raw authority API [task:2.2]", () => {
  it("[domain] removes WeakSet marker APIs and accepts raw decisions only through full revalidation", () => {
    const authorityPath = "src/story/domain/adoptionDecisionAuthority.ts";
    expect(existsSync(authorityPath)).toBe(false);
    const adoptionSource = readFileSync("src/story/domain/adoptionDecision.ts", "utf8");
    const narrativeSource = readFileSync("src/story/domain/narrativeProposal.ts", "utf8");
    expect(adoptionSource).not.toMatch(/markAdoptionDecisionValidated|createValidatedAdoptionDecision|WeakSet/);
    expect(narrativeSource).not.toMatch(/ValidatedAdoptionDecision|isValidatedAdoptionDecision|WeakSet/);

    const source = proposal("proposal-raw-api");
    const valid = decision(source, "adopt", "RAW-VALID");
    const raw: AdoptionDecision = { ...valid };
    expect(() =>
      reviseNarrativeProposalFromAdoptionDecision({
        proposal: source,
        decision: raw,
        revisedAt: now,
      }),
    ).not.toThrow();

    const forged = {
      ...valid,
      reason: "forged",
    };
    expect(() =>
      reviseNarrativeProposalFromAdoptionDecision({
        proposal: source,
        decision: forged,
        revisedAt: now,
      }),
    ).toThrow("Adoption Decision evidence must match top-level decision fields");
  });
});

describe("Task 2.2 fix round 5 idempotent decision validation [task:2.2]", () => {
  it("[persistence] revalidates existing decision and retained revision on idempotent replay", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const source = proposal("proposal-idempotent-decision");
    await saveNarrativeProposalRevision(persistence, source);
    const valid = decision(source, "adopt", "DECISION-IDEMPOTENT");
    const wrongReference = {
      ...valid.proposalReference,
      hash: "forged-proposal-hash",
    };
    const forged = {
      ...valid,
      proposalReference: wrongReference,
      evidence: createObservation({
        ...valid.evidence,
        sourceReference: wrongReference,
        data: {
          ...valid.evidence.data,
          proposalReference: wrongReference,
        },
      }),
    };

    await persistence.decisions.saveIfAbsent(forged);
    await expect(recordAdoptionDecision(persistence, forged))
      .rejects.toThrow("Adoption Decision evidence must match retained Proposal Revision");
    await expect(recordAdoptionDecision(persistence, valid))
      .rejects.toThrow("Adoption Decision evidence must match retained Proposal Revision");

    const validPersistence = createInMemoryNarrativeProposalPersistence();
    await saveNarrativeProposalRevision(validPersistence, source);
    const first = await recordAdoptionDecision(validPersistence, valid);
    await expect(recordAdoptionDecision(validPersistence, valid)).resolves.toEqual(first);
  });
});
