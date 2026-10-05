import type {
  ForwardCompensationStore,
  ProjectionRecoveryReducer,
  ProjectionReplayEvent,
} from "../../src/shared/application/projectionReplayRecovery";

export interface NumberProjection {
  readonly total: number;
}

export interface NumberProjectionEvent {
  readonly amount: number;
}

export const numberReducer: ProjectionRecoveryReducer<NumberProjection, NumberProjectionEvent> = {
  initial: () => ({ total: 0 }),
  apply: (state, event) => ({ total: state.total + event.amount }),
};

export const projectionEvents: readonly ProjectionReplayEvent<NumberProjectionEvent>[] = Object.freeze([
  { sequence: 1, payload: { amount: 1 } },
  { sequence: 2, payload: { amount: 2 } },
  { sequence: 3, payload: { amount: 3 } },
]);

export function failingProjectionFixture(): {
  readonly canonicalCommits: number;
  commitCanonical(): Promise<{ readonly commitId: string }>;
  failProjection(): Promise<never>;
  recoverProjection(): Promise<NumberProjection>;
} {
  let canonicalCommits = 0;
  return {
    get canonicalCommits() {
      return canonicalCommits;
    },
    commitCanonical: async () => {
      canonicalCommits += 1;
      return { commitId: `commit-${canonicalCommits}` };
    },
    failProjection: async () => {
      throw new Error("injected projection rebuild failure");
    },
    recoverProjection: async () => ({ total: 6 }),
  };
}

interface StoredCompensation {
  readonly id: string;
  readonly fingerprint: string;
  readonly effect: string;
}

export function inMemoryForwardCompensationStore(): ForwardCompensationStore<StoredCompensation> {
  const records = new Map<string, StoredCompensation>();
  return {
    findById: async (id) => records.get(id),
    saveIfAbsent: async (record) => {
      if (records.has(record.id)) {
        throw new Error(`Forward compensation already exists: ${record.id}`);
      }
      records.set(record.id, record);
    },
  };
}
