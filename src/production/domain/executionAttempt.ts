import type { Candidate } from "./candidate";
import type { GenerationTask } from "./generationTask";
import type { RuntimeRequest, RuntimeResult } from "../runtime/runtimeAdapter";
import type { DomainId, RevisionId } from "../../shared/domain/ids";
import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";
import {
  createImmutableTimestamp,
  createObservation,
  createSourceReference,
  type EvidenceReference,
  isImmutableTimestamp,
  type ImmutableTimestamp,
  type Observation,
  type SourceReference,
} from "../../shared/domain/observationSource";

export type ExecutionAttemptStatus = "created" | "running" | "succeeded" | "failed" | "cancelled";
export type ExecutionAttemptRelation = "initial" | "retry" | "fallback";

export interface ExecutionRoutingDecisionReference {
  readonly routingDecisionId: string;
  readonly resolverVersion: string;
  readonly routingPolicyVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly reason: string;
  readonly fallbackFromAttemptId?: string;
}

export interface ExecutionFailureEvidence {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly providerRequestId?: string;
}

export interface ExecutionRuntimeEvidence extends RuntimeResult {
  readonly occurredAt: Date;
  readonly requestReference: SourceReference;
  readonly request: RuntimeRequest;
  readonly resultReference: SourceReference;
  readonly result: RuntimeResult & { readonly requestReference: SourceReference };
}

export interface ExecutionFailureObservationData extends ExecutionFailureEvidence {
  readonly occurredAt: Date;
}

export interface ExecutionCancellationEvidence {
  readonly reason: string;
  readonly occurredAt: Date;
}

export interface ExecutionAttempt {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly generationTaskId: DomainId;
  readonly generationTaskReference: SourceReference;
  readonly executionKey: string;
  readonly attemptOrdinal: number;
  readonly relation: ExecutionAttemptRelation;
  readonly predecessorAttemptReference?: SourceReference;
  readonly predecessorRoutingDecisionId?: string;
  readonly routingDecision: ExecutionRoutingDecisionReference;
  readonly status: ExecutionAttemptStatus;
  readonly currentRevisionId: RevisionId;
  readonly createdAt: ImmutableTimestamp;
  readonly updatedAt: ImmutableTimestamp;
  readonly startedAt?: ImmutableTimestamp;
  readonly endedAt?: ImmutableTimestamp;
  readonly runtimeEvidence?: Observation<ExecutionRuntimeEvidence>;
  readonly failureEvidence?: Observation<ExecutionFailureObservationData>;
  readonly cancellationEvidence?: Observation<ExecutionCancellationEvidence>;
  readonly candidateReference?: SourceReference;
  readonly auditReferences: readonly EvidenceReference[];
  readonly retryReason?: string;
  readonly cancellationReason?: string;
}

export interface CreateExecutionAttemptInput {
  readonly executionKey: string;
  readonly attemptOrdinal?: number;
  readonly relation: ExecutionAttemptRelation;
  readonly generationTask: GenerationTask | Pick<GenerationTask, "id" | "novelId">;
  readonly generationTaskReference?: SourceReference;
  readonly routingDecision: ExecutionRoutingDecisionReference;
  readonly createdAt: Date;
  readonly predecessorAttempt?: ExecutionAttempt;
}

const terminalStatuses = new Set<ExecutionAttemptStatus>(["succeeded", "failed", "cancelled"]);

