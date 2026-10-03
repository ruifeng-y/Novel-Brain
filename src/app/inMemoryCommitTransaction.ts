import { AsyncLocalStorage } from "node:async_hooks";
import type {
  CommitChangeSetRevisionEventStore,
  CommitChangeSetRevisionRepositories,
  CommitChangeSetRevisionTransaction,
  CommitChangeSetRevisionTransactionWork,
} from "../safety/application/commitChangeSetRevision";
import type { EventStore } from "../safety/infrastructure/eventStore";
import type { DomainEvent } from "../safety/domain/domainEvent";
import { cloneJsonPayload } from "../safety/domain/domainEvent";
import type {
  Identified,
  Repository,
  Revisioned,
  RevisionedRepository,
} from "../shared/application/repository";
import {
  CommitConflictError,
  isCommitConflictError,
} from "../shared/application/commitConflict";
import { deepFreeze } from "../shared/domain/immutable";
import type { Scene } from "../manuscript/domain/scene";
import type { CanonicalFact } from "../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../narrative/state/domain/stateRecord";
import type { NarrativeCommit } from "../safety/domain/narrativeCommit";

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && Object.is(left.getTime(), right.getTime());
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => sameValue(entry, right[index]))
    );
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && sameValue(left[key], right[key]),
    )
  );
}

function normalizeConflict(error: unknown): unknown {
  if (isCommitConflictError(error)) return error;
  if (!(error instanceof Error)) return error;
  if (error.message.startsWith("CAS revision conflict:")) {
    return new CommitConflictError("cas_revision", error.message);
  }
  if (error.message.startsWith("CAS commit status conflict:")) {
    return new CommitConflictError("cas_commit_status", error.message);
  }
  if (error.message.startsWith("NarrativeCommit id already exists:")) {
    return new CommitConflictError("narrative_commit_id", error.message);
  }
  if (error.message.startsWith("NarrativeCommit changeSetRevisionId already exists:")) {
    return new CommitConflictError("narrative_commit_revision", error.message);
  }
  if (error.message.startsWith("Duplicate event id:")) {
    return new CommitConflictError("duplicate_event_id", error.message);
  }
  if (error.message.startsWith("Revision already exists:")) {
    return new CommitConflictError("revision_history", error.message);
  }
  return error;
}

class WriteTransactionCoordinator {
  private readonly transactionContext = new AsyncLocalStorage<true>();
  private tail: Promise<void> = Promise.resolve();

  isInTransaction(): boolean {
    return this.transactionContext.getStore() === true;
  }

  runContext<T>(operation: () => Promise<T>): Promise<T> {
    return this.transactionContext.run(true, operation);
  }

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  runExternalWrite<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isInTransaction()) {
      return Promise.reject(
        new CommitConflictError(
          "raw_write_in_transaction",
          "External write cannot bypass the active commit transaction",
        ),
      );
    }
    return this.runExclusive(operation).catch(error => {
      throw normalizeConflict(error);
    });
  }

  runExternalRead<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isInTransaction()) return operation();
    return this.runExclusive(operation);
  }
}

interface RevisionedStoreSnapshot<T> {
  readonly currentEntities: ReadonlyMap<string, T>;
  readonly revisions: ReadonlyMap<string, T>;
}

