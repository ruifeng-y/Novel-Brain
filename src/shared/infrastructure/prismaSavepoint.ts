import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { nextSavepointName } from "./savepointName";

interface SavepointSection {
  childTail: Promise<void>;
}

const topTailByClient = new WeakMap<object, Promise<void>>();
const sectionContext = new AsyncLocalStorage<SavepointSection>();

async function executeSavepoint<T>(
  client: Prisma.TransactionClient,
  operation: () => Promise<T>,
): Promise<T> {
  const savepointName = nextSavepointName("capability_prisma_sp");
  await client.$executeRawUnsafe(`SAVEPOINT ${savepointName}`);
  try {
    const result = await operation();
    await client.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepointName}`);
    return result;
  } catch (error) {
    try {
      await client.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      await client.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepointName}`);
    } catch {
      // Preserve the operation error; outer transaction rollback is authoritative.
    }
    throw error;
  }
}

function enqueue<T>(
  tail: Promise<void>,
  client: Prisma.TransactionClient,
  operation: () => Promise<T>,
): Promise<T> {
  const result = tail.then(() =>
    sectionContext.run({ childTail: Promise.resolve() }, () =>
      executeSavepoint(client, operation),
    ),
  );
  return result;
}

/**
 * One per-client section coordinator for repository and nested transaction
 * savepoints. Child sections queue on their parent, while children of a section
 * use a separate tail so they cannot deadlock their parent.
 */
export function runInPrismaSavepoint<T>(
  client: Prisma.TransactionClient,
  operation: () => Promise<T>,
): Promise<T> {
  const parent = sectionContext.getStore();
  if (parent) {
    const result = enqueue(parent.childTail, client, operation);
    parent.childTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  const previous = topTailByClient.get(client) ?? Promise.resolve();
  const result = enqueue(previous, client, operation);
  topTailByClient.set(
    client,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}
