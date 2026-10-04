import { type SourceReference } from "../../shared/domain/observationSource";
import {
  createObservation,
  createSourceReference,
  type Observation,
} from "../../shared/domain/observationSource";
import { deepFreeze } from "../../shared/domain/immutable";
import type { VersionSet } from "../../shared/domain/versioning";
import type { ModelPolicy } from "../../production/runtime/runtimeAdapter";
import type {
  RuntimeAdapter,
  RuntimeRequest,
  RuntimeResult,
} from "../../production/runtime/runtimeAdapter";
import {
  assertRuntimeRequestResultMatch,
  runtimeRequestSourceReference,
  runtimeResultSourceReference,
} from "../../production/domain/executionAttempt";
import {
  createNarrativeProposal,
  narrativeProposalSourceReference,
  type NarrativeProposal,
  type NarrativeProposalSectionInput,
  type NarrativeProposalType,
  type ProposalOpenQuestionInput,
  type ProposalOpenQuestionScope,
  type ProposalScope,
  type ProposalSectionProvenance,
} from "../domain/narrativeProposal";
import type { NarrativeProposalPersistence } from "./narrativeProposalPersistence";
import { saveNarrativeProposalRevision } from "./narrativeProposalService";

export type FoundationEntryMode = "idea" | "existing_text" | "blank";

export type FoundationEntrySource =
  | {
      readonly kind: "idea";
      readonly text: string;
      readonly sourceReference: SourceReference;
    }
  | {
      readonly kind: "existing_text";
      readonly text: string;
      readonly sourceReference: SourceReference;
    }
  | {
      readonly kind: "blank";
      readonly sourceReference: SourceReference;
    };

export interface FoundationGenerationOptions {
  readonly taskId: string;
  readonly agentRole: RuntimeRequest["agentRole"];
  readonly modelPolicy: ModelPolicy;
  readonly basedOnVersionSet: VersionSet;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface FoundationEntryInput {
  readonly entryId: string;
  readonly novelId: string;
  readonly proposalId?: string;
  readonly mode: FoundationEntryMode;
  readonly proposalType: NarrativeProposalType;
  readonly scope: ProposalScope;
  readonly source: FoundationEntrySource;
  readonly occurredAt: Date;
  readonly persistence: NarrativeProposalPersistence;
  readonly runtime?: RuntimeAdapter;
  readonly generation?: FoundationGenerationOptions;
}

export interface FoundationRuntimeEvidence {
  readonly requestReference: SourceReference;
  readonly request: RuntimeRequest;
  readonly resultReference: SourceReference;
  readonly result: RuntimeResult & { readonly requestReference: SourceReference };
}

export interface FoundationEntryProvenance {
  readonly inputReference: SourceReference;
  readonly runtimeEvidence?: Observation<FoundationRuntimeEvidence>;
  readonly derivationReference?: SourceReference;
}

export type FoundationEntryStatus =
  | "skipped"
  | "proposal_created"
  | "empty_narrative_state";

export interface FoundationEntrySession {
  readonly entryId: string;
  readonly novelId: string;
  readonly mode: FoundationEntryMode;
  readonly proposalType: NarrativeProposalType;
  readonly scope: ProposalScope;
  readonly source: FoundationEntrySource;
  readonly provenance: FoundationEntryProvenance;
  readonly status: FoundationEntryStatus;
}

export interface EmptyNarrativeStateEntry {
  readonly kind: "empty_narrative_state";
  readonly novelId: string;
  readonly sourceReference: SourceReference;
}

export interface FoundationProposalResult {
  readonly status: "proposal_created";
  readonly session: FoundationEntrySession;
  readonly proposal: NarrativeProposal;
  readonly proposalReference: SourceReference;
}

export interface FoundationEmptyNarrativeStateResult {
  readonly status: "empty_narrative_state";
  readonly session: FoundationEntrySession;
  readonly emptyNarrativeState: EmptyNarrativeStateEntry;
}

export interface FoundationSkippedResult {
  readonly status: "skipped";
  readonly session: FoundationEntrySession;
}

export type FoundationEntryResult =
  | FoundationProposalResult
  | FoundationEmptyNarrativeStateResult
  | FoundationSkippedResult;

export interface ReenterFoundationEntryInput {
  readonly session: FoundationEntrySession;
  readonly proposalId?: string;
  readonly occurredAt: Date;
  readonly persistence: NarrativeProposalPersistence;
  readonly runtime?: RuntimeAdapter;
  readonly generation?: FoundationGenerationOptions;
}

interface FoundationProposalDraft {
  readonly sections: readonly {
    readonly id: string;
    readonly content: Readonly<Record<string, unknown>>;
  }[];
  readonly openQuestions: readonly {
    readonly id: string;
    readonly text: string;
    readonly scope: ProposalOpenQuestionScope;
  }[];
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function assertModeMatchesSource(mode: FoundationEntryMode, source: FoundationEntrySource): void {
  const expected = mode === "idea" ? "idea" : mode === "existing_text" ? "existing_text" : "blank";
  if (source.kind !== expected) {
    throw new Error("Foundation entry source must match entry mode");
  }
}

function assertCommonInput(input: Pick<
  FoundationEntryInput,
  "entryId" | "novelId" | "proposalId" | "mode" | "source"
>): SourceReference {
  required(input.entryId, "entryId");
  required(input.novelId, "novelId");
  if (input.proposalId !== undefined) required(input.proposalId, "proposalId");
  assertModeMatchesSource(input.mode, input.source);
  return createSourceReference(input.source.sourceReference);
}

function parseDraft(value: unknown): FoundationProposalDraft {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Foundation runtime design content must be an object");
  }
  const content = value as Record<string, unknown>;
  if (!Array.isArray(content.sections)) {
    throw new Error("Foundation runtime design content requires sections");
  }
  const sections = content.sections.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Foundation runtime section must be an object");
    }
    const section = entry as Record<string, unknown>;
    required(typeof section.id === "string" ? section.id : undefined, "Foundation runtime section id");
    if (
      section.content === null ||
      typeof section.content !== "object" ||
      Array.isArray(section.content)
    ) {
      throw new Error("Foundation runtime section content must be an object");
    }
    return {
      id: section.id as string,
      content: { ...(section.content as Record<string, unknown>) },
    };
  });
  const rawQuestions = content.openQuestions ?? [];
  if (!Array.isArray(rawQuestions)) {
    throw new Error("Foundation runtime openQuestions must be an array");
  }
  const openQuestions = rawQuestions.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Foundation runtime open question must be an object");
    }
    const question = entry as Record<string, unknown>;
    required(
      typeof question.id === "string" ? question.id : undefined,
      "Foundation runtime open question id",
    );
    required(
      typeof question.text === "string" ? question.text : undefined,
      "Foundation runtime open question text",
    );
    if (
      question.scope === null ||
      typeof question.scope !== "object" ||
      Array.isArray(question.scope)
    ) {
      throw new Error("Foundation runtime open question scope must be an object");
    }
    return {
      id: question.id as string,
      text: question.text as string,
      scope: { ...(question.scope as ProposalOpenQuestionScope) },
    };
  });
  return { sections, openQuestions };
}

