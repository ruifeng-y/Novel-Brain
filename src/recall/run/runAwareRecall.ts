import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";
import type { ProductionRun } from "../../production/domain/productionRun";
import type { RunCheckpoint } from "../../production/domain/runCheckpoint";
import type { GenerationOperation } from "../../production/domain/generationTask";
import type { VersionSet } from "../../shared/domain/versioning";

export interface RunAwareRecallEvidence {
  readonly sourceKind: "run_signals";
  readonly evidenceReference: string;
  readonly sourceReference: {
    readonly identity: string;
    readonly version: string;
    readonly hash: string;
  };
  readonly staleness: "fresh" | "stale" | "missing";
  readonly value: unknown;
}

export interface RunAwareRecallObservation {
  readonly observationId: string;
  readonly runId: string;
  readonly novelId: string;
  readonly runRevisionId: string;
  readonly evidence: readonly RunAwareRecallEvidence[];
  readonly hash: string;
  readonly observedAt: string;
}

export type RecallRunPolicyAction = "pause" | "checkpoint" | "ask" | "abort";

export interface GenerationTaskProposal {
  readonly operation: GenerationOperation;
  readonly targetSceneId: string;
  readonly intent: string;
  readonly basedOnVersionSet: VersionSet;
}

interface NormalRunPolicyRequestBase {
  readonly kind: "normal_run_policy";
  readonly requestId: string;
  readonly runId: string;
  readonly reason: string;
  readonly evidenceReferences: readonly string[];
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly observationHash: string;
}

export interface ThresholdRunPolicyRequest extends NormalRunPolicyRequestBase {
  readonly requestType: "threshold_action";
  readonly action: RecallRunPolicyAction;
}

export interface GenerationTaskRunPolicyRequest extends NormalRunPolicyRequestBase {
  readonly requestType: "generation_task";
  readonly proposal: GenerationTaskProposal;
}

export type NormalRunPolicyRequest =
  | ThresholdRunPolicyRequest
  | GenerationTaskRunPolicyRequest;

export interface RecallProposedAction {
  readonly request: NormalRunPolicyRequest;
}

export interface RunPolicyRequestReceipt {
  readonly requestId: string;
  readonly status: "accepted" | "rejected" | "queued";
}

export interface RunPolicyRequestPort {
  requestNormalRunPolicy(
    request: NormalRunPolicyRequest,
  ): Promise<RunPolicyRequestReceipt> | RunPolicyRequestReceipt;
}

const runPolicyActions = new Set<RecallRunPolicyAction>([
  "pause",
  "checkpoint",
  "ask",
  "abort",
]);

const generationOperations = new Set<GenerationOperation>([
  "story_planning",
  "outline_refinement",
  "chapter_generation",
  "scene_generation",
  "continuation",
  "expansion",
  "rewrite",
  "polish",
  "local_regeneration",
  "consistency_analysis",
]);

const aggregateTypes = new Set([
  "Novel",
  "Arc",
  "Chapter",
  "Scene",
  "CanonicalFact",
  "StateRecord",
  "GenerationTask",
  "Candidate",
  "ValidationRun",
  "ReviewDecision",
  "NarrativeCommit",
]);

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function timestamp(value: unknown, name: string): string {
  const normalized = requiredText(value, name);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`${name} must be a canonical ISO timestamp`);
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(
  value: unknown,
  allowed: ReadonlySet<string>,
  name: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(
        "proposedAction must request normal Run policy without direct authority",
      );
    }
  }
}

