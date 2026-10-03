import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  Identified,
  PersistenceTransaction,
  RevisionCompareAndSwapPort,
  RevisionCreatePort,
  Revisioned,
  RevisionedRepository,
  UniqueCreatePort,
} from "../application/repository";
import { WriteTransactionCoordinator } from "./writeTransactionCoordinator";
import { runInPrismaSavepoint } from "./prismaSavepoint";

export interface SnapshotStore {
  captureSnapshot(): unknown;
  restoreSnapshot(snapshot: unknown): void;
}

export interface InMemoryPersistenceAccess {
  unique<T extends Identified>(
    delegate: UniqueCreatePort<T> & SnapshotStore,
  ): UniqueCreatePort<T>;
  revisioned<T extends Revisioned<T>>(
    delegate: RevisionCreatePort<T> & RevisionCompareAndSwapPort<T> & SnapshotStore,
  ): RevisionCreatePort<T> & RevisionCompareAndSwapPort<T>;
}

interface InMemoryTransactionContext {
  savepointTail: Promise<void>;
}

type InMemoryWrite<T> = () => Promise<T>;

class InMemoryTransactionUniquePort<T extends Identified>
  implements UniqueCreatePort<T>
{
  constructor(
    private readonly delegate: UniqueCreatePort<T>,
    private readonly runWrite: <R>(operation: InMemoryWrite<R>) => Promise<R>,
  ) {}

  saveIfAbsent(entity: T): Promise<void> {
    return this.runWrite(() => this.delegate.saveIfAbsent(entity));
  }

  findById(id: string): Promise<T | undefined> {
    return this.delegate.findById(id);
  }

  listByNovel(novelId: string): Promise<readonly T[]> {
    return this.delegate.listByNovel(novelId);
  }
}

class InMemoryExternalUniquePort<T extends Identified>
  implements UniqueCreatePort<T>
{
  constructor(
    private readonly delegate: UniqueCreatePort<T>,
    private readonly coordinator: WriteTransactionCoordinator,
  ) {}

  saveIfAbsent(entity: T): Promise<void> {
    return this.coordinator.runExternalWrite(() => this.delegate.saveIfAbsent(entity));
  }

  findById(id: string): Promise<T | undefined> {
    return this.coordinator.runExternalRead(() => this.delegate.findById(id));
  }

  listByNovel(novelId: string): Promise<readonly T[]> {
    return this.coordinator.runExternalRead(() => this.delegate.listByNovel(novelId));
  }
}

class InMemoryTransactionRevisionedPort<T extends Revisioned<T>>
  implements RevisionCreatePort<T>, RevisionCompareAndSwapPort<T>
{
  constructor(
    private readonly delegate: RevisionCreatePort<T> & RevisionCompareAndSwapPort<T>,
    private readonly runWrite: <R>(operation: InMemoryWrite<R>) => Promise<R>,
  ) {}

  saveRevisionIfAbsent(entity: T): Promise<void> {
    return this.runWrite(() => this.delegate.saveRevisionIfAbsent(entity));
  }

  saveIfCurrent(expectedRevisionId: string, entity: T): Promise<void> {
    return this.runWrite(() => this.delegate.saveIfCurrent(expectedRevisionId, entity));
  }

  findById(id: string): Promise<T | undefined> {
    return this.delegate.findById(id);
  }

  getRevision(id: string, revisionId: string): Promise<T | undefined> {
    return this.delegate.getRevision(id, revisionId);
  }

  listByNovel(novelId: string): Promise<readonly T[]> {
    return this.delegate.listByNovel(novelId);
  }
}

class InMemoryExternalRevisionedPort<T extends Revisioned<T>>
  implements RevisionCreatePort<T>, RevisionCompareAndSwapPort<T>
{
  constructor(
    private readonly delegate: RevisionCreatePort<T> & RevisionCompareAndSwapPort<T>,
    private readonly coordinator: WriteTransactionCoordinator,
  ) {}

  saveRevisionIfAbsent(entity: T): Promise<void> {
    return this.coordinator.runExternalWrite(() =>
      this.delegate.saveRevisionIfAbsent(entity),
    );
  }

  saveIfCurrent(expectedRevisionId: string, entity: T): Promise<void> {
    return this.coordinator.runExternalWrite(() =>
      this.delegate.saveIfCurrent(expectedRevisionId, entity),
    );
  }

  findById(id: string): Promise<T | undefined> {
    return this.coordinator.runExternalRead(() => this.delegate.findById(id));
  }

  getRevision(id: string, revisionId: string): Promise<T | undefined> {
    return this.coordinator.runExternalRead(() =>
      this.delegate.getRevision(id, revisionId),
    );
  }

  listByNovel(novelId: string): Promise<readonly T[]> {
    return this.coordinator.runExternalRead(() => this.delegate.listByNovel(novelId));
  }
}

