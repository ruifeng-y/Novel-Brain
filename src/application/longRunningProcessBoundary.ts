import type {
  ApplicationCommandContract,
  ApplicationQueryContract,
} from "./commandQueryBoundary";

export const longRunningProcessKinds = [
  "generation",
  "validation",
  "run",
  "impact-analysis",
  "projection-rebuild",
] as const;

export type LongRunningProcessKind = (typeof longRunningProcessKinds)[number];
export type LongRunningProcessPhase = "submitted" | "running" | "terminal";
export type LongRunningProcessActiveStatus = "submitted" | "running";
export type LongRunningProcessTerminalStatus = "succeeded" | "failed" | "cancelled";
export type LongRunningProcessStatus =
  | LongRunningProcessActiveStatus
  | LongRunningProcessTerminalStatus;

export type LongRunningProcessCommandBoundary = Pick<
  ApplicationCommandContract,
  "kind" | "effect" | "resultChannel"
>;
export type LongRunningProcessQueryBoundary = Pick<
  ApplicationQueryContract,
  "kind" | "effect" | "resultChannel"
>;

export interface LongRunningProcessResultBoundary {
  readonly kind: "process-result";
  readonly effect: "read";
  readonly resultChannel: "process-result";
}

export interface LongRunningProcessLifecycleContract {
  readonly phases: readonly ["submitted", "running", "terminal"];
  readonly terminalStatuses: readonly [
    "succeeded",
    "failed",
    "cancelled",
  ];
}

export interface LongRunningProcessCancellationContract {
  readonly request: LongRunningProcessCommandBoundary;
  readonly supported: true;
  readonly terminalStatus: "cancelled";
  readonly idempotent: true;
}

export interface LongRunningProcessIdempotencyContract {
  readonly identity: "process-id";
  readonly duplicateDisposition: "return-existing-process";
}

export interface LongRunningProcessContract {
  readonly id: string;
  readonly kind: LongRunningProcessKind;
  readonly submission: LongRunningProcessCommandBoundary;
  readonly status: LongRunningProcessQueryBoundary;
  readonly result: LongRunningProcessResultBoundary;
  readonly lifecycle: LongRunningProcessLifecycleContract;
  readonly cancellation: LongRunningProcessCancellationContract;
  readonly idempotency: LongRunningProcessIdempotencyContract;
}

export type LongRunningProcessResult<TValue> =
  | { readonly status: "succeeded"; readonly value: TValue }
  | { readonly status: "failed"; readonly error: string }
  | { readonly status: "cancelled" };

export interface LongRunningProcessIdentity {
  readonly id: string;
  readonly kind: LongRunningProcessKind;
}

interface LongRunningProcessActiveSnapshot extends LongRunningProcessIdentity {
  readonly phase: "submitted" | "running";
  readonly status: LongRunningProcessActiveStatus;
  readonly cancellationRequested: boolean;
  readonly result?: undefined;
}

interface LongRunningProcessTerminalSnapshot<TValue>
  extends LongRunningProcessIdentity {
  readonly phase: "terminal";
  readonly status: LongRunningProcessTerminalStatus;
  readonly cancellationRequested: boolean;
  readonly result: LongRunningProcessResult<TValue>;
}

export type LongRunningProcessSnapshot<TValue> =
  | LongRunningProcessActiveSnapshot
  | LongRunningProcessTerminalSnapshot<TValue>;

export interface LongRunningProcessCancellationReceipt {
  readonly id: string;
  readonly disposition:
    | "cancelled"
    | "requested"
    | "already-requested"
    | "already-terminal";
  readonly status: LongRunningProcessStatus;
  readonly cancellationRequested: boolean;
}

const commandBoundary: LongRunningProcessCommandBoundary = Object.freeze({
  kind: "command",
  effect: "mutation",
  resultChannel: "command-result",
});

const queryBoundary: LongRunningProcessQueryBoundary = Object.freeze({
  kind: "query",
  effect: "read",
  resultChannel: "query-result",
});

const resultBoundary: LongRunningProcessResultBoundary = Object.freeze({
  kind: "process-result",
  effect: "read",
  resultChannel: "process-result",
});

const lifecycle: LongRunningProcessLifecycleContract = Object.freeze({
  phases: Object.freeze(["submitted", "running", "terminal"] as const),
  terminalStatuses: Object.freeze(["succeeded", "failed", "cancelled"] as const),
});

const cancellation: LongRunningProcessCancellationContract = Object.freeze({
  request: commandBoundary,
  supported: true,
  terminalStatus: "cancelled",
  idempotent: true,
});

const idempotency: LongRunningProcessIdempotencyContract = Object.freeze({
  identity: "process-id",
  duplicateDisposition: "return-existing-process",
});

function createProcessContract(kind: LongRunningProcessKind): LongRunningProcessContract {
  return Object.freeze({
    id: `process.${kind}`,
    kind,
    submission: commandBoundary,
    status: queryBoundary,
    result: resultBoundary,
    lifecycle,
    cancellation,
    idempotency,
  });
}

export const longRunningProcessContracts: readonly LongRunningProcessContract[] =
  Object.freeze(longRunningProcessKinds.map(createProcessContract));

