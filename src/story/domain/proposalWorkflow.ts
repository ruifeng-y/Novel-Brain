import { canonicalJson } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";
import type { DomainId, RevisionId } from "../../shared/domain/ids";
import type { SourceReference } from "../../shared/domain/observationSource";
import {
  proposalAdoptionSummary,
  type NarrativeProposal,
  type ProposalAdoptionSummary,
  type ProposalSectionHash,
  type ProposalOpenQuestionScope,
  type ProposalSectionAdoptionDisposition,
} from "./narrativeProposal";

export type ProposalWorkflowStage = "frame" | "explore" | "deepen" | "refine";
export type ProposalWorkflowTransitionKind = "start" | "advance" | "revisit" | "repeat";

export interface ProposalWorkflowTransition {
  readonly from: ProposalWorkflowStage | undefined;
  readonly to: ProposalWorkflowStage;
  readonly kind: ProposalWorkflowTransitionKind;
}

export interface ProposalWorkflowPosition {
  readonly proposalId: DomainId;
  readonly revisionId: RevisionId;
  readonly stage: ProposalWorkflowStage;
}

export type ProposalWorkflowDecisionSpaceSignal =
  | "already_decided"
  | "ai_suggested"
  | "author_preference"
  | "open_question"
  | "undecided";

export interface ProposalWorkflowSectionView {
  readonly sectionId: DomainId;
  readonly adoptionDisposition: ProposalSectionAdoptionDisposition;
  readonly signals: readonly ProposalWorkflowDecisionSpaceSignal[];
  readonly openQuestionIds: readonly DomainId[];
}

export interface ProposalWorkflowOpenQuestionView {
  readonly id: DomainId;
  readonly text: string;
  readonly scope: ProposalOpenQuestionScope;
  readonly state: "open" | "resolved" | "dismissed";
  readonly resolutionReference?: SourceReference;
}

export interface ProposalWorkflowDecisionSpace {
  readonly alreadyDecidedSectionIds: readonly DomainId[];
  readonly aiSuggestedSectionIds: readonly DomainId[];
  readonly authorPreferenceSectionIds: readonly DomainId[];
  readonly undecidedSectionIds: readonly DomainId[];
  readonly openQuestionIds: readonly DomainId[];
}

export interface ProposalWorkflowPartialAdoption {
  readonly supported: true;
  readonly unit: "section";
  readonly selectableSectionIds: readonly DomainId[];
  readonly summary: ProposalAdoptionSummary;
}

export interface ProposalWorkflowView {
  readonly position: ProposalWorkflowPosition;
  readonly proposalReference: SourceReference;
  readonly revisionNumber: number;
  readonly revisionHash: string;
  readonly sectionWork: readonly ProposalWorkflowSectionView[];
  readonly sectionHashes: readonly ProposalSectionHash[];
  readonly decisionSpace: ProposalWorkflowDecisionSpace;
  readonly openQuestions: readonly ProposalWorkflowOpenQuestionView[];
  readonly partialAdoption: ProposalWorkflowPartialAdoption;
}

export interface ProposalWorkflowViewComparison {
  readonly addedSectionIds: readonly DomainId[];
  readonly removedSectionIds: readonly DomainId[];
  readonly changedSectionIds: readonly DomainId[];
  readonly unchangedSectionIds: readonly DomainId[];
  readonly preservedUndecidedSectionIds: readonly DomainId[];
  readonly preservedOpenQuestionIds: readonly DomainId[];
  readonly addedOpenQuestionIds: readonly DomainId[];
  readonly removedOpenQuestionIds: readonly DomainId[];
  readonly changedOpenQuestionIds: readonly DomainId[];
}

const stageOrder: readonly ProposalWorkflowStage[] = ["frame", "explore", "deepen", "refine"];

function sorted(values: Iterable<DomainId>): readonly DomainId[] {
  return [...new Set(values)].sort();
}

export function proposalWorkflowTransition(
  from: ProposalWorkflowStage | undefined,
  to: ProposalWorkflowStage,
): ProposalWorkflowTransition {
  if (!stageOrder.includes(to)) throw new Error(`unknown Proposal Workflow stage: ${to}`);
  if (from === undefined) {
    if (to !== "frame") throw new Error("Proposal Workflow must start at Frame");
    return deepFreeze({ from, to, kind: "start" });
  }
  if (!stageOrder.includes(from)) throw new Error(`unknown Proposal Workflow stage: ${from}`);
  const kind = from === to
    ? "repeat"
    : stageOrder.indexOf(to) > stageOrder.indexOf(from)
      ? "advance"
      : "revisit";
  return deepFreeze({ from, to, kind });
}

