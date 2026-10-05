import { canonicalJson, hashContent } from "../shared/domain/contentHash";
import { deepFreeze } from "../shared/domain/immutable";
import { createSourceReference, type SourceReference } from "../shared/domain/observationSource";
import {
  enterFoundation,
  type FoundationEntryMode,
  type FoundationEntrySource,
  type FoundationEntryStatus,
  type FoundationGenerationOptions,
} from "../story/application/foundationEntryService";
import {
  recordFoundationAdoptionPreparation,
  type FoundationAdoptionPreparation,
  type RecordFoundationAdoptionPreparationInput,
} from "../story/application/foundationAdoptionService";
import { loadNarrativeProposal } from "../story/application/narrativeProposalService";
import {
  applyProposalWorkflowStep,
  type ProposalWorkflowActor,
} from "../story/application/proposalWorkflowService";
import type { NarrativeProposalPersistence } from "../story/application/narrativeProposalPersistence";
import {
  narrativeProposalSourceReference,
  type NarrativeProposalType,
  type ProposalOpenQuestionScope,
  type ProposalScope,
  type ProposalSectionProvenance,
} from "../story/domain/narrativeProposal";
import type {
  ProposalWorkflowStage,
  ProposalWorkflowTransition,
} from "../story/domain/proposalWorkflow";
import {
  createRunPlanApproval,
  createRunPlanRevision as buildRunPlanRevision,
  type RunPlanApproval,
  type RunPlanRevision,
  type RunPlanStep,
} from "../production/domain/runPlan";
import {
  approveProductionRun,
  createProductionRun,
  planProductionRun,
  startProductionRun,
  type ProductionRun,
} from "../production/domain/productionRun";
import {
  loadApprovedRunPlanRevision,
  saveProductionRun,
  saveRunPlanApproval,
  saveRunPlanRevision,
} from "../production/application/runPlanService";
import {
  pauseProductionRun as pauseRunLifecycle,
  resumeProductionRun as resumeRunLifecycle,
} from "../production/application/runLifecycleService";
import type { RunOrchestrationPersistence } from "../production/application/runPlanPersistence";
import type { RuntimeAdapter } from "../production/runtime/runtimeAdapter";
import {
  applyAttentionDisposition,
  type AttentionDispositionServiceInput,
} from "../recall/attention/attentionDispositionService";
import type { AttentionDispositionRecord } from "../recall/attention/attentionDisposition";
import type { AttentionDispositionPersistence } from "../recall/attention/attentionDispositionPersistence";
import type { RecallItem } from "../recall/projection/recallItemProjection";
import type { ProductionRunStateBoundary, RecallAuthorityBoundary } from "./productionRunRecallSurfaceContract";
import type { WorkspaceTruthOwner } from "./workspaceQueryPresentationContract";

export interface FoundationEntryCommand {
  readonly entryId: string;
  readonly novelId: string;
  readonly proposalId?: string;
  readonly mode: FoundationEntryMode;
  readonly idea?: string;
  readonly text?: string;
  readonly proposalType?: NarrativeProposalType;
  readonly scope?: ProposalScope;
  readonly occurredAt?: Date;
  readonly sourceReference?: SourceReference;
  readonly generation?: FoundationGenerationOptions;
}

export interface FoundationEntryProductResult {
  readonly entryId: string;
  readonly novelId: string;
  readonly mode: FoundationEntryMode;
  readonly status: FoundationEntryStatus;
  readonly proposalId?: string;
  readonly proposalRevisionId?: string;
  readonly automaticCommit: false;
}

export type ProposalWorkflowChangeInput =
  | {
      readonly kind: "add_section";
      readonly section: {
        readonly id: string;
        readonly content: Readonly<Record<string, unknown>>;
        readonly provenance?: ProposalSectionProvenance;
      };
    }
  | {
      readonly kind: "update_section";
      readonly sectionId: string;
      readonly content: Readonly<Record<string, unknown>>;
      readonly evidenceReferences?: readonly SourceReference[];
    }
  | { readonly kind: "remove_section"; readonly sectionId: string }
  | {
      readonly kind: "add_open_question";
      readonly question: {
        readonly id: string;
        readonly text: string;
        readonly scope?: ProposalOpenQuestionScope;
        readonly state?: "open" | "resolved" | "dismissed";
        readonly resolutionReference?: SourceReference;
        readonly provenance?: ProposalSectionProvenance;
      };
    }
  | {
      readonly kind: "resolve_open_question";
      readonly questionId: string;
      readonly resolutionReference: SourceReference;
    }
  | { readonly kind: "dismiss_open_question"; readonly questionId: string };