export function getLongRunningProcessContract(
  kind: string,
): LongRunningProcessContract {
  const contract = longRunningProcessContracts.find(candidate => candidate.kind === kind);
  if (!contract) throw new Error(`unknown long-running process kind: ${kind}`);
  return contract;
}

interface ProcessRecord<TValue> extends LongRunningProcessIdentity {
  phase: LongRunningProcessPhase;
  status: LongRunningProcessStatus;
  cancellationRequested: boolean;
  result?: LongRunningProcessResult<TValue>;
  waiters: Set<(result: LongRunningProcessResult<TValue>) => void>;
}

function sameResult<TValue>(
  left: LongRunningProcessResult<TValue>,
  right: LongRunningProcessResult<TValue>,
): boolean {
  if (left.status !== right.status) return false;
  if (left.status === "succeeded" && right.status === "succeeded") {
    return Object.is(left.value, right.value);
  }
  if (left.status === "failed" && right.status === "failed") {
    return left.error === right.error;
  }
  return left.status === "cancelled" && right.status === "cancelled";
}

export class InMemoryLongRunningProcessBoundary<TValue = unknown> {
  private readonly processes = new Map<string, ProcessRecord<TValue>>();

  async submit(identity: LongRunningProcessIdentity): Promise<LongRunningProcessSnapshot<TValue>> {
    getLongRunningProcessContract(identity.kind);
    if (identity.id.trim().length === 0) throw new Error("process identity is required");

    const existing = this.processes.get(identity.id);
    if (existing) {
      if (existing.kind !== identity.kind) {
        throw new Error(
          `process identity ${identity.id} is already reserved for ${existing.kind}`,
        );
      }
      return this.snapshot(existing);
    }

    const record: ProcessRecord<TValue> = {
      id: identity.id,
      kind: identity.kind,
      phase: "submitted",
      status: "submitted",
      cancellationRequested: false,
      waiters: new Set(),
    };
    this.processes.set(identity.id, record);
    return this.snapshot(record);
  }

  async markRunning(id: string): Promise<LongRunningProcessSnapshot<TValue>> {
    const record = this.requireRecord(id);
    if (record.phase === "terminal") {
      throw new Error(
        `process ${id} is already terminal with ${record.status}`,
      );
    }
    if (record.phase === "running") return this.snapshot(record);

    record.phase = "running";
    record.status = "running";
    return this.snapshot(record);
  }

  async complete(
    id: string,
    result: LongRunningProcessResult<TValue>,
  ): Promise<LongRunningProcessSnapshot<TValue>> {
    const record = this.requireRecord(id);
    if (record.phase === "terminal") {
      if (record.result !== undefined && sameResult(record.result, result)) {
        return this.snapshot(record);
      }
      throw new Error(`process ${id} is already terminal with ${record.status}`);
    }
    if (record.cancellationRequested && result.status !== "cancelled") {
      throw new Error(`process ${id} requested cancellation`);
    }

    record.phase = "terminal";
    record.status = result.status;
    record.result = result;
    this.resolveWaiters(record);
    return this.snapshot(record);
  }

  async requestCancellation(id: string): Promise<LongRunningProcessCancellationReceipt> {
    const record = this.requireRecord(id);
    if (record.phase === "terminal") {
      return {
        id,
        disposition: "already-terminal",
        status: record.status,
        cancellationRequested: record.cancellationRequested,
      };
    }
    if (record.cancellationRequested) {
      return {
        id,
        disposition: "already-requested",
        status: record.status,
        cancellationRequested: true,
      };
    }

    record.cancellationRequested = true;
    if (record.phase === "submitted") {
      record.phase = "terminal";
      record.status = "cancelled";
      record.result = { status: "cancelled" };
      this.resolveWaiters(record);
      return {
        id,
        disposition: "cancelled",
        status: "cancelled",
        cancellationRequested: true,
      };
    }

    return {
      id,
      disposition: "requested",
      status: "running",
      cancellationRequested: true,
    };
  }

  async observe(id: string): Promise<LongRunningProcessSnapshot<TValue>> {
    return this.snapshot(this.requireRecord(id));
  }

  async result(id: string): Promise<LongRunningProcessResult<TValue>> {
    const record = this.requireRecord(id);
    if (record.result) return record.result;

    return new Promise<LongRunningProcessResult<TValue>>(resolve => {
      record.waiters.add(resolve);
    });
  }

  private requireRecord(id: string): ProcessRecord<TValue> {
    const record = this.processes.get(id);
    if (!record) throw new Error(`unknown long-running process: ${id}`);
    return record;
  }

  private resolveWaiters(record: ProcessRecord<TValue>): void {
    if (!record.result) return;
    for (const resolve of record.waiters) resolve(record.result);
    record.waiters.clear();
  }

  private snapshot(record: ProcessRecord<TValue>): LongRunningProcessSnapshot<TValue> {
    const identity = { id: record.id, kind: record.kind };
    if (record.phase === "terminal" && record.result) {
      return {
        ...identity,
        phase: "terminal",
        status: record.status as LongRunningProcessTerminalStatus,
        cancellationRequested: record.cancellationRequested,
        result: record.result,
      };
    }
    return {
      ...identity,
      phase: record.phase as "submitted" | "running",
      status: record.status as LongRunningProcessActiveStatus,
      cancellationRequested: record.cancellationRequested,
    };
  }
}