function commonRequestKeys(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  if (value.kind !== "normal_run_policy") {
    throw new Error(
      "proposedAction must request normal Run policy without direct authority",
    );
  }
  requiredText(value.requestId, "request.requestId");
  requiredText(value.runId, "request.runId");
  requiredText(value.reason, "request.reason");
  requiredText(value.requestedBy, "request.requestedBy");
  timestamp(value.requestedAt, "request.requestedAt");
  requiredText(value.observationHash, "request.observationHash");
  if (
    !Array.isArray(value.evidenceReferences) ||
    value.evidenceReferences.length === 0 ||
    value.evidenceReferences.some((reference) => typeof reference !== "string" || !reference.trim())
  ) {
    throw new Error("request.evidenceReferences must not be empty");
  }
  return value;
}
function assertVersionSet(value: unknown, proposal: GenerationTaskProposal): void {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new Error("proposal.basedOnVersionSet must not be empty");
  }
  const references = Object.values(value) as Record<string, unknown>[];
  for (const reference of references) {
    assertExactKeys(
      reference,
      new Set(["aggregateType", "objectId", "revisionId"]),
      "proposal.basedOnVersionSet reference",
    );
    if (
      typeof reference.aggregateType !== "string" ||
      !aggregateTypes.has(reference.aggregateType)
    ) {
      throw new Error("proposal.basedOnVersionSet aggregateType is invalid");
    }
    requiredText(reference.objectId, "proposal.basedOnVersionSet objectId");
    requiredText(reference.revisionId, "proposal.basedOnVersionSet revisionId");
  }
  const coversTarget = references.some(
    (reference) =>
      reference.aggregateType === "Scene" && reference.objectId === proposal.targetSceneId,
  );
  if (!coversTarget) {
    throw new Error("proposal.basedOnVersionSet must include the target scene version");
  }
}

function assertGenerationProposal(value: unknown): GenerationTaskProposal {
  assertExactKeys(
    value,
    new Set(["operation", "targetSceneId", "intent", "basedOnVersionSet"]),
    "request.proposal",
  );
  const operation = requiredText(value.operation, "proposal.operation");
  if (!generationOperations.has(operation as GenerationOperation)) {
    throw new Error("proposal.operation is invalid");
  }
  const proposal = {
    operation: operation as GenerationOperation,
    targetSceneId: requiredText(value.targetSceneId, "proposal.targetSceneId"),
    intent: requiredText(value.intent, "proposal.intent"),
    basedOnVersionSet: value.basedOnVersionSet as VersionSet,
  };
  assertVersionSet(value.basedOnVersionSet, proposal);
  return proposal;
}

function authorityError(): Error {
  return new Error(
    "proposedAction must request normal Run policy without direct authority",
  );
}

export function assertRecallProposedAction(value: unknown): RecallProposedAction {
  assertExactKeys(value, new Set(["request"]), "proposedAction");
  const request = commonRequestKeys(value.request, "request");
  if (request.requestType === "threshold_action") {
    assertExactKeys(
      request,
      new Set([
        "kind",
        "requestType",
        "requestId",
        "runId",
        "action",
        "reason",
        "evidenceReferences",
        "requestedBy",
        "requestedAt",
        "observationHash",
      ]),
      "request",
    );
    if (typeof request.action !== "string" || !runPolicyActions.has(request.action as RecallRunPolicyAction)) {
      throw authorityError();
    }
  } else if (request.requestType === "generation_task") {
    assertExactKeys(
      request,
      new Set([
        "kind",
        "requestType",
        "requestId",
        "runId",
        "proposal",
        "reason",
        "evidenceReferences",
        "requestedBy",
        "requestedAt",
        "observationHash",
      ]),
      "request",
    );
    assertGenerationProposal(request.proposal);
  } else {
    throw authorityError();
  }
  return value as unknown as RecallProposedAction;
}

function runEvidence(run: ProductionRun): RunAwareRecallEvidence {
  return {
    sourceKind: "run_signals",
    evidenceReference: `ProductionRun:${run.id}`,
    sourceReference: {
      identity: `ProductionRun:${run.id}`,
      version: run.currentRevisionId,
      hash: hashContent(
        canonicalJson({
          id: run.id,
          novelId: run.novelId,
          runPlanRevisionId: run.runPlanRevisionId,
          planRevisionReference: run.planRevisionReference,
          status: run.status,
          revisionNumber: run.revisionNumber,
          currentRevisionId: run.currentRevisionId,
          stepStates: run.stepStates,
        }),
      ),
    },
    staleness: "fresh",
    value: {
      runId: run.id,
      status: run.status,
      revisionNumber: run.revisionNumber,
      stepStates: run.stepStates,
    },
  };
}

