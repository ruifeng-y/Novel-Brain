import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CommitChangeSetRevisionEventStore,
  CommitChangeSetRevisionRepositories,
  CommitChangeSetRevisionTransaction,
  CommitChangeSetRevisionTransactionWork,
} from "../safety/application/commitChangeSetRevision";
import { cloneJsonPayload, type DomainEvent } from "../safety/domain/domainEvent";
import type { NarrativeCommit } from "../safety/domain/narrativeCommit";
import type { Scene } from "../manuscript/domain/scene";
import type { CanonicalFact } from "../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../narrative/state/domain/stateRecord";
import type { Identified, UniqueCreatePort } from "../shared/application/repository";
import { capabilityPersistencePayloadCodec } from "../shared/domain/persistencePayload";
import { PrismaPersistenceTransaction } from "../shared/infrastructure/persistenceTransaction";
import {
  PrismaRepository,
  PrismaRevisionedRepository,
} from "../shared/infrastructure/prismaRepositories";

type Payload = Record<string, unknown>;

/**
 * Aggregate types shared by the commit transaction and the runtime composition
 * root. They reuse the frozen VersionReference aggregate names so a persisted
 * target can be addressed by the same identity the gate inspects.
 */
export const prismaCommitAggregateTypes = Object.freeze({
  scene: "Scene",
  canonicalFact: "CanonicalFact",
  stateRecord: "StateRecord",
  narrativeCommit: "NarrativeCommit",
  runCompensationRecord: "RunCompensationRecord",
});

function prismaPayload(payload: Payload): Prisma.InputJsonValue {
  return payload as Prisma.InputJsonValue;
}

function reviveScene(payload: Payload): Scene {
  return payload as unknown as Scene;
}

function reviveCanonicalFact(payload: Payload): CanonicalFact {
  return payload as unknown as CanonicalFact;
}

function reviveStateRecord(payload: Payload): StateRecord {
  return payload as unknown as StateRecord;
}

function reviveNarrativeCommit(payload: Payload): NarrativeCommit {
  return payload as unknown as NarrativeCommit;
}

function reviveDomainEvent(record: {
  readonly eventId: string;
  readonly name: string;
  readonly context: string;
  readonly novelId: string;
  readonly objectId: string;
  readonly revisionId: string;
  readonly commitId: string | null;
  readonly payload: unknown;
  readonly occurredAt: Date;
}): DomainEvent {
  return {
    eventId: record.eventId,
    name: record.name as DomainEvent["name"],
    context: record.context as DomainEvent["context"],
    novelId: record.novelId,
    objectId: record.objectId,
    revisionId: record.revisionId,
    commitId: record.commitId ?? undefined,
    payload: record.payload as DomainEvent["payload"],
    occurredAt: record.occurredAt,
  };
}

function prismaEventStore(client: Prisma.TransactionClient): CommitChangeSetRevisionEventStore {
  return {
    listByNovel: async (novelId) => {
      const records = await client.domainEvent.findMany({
        where: { novelId },
        orderBy: { sequence: "asc" },
      });
      return records.map(reviveDomainEvent);
    },
    appendEventsIfAbsent: async (events) => {
      const ids = new Set<string>();
      for (const event of events) {
        if (ids.has(event.eventId)) {
          throw new Error(`Duplicate event id: ${event.eventId}`);
        }
        ids.add(event.eventId);
      }
      if (events.length === 0) return;

      const existing = await client.domainEvent.findMany({
        where: { eventId: { in: [...ids] } },
        select: { eventId: true },
      });
      if (existing.length > 0) {
        throw new Error(`Duplicate event id: ${existing[0]!.eventId}`);
      }

      await client.domainEvent.createMany({
        data: events.map((event) => ({
          eventId: event.eventId,
          name: event.name,
          context: event.context,
          novelId: event.novelId,
          objectId: event.objectId,
          revisionId: event.revisionId,
          commitId: event.commitId,
          payload: cloneJsonPayload(event.payload) as Prisma.InputJsonValue,
          occurredAt: event.occurredAt,
        })),
      });
    },
  };
}

