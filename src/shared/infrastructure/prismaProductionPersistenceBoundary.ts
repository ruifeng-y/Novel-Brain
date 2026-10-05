import type { Prisma, PrismaClient } from "@prisma/client";
import {
  assertProductionPersistenceRole,
  decodeProductionPersistenceValue,
  encodeProductionPersistenceValue,
  type CanonicalStatePersistenceRecord,
  type EventAuditPersistenceRecord,
  type IdempotencyReservationDisposition,
  type IdempotencyReservationRecord,
  type ProductionPersistenceEnvironment,
  type ProductionPersistenceWork,
  type VersionedSnapshotPersistenceRecord,
} from "../application/postgresPersistenceMapping";
import { PrismaPersistenceTransaction } from "./persistenceTransaction";
import { runInPrismaSavepoint } from "./prismaSavepoint";

type PrismaProductionClient = PrismaClient | Prisma.TransactionClient;

function payload(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function assertReservation(reservation: IdempotencyReservationRecord): void {
  if (!reservation.key || reservation.key.trim() !== reservation.key) {
    throw new Error("idempotency reservation key is required");
  }
  if (!reservation.fingerprint) {
    throw new Error("idempotency reservation fingerprint is required");
  }
}

async function runBoundaryWrite<T>(
  client: PrismaProductionClient,
  operation: (work: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if ("$transaction" in client) {
    return client.$transaction((transaction) =>
      runInPrismaSavepoint(transaction, () => operation(transaction)),
    );
  }
  return runInPrismaSavepoint(client, () => operation(client));
}

export class PrismaProductionPersistenceWork implements ProductionPersistenceWork {
  constructor(private readonly prisma: PrismaProductionClient) {}

  async saveCanonicalStateIfAbsent(record: CanonicalStatePersistenceRecord): Promise<void> {
    assertProductionPersistenceRole(record.contract, "canonical-state");
    const encoded = encodeProductionPersistenceValue(record.value);
    await runBoundaryWrite(this.prisma, async (client) => {
      try {
        await client.currentObject.create({
          data: {
            aggregateType: record.contract,
            objectId: record.objectId,
            novelId: record.novelId,
            revisionId: record.revisionId,
            payload: payload(encoded),
          },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new Error(`Canonical state already exists: ${record.contract}:${record.objectId}`);
        }
        throw error;
      }
    });
  }

  async findCanonicalState(contract: string, objectId: string) {
    const record = await this.prisma.currentObject.findFirst({
      where: { aggregateType: contract, objectId },
    });
    if (!record) return undefined;
    return {
      contract,
      objectId: record.objectId,
      novelId: record.novelId,
      revisionId: record.revisionId ?? undefined,
      value: decodeProductionPersistenceValue(record.payload),
    };
  }

  async saveVersionedSnapshotIfAbsent(record: VersionedSnapshotPersistenceRecord): Promise<void> {
    assertProductionPersistenceRole(record.contract, "versioned-snapshot");
    const encoded = encodeProductionPersistenceValue(record.value);
    await runBoundaryWrite(this.prisma, async (client) => {
      try {
        await client.revisionRecord.create({
          data: {
            aggregateType: record.contract,
            objectId: record.objectId,
            novelId: record.novelId,
            revisionId: record.revisionId,
            commitId: record.commitId,
            payload: payload(encoded),
          },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new Error(
            `Versioned snapshot already exists: ${record.contract}:${record.objectId}:${record.revisionId}`,
          );
        }
        throw error;
      }
    });
  }

  async findVersionedSnapshot(contract: string, objectId: string, revisionId: string) {
    const record = await this.prisma.revisionRecord.findUnique({
      where: {
        aggregateType_objectId_revisionId: { aggregateType: contract, objectId, revisionId },
      },
    });
    if (!record) return undefined;
    return {
      contract,
      objectId: record.objectId,
      novelId: record.novelId,
      revisionId: record.revisionId,
      commitId: record.commitId ?? undefined,
      value: decodeProductionPersistenceValue(record.payload),
    };
  }

  async appendEventAudit(records: readonly EventAuditPersistenceRecord[]): Promise<void> {
    assertProductionPersistenceRole("domain-event", "event-audit");
    const batchIds = new Set<string>();
    for (const record of records) {
      if (batchIds.has(record.eventId)) throw new Error(`Duplicate event id: ${record.eventId}`);
      batchIds.add(record.eventId);
    }

    await runBoundaryWrite(this.prisma, async (client) => {
      const existing = await client.domainEvent.findFirst({
        where: { eventId: { in: [...batchIds] } },
        select: { eventId: true },
      });
      if (existing) throw new Error(`Duplicate event id: ${existing.eventId}`);

      try {
        await client.domainEvent.createMany({
          data: records.map((record) => ({
            eventId: record.eventId,
            name: record.name,
            context: record.context,
            novelId: record.novelId,
            objectId: record.objectId,
            revisionId: record.revisionId,
            commitId: record.commitId,
            payload: payload(record.payload),
            occurredAt: record.occurredAt,
          })),
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new Error(`Duplicate event id: ${records[0]?.eventId ?? "unknown"}`);
        }
        throw error;
      }
    });
  }

  async listEventAudit(novelId: string) {
    const records = await this.prisma.domainEvent.findMany({
      where: { novelId },
      orderBy: { sequence: "asc" },
    });
    return records.map((record) => ({
      eventId: record.eventId,
      name: record.name,
      context: record.context,
      novelId: record.novelId,
      objectId: record.objectId,
      revisionId: record.revisionId,
      commitId: record.commitId ?? undefined,
      payload: record.payload as Readonly<Record<string, unknown>>,
      occurredAt: record.occurredAt,
    }));
  }

  async reserveIdempotency(
    reservation: IdempotencyReservationRecord,
  ): Promise<IdempotencyReservationDisposition> {
    assertReservation(reservation);
    return runBoundaryWrite(this.prisma, async (client) => {
      const inserted = await client.idempotencyReservation.createMany({
        data: [{ key: reservation.key, novelId: "", fingerprint: reservation.fingerprint }],
        skipDuplicates: true,
      });
      if (inserted.count === 1) return "reserved";

      const existing = await client.idempotencyReservation.findUnique({
        where: { key: reservation.key },
      });
      if (existing?.fingerprint === reservation.fingerprint) return "replayed";
      throw new Error(`Idempotency reservation conflict: ${reservation.key}`);
    });
  }

  async findIdempotencyReservation(key: string) {
    const reservation = await this.prisma.idempotencyReservation.findUnique({ where: { key } });
    return reservation
      ? { key: reservation.key, fingerprint: reservation.fingerprint }
      : undefined;
  }
}

export function createPrismaProductionPersistenceEnvironment(
  prisma: PrismaClient,
): ProductionPersistenceEnvironment {
  const transaction = new PrismaPersistenceTransaction<ProductionPersistenceWork>(
    prisma,
    (client) => new PrismaProductionPersistenceWork(client),
  );
  return {
    transaction,
    external: new PrismaProductionPersistenceWork(prisma),
  };
}
