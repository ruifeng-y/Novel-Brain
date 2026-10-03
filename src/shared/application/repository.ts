export interface NovelOwned {
  readonly id: string;
  readonly novelId: string;
}

export interface Identified {
  readonly id: string;
  readonly novelId?: string;
}

export interface RepositoryReadPort<T extends Identified> {
  findById(id: string): Promise<T | undefined>;
  listByNovel(novelId: string): Promise<readonly T[]>;
}

/** A missing novelId means the object itself is the novel identity. */
export interface Repository<T extends Identified> extends RepositoryReadPort<T> {
  save(entity: T): Promise<void>;
}

/** Capability create-only port; it intentionally exposes no generic save bypass. */
export interface UniqueCreatePort<T extends Identified> extends RepositoryReadPort<T> {
  saveIfAbsent(entity: T): Promise<void>;
}

export interface Revisioned<T> extends NovelOwned {
  readonly currentRevisionId: string;
}

export interface RevisionedReadPort<T extends Revisioned<T>> extends RepositoryReadPort<T> {
  getRevision(id: string, revisionId: string): Promise<T | undefined>;
}

export interface RevisionedRepository<T extends Revisioned<T>>
  extends Repository<T>,
    RevisionedReadPort<T> {}

/** Capability immutable-history create-only port. */
export interface RevisionCreatePort<T extends Revisioned<T>> extends RevisionedReadPort<T> {
  saveRevisionIfAbsent(entity: T): Promise<void>;
}

/** Capability current-replacement CAS-only port. */
export interface RevisionCompareAndSwapPort<T extends Revisioned<T>>
  extends RevisionedReadPort<T> {
  saveIfCurrent(expectedRevisionId: string, entity: T): Promise<void>;
}

/** Backward-compatible names for the narrow capability write ports. */
export type UniqueRepository<T extends Identified> = UniqueCreatePort<T>;
export type CompareAndSwapRevisionedRepository<T extends Revisioned<T>> =
  RevisionCompareAndSwapPort<T>;

/**
 * Generic transaction boundary. Capability implementations bind their own
 * narrow work ports without exposing ordinary repository save methods.
 */
export interface PersistenceTransaction<TWork> {
  run<T>(operation: (work: TWork) => Promise<T>): Promise<T>;
}
