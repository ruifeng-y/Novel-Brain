import { canonicalJson } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";
import type { DomainId } from "../../shared/domain/ids";
import {
  createSourceReference,
  type ImmutableTimestamp,
  type SourceReference,
} from "../../shared/domain/observationSource";
import {
  branchNarrativeProposal,
  compareNarrativeProposals,
  narrativeProposalSourceReference,
  proposalSectionInput,
  reviseNarrativeProposal,
  type NarrativeProposal,
  type NarrativeProposalComparison,
  type NarrativeProposalSectionInput,
  type ProposalOpenQuestionInput,
} from "../domain/narrativeProposal";
import {
  buildProposalWorkflowView,
  compareProposalWorkflowViews,
  proposalWorkflowTransition,
  type ProposalWorkflowPosition,
  type ProposalWorkflowStage,
  type ProposalWorkflowTransition,
  type ProposalWorkflowView,
  type ProposalWorkflowViewComparison,
} from "../domain/proposalWorkflow";
import type { NarrativeProposalPersistence } from "./narrativeProposalPersistence";
import {
  loadNarrativeProposal,
  saveNarrativeProposalRevision,
} from "./narrativeProposalService";

export type ProposalWorkflowActor = "author" | "ai" | "system";

export type ProposalWorkflowChange =
  | {
      readonly kind: "add_section";
      readonly section: NarrativeProposalSectionInput;
    }
  | {
      readonly kind: "update_section";
      readonly sectionId: DomainId;
      readonly content: Readonly<Record<string, unknown>>;
      readonly evidenceReferences?: readonly SourceReference[];
    }
  | {
      readonly kind: "remove_section";
      readonly sectionId: DomainId;
    }
  | {
      readonly kind: "add_open_question";
      readonly question: ProposalOpenQuestionInput;
    }
  | {
      readonly kind: "resolve_open_question";
      readonly questionId: DomainId;
      readonly resolutionReference: SourceReference;
    }
  | {
      readonly kind: "dismiss_open_question";
      readonly questionId: DomainId;
    };

export interface ApplyProposalWorkflowStepInput {
  readonly persistence: NarrativeProposalPersistence;
  readonly position: ProposalWorkflowPosition;
  readonly toStage: ProposalWorkflowStage;
  readonly actor: ProposalWorkflowActor;
  readonly evidence: SourceReference;
  readonly changes: readonly ProposalWorkflowChange[];
  readonly revisedAt: Date | ImmutableTimestamp;
}

export interface ProposalWorkflowStepResult {
  readonly transition: ProposalWorkflowTransition;
  readonly position: ProposalWorkflowPosition;
  readonly previousProposal: NarrativeProposal;
  readonly proposal: NarrativeProposal;
  readonly comparison: NarrativeProposalComparison;
  readonly view: ProposalWorkflowView;
}

export interface QueryProposalWorkflowInput {
  readonly persistence: NarrativeProposalPersistence;
  readonly position: ProposalWorkflowPosition;
}

export interface BranchProposalWorkflowInput {
  readonly persistence: NarrativeProposalPersistence;
  readonly sourcePosition: ProposalWorkflowPosition;
  readonly branchProposalId: DomainId;
  readonly occurredAt: Date | ImmutableTimestamp;
  readonly stage?: ProposalWorkflowStage;
  readonly novelId?: DomainId;
  readonly scope?: Readonly<Record<string, unknown>>;
}

export interface ProposalWorkflowBranchResult {
  readonly sourceProposal: NarrativeProposal;
  readonly proposal: NarrativeProposal;
  readonly proposalReference: SourceReference;
  readonly position: ProposalWorkflowPosition;
  readonly view: ProposalWorkflowView;
}

export interface CompareProposalWorkflowsInput {
  readonly persistence: NarrativeProposalPersistence;
  readonly left: ProposalWorkflowPosition;
  readonly right: ProposalWorkflowPosition;
}

export interface ProposalWorkflowComparisonResult {
  readonly left: ProposalWorkflowView;
  readonly right: ProposalWorkflowView;
  readonly comparison: ProposalWorkflowViewComparison;
}

function evidenceReferences(
  existing: readonly SourceReference[],
  extra: readonly SourceReference[] | undefined,
  stepEvidence: SourceReference,
): readonly SourceReference[] {
  return [
    ...existing.map((entry) => createSourceReference(entry)),
    ...(extra ?? []).map((entry) => createSourceReference(entry)),
    createSourceReference(stepEvidence),
  ];
}

function questionProvenance(
  input: ProposalOpenQuestionInput,
  stepEvidence: SourceReference,
): ProposalOpenQuestionInput {
  return {
    ...input,
    provenance: {
      ...input.provenance,
      evidenceReferences: evidenceReferences(
        input.provenance.evidenceReferences,
        undefined,
        stepEvidence,
      ),
    },
  };
}