export class InMemoryCommitRevisionedStore<T extends Revisioned<T>>
  implements RevisionedRepository<T>
{
  private currentEntities = new Map<string, T>();
  private revisions = new Map<string, T>();

  async save(entity: T): Promise<void> {
    this.saveRevision(entity);
    this.currentEntities.set(entity.id, snapshot(entity));
  }

  async findById(id: string): Promise<T | undefined> {
    const entity = this.currentEntities.get(id);
    return entity ? snapshot(entity) : undefined;
  }

  async getRevision(id: string, revisionId: string): Promise<T | undefined> {
    const entity = this.revisions.get(`${id}:${revisionId}`);
    return entity ? snapshot(entity) : undefined;
  }

  async listByNovel(novelId: string): Promise<readonly T[]> {
    return Object.freeze(
      [...this.currentEntities.values()]
        .filter(entity => entity.novelId === novelId)
        .map(entity => snapshot(entity)),
    );
  }

  async saveIfCurrent(expectedRevisionId: string, entity: T): Promise<void> {
    const current = this.currentEntities.get(entity.id);
    if (!current || current.currentRevisionId !== expectedRevisionId) {
      throw new CommitConflictError("cas_revision", `CAS revision conflict: ${entity.id}`);
    }
    this.saveRevision(entity);
    this.currentEntities.set(entity.id, snapshot(entity));
  }

  captureSnapshot(): RevisionedStoreSnapshot<T> {
    return {
      currentEntities: new Map(
        [...this.currentEntities].map(([id, entity]) => [id, snapshot(entity)]),
      ),
      revisions: new Map([...this.revisions].map(([key, entity]) => [key, snapshot(entity)])),
    };
  }

  restoreSnapshot(value: RevisionedStoreSnapshot<T>): void {
    this.currentEntities = new Map(
      [...value.currentEntities].map(([id, entity]) => [id, snapshot(entity)]),
    );
    this.revisions = new Map([...value.revisions].map(([key, entity]) => [key, snapshot(entity)]));
  }

  private saveRevision(entity: T): void {
    const frozen = snapshot(entity);
    const revisionKey = `${entity.id}:${entity.currentRevisionId}`;
    const existing = this.revisions.get(revisionKey);
    if (existing && !sameValue(existing, frozen)) {
      throw new CommitConflictError("revision_history", `Revision already exists: ${revisionKey}`);
    }
    this.revisions.set(revisionKey, frozen);
  }
}

interface NarrativeCommitStoreSnapshot {
  readonly entities: ReadonlyMap<string, NarrativeCommit>;
}

class InMemoryCommitNarrativeStore implements Repository<NarrativeCommit> {
  private entities = new Map<string, NarrativeCommit>();

  async save(entity: NarrativeCommit): Promise<void> {
    const existing = this.entities.get(entity.id);
    if (existing) {
      if (sameValue(existing, snapshot(entity))) return;
      throw new CommitConflictError(
        "narrative_commit_id",
        `NarrativeCommit id already exists: ${entity.id}`,
      );
    }
    this.reserveNew(entity);
    this.entities.set(entity.id, snapshot(entity));
  }

  async findById(id: string): Promise<NarrativeCommit | undefined> {
    const entity = this.entities.get(id);
    return entity ? snapshot(entity) : undefined;
  }

  async listByNovel(novelId: string): Promise<readonly NarrativeCommit[]> {
    return Object.freeze(
      [...this.entities.values()]
        .filter(entity => entity.novelId === novelId)
        .map(entity => snapshot(entity)),
    );
  }

  async saveIfAbsent(entity: NarrativeCommit): Promise<void> {
    this.reserveNew(entity);
    this.entities.set(entity.id, snapshot(entity));
  }

  async saveIfCurrent(
    expectedStatus: NarrativeCommit["status"],
    entity: NarrativeCommit,
  ): Promise<void> {
    const current = this.entities.get(entity.id);
    if (!current || current.status !== expectedStatus) {
      throw new CommitConflictError(
        "cas_commit_status",
        `CAS commit status conflict: ${entity.id}`,
      );
    }
    if (
      current.novelId !== entity.novelId ||
      current.changeSetRevisionId !== entity.changeSetRevisionId
    ) {
      throw new CommitConflictError(
        "narrative_commit_binding",
        `NarrativeCommit binding cannot change: ${entity.id}`,
      );
    }
    this.entities.set(entity.id, snapshot(entity));
  }

  captureSnapshot(): NarrativeCommitStoreSnapshot {
    return {
      entities: new Map([...this.entities].map(([id, entity]) => [id, snapshot(entity)])),
    };
  }

  restoreSnapshot(value: NarrativeCommitStoreSnapshot): void {
    this.entities = new Map([...value.entities].map(([id, entity]) => [id, snapshot(entity)]));
  }

  private reserveNew(entity: NarrativeCommit): void {
    if (this.entities.has(entity.id)) {
      throw new CommitConflictError(
        "narrative_commit_id",
        `NarrativeCommit id already exists: ${entity.id}`,
      );
    }
    for (const existing of this.entities.values()) {
      if (existing.changeSetRevisionId === entity.changeSetRevisionId) {
        throw new CommitConflictError(
          "narrative_commit_revision",
          `NarrativeCommit changeSetRevisionId already exists: ${entity.changeSetRevisionId}`,
        );
      }
    }
  }
}

interface EventStoreSnapshot {
  readonly events: readonly DomainEvent[];
  readonly eventIds: readonly string[];
}

class InMemoryCommitEventStore implements EventStore {
  private events: DomainEvent[] = [];
  private eventIds = new Set<string>();