/**
 * Generic InMemory transaction/savepoint runner using the same FIFO external
 * write boundary and nested savepoint rollback discipline as the commit path.
 */
export class InMemoryPersistenceTransaction<TWork>
  implements PersistenceTransaction<TWork>
{
  private readonly context = new AsyncLocalStorage<InMemoryTransactionContext>();
  private readonly coordinator = new WriteTransactionCoordinator();
  private readonly access: InMemoryPersistenceAccess;

  constructor(
    private readonly createWork: (access: InMemoryPersistenceAccess) => TWork,
    private readonly stores: readonly SnapshotStore[],
  ) {
    this.access = {
      unique: (delegate) =>
        new InMemoryTransactionUniquePort(delegate, (operation) => this.runWrite(operation)),
      revisioned: (delegate) =>
        new InMemoryTransactionRevisionedPort(delegate, (operation) => this.runWrite(operation)),
    };
  }

  unique<T extends Identified>(
    delegate: UniqueCreatePort<T> & SnapshotStore,
  ): UniqueCreatePort<T> {
    return new InMemoryExternalUniquePort(delegate, this.coordinator);
  }

  revisioned<T extends Revisioned<T>>(
    delegate: RevisionCreatePort<T> & RevisionCompareAndSwapPort<T> & SnapshotStore,
  ): RevisionCreatePort<T> & RevisionCompareAndSwapPort<T> {
    return new InMemoryExternalRevisionedPort(delegate, this.coordinator);
  }

  saveRevision<T extends Revisioned<T>>(
    delegate: RevisionedRepository<T>,
    entity: T,
  ): Promise<void> {
    return this.runWrite(() => delegate.save(entity));
  }

  async run<T>(operation: (work: TWork) => Promise<T>): Promise<T> {
    const parent = this.context.getStore();
    if (parent) {
      return this.enqueueSavepoint(parent, operation);
    }

    return this.coordinator.runExclusive(() =>
      this.coordinator.runContext(() => {
        const context: InMemoryTransactionContext = { savepointTail: Promise.resolve() };
        return this.context.run(context, () =>
          this.runSavepoint(() => operation(this.createWork(this.access))),
        );
      }),
    );
  }

  private enqueueSavepoint<T>(
    context: InMemoryTransactionContext,
    operation: (work: TWork) => Promise<T>,
  ): Promise<T> {
    const result = context.savepointTail.then(() =>
      this.runSavepoint(() => operation(this.createWork(this.access))),
    );
    context.savepointTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private runWrite<T>(operation: InMemoryWrite<T>): Promise<T> {
    const context = this.context.getStore();
    if (!context) {
      return this.coordinator.runExternalWrite(operation);
    }
    const result = context.savepointTail.then(operation);
    context.savepointTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async runSavepoint<T>(operation: () => Promise<T>): Promise<T> {
    const context: InMemoryTransactionContext = { savepointTail: Promise.resolve() };
    return this.context.run(context, async () => {
      const snapshots = this.stores.map((store) => store.captureSnapshot());
      try {
        return await operation();
      } catch (error) {
        this.stores.forEach((store, index) => {
          store.restoreSnapshot(snapshots[index]);
        });
        throw error;
      }
    });
  }
}
interface PrismaTransactionContext {
  readonly client: Prisma.TransactionClient;
  savepointTail: Promise<void>;
}

/**
 * Generic Prisma transaction/savepoint runner. Nested runs are serialized per
 * top-level transaction and use SQL savepoints on the same transaction client.
 */
export class PrismaPersistenceTransaction<TWork>
  implements PersistenceTransaction<TWork>
{
  private readonly context = new AsyncLocalStorage<PrismaTransactionContext>();


  constructor(
    private readonly prisma: PrismaClient,
    private readonly bindWork: (client: Prisma.TransactionClient) => TWork,
  ) {}

  async run<T>(operation: (work: TWork) => Promise<T>): Promise<T> {
    const parent = this.context.getStore();
    if (parent) {
      return this.enqueueSavepoint(parent, operation);
    }

    return this.prisma.$transaction((client) => {
      const context: PrismaTransactionContext = {
        client,
        savepointTail: Promise.resolve(),
      };
      return this.context.run(context, () => operation(this.bindWork(client)));
    });
  }

  private enqueueSavepoint<T>(
    context: PrismaTransactionContext,
    operation: (work: TWork) => Promise<T>,
  ): Promise<T> {
    const result = context.savepointTail.then(() =>
      this.runSavepoint(context.client, () => operation(this.bindWork(context.client))),
    );
    context.savepointTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private runSavepoint<T>(
    client: Prisma.TransactionClient,
    operation: () => Promise<T>,
  ): Promise<T> {
    return runInPrismaSavepoint(client, operation);
  }
}