export interface AdvanceProposalCommand {
  readonly proposalId: string;
  readonly from: ProposalWorkflowStage;
  readonly to: ProposalWorkflowStage;
  readonly changes: readonly ProposalWorkflowChangeInput[];
  readonly actor?: ProposalWorkflowActor;
  readonly evidence?: SourceReference;
  readonly revisedAt: Date;
}

export interface AdvanceProposalProductResult {
  readonly proposalId: string;
  readonly revisionId: string;
  readonly proposalReference: SourceReference;
  readonly stage: ProposalWorkflowStage;
  readonly transition: ProposalWorkflowTransition;
  readonly automaticCommit: false;
}

export interface CreateRunPlanRevisionCommand {
  readonly id: string;
  readonly planId: string;
  readonly novelId: string;
  readonly revisionNumber: number;
  readonly parentRevisionId?: string;
  readonly goal: string;
  readonly steps: readonly RunPlanStep[];
  readonly createdAt: Date;
}

export interface CreateRunCommand {
  readonly id: string;
  readonly novelId: string;
  readonly runPlanRevision: RunPlanRevision;
  readonly createdAt: Date;
}

export interface ApproveRunPlanCommand {
  readonly approvalId: string;
  readonly planRevisionId: string;
  readonly approvedBy: string;
  readonly approvedAt: Date;
  readonly evidenceReferences: readonly string[];
}

export interface RunTransitionCommand {
  readonly runId: string;
  readonly at: Date;
  readonly reason?: string;
}

export interface RunProductView {
  readonly run: ProductionRun;
  readonly stateBoundary: ProductionRunStateBoundary;
}

export interface AttentionProductView {
  readonly novelId: string;
  readonly items: readonly RecallItem[];
  readonly dispositions: readonly AttentionDispositionRecord[];
  readonly authority: RecallAuthorityBoundary;
  readonly truthOwner: WorkspaceTruthOwner;
}

/** Read-only attention source. Recall observes, it never owns Narrative Truth. */
export interface RecallAttentionSource {
  listItems(novelId: string): Promise<readonly RecallItem[]> | readonly RecallItem[];
}

export interface ProductSurfaceCommandDependencies {
  readonly foundationPersistence: NarrativeProposalPersistence;
  readonly runPersistence: RunOrchestrationPersistence;
  readonly attentionPersistence: AttentionDispositionPersistence;
  readonly runtime?: RuntimeAdapter;
  readonly recallAttention?: RecallAttentionSource;
}

export interface ProductSurfaceCommandService {
  createFoundationEntry(input: FoundationEntryCommand): Promise<FoundationEntryProductResult>;
  advanceProposal(input: AdvanceProposalCommand): Promise<AdvanceProposalProductResult>;
  prepareAdoption(
    input: Omit<RecordFoundationAdoptionPreparationInput, "persistence">,
  ): Promise<FoundationAdoptionPreparation>;
}

export interface RunRecallProductSurface {
  createRunPlanRevision(input: CreateRunPlanRevisionCommand): Promise<RunPlanRevision>;
  approveRunPlan(input: ApproveRunPlanCommand): Promise<RunPlanApproval>;
  startRun(input: CreateRunCommand): Promise<RunProductView>;
  pauseRun(input: RunTransitionCommand): Promise<RunProductView>;
  resumeRun(input: RunTransitionCommand): Promise<RunProductView>;
  getRunStatus(input: { readonly runId: string }): Promise<RunProductView>;
  getAttention(input: { readonly novelId: string }): Promise<AttentionProductView>;
  disposeAttention(
    input: Omit<AttentionDispositionServiceInput, "persistence">,
  ): Promise<AttentionDispositionRecord>;
}

export type ProductSurface = ProductSurfaceCommandService & RunRecallProductSurface;

const recallAuthority: RecallAuthorityBoundary = Object.freeze({
  authoritative: false,
  mayMutateNarrativeTruth: false,
  mayCreateTaskDirectly: false,
  mayCommit: false,
  proposedActionChannel: "production-run-policy",
});

const runStateBoundary: ProductionRunStateBoundary = Object.freeze({
  runStateOwner: "production-run",
  narrativeStateOwner: "shared-novel-engine",
  runStateEqualsNarrativeState: false,
  ownsNarrativeTruth: false,
  automaticCommit: false,
});

