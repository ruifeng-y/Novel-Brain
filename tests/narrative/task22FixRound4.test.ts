import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  applyAdoptionDecisionToProposal,
  createAdoptionDecision,

} from "../../src/story/domain/adoptionDecision";
import {
  createNarrativeProposal,
  proposalRevisionHash,
  proposalSectionHash,
  reviseNarrativeProposal,
  proposalSectionInput,
  reviseNarrativeProposalFromAdoptionDecision,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";
import {
  createInMemoryNarrativeProposalPersistence,
} from "../../src/story/application/narrativeProposalPersistence";
import {
  loadNarrativeProposal,
  saveNarrativeProposalRevision,
} from "../../src/story/application/narrativeProposalService";
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

function proposal(id = "proposal-round4-1") {
  return createNarrativeProposal({
    id,
    novelId: "novel-round4-1",
    proposalType: "story_concept",
    scope: {},
    sections: [section("section-a", "A")],
    createdAt: now,
  });
}

function target(source: ReturnType<typeof proposal>, sectionId: string, id: string) {
  const entry = source.sections.find((candidate) => candidate.id === sectionId)!;
  return {
    id,
    scope: {
      proposalIdentity: source.id,
      proposalRevision: source.currentRevisionId,
      sectionIdentity: sectionId,
    },
    targetType: "plan" as const,
    objectId: `plan-${sectionId}`,
    proposedChangeId: `change-${id}`,
    adoptedContent: {
      contentReference: {
        identity: sectionId,
        version: source.currentRevisionId,
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

function decision(source: ReturnType<typeof proposal>, id = "decision-round4-1") {
  return createAdoptionDecision({
    proposal: source,
    id,
    decisionType: "adopt",
    actor: { type: "author", identity: "author-1" },
    reason: "adopt",
    decidedAt: now,
    targets: [target(source, "section-a", `target-${id}`)],
  });
}

describe("Task 2.2 fix round 4 validated authority [task:2.2]", () => {
  it("[domain] removes public marker APIs and revalidates raw decisions", () => {
    expect(existsSync("src/story/domain/adoptionDecisionAuthority.ts")).toBe(false);
    const source = readFileSync("src/story/domain/adoptionDecision.ts", "utf8") +
      readFileSync("src/story/domain/narrativeProposal.ts", "utf8");
    expect(source).not.toMatch(/markAdoptionDecisionValidated|createValidatedAdoptionDecision|WeakSet/);

    const proposalValue = proposal("proposal-authority-raw");
    const valid = decision(proposalValue, "decision-authority-raw");
    const raw = { ...valid };
    expect(() =>
      reviseNarrativeProposalFromAdoptionDecision({
        proposal: proposalValue,
        decision: raw,
        revisedAt: now,
      }),
    ).not.toThrow();

    expect(() =>
      reviseNarrativeProposalFromAdoptionDecision({
        proposal: proposalValue,
        decision: { ...valid, reason: "forged" },
        revisedAt: now,
      }),
    ).toThrow("Adoption Decision evidence must match top-level decision fields");
  });
});

describe("Task 2.2 fix round 4 stale Adoption Decision [task:2.2]", () => {
  function staleRevision() {
    const initial = proposal("proposal-stale-1");
    const adopted = applyAdoptionDecisionToProposal({
      proposal: initial,
      decision: decision(initial, "decision-stale-1"),
      revisedAt: now,
    });
    const changed = reviseNarrativeProposal({
      proposal: adopted,
      sections: [{ ...proposalSectionInput(adopted.sections[0]!), content: { text: "A changed" } }],
      trigger: "content_change",
      revisedAt: now,
    });
    const staleSection = {
      ...changed.sections[0]!,
      adoptionDisposition: "adopted" as const,
    };
    const snapshotSection = {
      ...staleSection,
      sectionHash: proposalSectionHash(staleSection),
    };
    const staleBase = {
      ...changed,
      sections: [snapshotSection],
      sectionHashes: [{ sectionId: snapshotSection.id, hash: snapshotSection.sectionHash }],
    };
    return {
      initial,
      adopted,
      stale: {
        ...staleBase,
        revisionHash: proposalRevisionHash(staleBase),
      },
    };
  }

  it("[domain] old adopt decision cannot endorse a new content hash", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const { initial, adopted, stale } = staleRevision();
    await saveNarrativeProposalRevision(persistence, initial);
    await recordDecisionFixture(persistence, initial, "decision-stale-1");
    await saveNarrativeProposalRevision(persistence, adopted, initial);

    await expect(saveNarrativeProposalRevision(persistence, stale, adopted))
      .rejects.toThrow("Adoption Decision content hash is stale for current Section snapshot");
  });

  it("[persistence] stale rehash is rejected by save, load, and idempotent current validation", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const { initial, adopted, stale } = staleRevision();
    await saveNarrativeProposalRevision(persistence, initial);
    await recordDecisionFixture(persistence, initial, "decision-stale-1");
    await saveNarrativeProposalRevision(persistence, adopted, initial);

    await expect(saveNarrativeProposalRevision(persistence, stale, adopted))
      .rejects.toThrow("Adoption Decision content hash is stale");
    await persistence.proposals.saveIfCurrent(adopted.currentRevisionId, stale);
    await expect(loadNarrativeProposal(persistence, initial.id))
      .rejects.toThrow("Adoption Decision content hash is stale");
    await expect(saveNarrativeProposalRevision(persistence, stale, adopted))
      .rejects.toThrow("Adoption Decision content hash is stale");
  });
});

async function recordDecisionFixture(
  persistence: ReturnType<typeof createInMemoryNarrativeProposalPersistence>,
  source: ReturnType<typeof proposal>,
  id: string,
): Promise<void> {
  const { recordAdoptionDecision } = await import("../../src/story/application/narrativeProposalService");
  await recordAdoptionDecision(persistence, decision(source, id));
}