  async append(event: DomainEvent): Promise<void> {
    await this.appendMany([event]);
  }

  async appendMany(events: readonly DomainEvent[]): Promise<void> {
    const ids = new Set<string>();
    for (const event of events) {
      if (this.eventIds.has(event.eventId) || ids.has(event.eventId)) {
        throw new CommitConflictError(
          "duplicate_event_id",
          `Duplicate event id: ${event.eventId}`,
        );
      }
      ids.add(event.eventId);
    }
    const saved = events.map(event =>
      deepFreeze({
        ...event,
        payload: cloneJsonPayload(event.payload),
        occurredAt: new Date(event.occurredAt.getTime()),
      }),
    );
    for (const event of saved) this.eventIds.add(event.eventId);
    this.events.push(...saved);
  }

  async appendEventsIfAbsent(events: readonly DomainEvent[]): Promise<void> {
    await this.appendMany(events);
  }

  async listByNovel(novelId: string): Promise<readonly DomainEvent[]> {
    return Object.freeze(
      this.events
        .filter(event => event.novelId === novelId)
        .map(event => snapshot(event)),
    );
  }

  captureSnapshot(): EventStoreSnapshot {
    return {
      events: this.events.map(event => snapshot(event)),
      eventIds: [...this.eventIds],
    };
  }

  restoreSnapshot(value: EventStoreSnapshot): void {
    this.events = value.events.map(event => snapshot(event));
    this.eventIds = new Set(value.eventIds);
  }
}

export class SerializedRepository<T extends Identified> implements Repository<T> {
  constructor(
    private readonly delegate: Repository<T>,
    private readonly coordinator: WriteTransactionCoordinator,
  ) {}

  save(entity: T): Promise<void> {
    return this.coordinator.runExternalWrite(() => this.delegate.save(entity));
  }

  findById(id: string): Promise<T | undefined> {
    return this.coordinator.runExternalRead(() => this.delegate.findById(id));
  }

  listByNovel(novelId: string): Promise<readonly T[]> {
    return this.coordinator.runExternalRead(() => this.delegate.listByNovel(novelId));
  }
}

export class SerializedRevisionedRepository<T extends Revisioned<T>>
  implements RevisionedRepository<T>
{
  constructor(
    private readonly delegate: RevisionedRepository<T>,
    private readonly coordinator: WriteTransactionCoordinator,
  ) {}

  save(entity: T): Promise<void> {
    return this.coordinator.runExternalWrite(() => this.delegate.save(entity));
  }

  findById(id: string): Promise<T | undefined> {
    return this.coordinator.runExternalRead(() => this.delegate.findById(id));
  }

  getRevision(id: string, revisionId: string): Promise<T | undefined> {
    return this.coordinator.runExternalRead(() => this.delegate.getRevision(id, revisionId));
  }

  listByNovel(novelId: string): Promise<readonly T[]> {
    return this.coordinator.runExternalRead(() => this.delegate.listByNovel(novelId));
  }
}

class SerializedEventStore implements EventStore {
  constructor(
    private readonly delegate: EventStore,
    private readonly coordinator: WriteTransactionCoordinator,
  ) {}

  append(event: DomainEvent): Promise<void> {
    return this.coordinator.runExternalWrite(() => this.delegate.append(event));
  }

  appendMany(events: readonly DomainEvent[]): Promise<void> {
    return this.coordinator.runExternalWrite(() => this.delegate.appendMany(events));
  }

  listByNovel(novelId: string): Promise<readonly DomainEvent[]> {
    return this.coordinator.runExternalRead(() => this.delegate.listByNovel(novelId));
  }
}

/**
 * All public reads and writes share one FIFO coordinator with commit transactions.
 * Transaction work reaches the stores through private CAS/unique-only ports.
 */
export class InMemoryCommitTransaction implements CommitChangeSetRevisionTransaction {
  private readonly coordinator = new WriteTransactionCoordinator();
  private readonly sceneStore = new InMemoryCommitRevisionedStore<Scene>();
  private readonly canonicalFactStore = new InMemoryCommitRevisionedStore<CanonicalFact>();
  private readonly stateRecordStore = new InMemoryCommitRevisionedStore<StateRecord>();
  private readonly narrativeCommitStore = new InMemoryCommitNarrativeStore();
  private readonly eventStoreDelegate = new InMemoryCommitEventStore();