function checkpointEvidence(checkpoint: RunCheckpoint): RunAwareRecallEvidence {
  return {
    sourceKind: "run_signals",
    evidenceReference: `RunCheckpoint:${checkpoint.id}`,
    sourceReference: {
      identity: `RunCheckpoint:${checkpoint.id}`,
      version: checkpoint.currentRevisionId,
      hash: hashContent(
        canonicalJson({
          id: checkpoint.id,
          runId: checkpoint.runId,
          novelId: checkpoint.novelId,
          triggerCategory: checkpoint.triggerCategory,
          triggerReason: checkpoint.triggerReason,
          status: checkpoint.status,
          revisionNumber: checkpoint.revisionNumber,
          currentRevisionId: checkpoint.currentRevisionId,
          auditReferences: checkpoint.auditReferences,
        }),
      ),
    },
    staleness: "fresh",
    value: {
      checkpointId: checkpoint.id,
      runId: checkpoint.runId,
      status: checkpoint.status,
      triggerCategory: checkpoint.triggerCategory,
      triggerReason: checkpoint.triggerReason,
      ...(checkpoint.decision === undefined ? {} : { decision: checkpoint.decision }),
    },
  };
}

export function createRecallRunObservation(input: {
  readonly run: ProductionRun;
  readonly checkpoints: readonly RunCheckpoint[];
  readonly observedAt: string;
}): RunAwareRecallObservation {
  const observedAt = timestamp(input.observedAt, "observedAt");
  const evidence = deepFreeze([
    runEvidence(input.run),
    ...[...input.checkpoints]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(checkpointEvidence),
  ]);
  const runRevisionId = input.run.currentRevisionId;
  return deepFreeze({
    observationId: `run:${input.run.id}:${input.run.id}:${input.run.revisionNumber}:${input.run.status}`,
    runId: input.run.id,
    novelId: input.run.novelId,
    runRevisionId,
    evidence,
    hash: hashContent(canonicalJson({ runRevisionId, evidence })),
    observedAt,
  });
}

function evidenceReferences(input: readonly string[]): readonly string[] {
  if (input.length === 0) throw new Error("evidenceReferences must not be empty");
  return deepFreeze(input.map((reference) => requiredText(reference, "evidenceReference")));
}

function requestBase(input: {
  readonly observation: RunAwareRecallObservation;
  readonly reason: string;
  readonly evidenceReferences: readonly string[];
  readonly actorId: string;
  readonly requestedAt: string;
}): Omit<NormalRunPolicyRequestBase, "requestId"> {
  return {
    kind: "normal_run_policy",
    runId: input.observation.runId,
    reason: requiredText(input.reason, "reason"),
    evidenceReferences: evidenceReferences(input.evidenceReferences),
    requestedBy: requiredText(input.actorId, "actorId"),
    requestedAt: timestamp(input.requestedAt, "requestedAt"),
    observationHash: input.observation.hash,
  };
}

export function createRecallProposedAction(input: {
  readonly observation: RunAwareRecallObservation;
  readonly action: RecallRunPolicyAction;
  readonly reason: string;
  readonly evidenceReferences: readonly string[];
  readonly actorId: string;
  readonly requestedAt: string;
}): RecallProposedAction {
  if (!runPolicyActions.has(input.action)) throw new Error("invalid normal Run policy action");
  const base = requestBase(input);
  const requestId = hashContent(
    canonicalJson({
      ...base,
      requestType: "threshold_action",
      action: input.action,
    }),
  );
  return assertRecallProposedAction({
    request: {
      ...base,
      requestType: "threshold_action",
      requestId,
      action: input.action,
    },
  });
}

export function createRecallProposedGenerationTaskRequest(input: {
  readonly observation: RunAwareRecallObservation;
  readonly proposal: GenerationTaskProposal;
  readonly reason: string;
  readonly evidenceReferences: readonly string[];
  readonly actorId: string;
  readonly requestedAt: string;
}): RecallProposedAction {
  const base = requestBase(input);
  const proposal = assertGenerationProposal(input.proposal);
  const requestId = hashContent(
    canonicalJson({
      ...base,
      requestType: "generation_task",
      proposal,
    }),
  );
  return assertRecallProposedAction({
    request: {
      ...base,
      requestType: "generation_task",
      requestId,
      proposal,
    },
  });
}

export async function requestRecallRunPolicy(input: {
  readonly action: RecallProposedAction;
  readonly port: RunPolicyRequestPort;
}): Promise<{
  readonly request: NormalRunPolicyRequest;
  readonly receipt: RunPolicyRequestReceipt;
  readonly blocking: false;
}> {
  const action = assertRecallProposedAction(input.action);
  const receipt = await input.port.requestNormalRunPolicy(action.request);
  if (receipt.requestId !== action.request.requestId) {
    throw new Error("Run policy receipt requestId must match the request");
  }
  return deepFreeze({
    request: action.request,
    receipt,
    blocking: false as const,
  });
}
