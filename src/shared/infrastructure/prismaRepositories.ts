import type { Prisma, PrismaClient } from "@prisma/client";
import type { Repository, Revisioned, RevisionedRepository } from "../application/repository";
import type { DomainEvent } from "../../safety/domain/domainEvent";
import type { EventStore } from "../../safety/infrastructure/eventStore";
import { deepFreeze } from "../domain/immutable";

type Payload = Record<string, unknown>;

function prismaPayload(payload: Payload): Prisma.InputJsonValue {
  return payload as Prisma.InputJsonValue;
}

function serialize<T>(entity: T): Payload {
  return JSON.parse(JSON.stringify(entity)) as Payload;
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

export class PrismaRepository<T extends { id: string; novelId?: string }>
  implements Repository<T>
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly aggregateType: string,
    private readonly revive: (payload: Payload) => T,
  ) {}

  async save(entity: T): Promise<void> {
    const payload = serialize(entity);
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

  async findById(id: string): Promise<T | undefined> {
    const record = await this.prisma.currentObject.findFirst({
      where: { aggregateType: this.aggregateType, objectId: id },
    });
    return record ? snapshot(this.revive(record.payload as Payload)) : undefined;
  }

  async listByNovel(novelId: string): Promise<readonly T[]> {
    const records = await this.prisma.currentObject.findMany({
      where: { aggregateType: this.aggregateType, novelId },
      orderBy: { objectId: "asc" },
    });
    return records.map(record => snapshot(this.revive(record.payload as Payload)));
  }
}

export class PrismaRevisionedRepository<T extends Revisioned<T>>
  implements RevisionedRepository<T>
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly aggregateType: string,
    private readonly revive: (payload: Payload) => T,
  ) {}

  async save(entity: T): Promise<void> {
    const payload = serialize(entity);
    const revisionKey = {
      aggregateType: this.aggregateType,
      objectId: entity.id,
      revisionId: entity.currentRevisionId,
    };
    await this.prisma.$transaction(async transaction => {
      const existing = await transaction.revisionRecord.findUnique({
        where: { aggregateType_objectId_revisionId: revisionKey },
      });
      if (existing && !samePayload(existing.payload, payload)) {
        throw new Error(
          `Revision already exists: ${entity.id}:${entity.currentRevisionId}`,
        );
      }

      await transaction.revisionRecord.upsert({
        where: { aggregateType_objectId_revisionId: revisionKey },
        create: {
          aggregateType: this.aggregateType,
          objectId: entity.id,
          novelId: entity.novelId,
          revisionId: entity.currentRevisionId,
          payload: prismaPayload(payload),
        },
        update: { payload: prismaPayload(payload) },
      });
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
    });
  }

  async findById(id: string): Promise<T | undefined> {
    const record = await this.prisma.currentObject.findFirst({
      where: { aggregateType: this.aggregateType, objectId: id },
    });
    return record ? snapshot(this.revive(record.payload as Payload)) : undefined;
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
    return record ? snapshot(this.revive(record.payload as Payload)) : undefined;
  }

  async listByNovel(novelId: string): Promise<readonly T[]> {
    const records = await this.prisma.currentObject.findMany({
      where: { aggregateType: this.aggregateType, novelId },
      orderBy: { objectId: "asc" },
    });
    return records.map(record => snapshot(this.revive(record.payload as Payload)));
  }
}

export class PrismaEventStore implements EventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async append(event: DomainEvent): Promise<void> {
    await this.appendMany([event]);
  }

  async appendMany(events: readonly DomainEvent[]): Promise<void> {
    await this.prisma.domainEvent.createMany({
      data: events.map(event => ({
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
    return records.map(record =>
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