  readonly scenes: RevisionedRepository<Scene>;
  readonly canonicalFacts: RevisionedRepository<CanonicalFact>;
  readonly stateRecords: RevisionedRepository<StateRecord>;
  readonly narrativeCommits: Repository<NarrativeCommit>;
  readonly eventStore: EventStore;

  constructor() {
    this.scenes = new SerializedRevisionedRepository(this.sceneStore, this.coordinator);
    this.canonicalFacts = new SerializedRevisionedRepository(
      this.canonicalFactStore,
      this.coordinator,
    );
    this.stateRecords = new SerializedRevisionedRepository(this.stateRecordStore, this.coordinator);
    this.narrativeCommits = new SerializedRepository(this.narrativeCommitStore, this.coordinator);
    this.eventStore = new SerializedEventStore(this.eventStoreDelegate, this.coordinator);
  }

  serializeRepository<T extends Identified>(delegate: Repository<T>): Repository<T> {
    return new SerializedRepository(delegate, this.coordinator);
  }

  serializeRevisionedRepository<T extends Revisioned<T>>(
    delegate: RevisionedRepository<T>,
  ): RevisionedRepository<T> {
    return new SerializedRevisionedRepository(delegate, this.coordinator);
  }

  async run<T>(
    operation: (work: CommitChangeSetRevisionTransactionWork) => Promise<T>,
  ): Promise<T> {
    if (this.coordinator.isInTransaction()) return this.runSavepoint(operation);
    return this.coordinator.runExclusive(() =>
      this.coordinator.runContext(() => this.runSavepoint(operation)),
    );
  }

  private async runSavepoint<T>(
    operation: (work: CommitChangeSetRevisionTransactionWork) => Promise<T>,
  ): Promise<T> {
    const snapshotState = {
      scenes: this.sceneStore.captureSnapshot(),
      canonicalFacts: this.canonicalFactStore.captureSnapshot(),
      stateRecords: this.stateRecordStore.captureSnapshot(),
      narrativeCommits: this.narrativeCommitStore.captureSnapshot(),
      eventStore: this.eventStoreDelegate.captureSnapshot(),
    };
    try {
      return await operation(this.work());
    } catch (error) {
      this.sceneStore.restoreSnapshot(snapshotState.scenes);
      this.canonicalFactStore.restoreSnapshot(snapshotState.canonicalFacts);
      this.stateRecordStore.restoreSnapshot(snapshotState.stateRecords);
      this.narrativeCommitStore.restoreSnapshot(snapshotState.narrativeCommits);
      this.eventStoreDelegate.restoreSnapshot(snapshotState.eventStore);
      throw error;
    }
  }

  private work(): CommitChangeSetRevisionTransactionWork {
    const repositories: CommitChangeSetRevisionRepositories = {
      scenes: {
        findById: id => this.sceneStore.findById(id),
        getRevision: (id, revisionId) => this.sceneStore.getRevision(id, revisionId),
        saveSceneIfCurrent: (expectedRevisionId, scene) =>
          this.sceneStore.saveIfCurrent(expectedRevisionId, scene),
      },
      canonicalFacts: {
        findById: id => this.canonicalFactStore.findById(id),
        getRevision: (id, revisionId) => this.canonicalFactStore.getRevision(id, revisionId),
        saveCanonicalFactIfCurrent: (expectedRevisionId, fact) =>
          this.canonicalFactStore.saveIfCurrent(expectedRevisionId, fact),
      },
      stateRecords: {
        findById: id => this.stateRecordStore.findById(id),
        getRevision: (id, revisionId) => this.stateRecordStore.getRevision(id, revisionId),
        saveStateRecordIfCurrent: (expectedRevisionId, record) =>
          this.stateRecordStore.saveIfCurrent(expectedRevisionId, record),
      },
      narrativeCommits: {
        findById: id => this.narrativeCommitStore.findById(id),
        listByNovel: novelId => this.narrativeCommitStore.listByNovel(novelId),
        saveNarrativeCommitIfAbsent: commit => this.narrativeCommitStore.saveIfAbsent(commit),
        saveNarrativeCommitIfCurrent: (expectedStatus, commit) =>
          this.narrativeCommitStore.saveIfCurrent(expectedStatus, commit),
      },
    };
    return {
      repositories,
      eventStore: {
        listByNovel: novelId => this.eventStoreDelegate.listByNovel(novelId),
        appendEventsIfAbsent: events => this.eventStoreDelegate.appendEventsIfAbsent(events),
      },
    };
  }
}