function sectionInputWithEvidence(
  input: NarrativeProposalSectionInput,
  extra: readonly SourceReference[] | undefined,
  stepEvidence: SourceReference,
): NarrativeProposalSectionInput {
  return {
    ...input,
    provenance: {
      ...input.provenance,
      evidenceReferences: evidenceReferences(
        input.provenance.evidenceReferences,
        extra,
        stepEvidence,
      ),
    },
  };
}

function updateSections(
  previous: readonly NarrativeProposalSectionInput[],
  change: Extract<ProposalWorkflowChange, { kind: "update_section" }>,
  stepEvidence: SourceReference,
): readonly NarrativeProposalSectionInput[] {
  let found = false;
  const next = previous.map((entry) => {
    if (entry.id !== change.sectionId) return entry;
    found = true;
    return sectionInputWithEvidence(
      {
        ...entry,
        content: { ...change.content },
      },
      change.evidenceReferences,
      stepEvidence,
    );
  });
  if (!found) throw new Error(`Proposal Workflow section not found: ${change.sectionId}`);
  return next;
}

function updateQuestion(
  previous: readonly ProposalOpenQuestionInput[],
  change: Extract<
    ProposalWorkflowChange,
    { kind: "resolve_open_question" } | { kind: "dismiss_open_question" }
  >,
  actor: ProposalWorkflowActor,
  stepEvidence: SourceReference,
): readonly ProposalOpenQuestionInput[] {
  if (actor !== "author") {
    throw new Error("Only an author can resolve or dismiss a Proposal Open Question");
  }
  let found = false;
  const next = previous.map((entry) => {
    if (entry.id !== change.questionId) return entry;
    found = true;
    const provenance = {
      ...entry.provenance,
      evidenceReferences: evidenceReferences(
        entry.provenance.evidenceReferences,
        undefined,
        stepEvidence,
      ),
    };
    if (change.kind === "resolve_open_question") {
      return {
        ...entry,
        state: "resolved" as const,
        resolutionReference: createSourceReference(change.resolutionReference),
        provenance,
      };
    }
    const { resolutionReference: _staleResolution, ...withoutResolution } = entry;
    return {
      ...withoutResolution,
      state: "dismissed" as const,
      provenance,
    };
  });
  if (!found) throw new Error(`Proposal Workflow Open Question not found: ${change.questionId}`);
  return next;
}

function revisionTrigger(
  input: {
    readonly previousSections: readonly NarrativeProposalSectionInput[];
    readonly sections: readonly NarrativeProposalSectionInput[];
    readonly previousQuestions: readonly ProposalOpenQuestionInput[];
    readonly questions: readonly ProposalOpenQuestionInput[];
  },
): "content_change" | "section_add" | "section_remove" | "open_question_state_change" {
  const previousSectionIds = new Set(input.previousSections.map((entry) => entry.id));
  const nextSectionIds = new Set(input.sections.map((entry) => entry.id));
  const added = input.sections.some((entry) => !previousSectionIds.has(entry.id));
  const removed = input.previousSections.some((entry) => !nextSectionIds.has(entry.id));
  const updated = input.sections.some((entry) => {
    const previous = input.previousSections.find((candidate) => candidate.id === entry.id);
    return previous !== undefined && canonicalJson(previous) !== canonicalJson(entry);
  });
  const previousQuestionIds = new Set(input.previousQuestions.map((entry) => entry.id));
  const nextQuestionIds = new Set(input.questions.map((entry) => entry.id));
  const questionsChanged =
    input.previousQuestions.length !== input.questions.length ||
    input.questions.some((entry) => {
      const previous = input.previousQuestions.find((candidate) => candidate.id === entry.id);
      return previous === undefined || canonicalJson(previous) !== canonicalJson(entry);
    }) ||
    input.previousQuestions.some((entry) => !nextQuestionIds.has(entry.id));

  const categories = [
    added || removed || updated,
    questionsChanged,
  ].filter(Boolean).length;
  if (categories !== 1) {
    throw new Error("Proposal Workflow step must contain one semantic change category");
  }
  if (questionsChanged) return "open_question_state_change";
  if (added && !removed) return "section_add";
  if (removed && !added) return "section_remove";
  return "content_change";
}

async function proposalAt(
  persistence: NarrativeProposalPersistence,
  position: ProposalWorkflowPosition,
): Promise<NarrativeProposal> {
  const proposal = await persistence.proposals.getRevision(
    position.proposalId,
    position.revisionId,
  );
  if (!proposal) throw new Error(`Proposal Revision not found: ${position.proposalId}:${position.revisionId}`);
  if (
    proposal.id !== position.proposalId ||
    proposal.currentRevisionId !== position.revisionId
  ) {
    throw new Error("Proposal Workflow position revision mismatch");
  }
  return proposal;
}

export function openProposalWorkflow(
  proposal: NarrativeProposal,
  stage: ProposalWorkflowStage = "frame",
): ProposalWorkflowPosition {
  proposalWorkflowTransition(stage, stage);
  return deepFreeze({
    proposalId: proposal.id,
    revisionId: proposal.currentRevisionId,
    stage,
  });
}