function requiredText(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function defaultProvenance(evidence: SourceReference): ProposalSectionProvenance {
  return {
    origin: { type: "author_created", references: [evidence] },
    editLineage: [],
    evidenceReferences: [evidence],
    adoptionDecisionReferences: [],
  };
}

function foundationSource(input: FoundationEntryCommand): FoundationEntrySource {
  const reference =
    input.sourceReference ??
    createSourceReference({
      identity: input.entryId,
      version: "1",
      hash: hashContent(
        input.mode === "existing_text" ? input.text ?? "" : input.idea ?? input.entryId,
      ),
    });
  if (input.mode === "idea") {
    return { kind: "idea", text: requiredText(input.idea, "idea"), sourceReference: reference };
  }
  if (input.mode === "existing_text") {
    return {
      kind: "existing_text",
      text: requiredText(input.text, "text"),
      sourceReference: reference,
    };
  }
  return { kind: "blank", sourceReference: reference };
}

function workflowChange(
  change: ProposalWorkflowChangeInput,
  evidence: SourceReference,
) {
  if (change.kind === "add_section") {
    return {
      kind: "add_section" as const,
      section: {
        id: requiredText(change.section.id, "section id"),
        content: { ...change.section.content },
        provenance: change.section.provenance ?? defaultProvenance(evidence),
      },
    };
  }
  if (change.kind === "update_section") {
    return {
      kind: "update_section" as const,
      sectionId: requiredText(change.sectionId, "sectionId"),
      content: { ...change.content },
      ...(change.evidenceReferences === undefined
        ? {}
        : { evidenceReferences: change.evidenceReferences.map(createSourceReference) }),
    };
  }
  if (change.kind === "remove_section") {
    return { kind: "remove_section" as const, sectionId: requiredText(change.sectionId, "sectionId") };
  }
  if (change.kind === "add_open_question") {
    return {
      kind: "add_open_question" as const,
      question: {
        id: requiredText(change.question.id, "question id"),
        text: requiredText(change.question.text, "question text"),
        scope: change.question.scope ?? { kind: "proposal" as const },
        state: change.question.state ?? ("open" as const),
        ...(change.question.resolutionReference === undefined
          ? {}
          : { resolutionReference: createSourceReference(change.question.resolutionReference) }),
        provenance: change.question.provenance ?? defaultProvenance(evidence),
      },
    };
  }
  if (change.kind === "resolve_open_question") {
    return {
      kind: "resolve_open_question" as const,
      questionId: requiredText(change.questionId, "questionId"),
      resolutionReference: createSourceReference(change.resolutionReference),
    };
  }
  return { kind: "dismiss_open_question" as const, questionId: requiredText(change.questionId, "questionId") };
}

export function createProductSurfaceCommandService(
  dependencies: ProductSurfaceCommandDependencies,
): ProductSurface {
  return {
    async createFoundationEntry(input) {
      const occurredAt = input.occurredAt ?? new Date();
      const source = foundationSource(input);
      const proposalType = input.proposalType ?? "story_concept";
      const scope = input.scope ?? {};
      const generation = input.mode === "blank" ? undefined : input.generation;
      if (input.mode !== "blank") {
        if (!dependencies.runtime) {
          throw new Error("runtime is required to enter an Idea or Existing Text foundation");
        }
        if (!generation) {
          throw new Error("generation options are required to enter an Idea or Existing Text foundation");
        }
      }

      const result = await enterFoundation({
        entryId: requiredText(input.entryId, "entryId"),
        novelId: requiredText(input.novelId, "novelId"),
        ...(input.proposalId === undefined ? {} : { proposalId: input.proposalId }),
        mode: input.mode,
        proposalType,
        scope,
        source,
        occurredAt,
        persistence: dependencies.foundationPersistence,
        ...(generation === undefined ? {} : { runtime: dependencies.runtime!, generation }),
      });

      return deepFreeze({
        entryId: input.entryId,
        novelId: input.novelId,
        mode: input.mode,
        status: result.status,
        ...(result.status === "proposal_created"
          ? {
              proposalId: result.proposal.id,
              proposalRevisionId: result.proposal.currentRevisionId,
            }
          : {}),
        automaticCommit: false as const,
      });
    },

    async advanceProposal(input) {
      const previous = await loadNarrativeProposal(
        dependencies.foundationPersistence,
        input.proposalId,
      );
      const evidence =
        input.evidence === undefined
          ? narrativeProposalSourceReference(previous)
          : createSourceReference(input.evidence);
      const result = await applyProposalWorkflowStep({
        persistence: dependencies.foundationPersistence,
        position: {
          proposalId: previous.id,
          revisionId: previous.currentRevisionId,
          stage: input.from,
        },
        toStage: input.to,
        actor: input.actor ?? "author",
        evidence,
        changes: input.changes.map(change => workflowChange(change, evidence)),
        revisedAt: input.revisedAt,
      });

      return deepFreeze({
        proposalId: result.proposal.id,
        revisionId: result.proposal.currentRevisionId,
        proposalReference: narrativeProposalSourceReference(result.proposal),
        stage: result.position.stage,
        transition: result.transition,
        automaticCommit: false as const,
      });
    },

    async prepareAdoption(input) {
      return recordFoundationAdoptionPreparation({
        ...input,
        persistence: dependencies.foundationPersistence,
      });
    },

    async createRunPlanRevision(input) {
      return saveRunPlanRevision(dependencies.runPersistence, buildRunPlanRevision({ ...input }));
    },

    async approveRunPlan(input) {
      const planRevisionId = requiredText(input.planRevisionId, "planRevisionId");
      if (input.evidenceReferences.length === 0) {
        throw new Error("at least one evidence reference is required to approve a Run Plan");
      }
      input.evidenceReferences.forEach((reference, index) => {
        requiredText(reference, `evidenceReferences[${index}]`);
      });
      const revision = await dependencies.runPersistence.planRevisions.findById(planRevisionId);
      if (!revision) throw new Error("Run Plan Revision not found");

      const approval = createRunPlanApproval({
        id: requiredText(input.approvalId, "approvalId"),
        revision,
        approvedBy: requiredText(input.approvedBy, "approvedBy"),
        approvedAt: input.approvedAt,
      });
      // The frozen approval shape has no evidence slot; the references are
      // validated here and the revision reference is what binds the approval
      // to the immutable execution baseline.
      return saveRunPlanApproval(dependencies.runPersistence, approval);
    },

    async startRun(input) {
      const persisted = await loadApprovedRunPlanRevision(
        dependencies.runPersistence,
        input.runPlanRevision.id,
      );
      if (canonicalJson(persisted) !== canonicalJson(input.runPlanRevision)) {
        throw new Error("Run Plan Revision does not match the approved execution baseline");
      }
      const approval = await dependencies.runPersistence.planApprovals.findByRevisionId(
        persisted.id,
        persisted.novelId,
      );
      if (!approval) throw new Error("Run Plan Revision is not approved");

      let run = createProductionRun({
        id: input.id,
        novelId: input.novelId,
        runPlanRevision: persisted,
        createdAt: input.createdAt,
      });
      run = planProductionRun(run, input.createdAt);
      run = approveProductionRun(run, approval, input.createdAt);
      run = startProductionRun(run, input.createdAt);
      const saved = await saveProductionRun(dependencies.runPersistence, run);
      return deepFreeze({ run: saved, stateBoundary: runStateBoundary });
    },

    async pauseRun(input) {
      const run = await pauseRunLifecycle(
        dependencies.runPersistence,
        input.runId,
        input.at,
        input.reason ?? "paused by author",
      );
      return deepFreeze({ run, stateBoundary: runStateBoundary });
    },

    async resumeRun(input) {
      const run = await resumeRunLifecycle(dependencies.runPersistence, input.runId, input.at);
      return deepFreeze({ run, stateBoundary: runStateBoundary });
    },

    async getRunStatus(input) {
      const run = await dependencies.runPersistence.runs.findById(input.runId);
      if (!run) throw new Error("Production Run not found");
      return deepFreeze({ run, stateBoundary: runStateBoundary });
    },

    async getAttention(input) {
      const items =
        dependencies.recallAttention === undefined
          ? []
          : await dependencies.recallAttention.listItems(input.novelId);
      const dispositions =
        await dependencies.attentionPersistence.dispositions.listByNovel(input.novelId);
      return deepFreeze({
        novelId: input.novelId,
        items: [...items],
        dispositions: [...dispositions],
        authority: recallAuthority,
        truthOwner: "shared-novel-engine" as const,
      });
    },

    async disposeAttention(input) {
      const result = await applyAttentionDisposition({
        ...input,
        persistence: dependencies.attentionPersistence,
      });
      return result.record;
    },
  };
}