export function buildProposalWorkflowView(input: {
  readonly proposal: NarrativeProposal;
  readonly position: ProposalWorkflowPosition;
}): ProposalWorkflowView {
  const { proposal, position } = input;
  if (position.proposalId !== proposal.id) {
    throw new Error("Proposal Workflow position proposal identity mismatch");
  }
  if (position.revisionId !== proposal.currentRevisionId) {
    throw new Error("Proposal Workflow position revision mismatch");
  }

  const questionIdsBySection = new Map<DomainId, DomainId[]>();
  const openQuestions = proposal.openQuestions.map((entry) => {
    if (entry.scope.kind === "section" && entry.state === "open") {
      const ids = questionIdsBySection.get(entry.scope.sectionId) ?? [];
      ids.push(entry.id);
      questionIdsBySection.set(entry.scope.sectionId, ids);
    }
    return deepFreeze({
      id: entry.id,
      text: entry.text,
      scope: entry.scope,
      state: entry.state,
      ...(entry.resolutionReference ? { resolutionReference: entry.resolutionReference } : {}),
    });
  });

  const sectionWork = proposal.sections.map((entry) => {
    const signals: ProposalWorkflowDecisionSpaceSignal[] = [];
    if (entry.adoptionDisposition !== "pending") signals.push("already_decided");
    if (entry.provenance.origin.type === "ai_generated") signals.push("ai_suggested");
    if (entry.provenance.origin.type === "author_created") signals.push("author_preference");
    const sectionQuestionIds = sorted(questionIdsBySection.get(entry.id) ?? []);
    if (sectionQuestionIds.length > 0) signals.push("open_question");
    if (entry.adoptionDisposition === "pending") signals.push("undecided");
    return deepFreeze({
      sectionId: entry.id,
      adoptionDisposition: entry.adoptionDisposition,
      signals,
      openQuestionIds: sectionQuestionIds,
    });
  });

  const summary = proposalAdoptionSummary(proposal);
  return deepFreeze({
    position,
    proposalReference: {
      identity: proposal.id,
      version: proposal.currentRevisionId,
      hash: proposal.revisionHash,
    },
    revisionNumber: proposal.revisionNumber,
    revisionHash: proposal.revisionHash,
    sectionWork,
    sectionHashes: proposal.sectionHashes,
    decisionSpace: {
      alreadyDecidedSectionIds: sorted(
        proposal.sections.filter((entry) => entry.adoptionDisposition !== "pending").map((entry) => entry.id),
      ),
      aiSuggestedSectionIds: sorted(
        proposal.sections.filter((entry) => entry.provenance.origin.type === "ai_generated").map((entry) => entry.id),
      ),
      authorPreferenceSectionIds: sorted(
        proposal.sections.filter((entry) => entry.provenance.origin.type === "author_created").map((entry) => entry.id),
      ),
      undecidedSectionIds: summary.undecidedSectionIds,
      openQuestionIds: sorted(
        proposal.openQuestions.filter((entry) => entry.state === "open").map((entry) => entry.id),
      ),
    },
    openQuestions,
    partialAdoption: {
      supported: true,
      unit: "section",
      selectableSectionIds: sorted(proposal.sections.map((entry) => entry.id)),
      summary,
    },
  });
}

export function compareProposalWorkflowViews(
  left: ProposalWorkflowView,
  right: ProposalWorkflowView,
): ProposalWorkflowViewComparison {
  const leftHashes = new Map(left.sectionHashes.map((entry) => [entry.sectionId, entry.hash]));
  const rightHashes = new Map(right.sectionHashes.map((entry) => [entry.sectionId, entry.hash]));
  const rightUndecided = new Set(right.decisionSpace.undecidedSectionIds);
  const leftQuestions = new Map(left.openQuestions.map((entry) => [entry.id, entry]));
  const rightQuestions = new Map(right.openQuestions.map((entry) => [entry.id, entry]));
  return deepFreeze({
    addedSectionIds: sorted([...rightHashes.keys()].filter((id) => !leftHashes.has(id))),
    removedSectionIds: sorted([...leftHashes.keys()].filter((id) => !rightHashes.has(id))),
    changedSectionIds: sorted(
      [...leftHashes.entries()]
        .filter(([id, hash]) => rightHashes.has(id) && rightHashes.get(id) !== hash)
        .map(([id]) => id),
    ),
    unchangedSectionIds: sorted(
      [...leftHashes.entries()]
        .filter(([id, hash]) => rightHashes.has(id) && rightHashes.get(id) === hash)
        .map(([id]) => id),
    ),
    preservedUndecidedSectionIds: sorted(
      left.decisionSpace.undecidedSectionIds.filter((id) => rightUndecided.has(id)),
    ),
    preservedOpenQuestionIds: sorted(
      [...leftQuestions.entries()]
        .filter(([id, entry]) => rightQuestions.has(id) && canonicalJson(rightQuestions.get(id)) === canonicalJson(entry))
        .map(([id]) => id),
    ),
    addedOpenQuestionIds: sorted([...rightQuestions.keys()].filter((id) => !leftQuestions.has(id))),
    removedOpenQuestionIds: sorted([...leftQuestions.keys()].filter((id) => !rightQuestions.has(id))),
    changedOpenQuestionIds: sorted(
      [...leftQuestions.entries()]
        .filter(([id, entry]) => rightQuestions.has(id) && canonicalJson(rightQuestions.get(id)) !== canonicalJson(entry))
        .map(([id]) => id),
    ),
  });
}