function prismaNarrativeCommitPort(
  client: Prisma.TransactionClient,
): CommitChangeSetRevisionRepositories["narrativeCommits"] {
  const repository = new PrismaRepository<NarrativeCommit>(
    client,
    prismaCommitAggregateTypes.narrativeCommit,
    reviveNarrativeCommit,
    capabilityPersistencePayloadCodec,
  );

  return {
    findById: (id) => repository.findById(id),
    listByNovel: (novelId) => repository.listByNovel(novelId),
    saveNarrativeCommitIfAbsent: async (commit) => {
      const existing = await repository.findById(commit.id);
      if (existing) throw new Error(`NarrativeCommit id already exists: ${commit.id}`);
      const sameNovel = await repository.listByNovel(commit.novelId);
      if (
        sameNovel.some(
          (candidate) =>
            candidate.changeSetRevisionId === commit.changeSetRevisionId &&
            (candidate.status === "pending" || candidate.status === "committed"),
        )
      ) {
        throw new Error(
          `NarrativeCommit changeSetRevisionId already exists: ${commit.changeSetRevisionId}`,
        );
      }
      try {
        await repository.saveIfAbsent(commit);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Record already exists:")) {
          throw new Error(`NarrativeCommit id already exists: ${commit.id}`);
        }
        throw error;
      }
    },
    saveNarrativeCommitIfCurrent: async (expectedStatus, commit) => {
      const current = await repository.findById(commit.id);
      if (!current || current.status !== expectedStatus) {
        throw new Error(`CAS commit status conflict: ${commit.id}`);
      }
      if (
        current.novelId !== commit.novelId ||
        current.changeSetRevisionId !== commit.changeSetRevisionId
      ) {
        throw new Error(`NarrativeCommit binding cannot change: ${commit.id}`);
      }

      capabilityPersistencePayloadCodec.assertSupported(commit);
      const updated = await client.currentObject.updateMany({
        where: {
          aggregateType: prismaCommitAggregateTypes.narrativeCommit,
          objectId: commit.id,
          payload: { path: ["status"], equals: expectedStatus },
        },
        data: {
          novelId: commit.novelId,
          payload: prismaPayload(capabilityPersistencePayloadCodec.encode(commit)),
        },
      });
      if (updated.count !== 1) {
        throw new Error(`CAS commit status conflict: ${commit.id}`);
      }
    },
  };
}

function bindWork(client: Prisma.TransactionClient): CommitChangeSetRevisionTransactionWork {
  const scenes = new PrismaRevisionedRepository<Scene>(
    client,
    prismaCommitAggregateTypes.scene,
    reviveScene,
    capabilityPersistencePayloadCodec,
  );
  const canonicalFacts = new PrismaRevisionedRepository<CanonicalFact>(
    client,
    prismaCommitAggregateTypes.canonicalFact,
    reviveCanonicalFact,
    capabilityPersistencePayloadCodec,
  );
  const stateRecords = new PrismaRevisionedRepository<StateRecord>(
    client,
    prismaCommitAggregateTypes.stateRecord,
    reviveStateRecord,
    capabilityPersistencePayloadCodec,
  );

  const repositories: CommitChangeSetRevisionRepositories = {
    scenes: {
      findById: (id) => scenes.findById(id),
      getRevision: (id, revisionId) => scenes.getRevision(id, revisionId),
      saveSceneIfCurrent: (expectedRevisionId, scene) =>
        scenes.saveIfCurrent(expectedRevisionId, scene),
    },
    canonicalFacts: {
      findById: (id) => canonicalFacts.findById(id),
      getRevision: (id, revisionId) => canonicalFacts.getRevision(id, revisionId),
      saveCanonicalFactIfCurrent: (expectedRevisionId, fact) =>
        canonicalFacts.saveIfCurrent(expectedRevisionId, fact),
    },
    stateRecords: {
      findById: (id) => stateRecords.findById(id),
      getRevision: (id, revisionId) => stateRecords.getRevision(id, revisionId),
      saveStateRecordIfCurrent: (expectedRevisionId, record) =>
        stateRecords.saveIfCurrent(expectedRevisionId, record),
    },
    narrativeCommits: prismaNarrativeCommitPort(client),
  };

  return { repositories, eventStore: prismaEventStore(client) };
}

/**
 * Prisma implementation of the frozen commit transaction. Every read and write
 * inside `run` shares one database transaction; nested runs reuse the same
 * client through SQL savepoints, so a failure anywhere leaves no partial
 * canonical write, narrative commit, or event behind.
 */
export class PrismaCommitTransaction implements CommitChangeSetRevisionTransaction {
  private readonly transaction: PrismaPersistenceTransaction<CommitChangeSetRevisionTransactionWork>;
  private readonly clientByWork = new WeakMap<object, Prisma.TransactionClient>();

  constructor(prisma: PrismaClient) {
    this.transaction = new PrismaPersistenceTransaction<CommitChangeSetRevisionTransactionWork>(
      prisma,
      (client) => {
        const work = bindWork(client);
        this.clientByWork.set(work, client);
        return work;
      },
    );
  }

  run<T>(
    operation: (work: CommitChangeSetRevisionTransactionWork) => Promise<T>,
  ): Promise<T> {
    return this.transaction.run(operation);
  }

  /**
   * Compensation records are written through the same transaction client as the
   * compensation commit. Omitting them for Prisma would defer the record write
   * to after commit, so a crash could drop an idempotency record for a commit
   * that already landed.
   */
  runWithCompensationRecords<TRecord extends Identified, T>(
    operation: (
      work: CommitChangeSetRevisionTransactionWork,
      records: UniqueCreatePort<TRecord>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.transaction.run((work) => {
      const client = this.clientByWork.get(work);
      if (!client) throw new Error("Prisma commit transaction client is unavailable");
      const records = new PrismaRepository<TRecord>(
        client,
        prismaCommitAggregateTypes.runCompensationRecord,
        (payload) => payload as unknown as TRecord,
        capabilityPersistencePayloadCodec,
      );
      return operation(work, records);
    });
  }
}

export function createPrismaCommitTransaction(
  prisma: PrismaClient,
): CommitChangeSetRevisionTransaction {
  return new PrismaCommitTransaction(prisma);
}
