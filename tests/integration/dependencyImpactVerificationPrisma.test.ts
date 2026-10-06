import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaDependencyImpactPersistence } from "../../src/dependency/application/dependencyImpactPersistence";
import { DependencyImpactApplicationService } from "../../src/dependency/application/dependencyImpactService";
import { runDependencyImpactVerificationContract } from "../support/dependencyImpactVerificationContract";
import { createDependencyImpactVerificationEnvironment } from "../support/dependencyImpactFixtures";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain_test?schema=public";

const prisma = new PrismaClient();
const aggregateType = "DependencyImpactTask23";
const relationAggregate = `${aggregateType}:Relation`;
const impactAggregate = `${aggregateType}:Impact`;

async function clear(): Promise<void> {
  await prisma.currentObject.deleteMany({
    where: { aggregateType: { in: [relationAggregate, impactAggregate] } },
  });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

runDependencyImpactVerificationContract("Prisma", "2.3", async () =>
  createDependencyImpactVerificationEnvironment(
    createPrismaDependencyImpactPersistence(prisma, aggregateType),
  ),
);

describe("Prisma [task:2.3] dependency impact persistence", () => {
  it("[persistence] reuses generic CurrentObject without Frozen Core schema changes", async () => {
    const persistence = createPrismaDependencyImpactPersistence(prisma, aggregateType);
    const environment = createDependencyImpactVerificationEnvironment(persistence);
    const service = new DependencyImpactApplicationService(persistence);
    await service.recordRelations({ relations: [environment.directRelation] });
    const result = await service.analyzeImpact({
      analysisId: "impact-prisma-parity",
      novelId: environment.subject.novelId,
      subject: environment.subject,
      currentVersionSet: environment.currentVersionSet,
      evidenceSource: environment.evidenceSource,
      maxDepth: 2,
      computedAt: new Date("2026-10-04T02:08:00.000Z"),
    });

    const currentRows = await prisma.currentObject.findMany({
      where: { aggregateType: { in: [relationAggregate, impactAggregate] } },
      orderBy: [{ aggregateType: "asc" }, { objectId: "asc" }],
    });

    expect(currentRows).toHaveLength(2);
    expect(currentRows.map(({ aggregateType: type }) => type)).toEqual([
      impactAggregate,
      relationAggregate,
    ]);
    expect(await persistence.relations.findById(environment.directRelation.id)).toEqual(
      environment.directRelation,
    );
    expect(await persistence.impactResults.findById(result.id)).toEqual(result);
  });
});
