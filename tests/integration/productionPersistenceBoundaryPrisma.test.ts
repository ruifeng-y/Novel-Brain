import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { createPrismaProductionPersistenceEnvironment } from "../../src/shared/infrastructure/prismaProductionPersistenceBoundary";
import { runProductionPersistenceBoundaryContract } from "../support/productionPersistenceBoundaryContract";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public";
const prisma = new PrismaClient();
const migrationDirectory = join(
  process.cwd(),
  "prisma/migrations/20261005000000_production_persistence_boundary",
);
const baseMigrationPath = join(
  process.cwd(),
  "prisma/migrations/20261002125049_core_engine_persistence/migration.sql",
);

async function clearBoundaryRows(): Promise<void> {
  await prisma.currentObject.deleteMany({
    where: { aggregateType: { in: ["candidate", "legacy-state"] } },
  });
  await prisma.revisionRecord.deleteMany({
    where: { aggregateType: { in: ["candidate", "legacy-snapshot"] } },
  });
  await prisma.domainEvent.deleteMany({
    where: { OR: [{ novelId: "novel-parity" }, { novelId: "novel-legacy" }] },
  });
  await prisma.idempotencyReservation.deleteMany();
}

async function executeScript(
  client: PrismaClient | Prisma.TransactionClient,
  sql: string,
): Promise<void> {
  for (const statement of sql.split(";")) {
    const normalized = statement.trim();
    if (normalized) await client.$executeRawUnsafe(normalized);
  }
}

describe("[task:P1.2] Prisma production persistence boundary", () => {
  beforeAll(async () => {
    await clearBoundaryRows();
  });

  afterAll(async () => {
    await clearBoundaryRows();
    await prisma.$disconnect();
  });

  runProductionPersistenceBoundaryContract("Prisma", async () => {
    await clearBoundaryRows();
    return { environment: createPrismaProductionPersistenceEnvironment(prisma) };
  });

  it("[task:P1.2] [persistence] [regression] [integration] applies an additive reservation migration while preserving legacy generic rows", async () => {
    await clearBoundaryRows();

    await prisma.currentObject.create({
      data: {
        aggregateType: "legacy-state",
        objectId: "legacy-current",
        novelId: "novel-legacy",
        revisionId: "legacy-rev",
        payload: { value: { source: "CurrentObject" } },
      },
    });
    await prisma.revisionRecord.create({
      data: {
        aggregateType: "legacy-snapshot",
        objectId: "legacy-revision",
        novelId: "novel-legacy",
        revisionId: "legacy-rev",
        payload: { value: { source: "RevisionRecord" } },
      },
    });
    await prisma.domainEvent.create({
      data: {
        eventId: "legacy-event",
        name: "NarrativeCommitRecorded",
        context: "ai_production",
        novelId: "novel-legacy",
        objectId: "legacy-current",
        revisionId: "legacy-rev",
        payload: { source: "DomainEvent" },
        occurredAt: new Date("2026-10-04T00:00:00.000Z"),
      },
    });

    const environment = createPrismaProductionPersistenceEnvironment(prisma);
    await expect(environment.external.findCanonicalState("legacy-state", "legacy-current")).resolves.toEqual({
      contract: "legacy-state",
      objectId: "legacy-current",
      novelId: "novel-legacy",
      revisionId: "legacy-rev",
      value: { value: { source: "CurrentObject" } },
    });
    await expect(
      environment.external.findVersionedSnapshot("legacy-snapshot", "legacy-revision", "legacy-rev"),
    ).resolves.toEqual({
      contract: "legacy-snapshot",
      objectId: "legacy-revision",
      novelId: "novel-legacy",
      revisionId: "legacy-rev",
      commitId: undefined,
      value: { value: { source: "RevisionRecord" } },
    });
    await expect(environment.external.listEventAudit("novel-legacy")).resolves.toEqual([
      {
        eventId: "legacy-event",
        name: "NarrativeCommitRecorded",
        context: "ai_production",
        novelId: "novel-legacy",
        objectId: "legacy-current",
        revisionId: "legacy-rev",
        commitId: undefined,
        payload: { source: "DomainEvent" },
        occurredAt: new Date("2026-10-04T00:00:00.000Z"),
      },
    ]);

    const migrations = await prisma.$queryRaw<
      { migration_name: string }[]
    >`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ${"20261005000000_production_persistence_boundary"}`;
    expect(migrations).toHaveLength(1);

    const constraints = await prisma.$queryRaw<
      { constraint_name: string; constraint_type: string }[]
    >`
      SELECT tc.constraint_name, tc.constraint_type
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'IdempotencyReservation'
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
    `;
    expect(constraints).toContainEqual({
      constraint_name: "IdempotencyReservation_pkey",
      constraint_type: "PRIMARY KEY",
    });
  });

  it("[task:P1.2] [recovery] [persistence] migration rollback and reapply preserve legacy rows", async () => {
    const migration = readFileSync(join(migrationDirectory, "migration.sql"), "utf8");
    const rollback = readFileSync(join(migrationDirectory, "rollback.sql"), "utf8");
    const schema = `p12_migration_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await executeScript(transaction, readFileSync(baseMigrationPath, "utf8"));

      await transaction.$executeRawUnsafe(
        `INSERT INTO "CurrentObject" ("id", "aggregateType", "objectId", "novelId", "payload", "updatedAt")
         VALUES ('legacy-current', 'Legacy', 'legacy-object', 'legacy-novel', '{"legacy":true}', CURRENT_TIMESTAMP)`,
      );
      await transaction.$executeRawUnsafe(
        `INSERT INTO "RevisionRecord" ("id", "aggregateType", "objectId", "novelId", "revisionId", "payload")
         VALUES ('legacy-revision', 'Legacy', 'legacy-object', 'legacy-novel', 'legacy-rev', '{"legacy":true}')`,
      );
      await transaction.$executeRawUnsafe(
        `INSERT INTO "DomainEvent" ("eventId", "name", "context", "novelId", "objectId", "revisionId", "payload", "occurredAt")
         VALUES ('legacy-event', 'LegacyEvent', 'platform', 'legacy-novel', 'legacy-object', 'legacy-rev', '{"legacy":true}', CURRENT_TIMESTAMP)`,
      );

      await executeScript(transaction, migration);
      await executeScript(transaction, rollback);
      expect(
        await transaction.$queryRawUnsafe<Array<{ legacy_count: bigint }>>(
          `SELECT
             (SELECT COUNT(*) FROM "CurrentObject") +
             (SELECT COUNT(*) FROM "RevisionRecord") +
             (SELECT COUNT(*) FROM "DomainEvent") AS legacy_count`,
        ),
      ).toEqual([{ legacy_count: 3n }]);

      await executeScript(transaction, migration);
      expect(
        await transaction.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*)::bigint AS count FROM "IdempotencyReservation"`,
        ),
      ).toEqual([{ count: 0n }]);
    });

    await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  });
});
