import { InMemoryRevisionedRepository } from "../../app/inMemoryRepositories";
import { InMemoryPersistenceTransaction } from "../../shared/infrastructure/persistenceTransaction";
import type {
  PersistenceTransaction,
  RevisionCompareAndSwapPort,
  RevisionCreatePort,
} from "../../shared/application/repository";
import type { AttentionDispositionRecord } from "./attentionDisposition";

export type AttentionDispositionPort = RevisionCreatePort<AttentionDispositionRecord> &
  RevisionCompareAndSwapPort<AttentionDispositionRecord>;

export interface AttentionDispositionWork {
  readonly dispositions: AttentionDispositionPort;
}

export interface AttentionDispositionPersistence {
  readonly transaction: PersistenceTransaction<AttentionDispositionWork>;
  readonly dispositions: AttentionDispositionPort;
}

export function createInMemoryAttentionDispositionPersistence(): AttentionDispositionPersistence {
  const repository = new InMemoryRevisionedRepository<AttentionDispositionRecord>();
  const transaction = new InMemoryPersistenceTransaction<AttentionDispositionWork>(
    (access) => ({ dispositions: access.revisioned(repository) }),
    [repository],
  );
  return {
    transaction,
    dispositions: transaction.revisioned(repository),
  };
}
