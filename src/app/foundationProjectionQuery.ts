import type { RepositoryReadPort } from "../shared/application/repository";
import type { Novel } from "../narrative/novel/domain/novel";
import type { NarrativeProposalType } from "../story/domain/narrativeProposal";
import type { NarrativeProposalPort, AdoptionDecisionPort } from "../story/application/narrativeProposalPersistence";

/**
 * The five directions of the Story Foundation surface. They are the proposal
 * types a direction is held as; a direction is a design decision held as a
 * proposal, not a canonical fact, and it may stay open indefinitely.
 */
export const FOUNDATION_DIRECTIONS = [
  "story_concept",
  "core_conflict",
  "world_direction",
  "protagonist_direction",
  "main_plot_story_engine",
] as const satisfies readonly NarrativeProposalType[];

export type FoundationDirection = (typeof FOUNDATION_DIRECTIONS)[number];

export type FoundationDirectionStatus = "open" | "proposed" | "adopted" | "deferred";

export interface FoundationDirectionState {
  readonly direction: FoundationDirection;
  readonly proposalIds: readonly string[];
  readonly status: FoundationDirectionStatus;
}

export interface FoundationOpenQuestion {
  /** The Proposal that owns this question; the projection never rewrites it. */
  readonly proposalId: string;
  readonly questionId: string;
  readonly text: string;
  readonly state: string;
}

export interface FoundationProjection {
  readonly novelId: string;
  /** How the Novel's design started. Not where an author's session is. */
  readonly entryMode: "idea" | "existing_text" | "blank" | "none";
  readonly entryProvenance?: string;
  readonly directions: readonly FoundationDirectionState[];
  /**
   * Proposals grouped by proposal type. The plan named this `proposalsByStage`,
   * but a stage is not persisted state: `ProposalWorkflowPosition` is supplied
   * by the caller, so a stage grouping would have to be invented here.
   */
  readonly proposalsByType: Readonly<Record<string, readonly string[]>>;
  readonly openQuestions: readonly FoundationOpenQuestion[];
  readonly adoptionReadiness: { readonly ready: boolean; readonly reason?: string };
}

export interface FoundationProjectionQuery {
  project(input: { readonly novelId: string }): Promise<FoundationProjection | undefined>;
}

const ENTRY_MODES = ["idea", "existing_text", "blank"] as const;

function compareDecisions(
  left: { readonly decidedAt: { readonly iso: string }; readonly id: string },
  right: { readonly decidedAt: { readonly iso: string }; readonly id: string },
): number {
  const byTime = left.decidedAt.iso.localeCompare(right.decidedAt.iso);
  return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
}

/**
 * The projection is derived: it aggregates what the Proposal revisions and the
 * AdoptionDecision records already say, and it decides nothing on its own. It
 * holds no Workspace Session state and it never writes.
 */
export function createFoundationProjectionQuery(dependencies: {
  readonly novels: RepositoryReadPort<Novel>;
  readonly proposals: NarrativeProposalPort;
  readonly decisions: AdoptionDecisionPort;
}): FoundationProjectionQuery {
  return {
    async project({ novelId }) {
      const novel = await dependencies.novels.findById(novelId);
      if (!novel) return undefined;

      const proposals = [...(await dependencies.proposals.listByNovel(novelId))].sort((left, right) =>
        left.createdAt.iso.localeCompare(right.createdAt.iso),
      );
      const decisions = await dependencies.decisions.listByNovel(novelId);

      // The latest decision per proposal decides that proposal's standing; the
      // earlier ones stay in the record and are not rewritten.
      const latest = new Map<string, (typeof decisions)[number]>();
      for (const decision of decisions) {
        const key = decision.proposalReference.identity;
        const existing = latest.get(key);
        if (!existing || compareDecisions(decision, existing) > 0) latest.set(key, decision);
      }

      const directions = FOUNDATION_DIRECTIONS.map(direction => {
        const owned = proposals.filter(proposal => proposal.proposalType === direction);
        const types = owned.map(proposal => latest.get(proposal.id)?.decisionType);
        const status: FoundationDirectionStatus =
          owned.length === 0
            ? "open"
            : types.includes("adopt")
              ? "adopted"
              : types.includes("defer")
                ? "deferred"
                : "proposed";
        return Object.freeze({
          direction: direction,
          proposalIds: Object.freeze(owned.map(proposal => proposal.id)),
          status: status,
        });
      });

      const proposalsByType: Record<string, readonly string[]> = {};
      for (const proposal of proposals) {
        proposalsByType[proposal.proposalType] = Object.freeze([
          ...(proposalsByType[proposal.proposalType] ?? []),
          proposal.id,
        ]);
      }

      const openQuestions = Object.freeze(
        proposals.flatMap(proposal =>
          proposal.openQuestions.map(question =>
            Object.freeze({
              proposalId: proposal.id,
              questionId: question.id,
              text: question.text,
              state: question.state,
            }),
          ),
        ),
      );

      // The entry mode and its provenance are read from the same section, so
      // they always describe the same entry rather than two different ones.
      const entrySection = proposals
        .flatMap(proposal => proposal.sections)
        .find(section => {
          const value = section.content.entryMode;
          return typeof value === "string" && (ENTRY_MODES as readonly string[]).includes(value);
        });
      const entryMode =
        entrySection === undefined
          ? "none"
          : (entrySection.content.entryMode as (typeof ENTRY_MODES)[number]);
      const originType = entrySection?.provenance.origin.type;

      const hasContent = proposals.some(proposal => proposal.sections.length > 0);
      const adoptionReadiness = Object.freeze(
        hasContent
          ? { ready: true }
          : {
              ready: false,
              reason: proposals.length === 0 ? "尚无提案" : "提案尚无内容",
            },
      );

      return Object.freeze({
        novelId: novelId,
        entryMode: entryMode,
        ...(originType === undefined ? {} : { entryProvenance: originType }),
        directions: Object.freeze(directions),
        proposalsByType: Object.freeze(proposalsByType),
        openQuestions: openQuestions,
        adoptionReadiness: adoptionReadiness,
      });
    },
  };
}
