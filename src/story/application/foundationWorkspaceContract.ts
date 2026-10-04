import type { TargetType } from "../../production/domain/change";
import type { DomainId } from "../../shared/domain/ids";
import { deepFreeze } from "../../shared/domain/immutable";
import type { SourceReference } from "../../shared/domain/observationSource";
import {
  adoptionDecisionSourceReference,
  createAdoptionChangeSetInputs,
  type AdoptionDecision,
  type ProposedChange,
} from "../domain/adoptionDecision";
import {
  narrativeProposalSourceReference,
  type NarrativeProposal,
  type ProposalOpenQuestion,
} from "../domain/narrativeProposal";
import type { NarrativeProposalPersistence } from "./narrativeProposalPersistence";

export type FoundationWorkspaceFocusObject =
  | "story-foundation"
  | "proposal"
  | TargetType;

export type FoundationWorkspaceMode = "design" | "review";

export interface FoundationWorkspaceFocus {
  readonly object: FoundationWorkspaceFocusObject;
  readonly objectId?: DomainId;
  readonly mode: FoundationWorkspaceMode;
  readonly taskId?: DomainId;
}

export interface FoundationWorkspaceOpenQuestion {
  readonly proposalId: DomainId;
  readonly proposalRevision: string;
  readonly question: ProposalOpenQuestion;
}

export type FoundationWorkspaceEvidenceKind =
  | "proposal"
  | "proposal-origin"
  | "proposal-edit"
  | "proposal-evidence"
  | "proposal-adoption"
  | "adoption-decision";

export interface FoundationWorkspaceEvidence {
  readonly kind: FoundationWorkspaceEvidenceKind;
  readonly proposalId: DomainId;
  readonly reference: SourceReference;
}

export interface FoundationWorkspaceNarrativeTruthBoundary {
  readonly owner: "shared-novel-engine";
  readonly foundationOwnsNarrativeTruth: false;
  readonly automaticCommit: false;
}

export interface FoundationWorkspaceView {
  readonly focus: FoundationWorkspaceFocus;
  readonly proposals: readonly NarrativeProposal[];
  readonly adoptedChanges: readonly ProposedChange[];
  readonly openQuestions: readonly FoundationWorkspaceOpenQuestion[];
  readonly evidence: readonly FoundationWorkspaceEvidence[];
  readonly narrativeTruth: FoundationWorkspaceNarrativeTruthBoundary;
}

export interface FoundationWorkspaceQueryInput {
  readonly novelId: DomainId;
  readonly focus: FoundationWorkspaceFocus;
}

export interface FoundationWorkspaceQueryContract {
  query(input: FoundationWorkspaceQueryInput): Promise<FoundationWorkspaceView>;
}

export interface FoundationWorkspaceApplicationContract
  extends FoundationWorkspaceQueryContract {
  readonly supportsPartialAdoption: true;
  readonly ownsNarrativeTruth: false;
}

export interface FoundationWorkspaceContractDependencies {
  readonly persistence: NarrativeProposalPersistence;
}

function referenceKey(reference: SourceReference): string {
  return `${reference.identity}:${reference.version}:${reference.hash}`;
}

function focusMatches(
  focus: FoundationWorkspaceFocus,
  proposal: NarrativeProposal,
  decisions: readonly AdoptionDecision[],
): boolean {
  if (focus.object === "story-foundation") return true;
  if (focus.object === "proposal") return focus.objectId === proposal.id;
  return decisions.some((decision) =>
    decision.proposalReference.identity === proposal.id &&
    createAdoptionChangeSetInputs(decision).changes.some(
      (change) =>
        change.targetAddress.targetType === focus.object &&
        (focus.objectId === undefined || change.targetAddress.objectId === focus.objectId),
    ),
  );
}

function evidenceFor(
  proposal: NarrativeProposal,
  decisions: readonly AdoptionDecision[],
): readonly FoundationWorkspaceEvidence[] {
  const evidence: FoundationWorkspaceEvidence[] = [
    {
      kind: "proposal",
      proposalId: proposal.id,
      reference: narrativeProposalSourceReference(proposal),
    },
  ];
  for (const section of proposal.sections) {
    for (const reference of section.provenance.origin.references) {
      evidence.push({ kind: "proposal-origin", proposalId: proposal.id, reference });
    }
    for (const reference of section.provenance.editLineage) {
      evidence.push({ kind: "proposal-edit", proposalId: proposal.id, reference });
    }
    for (const reference of section.provenance.evidenceReferences) {
      evidence.push({ kind: "proposal-evidence", proposalId: proposal.id, reference });
    }
    for (const reference of section.provenance.adoptionDecisionReferences) {
      evidence.push({ kind: "proposal-adoption", proposalId: proposal.id, reference });
    }
  }
  for (const decision of decisions) {
    evidence.push({
      kind: "adoption-decision",
      proposalId: proposal.id,
      reference: adoptionDecisionSourceReference(decision),
    });
    evidence.push({
      kind: "adoption-decision",
      proposalId: proposal.id,
      reference: decision.evidence.sourceReference,
    });
  }
  const seen = new Set<string>();
  return evidence.filter((entry) => {
    const key = referenceKey(entry.reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createFoundationWorkspaceContract(
  dependencies: FoundationWorkspaceContractDependencies,
): FoundationWorkspaceApplicationContract {
  return {
    supportsPartialAdoption: true,
    ownsNarrativeTruth: false,
    async query(input) {
      const proposals = (await dependencies.persistence.proposals.listByNovel(input.novelId))
        .filter((proposal) => input.focus.object !== "proposal" || input.focus.objectId === proposal.id);
      const allDecisions = await dependencies.persistence.decisions.listByNovel(input.novelId);
      const relevantProposals = proposals.filter((proposal) =>
        focusMatches(input.focus, proposal, allDecisions),
      );
      const decisionsFor = (proposal: NarrativeProposal) =>
        allDecisions.filter((decision) => decision.proposalReference.identity === proposal.id);
      const adoptedChanges = relevantProposals.flatMap((proposal) =>
        decisionsFor(proposal)
          .filter((decision) => decision.decisionType === "adopt")
          .flatMap((decision) => createAdoptionChangeSetInputs(decision).proposedChanges),
      );
      const openQuestions = relevantProposals.flatMap((proposal) =>
        proposal.openQuestions
          .filter((question) => question.state === "open")
          .map((question) => ({
            proposalId: proposal.id,
            proposalRevision: proposal.currentRevisionId,
            question,
          })),
      );
      const evidence = relevantProposals.flatMap((proposal) =>
        evidenceFor(proposal, decisionsFor(proposal)),
      );

      return deepFreeze({
        focus: { ...input.focus },
        proposals: relevantProposals,
        adoptedChanges,
        openQuestions,
        evidence,
        narrativeTruth: {
          owner: "shared-novel-engine",
          foundationOwnsNarrativeTruth: false,
          automaticCommit: false,
        },
      });
    },
  };
}
