import {
  canonicalPersistenceMappingContract,
  type CanonicalPersistenceCapability,
} from "./canonicalPersistenceMapping";

export type ProjectionRecoveryMechanism =
  | "snapshot-recovery"
  | "event-replay"
  | "projection-rebuild"
  | "forward-compensation";

export type ProjectionSourceRole =
  | "canonical-state"
  | "versioned-snapshot"
  | "event-audit";

export interface ProjectionReplayRecoveryEntry {
  readonly capability: CanonicalPersistenceCapability;
  /** Logical projection contract; intentionally not a table, DTO, or field list. */
  readonly contract: string;
  readonly projectionOwnership: "derived";
  readonly canonicalSuccessCriterion: "excluded";
  readonly sourceRoles: readonly ProjectionSourceRole[];
  readonly recoveryMechanisms: readonly Exclude<
    ProjectionRecoveryMechanism,
    "forward-compensation"
  >[];
  readonly failureCompensation: "forward-only";
}

export interface ProjectionCompensationContract {
  readonly trigger: "projection-failure-after-canonical-commit";
  readonly strategy: "forward-only";
  readonly canonicalRollback: "forbidden";
  readonly idempotency: "required";
  readonly replayDisposition: "replayed";
}

export interface ProjectionReplayRecoveryContract {
  readonly source: "canonical-persistence-mapping-contract";
  readonly projectionOwnership: "derived";
  readonly canonicalSuccessCriterion: "excluded";
  readonly recoveryMechanisms: readonly ProjectionRecoveryMechanism[];
  readonly compensation: ProjectionCompensationContract;
  readonly entries: readonly ProjectionReplayRecoveryEntry[];
}

export interface ProjectionRecoveryReducer<TState, TEvent> {
  initial(): TState;
  apply(state: TState, event: TEvent): TState;
}

export interface ProjectionReplayEvent<TEvent> {
  readonly sequence: number;
  readonly payload: TEvent;
}

export interface ProjectionRecoverySnapshot<TState> {
  readonly throughSequence: number;
  readonly state: TState;
}

export interface ProjectionRecoveryResult<TState> {
  readonly mechanism: "snapshot-recovery" | "event-replay" | "projection-rebuild";
  readonly state: TState;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly appliedEvents: number;
}

export type DerivedProjectionExecution<TValue> =
  | {
      readonly canonicalStatus: "committed";
      readonly canonicalSuccess: true;
      readonly projectionStatus: "succeeded";
      readonly value: TValue;
    }
  | {
      readonly canonicalStatus: "committed";
      readonly canonicalSuccess: true;
      readonly projectionStatus: "failed";
      readonly recoveryRequired: true;
      readonly error: string;
    };

export interface ForwardCompensationIdentity {
  readonly id: string;
  readonly fingerprint: string;
}

export interface ForwardCompensationStore<TRecord extends ForwardCompensationIdentity> {
  findById(id: string): Promise<TRecord | undefined>;
  saveIfAbsent(record: TRecord): Promise<void>;
}

export type ForwardCompensationResult<TRecord extends ForwardCompensationIdentity> = {
  readonly status: "compensated" | "replayed";
  readonly record: TRecord;
};

const recoveryMechanisms: readonly ProjectionRecoveryMechanism[] = Object.freeze([
  "snapshot-recovery",
  "event-replay",
  "projection-rebuild",
  "forward-compensation",
]);

const projectionRecoveryMechanisms: readonly Exclude<
  ProjectionRecoveryMechanism,
  "forward-compensation"
>[] = Object.freeze([
  "snapshot-recovery",
  "event-replay",
  "projection-rebuild",
]);

const compensationContract: ProjectionCompensationContract = Object.freeze({
  trigger: "projection-failure-after-canonical-commit",
  strategy: "forward-only",
  canonicalRollback: "forbidden",
  idempotency: "required",
  replayDisposition: "replayed",
});

function entry(
  capability: CanonicalPersistenceCapability,
  contract: string,
  sourceRoles: readonly ProjectionSourceRole[],
  mechanisms: readonly Exclude<ProjectionRecoveryMechanism, "forward-compensation">[],
): ProjectionReplayRecoveryEntry {
  return Object.freeze({
    capability,
    contract,
    projectionOwnership: "derived",
    canonicalSuccessCriterion: "excluded",
    sourceRoles: Object.freeze([...sourceRoles]),
    recoveryMechanisms: Object.freeze([...mechanisms]),
    failureCompensation: "forward-only",
  });
}

