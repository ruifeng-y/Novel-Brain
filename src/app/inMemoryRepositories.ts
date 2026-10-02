import type { Repository, Revisioned, RevisionedRepository } from "../shared/application/repository";

export class InMemoryRepository<T extends { id: string; novelId?: string }> implements Repository<T> {
  private readonly entities = new Map<string, T>();

  async save(entity: T): Promise<void> {
    this.entities.set(entity.id, Object.freeze({ ...entity }));
  }

  async findById(id: string): Promise<T | undefined> {
    const entity = this.entities.get(id);
    return entity ? Object.freeze({ ...entity }) : undefined;
  }

  async listByNovel(novelId: string): Promise<readonly T[]> {
    return Object.freeze(
      [...this.entities.values()]
        .filter((entity) => entity.novelId === novelId)
        .map((entity) => Object.freeze({ ...entity })),
    );
  }
}

export class InMemoryRevisionedRepository<T extends Revisioned<T>>
  implements RevisionedRepository<T>
{
  private readonly currentEntities = new Map<string, T>();
  private readonly revisions = new Map<string, T>();

  async save(entity: T): Promise<void> {
    const frozen = Object.freeze({ ...entity });
    this.currentEntities.set(entity.id, frozen);
    this.revisions.set(`${entity.id}:${entity.currentRevisionId}`, frozen);
  }

  async findById(id: string): Promise<T | undefined> {
    const entity = this.currentEntities.get(id);
    return entity ? Object.freeze({ ...entity }) : undefined;
  }

  async getRevision(id: string, revisionId: string): Promise<T | undefined> {
    const entity = this.revisions.get(`${id}:${revisionId}`);
    return entity ? Object.freeze({ ...entity }) : undefined;
  }

  async listByNovel(novelId: string): Promise<readonly T[]> {
    return Object.freeze(
      [...this.currentEntities.values()]
        .filter((entity) => entity.novelId === novelId)
        .map((entity) => Object.freeze({ ...entity })),
    );
  }
}