export async function queryProposalWorkflow(
  input: QueryProposalWorkflowInput,
): Promise<ProposalWorkflowView> {
  const proposal = await proposalAt(input.persistence, input.position);
  return buildProposalWorkflowView({ proposal, position: input.position });
}

export async function applyProposalWorkflowStep(
  input: ApplyProposalWorkflowStepInput,
): Promise<ProposalWorkflowStepResult> {
  const transition = proposalWorkflowTransition(input.position.stage, input.toStage);
  const previous = await loadNarrativeProposal(input.persistence, input.position.proposalId);
  if (previous.currentRevisionId !== input.position.revisionId) {
    throw new Error("Proposal Workflow position revision mismatch");
  }
  if (input.changes.length === 0) {
    throw new Error("Proposal Workflow step requires a semantic change");
  }

  let sections: NarrativeProposalSectionInput[] = previous.sections.map(proposalSectionInput);
  let questions: ProposalOpenQuestionInput[] = previous.openQuestions.map((entry) => ({ ...entry }));
  for (const change of input.changes) {
    if (change.kind === "add_section") {
      if (sections.some((entry) => entry.id === change.section.id)) {
        throw new Error(`Proposal Workflow section already exists: ${change.section.id}`);
      }
      sections = [
        ...sections,
        sectionInputWithEvidence(change.section, undefined, input.evidence),
      ];
    } else if (change.kind === "update_section") {
      sections = [...updateSections(sections, change, input.evidence)];
    } else if (change.kind === "remove_section") {
      if (!sections.some((entry) => entry.id === change.sectionId)) {
        throw new Error(`Proposal Workflow section not found: ${change.sectionId}`);
      }
      sections = sections.filter((entry) => entry.id !== change.sectionId);
    } else if (change.kind === "add_open_question") {
      if (questions.some((entry) => entry.id === change.question.id)) {
        throw new Error(`Proposal Workflow Open Question already exists: ${change.question.id}`);
      }
      if (change.question.state !== "open" && input.actor !== "author") {
        throw new Error("Only an author can resolve or dismiss a Proposal Open Question");
      }
      questions = [...questions, questionProvenance(change.question, input.evidence)];
    } else {
      questions = [...updateQuestion(questions, change, input.actor, input.evidence)];
    }
  }

  const trigger = revisionTrigger({
    previousSections: previous.sections.map(proposalSectionInput),
    sections,
    previousQuestions: previous.openQuestions.map((entry) => ({ ...entry })),
    questions,
  });
  const revised = reviseNarrativeProposal({
    proposal: previous,
    sections,
    openQuestions: questions,
    trigger,
    revisedAt: input.revisedAt,
  });
  const existing = await input.persistence.proposals.getRevision(
    revised.id,
    revised.currentRevisionId,
  );
  const saved = existing && canonicalJson(existing) === canonicalJson(revised)
    ? existing
    : await saveNarrativeProposalRevision(input.persistence, revised, previous);
  const position = deepFreeze({
    proposalId: saved.id,
    revisionId: saved.currentRevisionId,
    stage: input.toStage,
  });
  return deepFreeze({
    transition,
    position,
    previousProposal: previous,
    proposal: saved,
    comparison: compareNarrativeProposals(previous, saved),
    view: buildProposalWorkflowView({ proposal: saved, position }),
  });
}

export async function branchProposalWorkflow(
  input: BranchProposalWorkflowInput,
): Promise<ProposalWorkflowBranchResult> {
  if (input.sourcePosition.proposalId === input.branchProposalId) {
    throw new Error("Proposal Workflow branch identity must differ from its source");
  }
  const sourceProposal = await proposalAt(input.persistence, input.sourcePosition);
  const branched = branchNarrativeProposal({
    sourceProposal,
    id: input.branchProposalId,
    createdAt: input.occurredAt,
    ...(input.novelId === undefined ? {} : { novelId: input.novelId }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
  });
  const existing = await input.persistence.proposals.getRevision(
    branched.id,
    branched.currentRevisionId,
  );
  const saved = existing && canonicalJson(existing) === canonicalJson(branched)
    ? existing
    : await saveNarrativeProposalRevision(input.persistence, branched);
  const position = openProposalWorkflow(saved, input.stage ?? "frame");
  return deepFreeze({
    sourceProposal,
    proposal: saved,
    proposalReference: narrativeProposalSourceReference(saved),
    position,
    view: buildProposalWorkflowView({ proposal: saved, position }),
  });
}

export async function compareProposalWorkflows(
  input: CompareProposalWorkflowsInput,
): Promise<ProposalWorkflowComparisonResult> {
  const [left, right] = await Promise.all([
    queryProposalWorkflow({ persistence: input.persistence, position: input.left }),
    queryProposalWorkflow({ persistence: input.persistence, position: input.right }),
  ]);
  return deepFreeze({
    left,
    right,
    comparison: compareProposalWorkflowViews(left, right),
  });
}
