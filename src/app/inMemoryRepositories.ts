import type {
  CompareAndSwapRevisionedRepository,
  RevisionCreatePort,
  Revisioned,
  RevisionedRepository,
  UniqueCreatePort,
} from "../shared/application/repository";
import { legacyPersistencePayloadCodec, type PersistencePayloadCodec } from "../shared/domain/persistencePayload";
import { deepFreeze } from "../shared/domain/immutable";
import { createImmutableTimestamp, isImmutableTimestamp } from "../shared/domain/observationSource";
import type { SnapshotStore } from "../shared/infrastructure/persistenceTransaction";

function cloneValue<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (isImmutableTimestamp(value)) return createImmutableTimestamp(value) as T;
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

function hasSameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Date || right instanceof Date) {
    return (
      left instanceof Date &&
      right instanceof Date &&
      Object.is(left.getTime(), right.getTime())
    );
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => hasSameValue(entry, right[index]))
    );
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && hasSameValue(left[key], right[key]),
    )
  );
}

interface RepositorySnapshot<T> {
  readonly entities: ReadonlyMap<string, T>;
}

interface RevisionedRepositorySnapshot<T> {
  readonly currentEntities: ReadonlyMap<string, T>;
  readonly revisions: ReadonlyMap<string, T>;
}

export class InMemoryRepository<T extends { id: string; novelId?: string }>
  implements UniqueCreatePort<T>, SnapshotStore
{
  private readonly entities = new Map<string, T>();

  constructor(private readonly payloadCodec: PersistencePayloadCodec = legacyPersistencePayloadCodec) {}

  async save(entity: T): Promise<void> {
    this.payloadCodec.assertSupported(entity);
    this.entities.set(entity.id, snapshot(entity));
  }

  async saveIfAbsent(entity: T): Promise<void> {
    this.payloadCodec.assertSupported(entity);
    if (this.entities.has(entity.id)) {
      throw new Error(`Record already exists: ${entity.id}`);
    }
    this.entities.set(entity.id, snapshot(entity));
  }

  async findById(id: string): Promise<T | undefined> {
    const entity = this.entities.get(id);
    return entity ? snapshot(entity) : undefined;
  }

  async listByNovel(novelId: string): Promise<readonly T[]> {
    return Object.freeze(
      [...this.entities.values()]
        .filter((entity) => (entity.novelId ?? entity.id) === novelId)
        .map((entity) => snapshot(entity)),
    );
  }

  captureSnapshot(): unknown {
    return {
      entities: new Map([...this.entities].map(([id, entity]) => [id, snapshot(entity)])),
    } satisfies RepositorySnapshot<T>;
  }

  restoreSnapshot(value: unknown): void {
    const state = value as RepositorySnapshot<T>;
    this.entities.clear();
    for (const [id, entity] of state.entities) {
      this.entities.set(id, snapshot(entity));
    }
  }
}

export class InMemoryRevisionedRepository<T extends Revisioned<T>>
  implements
    RevisionedRepository<T>,
    RevisionCreatePort<T>,
    CompareAndSwapRevisionedRepository<T>,
    SnapshotStore
{
  private readonly currentEntities = new Map<string, T>();
  private readonly revisions = new Map<string, T>();

  constructor(private readonly payloadCodec: PersistencePayloadCodec = legacyPersistencePayloadCodec) {}

  async save(entity: T): Promise<void> {
    this.payloadCodec.assertSupported(entity);
    this.saveEntity(entity);
  }

  async saveRevisionIfAbsent(entity: T): Promise<void> {
    this.payloadCodec.assertSupported(entity);
    const frozen = snapshot(entity);
    const revisionKey = `${entity.id}:${entity.currentRevisionId}`;
    if (this.revisions.has(revisionKey)) {
      throw new Error(`Revision already exists: ${revisionKey}`);
    }
    this.revisions.set(revisionKey, frozen);
    if (!this.currentEntities.has(entity.id)) {
      this.currentEntities.set(entity.id, frozen);
    }
  }

  async saveIfCurrent(expectedRevisionId: string, entity: T): Promise<void> {
    this.payloadCodec.assertSupported(entity);
    const current = this.currentEntities.get(entity.id);
    if (!current || current.currentRevisionId !== expectedRevisionId) {
      throw new Error(`CAS revision conflict: ${entity.id}`);
    }
    this.saveEntity(entity);
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
        .filter((entity) => entity.novelId === novelId)
        .map((entity) => snapshot(entity)),
    );
  }

  captureSnapshot(): unknown {
    return {
      currentEntities: new Map(
        [...this.currentEntities].map(([id, entity]) => [id, snapshot(entity)]),
      ),
      revisions: new Map([...this.revisions].map(([key, entity]) => [key, snapshot(entity)])),
    } satisfies RevisionedRepositorySnapshot<T>;
  }

  restoreSnapshot(value: unknown): void {
    const state = value as RevisionedRepositorySnapshot<T>;
    this.currentEntities.clear();
    this.revisions.clear();
    for (const [id, entity] of state.currentEntities) {
      this.currentEntities.set(id, snapshot(entity));
    }
    for (const [key, entity] of state.revisions) {
      this.revisions.set(key, snapshot(entity));
    }
  }

  private saveEntity(entity: T): void {
    const frozen = snapshot(entity);
    const revisionKey = `${entity.id}:${entity.currentRevisionId}`;
    const existing = this.revisions.get(revisionKey);
    if (existing) {
      if (!hasSameValue(existing, frozen)) {
        throw new Error(`Revision already exists: ${revisionKey}`);
      }
    } else {
      this.revisions.set(revisionKey, frozen);
    }
    this.currentEntities.set(entity.id, frozen);
  }
}