function assertStateIdentityMatches(
  request: RuntimeRequest,
  result: RuntimeResult,
): void {
  if (
    request.requestedChange.type !== "structured_state" ||
    result.change.type !== "structured_state" ||
    request.requestedChange.stateRecordId !== result.change.stateRecordId
  ) {
    throw new Error("Foundation runtime state identity must match request");
  }
}

function createRuntimeEvidence(
  entryId: string,
  request: RuntimeRequest,
  result: RuntimeResult,
  occurredAt: Date,
): Observation<FoundationRuntimeEvidence> {
  assertRuntimeRequestResultMatch(request, result);
  assertStateIdentityMatches(request, result);
  const requestReference = runtimeRequestSourceReference(entryId, request);
  const resultReference = runtimeResultSourceReference(
    entryId,
    result,
    occurredAt,
    requestReference,
  );
  return createObservation<FoundationRuntimeEvidence>({
    evidenceReference: `${entryId}:foundation-runtime`,
    sourceReference: resultReference,
    ordinal: 1,
    data: {
      requestReference,
      request,
      resultReference,
      result: { ...result, requestReference },
    },
  });
}

function originType(mode: FoundationEntryMode): ProposalSectionProvenance["origin"]["type"] {
  return mode === "idea"
    ? "ai_generated"
    : mode === "existing_text"
      ? "extracted_from_text"
      : "author_created";
}

function proposalProvenance(
  mode: FoundationEntryMode,
  provenance: FoundationEntryProvenance,
): ProposalSectionProvenance {
  const runtime = provenance.runtimeEvidence?.data;
  const references: SourceReference[] = [provenance.inputReference];
  const evidenceReferences: SourceReference[] = [provenance.inputReference];
  if (runtime) {
    references.push(runtime.requestReference, runtime.resultReference);
    evidenceReferences.push(runtime.requestReference, runtime.resultReference);
  }
  return deepFreeze({
    origin: { type: originType(mode), references },
    editLineage: runtime ? [runtime.resultReference] : [],
    evidenceReferences,
    adoptionDecisionReferences: [],
  });
}

function makeSession(
  input: Pick<
    FoundationEntryInput,
    "entryId" | "novelId" | "mode" | "proposalType" | "scope" | "source"
  >,
  provenance: FoundationEntryProvenance,
  status: FoundationEntryStatus,
): FoundationEntrySession {
  return deepFreeze({
    entryId: input.entryId,
    novelId: input.novelId,
    mode: input.mode,
    proposalType: input.proposalType,
    scope: { ...input.scope },
    source: input.source,
    provenance,
    status,
  });
}