export const projectionReplayRecoveryContract: ProjectionReplayRecoveryContract = Object.freeze({
  source: "canonical-persistence-mapping-contract",
  projectionOwnership: "derived",
  canonicalSuccessCriterion: "excluded",
  recoveryMechanisms,
  compensation: compensationContract,
  entries: Object.freeze([
    entry(
      "core",
      "change-set-revision-projection",
      ["canonical-state", "versioned-snapshot"],
      ["projection-rebuild"],
    ),
    entry(
      "production-run",
      "run-audit-projection",
      ["versioned-snapshot", "event-audit"],
      ["event-replay", "projection-rebuild"],
    ),
    entry(
      "recall",
      "recall-item-projection",
      ["canonical-state", "event-audit"],
      ["projection-rebuild"],
    ),
    entry(
      "recall",
      "memory-context-projection",
      ["canonical-state", "event-audit"],
      ["snapshot-recovery", "event-replay", "projection-rebuild"],
    ),
    entry(
      "dependency",
      "dependency-registry-view",
      ["canonical-state"],
      ["projection-rebuild"],
    ),
    entry(
      "dependency",
      "impact-analysis-result",
      ["versioned-snapshot"],
      ["snapshot-recovery", "projection-rebuild"],
    ),
  ]),
});

const forbiddenMetadataKeys = new Set([
  "schema",
  "dto",
  "api",
  "fields",
  "columns",
  "table",
  "tables",
]);

const requiredExistingProjections = Object.freeze([
  "change-set-revision-projection",
  "run-audit-projection",
  "recall-item-projection",
  "memory-context-projection",
  "dependency-registry-view",
  "impact-analysis-result",
]);

function assertNoSchemaMetadata(entry: ProjectionReplayRecoveryEntry): void {
  for (const key of Object.keys(entry)) {
    if (forbiddenMetadataKeys.has(key)) {
      throw new Error(`schema/field metadata is not allowed: ${entry.contract}.${key}`);
    }
  }
}

function assertProjectionEntry(entry: ProjectionReplayRecoveryEntry): void {
  assertNoSchemaMetadata(entry);
  if (entry.projectionOwnership !== "derived") {
    throw new Error(`Projection must remain derived: ${entry.contract}`);
  }
  if (entry.canonicalSuccessCriterion !== "excluded") {
    throw new Error(`Projection cannot participate in canonical success: ${entry.contract}`);
  }
  if (entry.sourceRoles.length === 0) {
    throw new Error(`Projection recovery source is required: ${entry.contract}`);
  }
  if (entry.recoveryMechanisms.length === 0) {
    throw new Error(`Projection recovery mechanism is required: ${entry.contract}`);
  }
  for (const mechanism of entry.recoveryMechanisms) {
    if (!projectionRecoveryMechanisms.includes(mechanism)) {
      throw new Error(`Unsupported projection recovery mechanism: ${entry.contract}`);
    }
  }
  if (entry.contract === "run-audit-projection" && !entry.recoveryMechanisms.includes("event-replay")) {
    throw new Error(`Projection event replay is required: ${entry.contract}`);
  }
  if (entry.failureCompensation !== "forward-only") {
    throw new Error(`Projection compensation must be forward-only: ${entry.contract}`);
  }
}

export function validateProjectionReplayRecoveryContract(
  contract: ProjectionReplayRecoveryContract,
): void {
  if (contract.source !== "canonical-persistence-mapping-contract") {
    throw new Error("Projection replay must follow the canonical persistence mapping contract");
  }
  if (contract.projectionOwnership !== "derived") {
    throw new Error("Projection ownership must be derived");
  }
  if (contract.canonicalSuccessCriterion !== "excluded") {
    throw new Error("Projection cannot participate in canonical success");
  }
  if (
    contract.recoveryMechanisms.length !== recoveryMechanisms.length ||
    contract.recoveryMechanisms.some(
      (mechanism, index) => mechanism !== recoveryMechanisms[index],
    )
  ) {
    throw new Error("Projection recovery mechanisms are inconsistent");
  }
  if (
    contract.compensation.trigger !== "projection-failure-after-canonical-commit" ||
    contract.compensation.strategy !== "forward-only" ||
    contract.compensation.canonicalRollback !== "forbidden" ||
    contract.compensation.idempotency !== "required" ||
    contract.compensation.replayDisposition !== "replayed"
  ) {
    throw new Error("Projection compensation contract must be forward-only and idempotent");
  }

  const covered = new Set<string>();
  for (const entry of contract.entries) {
    assertProjectionEntry(entry);
    covered.add(entry.contract);
  }
  for (const projected of canonicalPersistenceMappingContract.entries) {
    if (projected.roles.includes("projection") && !covered.has(projected.contract)) {
      throw new Error(`Projection replay is missing derived contract: ${projected.contract}`);
    }
  }
  for (const projection of requiredExistingProjections) {
    if (!covered.has(projection)) {
      throw new Error(`Projection replay is missing existing projection: ${projection}`);
    }
  }
}

