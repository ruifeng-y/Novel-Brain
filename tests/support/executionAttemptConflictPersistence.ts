import type {
  ExecutionAttemptPersistence,
  ExecutionAttemptPort,
  ExecutionAttemptWork,
} from "../../src/production/application/executionAttemptPersistence";
import type { ExecutionAttempt } from "../../src/production/domain/executionAttempt";
import type { PersistenceTransaction } from "../../src/shared/application/repository";

export interface TestExecutionAttemptPersistence extends ExecutionAttemptPersistence {
  readonly testPort: {
    seed(revision: ExecutionAttempt, setCurrent?: boolean): void;
    removeRevision(id: string, revisionId: string): void;
    setCurrent(id: string, revisionId: string): void;
  };
}

class TestExecutionAttemptPort implements ExecutionAttemptPort {
  readonly revisions = new Map<string, ExecutionAttempt>();
  readonly current = new Map<string, ExecutionAttempt>();

  async saveRevisionIfAbsent(entity: ExecutionAttempt): Promise<void> {
    const key = `${entity.id}:${entity.currentRevisionId}`;
    if (this.revisions.has(key)) throw new Error(`Revision already exists: ${key}`);
    this.revisions.set(key, entity);
    if (!this.current.has(entity.id)) this.current.set(entity.id, entity);
  }

  async saveIfCurrent(expectedRevisionId: string, entity: ExecutionAttempt): Promise<void> {
    const current = this.current.get(entity.id);
    if (!current || current.currentRevisionId !== expectedRevisionId) {
      throw new Error(`CAS revision conflict: ${entity.id}`);
    }
    const key = `${entity.id}:${entity.currentRevisionId}`;
    const existing = this.revisions.get(key);
    if (existing && existing !== entity) {
      throw new Error(`Revision already exists: ${key}`);
    }
    this.revisions.set(key, entity);
    this.current.set(entity.id, entity);
  }

  async findById(id: string): Promise<ExecutionAttempt | undefined> {
    return this.current.get(id);
  }

  async getRevision(id: string, revisionId: string): Promise<ExecutionAttempt | undefined> {
    return this.revisions.get(`${id}:${revisionId}`);
  }

  async listByNovel(novelId: string): Promise<readonly ExecutionAttempt[]> {
    return [...this.current.values()].filter((attempt) => attempt.novelId === novelId);
  }
}

export function createTestExecutionAttemptPersistence(): TestExecutionAttemptPersistence {
  const port = new TestExecutionAttemptPort();
  const transaction: PersistenceTransaction<ExecutionAttemptWork> = {
    run: (operation) => operation({ attempts: port }),
  };
  return {
    transaction,
    attempts: port,
    testPort: {
      seed(revision, setCurrent = true) {
        port.revisions.set(`${revision.id}:${revision.currentRevisionId}`, revision);
        if (setCurrent) port.current.set(revision.id, revision);
      },
      removeRevision(id, revisionId) {
        port.revisions.delete(`${id}:${revisionId}`);
      },
      setCurrent(id, revisionId) {
        const revision = port.revisions.get(`${id}:${revisionId}`);
        if (!revision) throw new Error(`missing revision ${id}:${revisionId}`);
        port.current.set(id, revision);
      },
    },
  };
}
