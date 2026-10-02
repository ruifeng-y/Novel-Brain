export interface NovelOwned {
  readonly id: string;
  readonly novelId: string;
}

export interface Identified {
  readonly id: string;
  readonly novelId?: string;
}

/** A missing novelId means the object itself is the novel identity. */
export interface Repository<T extends Identified> {
  save(entity: T): Promise<void>;
  findById(id: string): Promise<T | undefined>;
  listByNovel(novelId: string): Promise<readonly T[]>;
}

export interface Revisioned<T> extends NovelOwned {
  readonly currentRevisionId: string;
}

export interface RevisionedRepository<T extends Revisioned<T>> extends Repository<T> {
  getRevision(id: string, revisionId: string): Promise<T | undefined>;
}