function requireNonEmpty(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function requirePositiveInteger(value: number | undefined, name: string, fallback = 1): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function cloneTimestamp(value: Date | ImmutableTimestamp, name: string): ImmutableTimestamp {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${name} must be a valid Date`);
    return createImmutableTimestamp({
      iso: value.toISOString(),
      epochMilliseconds: value.getTime(),
    });
  }
  if (!isImmutableTimestamp(value)) throw new Error(`${name} must be an ImmutableTimestamp`);
  return createImmutableTimestamp(value);
}

function assertNotMovingBackward(
  next: Date | ImmutableTimestamp,
  previous: ImmutableTimestamp,
  name: string,
): ImmutableTimestamp {
  const cloned = cloneTimestamp(next, name);
  if (cloned.epochMilliseconds < previous.epochMilliseconds) {
    throw new Error(`${name} cannot move backward`);
  }
  return cloned;
}

function revisionIdFor(attemptId: string, status: ExecutionAttemptStatus): RevisionId {
  return `${attemptId}:${status}`;
}

export function createExecutionRoutingDecisionReference(
  input: ExecutionRoutingDecisionReference,
): ExecutionRoutingDecisionReference {
  const routingDecisionId = requireNonEmpty(input.routingDecisionId ?? "", "routingDecisionId");
  const resolverVersion = requireNonEmpty(input.resolverVersion, "resolverVersion");
  const routingPolicyVersion = requireNonEmpty(input.routingPolicyVersion, "routingPolicyVersion");
  const provider = requireNonEmpty(input.provider, "provider");
  const model = requireNonEmpty(input.model, "model");
  const reason = requireNonEmpty(input.reason, "routing reason");
  if (input.fallbackFromAttemptId !== undefined && !input.fallbackFromAttemptId.trim()) {
    throw new Error("fallbackFromAttemptId must be non-empty when present");
  }
  return deepFreeze({
    routingDecisionId,
    resolverVersion,
    routingPolicyVersion,
    provider,
    model,
    reason,
    ...(input.fallbackFromAttemptId === undefined
      ? {}
      : { fallbackFromAttemptId: input.fallbackFromAttemptId }),
  });
}

export function createExecutionFailureEvidence(
  input: ExecutionFailureEvidence,
): ExecutionFailureEvidence {
  const code = requireNonEmpty(input.code, "failure code");
  const message = requireNonEmpty(input.message, "failure message");
  if (typeof input.retryable !== "boolean") throw new Error("failure retryable must be boolean");
  if (input.providerRequestId !== undefined && !input.providerRequestId.trim()) {
    throw new Error("providerRequestId must be non-empty when present");
  }
  return deepFreeze({
    code,
    message,
    retryable: input.retryable,
    ...(input.providerRequestId === undefined ? {} : { providerRequestId: input.providerRequestId }),
  });
}

export function generationTaskSourceReference(task: GenerationTask): SourceReference {
  return createSourceReference({
    identity: task.id,
    version: `${task.status}:${task.updatedAt.toISOString()}`,
    hash: hashContent(canonicalJson(task)),
  });
}

export function candidateSourceReference(candidate: Candidate): SourceReference {
  return createSourceReference({
    identity: candidate.id,
    version: candidate.currentRevisionId,
    hash: hashContent(canonicalJson(candidate.change)),
  });
}

export function runtimeRequestSourceReference(
  attemptId: string,
  request: RuntimeRequest,
): SourceReference {
  if (!attemptId.trim()) throw new Error("attemptId is required");
  return createSourceReference({
    identity: `${attemptId}:runtime-request`,
    version: `runtime-request:${request.agentRole}`,
    hash: hashContent(canonicalJson(request)),
  });
}

export function runtimeResultSourceReference(
  attemptId: string,
  result: RuntimeResult,
  occurredAt: Date | ImmutableTimestamp = new Date(0),
  requestReference?: SourceReference,
): SourceReference {
  if (!attemptId.trim()) throw new Error("attemptId is required");
  return createSourceReference({
    identity: `${attemptId}:runtime-result`,
    version: requestReference
      ? `request:${requestReference.hash}`
      : `runtime-result:${result.agentRole}`,
    hash: hashContent(canonicalJson({
      ...(requestReference === undefined ? {} : { requestReference }),
      occurredAt,
      result,
    })),
  });
}

export function executionAttemptSourceReference(attempt: ExecutionAttempt): SourceReference {
  return createSourceReference({
    identity: attempt.id,
    version: attempt.currentRevisionId,
    hash: hashContent(canonicalJson(attempt)),
  });
}

export function createExecutionAttemptId(input: {
  readonly generationTaskId: string;
  readonly attemptOrdinal: number;
  readonly relation: ExecutionAttemptRelation;
  readonly routingDecisionId?: string;
  readonly predecessorAttemptId?: DomainId;
}): string {
  const generationTaskId = requireNonEmpty(input.generationTaskId, "generationTaskId");
  const attemptOrdinal = requirePositiveInteger(input.attemptOrdinal, "attemptOrdinal");
  if (!["initial", "retry", "fallback"].includes(input.relation)) {
    throw new Error("relation is invalid");
  }
  if (input.relation === "initial") {
    return hashContent(
      canonicalJson({
        scope: "initial",
        generationTaskId,
        attemptOrdinal,
      }),
    );
  }
  const predecessorAttemptId = requireNonEmpty(
    input.predecessorAttemptId ?? "",
    "predecessorAttemptId",
  );
  if (input.relation === "retry") {
    return hashContent(
      canonicalJson({
        scope: "retry",
        predecessorAttemptId,
        attemptOrdinal,
      }),
    );
  }
  const routingDecisionId = requireNonEmpty(input.routingDecisionId ?? "", "routingDecisionId");
  return hashContent(
    canonicalJson({
      scope: "fallback",
      predecessorAttemptId,
      attemptOrdinal,
      routingDecisionId,
    }),
  );
}

export function createExecutionAttempt(input: CreateExecutionAttemptInput): ExecutionAttempt {
  const executionKey = requireNonEmpty(input.executionKey, "executionKey");
  const attemptOrdinal = requirePositiveInteger(input.attemptOrdinal, "attemptOrdinal");
  const relation = input.relation;
  if (!["initial", "retry", "fallback"].includes(relation)) throw new Error("relation is invalid");
  const routingDecision = createExecutionRoutingDecisionReference(input.routingDecision);
  const predecessorAttempt = input.predecessorAttempt;
  if (relation === "initial" && predecessorAttempt) {
    throw new Error("initial attempt cannot have a predecessor");
  }
  if (relation !== "initial" && !predecessorAttempt) {
    throw new Error(`${relation} attempt requires a predecessor`);
  }
  if (predecessorAttempt && !terminalStatuses.has(predecessorAttempt.status)) {
    throw new Error(`${relation} requires a terminal predecessor`);
  }
  if (predecessorAttempt && predecessorAttempt.generationTaskId !== input.generationTask.id) {
    throw new Error("predecessor attempt must belong to the same GenerationTask");
  }
  if (
    relation === "fallback" &&
    predecessorAttempt &&
    routingDecision.routingDecisionId === predecessorAttempt.routingDecision.routingDecisionId
  ) {
    throw new Error("fallback requires a new routing decision");
  }
  if (
    relation === "fallback" &&
    routingDecision.fallbackFromAttemptId !== undefined &&
    predecessorAttempt &&
    routingDecision.fallbackFromAttemptId !== predecessorAttempt.id
  ) {
    throw new Error("fallbackFromAttemptId must reference the predecessor attempt");
  }

  const createdAt = cloneTimestamp(input.createdAt, "createdAt");
  const id = createExecutionAttemptId({
    generationTaskId: input.generationTask.id,
    attemptOrdinal,
    relation,
    routingDecisionId: routingDecision.routingDecisionId,
    predecessorAttemptId: predecessorAttempt?.id,
  });

  return deepFreeze({
    id,
    novelId: input.generationTask.novelId,
    generationTaskId: input.generationTask.id,
    generationTaskReference: input.generationTaskReference
      ? createSourceReference(input.generationTaskReference)
      : generationTaskSourceReference(input.generationTask as GenerationTask),
    executionKey,
    attemptOrdinal,
    relation,
    ...(predecessorAttempt
      ? {
          predecessorAttemptReference: executionAttemptSourceReference(predecessorAttempt),
          predecessorRoutingDecisionId: predecessorAttempt.routingDecision.routingDecisionId,
        }
      : {}),
    routingDecision,
    status: "created" as const,
    currentRevisionId: revisionIdFor(id, "created"),
    createdAt,
    updatedAt: createdAt,
    auditReferences: [] as readonly EvidenceReference[],
  });
}

export function createRetryExecutionAttempt(input: {
  readonly previousAttempt: ExecutionAttempt;
  readonly executionKey: string;
  readonly attemptOrdinal?: number;
  readonly routingDecision: ExecutionRoutingDecisionReference;
  readonly createdAt: Date;
}): ExecutionAttempt {
  return createExecutionAttempt({
    executionKey: input.executionKey,
    attemptOrdinal: input.attemptOrdinal ?? 1,
    relation: "retry",
    generationTask: {
      id: input.previousAttempt.generationTaskId,
      novelId: input.previousAttempt.novelId,
    },
    generationTaskReference: input.previousAttempt.generationTaskReference,
    routingDecision: input.routingDecision,
    createdAt: input.createdAt,
    predecessorAttempt: input.previousAttempt,
  });
}

export function createFallbackExecutionAttempt(input: {
  readonly previousAttempt: ExecutionAttempt;
  readonly executionKey: string;
  readonly attemptOrdinal?: number;
  readonly routingDecision: ExecutionRoutingDecisionReference;
  readonly createdAt: Date;
}): ExecutionAttempt {
  return createExecutionAttempt({
    executionKey: input.executionKey,
    attemptOrdinal: input.attemptOrdinal ?? 1,
    relation: "fallback",
    generationTask: {
      id: input.previousAttempt.generationTaskId,
      novelId: input.previousAttempt.novelId,
    },
    generationTaskReference: input.previousAttempt.generationTaskReference,
    routingDecision: input.routingDecision,
    createdAt: input.createdAt,
    predecessorAttempt: input.previousAttempt,
  });
}

export function startExecutionAttempt(attempt: ExecutionAttempt, startedAt: Date): ExecutionAttempt {
  if (terminalStatuses.has(attempt.status)) throw new Error("terminal attempt cannot change");
  if (attempt.status !== "created") throw new Error("Only a created attempt can start");
  const started = assertNotMovingBackward(startedAt, attempt.updatedAt, "startedAt");
  return deepFreeze({
    ...attempt,
    status: "running" as const,
    currentRevisionId: revisionIdFor(attempt.id, "running"),
    startedAt: started,
    updatedAt: started,
    auditReferences: [...attempt.auditReferences],
  });
}

function assertCanTerminate(
  attempt: ExecutionAttempt,
  occurredAt: Date,
  name: string,
): ImmutableTimestamp {
  if (terminalStatuses.has(attempt.status)) throw new Error("terminal attempt cannot change");
  return assertNotMovingBackward(occurredAt, attempt.updatedAt, name);
}

export function assertRuntimeRequestResultMatch(
  request: RuntimeRequest,
  result: RuntimeResult,
): void {
  const matches =
    request.taskId === result.taskId &&
    request.agentRole === result.agentRole &&
    canonicalJson(request.modelPolicy) === canonicalJson(result.modelPolicy) &&
    canonicalJson(request.basedOnVersionSet) === canonicalJson(result.basedOnVersionSet);
  if (!matches) throw new Error("RuntimeRequest and RuntimeResult must match");
}

function assertRoutingMatchesRuntimeResult(
  attempt: ExecutionAttempt,
  runtimeResult: RuntimeResult,
): void {
  if (attempt.routingDecision.provider !== runtimeResult.modelPolicy.provider) {
    throw new Error("routing provider must match RuntimeResult");
  }
  if (attempt.routingDecision.model !== runtimeResult.modelPolicy.model) {
    throw new Error("routing model must match RuntimeResult");
  }
}

function assertCandidateMatchesExecution(
  attempt: ExecutionAttempt,
  candidate: Candidate,
  runtimeResult: RuntimeResult,
): void {
  if (candidate.taskId !== attempt.generationTaskId) {
    throw new Error("Candidate taskId must match GenerationTask");
  }
  if (candidate.novelId !== attempt.novelId) {
    throw new Error("Candidate novelId must match GenerationTask");
  }
  if (canonicalJson(candidate.change) !== canonicalJson(runtimeResult.change)) {
    throw new Error("Candidate change must match RuntimeResult");
  }
}

export function completeExecutionAttempt(input: {
  readonly attempt: ExecutionAttempt;
  readonly runtimeRequest: RuntimeRequest;
  readonly runtimeResult: RuntimeResult;
  readonly completedAt: Date;
  readonly candidate?: Candidate;
}): ExecutionAttempt {
  const completedAt = assertCanTerminate(input.attempt, input.completedAt, "completedAt");
  if (input.attempt.status !== "running") throw new Error("Only a running attempt can complete");
  if (input.runtimeResult.taskId !== input.attempt.generationTaskId) {
    throw new Error("runtime result taskId must match GenerationTask");
  }
  assertRuntimeRequestResultMatch(input.runtimeRequest, input.runtimeResult);
  assertRoutingMatchesRuntimeResult(input.attempt, input.runtimeResult);
  if (input.candidate) {
    assertCandidateMatchesExecution(input.attempt, input.candidate, input.runtimeResult);
  }

  const requestReference = runtimeRequestSourceReference(input.attempt.id, input.runtimeRequest);
  const resultReference = runtimeResultSourceReference(
    input.attempt.id,
    input.runtimeResult,
    completedAt,
    requestReference,
  );
  const runtimeEvidence = createObservation<ExecutionRuntimeEvidence>({
    evidenceReference: `${input.attempt.id}:runtime-result`,
    sourceReference: resultReference,
    ordinal: 1,
    data: {
      ...input.runtimeResult,
      occurredAt: completedAt,
      requestReference,
      request: input.runtimeRequest,
      resultReference,
      result: { ...input.runtimeResult, requestReference },
    },
  });
  return deepFreeze({
    ...input.attempt,
    status: "succeeded" as const,
    currentRevisionId: revisionIdFor(input.attempt.id, "succeeded"),
    endedAt: completedAt,
    updatedAt: completedAt,
    runtimeEvidence,
    ...(input.candidate === undefined
      ? {}
      : { candidateReference: candidateSourceReference(input.candidate) }),
    auditReferences: [runtimeEvidence.evidenceReference],
  });
}

export function failExecutionAttempt(input: {
  readonly attempt: ExecutionAttempt;
  readonly failure: ExecutionFailureEvidence;
  readonly failedAt: Date;
  readonly retryReason?: string;
}): ExecutionAttempt {
  const failedAt = assertCanTerminate(input.attempt, input.failedAt, "failedAt");
  if (input.attempt.status !== "running") throw new Error("Only a running attempt can fail");
  const failure = createExecutionFailureEvidence(input.failure);
  const evidenceData: ExecutionFailureObservationData = {
    ...failure,
    occurredAt: new Date(failedAt.epochMilliseconds),
  };
  const failureEvidence = createObservation<ExecutionFailureObservationData>({
    evidenceReference: `${input.attempt.id}:failure`,
    sourceReference: createSourceReference({
      identity: input.attempt.id,
      version: "runtime-failure",
      hash: hashContent(canonicalJson(evidenceData)),
    }),
    ordinal: 1,
    data: evidenceData,
  });
  const retryReason =
    input.retryReason === undefined ? undefined : requireNonEmpty(input.retryReason, "retryReason");
  return deepFreeze({
    ...input.attempt,
    status: "failed" as const,
    currentRevisionId: revisionIdFor(input.attempt.id, "failed"),
    endedAt: failedAt,
    updatedAt: failedAt,
    failureEvidence,
    ...(retryReason === undefined ? {} : { retryReason }),
    auditReferences: [failureEvidence.evidenceReference],
  });
}

export function cancelExecutionAttempt(input: {
  readonly attempt: ExecutionAttempt;
  readonly reason: string;
  readonly cancelledAt: Date;
}): ExecutionAttempt {
  const cancelledAt = assertCanTerminate(input.attempt, input.cancelledAt, "cancelledAt");
  if (input.attempt.status !== "created" && input.attempt.status !== "running") {
    throw new Error("Only a created or running attempt can be cancelled");
  }
  const reason = requireNonEmpty(input.reason, "cancellation reason");
  const evidenceData: ExecutionCancellationEvidence = {
    reason,
    occurredAt: new Date(cancelledAt.epochMilliseconds),
  };
  const cancellationEvidence = createObservation<ExecutionCancellationEvidence>({
    evidenceReference: `${input.attempt.id}:cancellation`,
    sourceReference: createSourceReference({
      identity: input.attempt.id,
      version: "execution-cancellation",
      hash: hashContent(canonicalJson(evidenceData)),
    }),
    ordinal: 1,
    data: evidenceData,
  });
  return deepFreeze({
    ...input.attempt,
    status: "cancelled" as const,
    currentRevisionId: revisionIdFor(input.attempt.id, "cancelled"),
    endedAt: cancelledAt,
    updatedAt: cancelledAt,
    cancellationEvidence,
    cancellationReason: reason,
    auditReferences: [cancellationEvidence.evidenceReference],
  });
}
