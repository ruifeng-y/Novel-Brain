import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createPrismaNarrativeProposalPersistence,
} from "../../src/story/application/narrativeProposalPersistence";
import {
  loadNarrativeProposal,
  saveNarrativeProposalRevision,
} from "../../src/story/application/narrativeProposalService";
import {
  createNarrativeProposal,
  proposalRevisionHash,
  proposalSectionHash,
  reviseNarrativeProposal,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public";
const prisma = new PrismaClient();
const aggregateType = "NarrativeProposalPersistenceValidationTask22";
const aggregateTypes = [`${aggregateType}:Proposal`, `${aggregateType}:Decision`];

async function clear(): Promise<void> {
  await prisma.currentObject.deleteMany({ where: { aggregateType: { in: aggregateTypes } } });
  await prisma.revisionRecord.deleteMany({ where: { aggregateType: { in: aggregateTypes } } });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

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

describe("Prisma [task:2.2] proposal persistence semantic validation", () => {
  it("[persistence] rejects self-consistent forged trigger snapshots before save", async () => {
    const persistence = createPrismaNarrativeProposalPersistence(prisma, aggregateType);
    const initial = createNarrativeProposal({
      id: "proposal-prisma-trigger",
      novelId: "novel-prisma-trigger",
      proposalType: "story_concept",
      scope: {},
      sections: [section("section-a", "A")],
      createdAt: now,
    });
    await saveNarrativeProposalRevision(persistence, initial);
    const revised = reviseNarrativeProposal({
      proposal: initial,
      sections: [section("section-a", "A2")],
      trigger: "content_change",
      revisedAt: now,
    });
    const forgedBase = { ...revised, revisionTrigger: "disposition_change" as const };
    const forged = { ...forgedBase, revisionHash: proposalRevisionHash(forgedBase) };

    await expect(saveNarrativeProposalRevision(persistence, forged, initial))
      .rejects.toThrow("revision trigger does not match actual snapshot changes");
  });

  it("[persistence] revalidates idempotent current loads for disposition traceability", async () => {
    const persistence = createPrismaNarrativeProposalPersistence(prisma, aggregateType);
    const initial = createNarrativeProposal({
      id: "proposal-prisma-load",
      novelId: "novel-prisma-load",
      proposalType: "story_concept",
      scope: {},
      sections: [section("section-a", "A")],
      createdAt: now,
    });
    await saveNarrativeProposalRevision(persistence, initial);
    const forgedSection = {
      ...initial.sections[0]!,
      adoptionDisposition: "adopted" as const,
      provenance: {
        ...initial.sections[0]!.provenance,
        adoptionDecisionReferences: [{
          identity: "forged-decision",
          version: "1",
          hash: "forged-hash",
        }],
      },
    };
    const snapshotSection = {
      ...forgedSection,
      sectionHash: proposalSectionHash(forgedSection),
    };
    const forgedBase = {
      ...initial,
      currentRevisionId: `${initial.id}:r2`,
      revisionNumber: 2,
      parentRevision: {
        proposalIdentity: initial.id,
        revisionId: initial.currentRevisionId,
        revisionHash: initial.revisionHash,
      },
      revisionTrigger: "disposition_change" as const,
      sections: [snapshotSection],
      sectionHashes: [{ sectionId: snapshotSection.id, hash: snapshotSection.sectionHash }],
    };
    const forged = { ...forgedBase, revisionHash: proposalRevisionHash(forgedBase) };

    await persistence.proposals.saveIfCurrent(initial.currentRevisionId, forged);
    await expect(loadNarrativeProposal(persistence, initial.id))
      .rejects.toThrow(/No valid Adoption Decision|Non-Pending section requires valid Adoption Decision evidence/);
  });
});
