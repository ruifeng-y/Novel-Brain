import type { Repository, Revisioned, RevisionedRepository } from "../shared/application/repository";
import { deepFreeze } from "../shared/domain/immutable";

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

function hasSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class InMemoryRepository<T extends { id: string; novelId?: string }> implements Repository<T> {
  private readonly entities = new Map<string, T>();

  async save(entity: T): Promise<void> {
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
}

export class InMemoryRevisionedRepository<T extends Revisioned<T>>
  implements RevisionedRepository<T>
{
  private readonly currentEntities = new Map<string, T>();
  private readonly revisions = new Map<string, T>();

  async save(entity: T): Promise<void> {
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
}
