import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaNarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";
import { saveNarrativeProposalRevision, recordAdoptionDecision } from "../../src/story/application/narrativeProposalService";
import { createNarrativeProposalVerificationEnvironment } from "../support/narrativeProposalFixtures";
import { runNarrativeProposalVerificationContract } from "../support/narrativeProposalVerificationContract";
import { isImmutableTimestamp } from "../../src/shared/domain/observationSource";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public";
const prisma = new PrismaClient();
const aggregateType = "NarrativeProposalVerificationTask22";
const proposalAggregate = `${aggregateType}:Proposal`;
const decisionAggregate = `${aggregateType}:Decision`;

async function clear(): Promise<void> {
  await prisma.currentObject.deleteMany({
    where: { aggregateType: { in: [proposalAggregate, decisionAggregate] } },
  });
  await prisma.revisionRecord.deleteMany({
    where: { aggregateType: { in: [proposalAggregate, decisionAggregate] } },
  });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

runNarrativeProposalVerificationContract("Prisma", async () =>
  createNarrativeProposalVerificationEnvironment(
    createPrismaNarrativeProposalPersistence(prisma, aggregateType),
  ),
);

describe("Prisma [task:2.2] narrative proposal persistence", () => {
  it("[persistence] reuses generic CurrentObject and RevisionRecord without schema changes", async () => {
    const persistence = createPrismaNarrativeProposalPersistence(prisma, aggregateType);
    const environment = createNarrativeProposalVerificationEnvironment(persistence);
    await saveNarrativeProposalRevision(persistence, environment.proposal);
    const decision = environment.decision({ id: "decision-prisma-parity-2.2" });
    await recordAdoptionDecision(persistence, decision);

    const current = await prisma.currentObject.findUnique({
      where: {
        aggregateType_objectId: {
          aggregateType: proposalAggregate,
          objectId: environment.proposal.id,
        },
      },
    });
    const revisions = await prisma.revisionRecord.findMany({
      where: {
        aggregateType: proposalAggregate,
        objectId: environment.proposal.id,
      },
    });
    const loadedDecision = await persistence.decisions.findById(decision.id);

    expect(current?.revisionId).toBe(environment.proposal.currentRevisionId);
    expect(revisions).toHaveLength(1);
    expect(loadedDecision).toEqual(decision);
    expect(isImmutableTimestamp(loadedDecision?.decidedAt)).toBe(true);
    expect(isImmutableTimestamp(loadedDecision?.evidence.data.decidedAt)).toBe(true);
    expect(Object.isFrozen(loadedDecision)).toBe(true);
  });
});