export function replayProjectionEvents<TState, TEvent>(
  reducer: ProjectionRecoveryReducer<TState, TEvent>,
  events: readonly ProjectionReplayEvent<TEvent>[],
): ProjectionRecoveryResult<TState> {
  let state = reducer.initial();
  let previousSequence = 0;
  let firstSequence = 0;
  for (const event of events) {
    if (
      !Number.isInteger(event.sequence) ||
      event.sequence <= previousSequence
    ) {
      throw new Error("Projection event sequence must be strictly increasing");
    }
    if (firstSequence === 0) firstSequence = event.sequence;
    state = reducer.apply(state, event.payload);
    previousSequence = event.sequence;
  }
  return {
    mechanism: "event-replay",
    state,
    firstSequence,
    lastSequence: previousSequence,
    appliedEvents: events.length,
  };
}

export function rebuildProjection<TState, TEvent>(
  reducer: ProjectionRecoveryReducer<TState, TEvent>,
  events: readonly ProjectionReplayEvent<TEvent>[],
): ProjectionRecoveryResult<TState> {
  return { ...replayProjectionEvents(reducer, events), mechanism: "projection-rebuild" };
}

export function recoverProjectionFromSnapshot<TState, TEvent>(
  reducer: ProjectionRecoveryReducer<TState, TEvent>,
  snapshot: ProjectionRecoverySnapshot<TState>,
  events: readonly ProjectionReplayEvent<TEvent>[],
): ProjectionRecoveryResult<TState> {
  let state = snapshot.state;
  let previousSequence = snapshot.throughSequence;
  let firstSequence = 0;
  for (const event of events) {
    if (
      !Number.isInteger(event.sequence) ||
      event.sequence <= snapshot.throughSequence ||
      event.sequence <= previousSequence
    ) {
      throw new Error("Projection event sequence must follow the snapshot");
    }
    if (firstSequence === 0) firstSequence = event.sequence;
    state = reducer.apply(state, event.payload);
    previousSequence = event.sequence;
  }
  return {
    mechanism: "snapshot-recovery",
    state,
    firstSequence,
    lastSequence: previousSequence,
    appliedEvents: events.length,
  };
}

export async function executeDerivedProjectionAfterCanonicalCommit<TValue>(input: {
  readonly commitCanonical: () => Promise<unknown>;
  readonly rebuildProjection: () => Promise<TValue>;
}): Promise<DerivedProjectionExecution<TValue>> {
  await input.commitCanonical();
  try {
    const value = await input.rebuildProjection();
    return {
      canonicalStatus: "committed",
      canonicalSuccess: true,
      projectionStatus: "succeeded",
      value,
    };
  } catch (error) {
    return {
      canonicalStatus: "committed",
      canonicalSuccess: true,
      projectionStatus: "failed",
      recoveryRequired: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function executeForwardCompensation<
  TRecord extends ForwardCompensationIdentity,
  TEffect extends Omit<TRecord, "id" | "fingerprint">,
>(input: {
  readonly id: string;
  readonly fingerprint: string;
  readonly compensate: () => Promise<TEffect>;
  readonly store: ForwardCompensationStore<TRecord>;
}): Promise<ForwardCompensationResult<TRecord>> {
  const id = input.id.trim();
  const fingerprint = input.fingerprint.trim();
  if (!id) throw new Error("Forward compensation id is required");
  if (!fingerprint) throw new Error("Forward compensation fingerprint is required");

  const existing = await input.store.findById(id);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw new Error(`Forward compensation conflict: ${id}`);
    }
    return { status: "replayed", record: existing };
  }

  const effect = await input.compensate();
  const record = { ...effect, id, fingerprint } as unknown as TRecord;
  try {
    await input.store.saveIfAbsent(record);
    return { status: "compensated", record };
  } catch (error) {
    const winner = await input.store.findById(id);
    if (!winner) throw error;
    if (winner.fingerprint !== fingerprint) {
      throw new Error(`Forward compensation conflict: ${id}`);
    }
    return { status: "replayed", record: winner };
  }
}
