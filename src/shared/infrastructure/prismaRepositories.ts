import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CompareAndSwapRevisionedRepository,
  RevisionCreatePort,
  Revisioned,
  RevisionedRepository,
  UniqueCreatePort,
} from "../application/repository";
import type { DomainEvent } from "../../safety/domain/domainEvent";
import type { EventStore } from "../../safety/infrastructure/eventStore";
import {
  legacyPersistencePayloadCodec,
  type PersistencePayloadCodec,
} from "../domain/persistencePayload";
import { deepFreeze } from "../domain/immutable";
import { runInPrismaSavepoint } from "./prismaSavepoint";

type Payload = Record<string, unknown>;

export type PrismaRepositoryClient = PrismaClient | Prisma.TransactionClient;

function prismaPayload(payload: Payload): Prisma.InputJsonValue {
  return payload as Prisma.InputJsonValue;
}

function serialize<T>(entity: T, codec: PersistencePayloadCodec): Payload {
  return codec.encode(entity) as Payload;
}

function cloneValue<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  if (value !== null && typeof value === "object") {
    const clone = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      clone[key] = cloneValue(nested);
    }
    return clone as T;
  }
  return value;
}

function snapshot<T>(value: T): T {
  return deepFreeze(cloneValue(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function cloneJsonPayload(payload: unknown): Payload {
  return JSON.parse(JSON.stringify(payload)) as Payload;
}

function samePayload(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function revisionConflict(id: string, revisionId: string): Error {
  return new Error(`Revision already exists: ${id}:${revisionId}`);
}

function mapRepositoryConflict(error: unknown, id: string, revisionId: string): unknown {
  return isUniqueConstraintError(error) ? revisionConflict(id, revisionId) : error;
}

async function runInClientTransaction<T>(
  prisma: PrismaRepositoryClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if ("$transaction" in prisma) {
    return prisma.$transaction((transaction) => operation(transaction));
  }
  return operation(prisma);
}

export class PrismaRepository<T extends { id: string; novelId?: string }>
  implements UniqueCreatePort<T>
{
  constructor(
    private readonly prisma: PrismaRepositoryClient,
    private readonly aggregateType: string,
    private readonly revive: (payload: Payload) => T,
    private readonly payloadCodec: PersistencePayloadCodec = legacyPersistencePayloadCodec,
  ) {}

  async save(entity: T): Promise<void> {
    this.payloadCodec.assertSupported(entity);
    const payload = serialize(entity, this.payloadCodec);
    await this.prisma.currentObject.upsert({
      where: {
        aggregateType_objectId: {
          aggregateType: this.aggregateType,
          objectId: entity.id,
        },
      },
      create: {
        aggregateType: this.aggregateType,
        objectId: entity.id,
        novelId: entity.novelId ?? entity.id,
        payload: prismaPayload(payload),
      },
      update: {
        novelId: entity.novelId ?? entity.id,
        payload: prismaPayload(payload),
      },
    });
  }

  async saveIfAbsent(entity: T): Promise<void> {
    this.payloadCodec.assertSupported(entity);
    const payload = serialize(entity, this.payloadCodec);
    await runInClientTransaction(this.prisma, (transaction) =>
      runInPrismaSavepoint(transaction, async () => {
        try {
          await transaction.currentObject.create({
            data: {
              aggregateType: this.aggregateType,
              objectId: entity.id,
              novelId: entity.novelId ?? entity.id,
              payload: prismaPayload(payload),
            },
          });
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            throw new Error(`Record already exists: ${entity.id}`);
          }
          throw error;
        }
      }),
    );
  }

  async findById(id: string): Promise<T | undefined> {
    const record = await this.prisma.currentObject.findFirst({
      where: { aggregateType: this.aggregateType, objectId: id },
    });
    return record ? snapshot(this.revive(this.payloadCodec.decode(record.payload) as Payload)) : undefined;
  }

  async listByNovel(novelId: string): Promise<readonly T[]> {
    const records = await this.prisma.currentObject.findMany({
      where: { aggregateType: this.aggregateType, novelId },
      orderBy: { objectId: "asc" },
    });
    return records.map((record) => snapshot(this.revive(this.payloadCodec.decode(record.payload) as Payload)));
  }
}

export class PrismaRevisionedRepository<T extends Revisioned<T>>
  implements
    RevisionedRepository<T>,
    RevisionCreatePort<T>,
    CompareAndSwapRevisionedRepository<T>
{
  constructor(
    private readonly prisma: PrismaRepositoryClient,
    private readonly aggregateType: string,
    private readonly revive: (payload: Payload) => T,
    private readonly payloadCodec: PersistencePayloadCodec = legacyPersistencePayloadCodec,
  ) {}

  async save(entity: T): Promise<void> {
    this.payloadCodec.assertSupported(entity);
    await runInClientTransaction(this.prisma, (transaction) =>
      runInPrismaSavepoint(transaction, async () => {
        await this.reserveRevision(transaction, entity, true);
        await this.upsertCurrent(transaction, entity);
      }).catch((error) => {
        throw mapRepositoryConflict(error, entity.id, entity.currentRevisionId);
      }),
    );
  }

  async saveRevisionIfAbsent(entity: T): Promise<void> {
    this.payloadCodec.assertSupported(entity);
    await runInClientTransaction(this.prisma, (transaction) =>
      runInPrismaSavepoint(transaction, async () => {
        await this.reserveRevision(transaction, entity, false);
        await transaction.currentObject.createMany({
          data: [
            {
              aggregateType: this.aggregateType,
              objectId: entity.id,
              novelId: entity.novelId,
              revisionId: entity.currentRevisionId,
              payload: prismaPayload(serialize(entity, this.payloadCodec)),
            },
          ],
          skipDuplicates: true,
        });
      }).catch((error) => {
        throw mapRepositoryConflict(error, entity.id, entity.currentRevisionId);
      }),
    );
  }

  async saveIfCurrent(expectedRevisionId: string, entity: T): Promise<void> {
    this.payloadCodec.assertSupported(entity);
    await runInClientTransaction(this.prisma, (transaction) =>
      runInPrismaSavepoint(transaction, async () => {
        const payload = serialize(entity, this.payloadCodec);
        await this.reserveRevision(transaction, entity, true);
        const updated = await transaction.currentObject.updateMany({
          where: {
            aggregateType: this.aggregateType,
            objectId: entity.id,
            revisionId: expectedRevisionId,
          },
          data: {
            novelId: entity.novelId,
            revisionId: entity.currentRevisionId,
            payload: prismaPayload(payload),
          },
        });
        if (updated.count !== 1) {
          throw new Error(`CAS revision conflict: ${entity.id}`);
        }
      }).catch((error) => {
        throw mapRepositoryConflict(error, entity.id, entity.currentRevisionId);
      }),
    );
  }

  async findById(id: string): Promise<T | undefined> {
    const record = await this.prisma.currentObject.findFirst({
      where: { aggregateType: this.aggregateType, objectId: id },
    });
    return record ? snapshot(this.revive(this.payloadCodec.decode(record.payload) as Payload)) : undefined;
  }

  async getRevision(id: string, revisionId: string): Promise<T | undefined> {
    const record = await this.prisma.revisionRecord.findUnique({
      where: {
        aggregateType_objectId_revisionId: {
          aggregateType: this.aggregateType,
          objectId: id,
          revisionId,
        },
      },
    });
    return record ? snapshot(this.revive(this.payloadCodec.decode(record.payload) as Payload)) : undefined;
  }

  async listByNovel(novelId: string): Promise<readonly T[]> {
    const records = await this.prisma.currentObject.findMany({
      where: { aggregateType: this.aggregateType, novelId },
      orderBy: { objectId: "asc" },
    });
    return records.map((record) => snapshot(this.revive(this.payloadCodec.decode(record.payload) as Payload)));
  }

  private async reserveRevision(
    transaction: Prisma.TransactionClient,
    entity: T,
    allowExistingSamePayload: boolean,
  ): Promise<void> {
    const payload = serialize(entity, this.payloadCodec);
    const revisionKey = {
      aggregateType: this.aggregateType,
      objectId: entity.id,
      revisionId: entity.currentRevisionId,
    };
    const existing = await transaction.revisionRecord.findUnique({
      where: { aggregateType_objectId_revisionId: revisionKey },
    });
    if (existing) {
      if (!allowExistingSamePayload || !samePayload(existing.payload, payload)) {
        throw revisionConflict(entity.id, entity.currentRevisionId);
      }
      return;
    }

    const inserted = await transaction.revisionRecord.createMany({
      data: [
        {
          aggregateType: this.aggregateType,
          objectId: entity.id,
          novelId: entity.novelId,
          revisionId: entity.currentRevisionId,
          payload: prismaPayload(payload),
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return;

    const raced = await transaction.revisionRecord.findUnique({
      where: { aggregateType_objectId_revisionId: revisionKey },
    });
    if (
      !raced ||
      !allowExistingSamePayload ||
      !samePayload(raced.payload, payload)
    ) {
      throw revisionConflict(entity.id, entity.currentRevisionId);
    }
  }

  private async upsertCurrent(
    transaction: Prisma.TransactionClient,
    entity: T,
  ): Promise<void> {
    const payload = serialize(entity, this.payloadCodec);
    await transaction.currentObject.upsert({
      where: {
        aggregateType_objectId: {
          aggregateType: this.aggregateType,
          objectId: entity.id,
        },
      },
      create: {
        aggregateType: this.aggregateType,
        objectId: entity.id,
        novelId: entity.novelId,
        revisionId: entity.currentRevisionId,
        payload: prismaPayload(payload),
      },
      update: {
        novelId: entity.novelId,
        revisionId: entity.currentRevisionId,
        payload: prismaPayload(payload),
      },
    });
  }
}

export class PrismaEventStore implements EventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async append(event: DomainEvent): Promise<void> {
    await this.appendMany([event]);
  }

  async appendMany(events: readonly DomainEvent[]): Promise<void> {
    await this.prisma.domainEvent.createMany({
      data: events.map((event) => ({
        eventId: event.eventId,
        name: event.name,
        context: event.context,
        novelId: event.novelId,
        objectId: event.objectId,
        revisionId: event.revisionId,
        commitId: event.commitId,
        payload: prismaPayload(cloneJsonPayload(event.payload)),
        occurredAt: event.occurredAt,
      })),
    });
  }

  async listByNovel(novelId: string): Promise<readonly DomainEvent[]> {
    const records = await this.prisma.domainEvent.findMany({
      where: { novelId },
      orderBy: { sequence: "asc" },
    });
    return records.map((record) =>
      snapshot({
        eventId: record.eventId,
        name: record.name as DomainEvent["name"],
        context: record.context as DomainEvent["context"],
        novelId: record.novelId,
        objectId: record.objectId,
        revisionId: record.revisionId,
        commitId: record.commitId ?? undefined,
        payload: record.payload as unknown as DomainEvent["payload"],
        occurredAt: record.occurredAt,
      }),
    );
  }
}