function assertProposalGenerationOptions(
  input: FoundationEntryInput,
): asserts input is FoundationEntryInput & {
  runtime: RuntimeAdapter;
  generation: FoundationGenerationOptions;
  proposalId: string;
} {
  if (!input.runtime) throw new Error("runtime is required for Idea and Existing Text entry");
  if (!input.generation) {
    throw new Error("generation is required for Idea and Existing Text entry");
  }
  required(input.proposalId, "proposalId");
  required(input.generation.taskId, "generation.taskId");
  if (Object.keys(input.generation.basedOnVersionSet).length === 0) {
    throw new Error("generation.basedOnVersionSet must contain at least one dependency");
  }
}

async function createEntry(
  input: FoundationEntryInput,
  inputReference: SourceReference,
): Promise<FoundationEntryResult> {
  if (input.mode === "blank") {
    const provenance: FoundationEntryProvenance = { inputReference };
    return deepFreeze({
      status: "empty_narrative_state",
      session: makeSession(input, provenance, "empty_narrative_state"),
      emptyNarrativeState: {
        kind: "empty_narrative_state",
        novelId: input.novelId,
        sourceReference: inputReference,
      },
    });
  }

  assertProposalGenerationOptions(input);
  const generation = input.generation;
  const sourceText = input.source.kind === "blank" ? "" : input.source.text;
  const request: RuntimeRequest = {
    taskId: generation.taskId,
    agentRole: generation.agentRole,
    modelPolicy: generation.modelPolicy,
    basedOnVersionSet: generation.basedOnVersionSet,
    context: {
      ...generation.context,
      operation: input.mode === "idea" ? "generate" : "extract",
      sourceKind: input.source.kind,
      sourceText,
      proposalType: input.proposalType,
      scope: input.scope,
    },
    requestedChange: {
      type: "structured_state",
      stateRecordId: input.entryId,
      content: {
        kind: "foundation_design_request",
        entryMode: input.mode,
        sourceText,
        proposalType: input.proposalType,
        scope: input.scope,
      },
    },
  };
  const result = await input.runtime.execute(request);
  const runtimeEvidence = createRuntimeEvidence(
    input.entryId,
    request,
    result,
    input.occurredAt,
  );
  if (result.change.type !== "structured_state") {
    throw new Error("Foundation runtime must return structured_state design content");
  }
  const draft = parseDraft(result.change.content);
  const provenance: FoundationEntryProvenance = {
    inputReference,
    runtimeEvidence,
    derivationReference: runtimeEvidence.data.resultReference,
  };
  const sectionProvenance = proposalProvenance(input.mode, provenance);
  const sections: NarrativeProposalSectionInput[] = draft.sections.map((entry) => ({
    id: entry.id,
    content: entry.content,
    provenance: sectionProvenance,
  }));
  const openQuestions: ProposalOpenQuestionInput[] = draft.openQuestions.map((entry) => ({
    id: entry.id,
    text: entry.text,
    scope: entry.scope,
    state: "open",
    provenance: sectionProvenance,
  }));
  const proposal = createNarrativeProposal({
    id: input.proposalId,
    novelId: input.novelId,
    proposalType: input.proposalType,
    scope: input.scope,
    sections,
    openQuestions,
    createdAt: input.occurredAt,
  });
  const saved = await saveNarrativeProposalRevision(input.persistence, proposal);
  return deepFreeze({
    status: "proposal_created",
    session: makeSession(input, provenance, "proposal_created"),
    proposal: saved,
    proposalReference: narrativeProposalSourceReference(saved),
  });
}

export async function enterFoundation(input: FoundationEntryInput): Promise<FoundationEntryResult> {
  const inputReference = assertCommonInput(input);
  return createEntry(input, inputReference);
}

export function skipFoundationEntry(input: FoundationEntryInput): FoundationSkippedResult {
  const inputReference = assertCommonInput(input);
  return deepFreeze({
    status: "skipped",
    session: makeSession(input, { inputReference }, "skipped"),
  });
}

export async function reenterFoundationEntry(
  input: ReenterFoundationEntryInput,
): Promise<FoundationEntryResult> {
  assertModeMatchesSource(input.session.mode, input.session.source);
  return enterFoundation({
    entryId: input.session.entryId,
    novelId: input.session.novelId,
    ...(input.proposalId === undefined ? {} : { proposalId: input.proposalId }),
    mode: input.session.mode,
    proposalType: input.session.proposalType,
    scope: input.session.scope,
    source: input.session.source,
    occurredAt: input.occurredAt,
    persistence: input.persistence,
    ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
    ...(input.generation === undefined ? {} : { generation: input.generation }),
  });
}
