import { AsyncLocalStorage } from "node:async_hooks";
import { CommitConflictError } from "../application/commitConflict";

export type TransactionErrorNormalizer = (error: unknown) => unknown;

export class WriteTransactionCoordinator {
  private readonly transactionContext = new AsyncLocalStorage<true>();
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly normalizeError: TransactionErrorNormalizer = (error) => error,
  ) {}

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
    return this.runExclusive(operation).catch((error) => {
      throw this.normalizeError(error);
    });
  }

  runExternalRead<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isInTransaction()) return operation();
    return this.runExclusive(operation);
  }
}
