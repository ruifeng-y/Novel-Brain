import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { HttpBoundaryContext, HttpBoundaryPipeline } from "./httpBoundaryPipeline";
import {
  createProductSurfaceCommandService,
  type ProductSurfaceCommandDependencies,
  type ProposalWorkflowChangeInput,
  type ProductSurface,
} from "../app/productSurfaceCommandService";
import { createWorkspaceProductQueryService } from "../app/workspaceProductQueryService";
import {
  getObjectEntryContract,
  isWorkspaceObjectKind,
  workspaceModes,
} from "../app/objectEntryContract";
import { resolveFocus } from "../app/focusResolution";
import { createStructuralNavigationQuery } from "../app/structuralNavigationQuery";
import { createStructureCommandService } from "../app/structureCommandService";
import { createSceneReadQuery } from "../app/sceneReadQuery";
import { createTargetSpanResolutionQuery } from "../app/targetSpanResolutionQuery";
import { createChangeSetRevisionService } from "../app/changeSetRevisionService";
import { createChangeSetDiffQuery } from "../app/changeSetDiffQuery";
import {
  createValidationRunService,
  ValidationBindingError,
  type ValidationRunStore,
} from "../app/validationRunService";
import {
  createReviewDecisionService,
  ReviewDecisionBindingError,
  type ReviewDecisionStore,
} from "../app/reviewDecisionService";
import { createCommitGateQuery, presentCommitGate } from "../app/commitGateQuery";
import { createCommitProvenanceQuery } from "../app/commitProvenanceQuery";
import type { FoundationWorkspaceFocus } from "../story/application/foundationWorkspaceContract";
import type { FoundationGenerationOptions } from "../story/application/foundationEntryService";
import {
  createAdoptionDecision,
  type AdoptionTarget,
} from "../story/domain/adoptionDecision";
import { proposalSectionHash } from "../story/domain/narrativeProposal";
import { createChangeSet, replaceChangeSetChanges, type ChangeSet } from "../production/domain/changeSet";
import type { Repository, RevisionedRepository } from "../shared/application/repository";
import type { VersionSet } from "../shared/domain/versioning";
import type { Novel } from "../narrative/novel/domain/novel";
import { createNovel } from "../narrative/novel/domain/novel";
import type { Scene } from "../manuscript/domain/scene";
import { createScene } from "../manuscript/domain/scene";
import type { Arc } from "../manuscript/domain/arc";
import type { Chapter } from "../manuscript/domain/chapter";
import type { GenerationTask } from "../production/domain/generationTask";
import {
  createGenerationTask,
  startGenerationTask,
} from "../production/domain/generationTask";
import type { Candidate } from "../production/domain/candidate";
import { createCandidate } from "../production/domain/candidate";
import type { ValidationRun } from "../production/domain/validationRun";
import { createChange, type Change } from "../production/domain/change";
import type { ChangeSetRevisionRepository } from "../production/application/changeSetPersistence";
import {
  createInitialChangeSetRevision,
  type ChangeSetRevision,
} from "../production/domain/changeSetRevision";
import type { ReviewDecision } from "../production/domain/reviewDecision";
import { approveRunPlanRevision } from "../production/domain/runPlan";
import type { CanonicalFact } from "../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../narrative/state/domain/stateRecord";
import type { NarrativeCommit } from "../safety/domain/narrativeCommit";
import type { EventStore } from "../safety/infrastructure/eventStore";
import type { RuntimeAdapter } from "../production/runtime/runtimeAdapter";
import {
  CommitConflictError,
  isCommitConflictError,
} from "../shared/application/commitConflict";
import {
  commitChangeSetRevision,
  CommitGateBlockedError,
  type CommitChangeSetRevisionApprovalRequirement,
  type CommitChangeSetRevisionTransaction,
} from "../safety/application/commitChangeSetRevision";
import { rejectionPayload, rejectionStatus } from "./rejectionStatus";
import { ResourceIsolationError } from "../platform/securityBoundary";

export interface ApiDependencies {
  readonly novels: Repository<Novel>;
  readonly scenes: RevisionedRepository<Scene>;
  readonly arcs: Repository<Arc>;
  readonly chapters: Repository<Chapter>;
  readonly generationTasks: Repository<GenerationTask>;
  readonly candidates: RevisionedRepository<Candidate>;
  readonly canonicalFacts: RevisionedRepository<CanonicalFact>;
  readonly stateRecords: RevisionedRepository<StateRecord>;
  readonly narrativeCommits: Repository<NarrativeCommit>;
  readonly changeSets: ChangeSetRevisionRepository;
  readonly validations: ValidationRunStore;
  readonly reviews: ReviewDecisionStore;
  readonly eventStore: EventStore;
  readonly runtime: RuntimeAdapter;
  readonly commitTransaction: CommitChangeSetRevisionTransaction;
  readonly product?: ProductSurfaceCommandDependencies;
}

const versionReferenceSchema = z.object({
  aggregateType: z.enum([
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
  ]),
  objectId: z.string().min(1),
  revisionId: z.string().min(1),
});

const versionSetSchema = z.custom<VersionSet>(
  value =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value as Record<string, unknown>).every(entry =>
      versionReferenceSchema.safeParse(entry).success,
    ),
  { message: "Expected a version set" },
);

const modelPolicySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  maxOutputTokens: z.number().int().positive(),
});

const freeFormRecordSchema = z.custom<Readonly<Record<string, unknown>>>(
  value => typeof value === "object" && value !== null && !Array.isArray(value),
  { message: "Expected an object" },
);

const atomicCandidateChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), sceneId: z.string().min(1), text: z.string().min(1) }),
  z.object({
    type: z.literal("structured_state"),
    stateRecordId: z.string().min(1),
    content: freeFormRecordSchema,
  }),
  z.object({
    type: z.literal("canonical_fact"),
    canonicalFactId: z.string().min(1),
    content: freeFormRecordSchema,
  }),
  z.object({
    type: z.literal("local_text"),
    sceneId: z.string().min(1),
    targetSpan: z.object({
      anchorId: z.string().min(1),
      text: z.string().min(1),
      sourceContentHash: z.string().min(1),
    }),
    replacement: z.string().min(1),
  }),
]);

const candidateChangeSchema = z.union([
  atomicCandidateChangeSchema,
  z.object({
    type: z.literal("composite"),
    changes: z.array(atomicCandidateChangeSchema).min(1),
  }),
]);

const generationOperationSchema = z.enum([
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

const approvalScopeSchema = z.object({
  requirementDomain: z.enum(["canon", "plan", "structure", "manuscript", "story_state"]),
  targetType: z.enum(["canonical_fact", "plan", "structure", "manuscript", "story_state"]),
  objectId: z.string().min(1),
  subAddress: z.string().min(1).optional(),
});

const approvalScopeRequirementSchema = z.object({
  approvalScope: approvalScopeSchema,
  requirement: z.string().min(1),
  requirementLevel: z.enum(["not_required", "policy", "human"]),
});

const targetInvariantViolationSchema = z.union([
  z.string().min(1),
  z.object({
    message: z.string().min(1),
    evidenceReferences: z.array(z.string().min(1)).optional(),
  }),
]);

/**
 * A commit references real artefacts by id. It carries no candidate, no
 * client-supplied validation id, and no client-supplied review template: the
 * validation runs and review decisions must already exist and belong to the
 * addressed revision. `requiredApproval` is derived from the requirements
 * rather than supplied, so the preview and the commit cannot disagree on it.
 */
const commitRequestSchema = z.object({
  commitId: z.string().min(1),
  changeSetRevisionId: z.string().min(1),
  validationRunIds: z.array(z.string().min(1)).min(1),
  reviewDecisionIds: z.array(z.string().min(1)).default([]),
  currentRevisionFacts: z.object({
    unresolvedConflict: z.boolean(),
    unresolvedConflictEvidenceReferences: z.array(z.string().min(1)).optional(),
    stale: z.boolean(),
    staleEvidenceReferences: z.array(z.string().min(1)).optional(),
  }),
  targetInvariantViolations: z.array(targetInvariantViolationSchema),
  approvalRequirements: z.array(approvalScopeRequirementSchema).default([]),
}).strict();

const changeSetRevisionRequestSchema = z.object({
  candidateId: z.string().min(1),
  revisionId: z.string().min(1),
  parentRevisionId: z.string().min(1).optional(),
  candidateSource: z
    .object({ version: z.string().min(1), hash: z.string().min(1) })
    .optional(),
});

const changeSetDiffRequestSchema = z.object({
  fromRevisionId: z.string().min(1),
  toRevisionId: z.string().min(1),
});

const runValidationRequestSchema = z.object({
  validationId: z.string().min(1),
  planVersionId: z.string().min(1),
  candidateId: z.string().min(1),
  mustPreserve: z.array(z.string()).default([]),
});

/** A structured query field carried as JSON, rejected as a 400 when malformed. */
function jsonArrayField<T>(element: z.ZodType<T>, label: string) {
  return z.string().transform((value, context): readonly T[] => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      context.addIssue({ code: "custom", message: `${label} must be JSON` });
      return [];
    }
    const result = z.array(element).safeParse(parsed);
    if (!result.success) {
      context.addIssue({ code: "custom", message: `${label} must be a JSON array of the expected shape` });
      return [];
    }
    return result.data;
  });
}

const booleanQueryFlag = z.enum(["true", "false"]).default("false");

const commitGateRequestSchema = z.object({
  /** Required: the gate preview names the validation evidence it evaluates. */
  validationRunIds: z
    .string()
    .min(1)
    .transform(value =>
      value
        .split(",")
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0),
    )
    .refine(ids => ids.length > 0, {
      message: "validationRunIds must name at least one run",
    }),
  unresolvedConflict: booleanQueryFlag,
  stale: booleanQueryFlag,
  occConflict: booleanQueryFlag,
  targetInvariantViolations: jsonArrayField(
    targetInvariantViolationSchema,
    "targetInvariantViolations",
  ).optional(),
  approvalRequirements: jsonArrayField(
    approvalScopeRequirementSchema,
    "approvalRequirements",
  ).optional(),
});

/**
 * The transport mirrors the ReviewDecision preconditions so a malformed
 * decision is a 400 instead of reaching the domain and failing as a 500.
 * No decision semantics are added here.
 */
const recordReviewDecisionRequestSchema = z
  .object({
    reviewDecisionId: z.string().min(1),
    approvalScope: approvalScopeSchema,
    decision: z.enum(["approve", "reject", "request_regeneration"]),
    decidedBy: z.enum(["human", "policy"]),
    actorId: z.string().min(1),
    reason: z.string().default(""),
    evidenceReferences: z.array(z.string().min(1)).default([]),
    policyVersion: z.string().min(1).optional(),
    decisionRule: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.decision === "reject" && value.reason.trim().length === 0) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A rejection requires a reason",
      });
    }
    if (value.decidedBy === "policy" && value.policyVersion === undefined) {
      context.addIssue({
        code: "custom",
        path: ["policyVersion"],
        message: "A policy decision requires policyVersion",
      });
    }
    if (value.decidedBy === "policy" && value.decisionRule === undefined) {
      context.addIssue({
        code: "custom",
        path: ["decisionRule"],
        message: "A policy decision requires decisionRule",
      });
    }
  });

/**
 * Each route binds to a real production API boundary contract. The manuscript
 * scene route has no dedicated contract in the frozen application boundary, so
 * it binds to the closest foundation command that adopts design content.
 */
const routeContracts = {
  createNovel: "foundation.command.create-blank-foundation",
  createScene: "foundation.command.adopt-proposal-content",
  createGenerationTask: "generation.command.create-generation-task",
  submitGenerationCandidate: "generation.command.submit-generation-candidate",
  commitChangeSetRevision: "commit.command.commit-change-set-revision",
  createChangeSetRevision: "commit.command.create-change-set-revision",
  changeSetRevisionDiff: "commit.query.change-set-revision-diff",
  runValidation: "validation.command.run-validation",
  validationRun: "validation.query.validation-run",
  recordReviewDecision: "approval.command.record-review-decision",
  approvalEvidence: "approval.query.approval-evidence",
  commitGate: "commit.query.commit-gate",
  commitProvenance: "commit.query.commit-provenance",
  listNovelEvents: "commit.query.commit-evidence",
  workspaceFocus: "foundation.query.workspace-focus",
  focusResolution: "workspace.query.focus-resolution",
  enterFoundationIdea: "foundation.command.enter-foundation-idea",
  extractFoundationText: "foundation.command.extract-foundation-text",
  createBlankFoundation: "foundation.command.create-blank-foundation",
  reviseProposal: "foundation.command.revise-proposal",
  adoptProposalContent: "foundation.command.adopt-proposal-content",
  createRunPlanRevision: "run.command.create-run-plan-revision",
  approveRunPlan: "run.command.approve-run-plan",
  startRun: "run.command.start-run",
  pauseRun: "run.command.pause-run",
  resumeRun: "run.command.resume-run",
  runStatus: "run.query.run-status",
  recallAttention: "recall.query.recall-attention",
  recordRecallDisposition: "recall.command.record-recall-disposition",
  structuralNavigation: "manuscript.query.structural-navigation",
  sceneRead: "manuscript.query.scene",
  targetSpanResolution: "manuscript.query.target-span-resolution",
  createArc: "manuscript.command.create-arc",
  createChapter: "manuscript.command.create-chapter",
  reorderStructure: "manuscript.command.reorder-structure",
} as const;

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * The boundary authorizes the identity the handler actually acts on, so each
 * route derives its workspace from the addressed entity (path parameter, body
 * or a pre-loaded aggregate). The client-supplied `x-workspace-id` is never an
 * authorization source; it is only a consistency assertion: a mismatching
 * value is rejected, an absent value is ignored.
 */
function assertWorkspaceHeader(request: FastifyRequest, derivedWorkspaceId: string): void {
  const header = headerValue(request, "x-workspace-id");
  if (header !== undefined && header !== derivedWorkspaceId) {
    throw new ResourceIsolationError(
      `x-workspace-id ${header} does not match the addressed workspace ${derivedWorkspaceId}`,
    );
  }
}

function routeBoundaryContext(request: FastifyRequest, workspaceId: string): HttpBoundaryContext {
  assertWorkspaceHeader(request, workspaceId);
  const requestId = headerValue(request, "x-request-id") ?? crypto.randomUUID();
  return {
    requestId,
    principal: {
      subjectId: headerValue(request, "x-author-id") ?? "anonymous-author",
      workspaceId,
    },
    resource: { kind: "workspace", id: workspaceId },
    correlation: { requestId, traceId: requestId, auditId: requestId },
  };
}

/** Identity of the Novel a body-addressed create route acts on (`POST /novels` carries `id`). */
const novelBodyIdentitySchema = z.object({ id: z.string().min(1) });

function requiredPathParameter(request: FastifyRequest, name: string): string {
  const params = request.params as Record<string, unknown> | undefined;
  return z.string().min(1).parse(params?.[name]);
}

function requiredQueryParameter(request: FastifyRequest, name: string): string {
  const query = request.query as Record<string, unknown> | undefined;
  return z.string().min(1).parse(query?.[name]);
}

const workspaceModeSchema = z.enum(workspaceModes);

function normalizeTransportValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function routeBoundaryInput(request: FastifyRequest): unknown {
  const body = request.body;
  return {
    params: normalizeTransportValue(request.params),
    query: normalizeTransportValue(request.query),
    ...(body === undefined || body === null
      ? {}
      : { body: normalizeTransportValue(body) }),
  };
}

export function registerNovelBrainRoutes(
  app: FastifyInstance,
  dependencies: ApiDependencies,
  pipeline: HttpBoundaryPipeline,
): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "Bad Request", details: error.issues });
    }
    if (error instanceof ValidationBindingError) {
      return reply
        .code(409)
        .send({ error: "Validation Binding Conflict", reason: error.message });
    }
    if (error instanceof ReviewDecisionBindingError) {
      return reply
        .code(409)
        .send({ error: "Approval Binding Conflict", reason: error.message });
    }
    if (isCommitConflictError(error)) {
      return reply.code(409).send({
        error: "Commit Conflict",
        conflictType: error.conflictType,
        reason: error.message,
      });
    }
    const status = rejectionStatus(error);
    if (status !== undefined) {
      return reply.code(status).send(rejectionPayload(error, status));
    }
    return reply.send(error);
  });

  const productDependencies = dependencies.product;
  const workspaceQueryService =
    productDependencies === undefined
      ? undefined
      : createWorkspaceProductQueryService({
          foundationPersistence: productDependencies.foundationPersistence,
        });
  const productSurface: ProductSurface | undefined =
    productDependencies === undefined
      ? undefined
      : createProductSurfaceCommandService(productDependencies);
  const structuralNavigation = createStructuralNavigationQuery({
    arcs: dependencies.arcs,
    chapters: dependencies.chapters,
    scenes: dependencies.scenes,
  });
  const structureCommands = createStructureCommandService({
    arcs: dependencies.arcs,
    chapters: dependencies.chapters,
    scenes: dependencies.scenes,
  });
  const sceneRead = createSceneReadQuery({ scenes: dependencies.scenes });
  const targetSpanResolution = createTargetSpanResolutionQuery({ scenes: dependencies.scenes });
  const changeSetRevisions = createChangeSetRevisionService({ changeSets: dependencies.changeSets });
  const changeSetDiff = createChangeSetDiffQuery({ changeSets: dependencies.changeSets });
  const validationRuns = createValidationRunService({
    changeSets: dependencies.changeSets,
    validations: dependencies.validations,
    scenes: dependencies.scenes,
    candidates: dependencies.candidates,
  });
  const reviewDecisions = createReviewDecisionService({
    reviews: dependencies.reviews,
    changeSets: dependencies.changeSets,
  });
  const commitGate = createCommitGateQuery({
    changeSets: dependencies.changeSets,
    validations: dependencies.validations,
    reviews: dependencies.reviews,
  });
  const commitProvenance = createCommitProvenanceQuery({
    commits: dependencies.narrativeCommits,
    validations: dependencies.validations,
    reviews: dependencies.reviews,
    eventStore: dependencies.eventStore,
  });

  app.post("/novels", async (request, reply) => {
    const identity = novelBodyIdentitySchema.parse(request.body);
    return pipeline.execute(
      routeContracts.createNovel,
      routeBoundaryContext(request, identity.id),
      routeBoundaryInput(request),
      async () => {
        const body = z
          .object({ id: z.string().min(1), authorId: z.string().min(1), title: z.string().min(1) })
          .parse(request.body);
        const novel = createNovel({ ...body, createdAt: new Date() });
        await dependencies.novels.save(novel);
        return reply.code(201).send(novel);
      },
    );
  });

  app.post("/novels/:novelId/scenes", async (request, reply) => {
    const novelId = requiredPathParameter(request, "novelId");
    return pipeline.execute(
      routeContracts.createScene,
      routeBoundaryContext(request, novelId),
      routeBoundaryInput(request),
      async () => {
        const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
        const novel = await dependencies.novels.findById(params.novelId);
        if (!novel) return reply.code(404).send({ error: "Novel not found" });
        const actorId = request.headers["x-author-id"];
        if (typeof actorId !== "string" || actorId !== novel.authorId) {
          return reply.code(403).send({ error: "Forbidden" });
        }
        const body = z
          .object({ id: z.string().min(1), chapterId: z.string().min(1), title: z.string().min(1) })
          .parse(request.body);
        const scene = createScene({
          ...body,
          novelId: params.novelId,
          revisionId: `${body.id}:rev-1`,
          commitId: `initial:${body.id}`,
          createdAt: new Date(),
        });
        await dependencies.scenes.save(scene);
        return reply.code(201).send(scene);
      },
    );
  });

  app.post("/novels/:novelId/generation-tasks", async (request, reply) => {
    const novelId = requiredPathParameter(request, "novelId");
    return pipeline.execute(
      routeContracts.createGenerationTask,
      routeBoundaryContext(request, novelId),
      routeBoundaryInput(request),
      async () => {
        const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
        const novel = await dependencies.novels.findById(params.novelId);
        if (!novel) return reply.code(404).send({ error: "Novel not found" });
        const actorId = request.headers["x-author-id"];
        if (typeof actorId !== "string" || actorId !== novel.authorId) {
          return reply.code(403).send({ error: "Forbidden" });
        }
        const body = z
          .object({
            id: z.string().min(1),
            operation: generationOperationSchema,
            targetSceneId: z.string().min(1),
            intent: z.string().min(1),
            basedOnVersionSet: versionSetSchema,
          })
          .parse(request.body);
        const targetScene = await dependencies.scenes.findById(body.targetSceneId);
        if (!targetScene || targetScene.novelId !== params.novelId) {
          return reply.code(404).send({ error: "Target scene not found" });
        }
        const task = createGenerationTask({
          ...body,
          novelId: params.novelId,
          createdAt: new Date(),
        });
        await dependencies.generationTasks.save(task);
        return reply.code(201).send(task);
      },
    );
  });

  app.post("/generation-tasks/:taskId/candidates", async (request, reply) => {
    const taskId = requiredPathParameter(request, "taskId");
    const task = await dependencies.generationTasks.findById(taskId);
    if (!task) return reply.code(404).send({ error: "Not Found" });
    return pipeline.execute(
      routeContracts.submitGenerationCandidate,
      routeBoundaryContext(request, task.novelId),
      routeBoundaryInput(request),
      async () => {
        const params = z.object({ taskId: z.string().min(1) }).parse(request.params);
        const body = z
          .object({
            id: z.string().min(1),
            agentRole: z.enum([
              "planner",
              "writer",
              "editor",
              "reviewer",
              "consistency_agent",
              "memory_agent",
            ]),
            modelPolicy: modelPolicySchema,
            change: candidateChangeSchema,
          })
          .parse(request.body);

        const startedTask = startGenerationTask(task, new Date());
        const runtimeResult = await dependencies.runtime.execute({
          taskId: task.id,
          agentRole: body.agentRole,
          modelPolicy: body.modelPolicy,
          basedOnVersionSet: task.basedOnVersionSet,
          context: { taskIntent: task.intent },
          requestedChange: body.change,
        });
        const candidate = createCandidate({
          id: body.id,
          taskId: task.id,
          novelId: task.novelId,
          basedOnVersionSet: runtimeResult.basedOnVersionSet,
          change: runtimeResult.change,
          createdAt: new Date(),
        });
        await dependencies.generationTasks.save(startedTask);
        await dependencies.candidates.save(candidate);
        return reply.code(201).send(candidate);
      },
    );
  });

  /**
   * A commit references real artefacts by id. Every referenced validation run
   * and review decision must exist and belong to the addressed revision — the
   * address is the pair (Change Set, revision) — so a mismatch is a conflict,
   * never a silent substitution. The gate is evaluated again here with the same
   * function the preview uses, because the current-state facts may have changed
   * since the author looked. Canonical state still changes only through
   * `commitChangeSetRevision`.
   */
  app.post("/change-sets/:changeSetId/commit", async (request, reply) => {
    const params = z.object({ changeSetId: z.string().min(1) }).parse(request.params);
    const body = commitRequestSchema.parse(request.body);
    const revision = await changeSetRevisions.getRevision({
      changeSetId: params.changeSetId,
      revisionId: body.changeSetRevisionId,
    });
    if (!revision) {
      return reply.code(404).send({ error: "Change Set Revision not found" });
    }
    return pipeline.execute(
      routeContracts.commitChangeSetRevision,
      routeBoundaryContext(request, revision.novelId),
      routeBoundaryInput(request),
      async () => {
        const referencedRevision = `${params.changeSetId}:${body.changeSetRevisionId}`;

        // Resolved through the paired app entries: a run or decision is only
        // accepted when it belongs to this (Change Set, revision).
        const resolvedRuns: ValidationRun[] = [];
        for (const validationRunId of body.validationRunIds) {
          const run = await validationRuns.getValidation({
            validationId: validationRunId,
            changeSetId: params.changeSetId,
            revisionId: body.changeSetRevisionId,
          });
          if (!run) {
            return reply.code(409).send({
              error: "Commit Conflict",
              reason: `Validation run ${validationRunId} does not belong to revision ${referencedRevision}`,
            });
          }
          resolvedRuns.push(run);
        }

        const decisionsOfRevision = new Map(
          (
            await reviewDecisions.listForRevision({
              changeSetId: params.changeSetId,
              revisionId: body.changeSetRevisionId,
            })
          ).map(decision => [decision.id, decision] as const),
        );
        const resolvedDecisions: ReviewDecision[] = [];
        for (const reviewDecisionId of body.reviewDecisionIds) {
          const decision = decisionsOfRevision.get(reviewDecisionId);
          if (!decision) {
            return reply.code(409).send({
              error: "Commit Conflict",
              reason: `Review decision ${reviewDecisionId} does not belong to revision ${referencedRevision}`,
            });
          }
          resolvedDecisions.push(decision);
        }

        const approvalRequirements = body.approvalRequirements.map(
          (requirement): CommitChangeSetRevisionApprovalRequirement => requirement,
        );
        // Derived, never client-supplied: the preview derives it the same way.
        const requiredApproval = approvalRequirements.some(
          requirement => requirement.requirementLevel !== "not_required",
        );

        const gate = await commitGate.evaluate({
          changeSetId: params.changeSetId,
          revisionId: body.changeSetRevisionId,
          validationRunIds: body.validationRunIds,
          currentRevisionFacts: body.currentRevisionFacts,
          targetInvariantViolations: body.targetInvariantViolations,
          approvalRequirements,
        });
        if (!gate) {
          return reply.code(404).send({ error: "Change Set Revision not found" });
        }
        if (!gate.allowed) {
          return reply.code(409).send({ error: "Commit Conflict", gate });
        }

        try {
          const commit = await commitChangeSetRevision({
            transaction: dependencies.commitTransaction,
            input: {
              commitId: body.commitId,
              changeSetRevision: revision,
              validationRuns: resolvedRuns,
              reviewDecisions: resolvedDecisions,
              currentRevisionFacts: body.currentRevisionFacts,
              targetInvariantViolations: body.targetInvariantViolations,
              requiredApproval,
              approvalScopeRequirements: approvalRequirements,
              now: new Date(),
            },
          });
          return reply.code(201).send(commit);
        } catch (error) {
          if (error instanceof CommitGateBlockedError) {
            return reply.code(409).send({
              error: "Commit Conflict",
              gate: presentCommitGate(error.gate),
            });
          }
          if (error instanceof Error && error.message.startsWith("Stale dependency:")) {
            return reply.code(409).send({ error: "Commit Conflict", reason: error.message });
          }
          throw error;
        }
      },
    );
  });

  /**
   * Adoption promotes a Candidate into a persisted Change Set Revision. The
   * Candidate is never the commit target; it only supplies the change content.
   * The boundary authorizes the workspace of the candidate actually adopted.
   */
  app.post("/change-sets/:changeSetId/revisions", async (request, reply) => {
    const params = z.object({ changeSetId: z.string().min(1) }).parse(request.params);
    const body = changeSetRevisionRequestSchema.parse(request.body);
    const candidate = await dependencies.candidates.findById(body.candidateId);
    if (!candidate) {
      return reply.code(404).send({ error: "Not Found" });
    }
    return pipeline.execute(
      routeContracts.createChangeSetRevision,
      routeBoundaryContext(request, candidate.novelId),
      routeBoundaryInput(request),
      async () => {
        const parentRevision =
          body.parentRevisionId === undefined
            ? undefined
            : await changeSetRevisions.getRevision({
                changeSetId: params.changeSetId,
                revisionId: body.parentRevisionId,
              });
        if (body.parentRevisionId !== undefined && !parentRevision) {
          return reply.code(404).send({ error: "Parent revision not found" });
        }
        const revision = await changeSetRevisions.adoptCandidate({
          candidate,
          changeSetId: params.changeSetId,
          revisionId: body.revisionId,
          ...(parentRevision === undefined ? {} : { parentRevision }),
          ...(body.candidateSource === undefined
            ? {}
            : { sourceReference: body.candidateSource }),
          createdAt: new Date(),
        });
        return reply.code(201).send(revision);
      },
    );
  });

  /**
   * Diffing is defined only between two revisions of one Change Set. Both are
   * resolved before the boundary so an unknown revision is a 404, never a
   * cross change set comparison.
   */
  app.get("/change-sets/:changeSetId/revisions/diff", async (request, reply) => {
    const params = z.object({ changeSetId: z.string().min(1) }).parse(request.params);
    const query = changeSetDiffRequestSchema.parse(request.query);
    const from = await changeSetRevisions.getRevision({
      changeSetId: params.changeSetId,
      revisionId: query.fromRevisionId,
    });
    const to = await changeSetRevisions.getRevision({
      changeSetId: params.changeSetId,
      revisionId: query.toRevisionId,
    });
    if (!from || !to) {
      return reply.code(404).send({ error: "Change Set Revision not found" });
    }
    return pipeline.execute(
      routeContracts.changeSetRevisionDiff,
      routeBoundaryContext(request, from.novelId),
      routeBoundaryInput(request),
      async () => {
        const entries = await changeSetDiff.diffRevisions({
          changeSetId: params.changeSetId,
          fromRevisionId: query.fromRevisionId,
          toRevisionId: query.toRevisionId,
        });
        if (!entries) return reply.code(404).send({ error: "Change Set Revision not found" });
        return reply.code(200).send(entries);
      },
    );
  });

  /**
   * Validation is a stage the author performs before deciding to commit: the
   * run is persisted on its own, binds to the addressed Change Set Revision,
   * and can be read back without any commit having happened. The authorization
   * resource is the workspace of the revision actually validated.
   */
  app.post(
    "/change-sets/:changeSetId/revisions/:revisionId/validation-runs",
    async (request, reply) => {
      const params = z
        .object({ changeSetId: z.string().min(1), revisionId: z.string().min(1) })
        .parse(request.params);
      const body = runValidationRequestSchema.parse(request.body);
      const revision = await changeSetRevisions.getRevision({
        changeSetId: params.changeSetId,
        revisionId: params.revisionId,
      });
      if (!revision) {
        return reply.code(404).send({ error: "Change Set Revision not found" });
      }
      const candidate = await dependencies.candidates.findById(body.candidateId);
      if (!candidate) return reply.code(404).send({ error: "Not Found" });
      return pipeline.execute(
        routeContracts.runValidation,
        routeBoundaryContext(request, revision.novelId),
        routeBoundaryInput(request),
        async () => {
          const run = await validationRuns.runValidation({
            changeSetId: params.changeSetId,
            revisionId: params.revisionId,
            validationId: body.validationId,
            planVersionId: body.planVersionId,
            candidateId: body.candidateId,
            mustPreserve: body.mustPreserve,
            createdAt: new Date(),
          });
          return reply.code(201).send(run);
        },
      );
    },
  );

  app.get(
    "/change-sets/:changeSetId/revisions/:revisionId/validation-runs/:validationId",
    async (request, reply) => {
      const params = z
        .object({
          changeSetId: z.string().min(1),
          revisionId: z.string().min(1),
          validationId: z.string().min(1),
        })
        .parse(request.params);
      const revision = await changeSetRevisions.getRevision({
        changeSetId: params.changeSetId,
        revisionId: params.revisionId,
      });
      if (!revision) {
        return reply.code(404).send({ error: "Change Set Revision not found" });
      }
      return pipeline.execute(
        routeContracts.validationRun,
        routeBoundaryContext(request, revision.novelId),
        routeBoundaryInput(request),
        async () => {
          const run = await validationRuns.getValidation({
            validationId: params.validationId,
            changeSetId: params.changeSetId,
            revisionId: params.revisionId,
          });
          if (!run) return reply.code(404).send({ error: "Validation Run not found" });
          return reply.code(200).send(run);
        },
      );
    },
  );

  /**
   * Approval is a stage the author performs before deciding to commit: a
   * ReviewDecision is an immutable Decision Event recorded against the
   * addressed Change Set Revision and an Approval Scope. The Candidate is
   * never the approval subject. The authorization resource is the workspace
   * of the revision actually decided about.
   */
  app.post(
    "/change-sets/:changeSetId/revisions/:revisionId/review-decisions",
    async (request, reply) => {
      const params = z
        .object({ changeSetId: z.string().min(1), revisionId: z.string().min(1) })
        .parse(request.params);
      const body = recordReviewDecisionRequestSchema.parse(request.body);
      const revision = await changeSetRevisions.getRevision({
        changeSetId: params.changeSetId,
        revisionId: params.revisionId,
      });
      if (!revision) {
        return reply.code(404).send({ error: "Change Set Revision not found" });
      }
      return pipeline.execute(
        routeContracts.recordReviewDecision,
        routeBoundaryContext(request, revision.novelId),
        routeBoundaryInput(request),
        async () => {
          const decision = await reviewDecisions.recordReview({
            reviewDecisionId: body.reviewDecisionId,
            changeSetId: params.changeSetId,
            revisionId: params.revisionId,
            approvalScope: body.approvalScope,
            decision: body.decision,
            decidedBy: body.decidedBy,
            actorId: body.actorId,
            reason: body.reason,
            evidenceReferences: body.evidenceReferences,
            ...(body.policyVersion === undefined ? {} : { policyVersion: body.policyVersion }),
            ...(body.decisionRule === undefined ? {} : { decisionRule: body.decisionRule }),
            createdAt: new Date(),
          });
          return reply.code(201).send(decision);
        },
      );
    },
  );

  /**
   * Approval evidence is the recorded decision events of one revision: the
   * derived approval state is not stored, only the decisions it is derived from.
   */
  app.get(
    "/change-sets/:changeSetId/revisions/:revisionId/review-decisions",
    async (request, reply) => {
      const params = z
        .object({ changeSetId: z.string().min(1), revisionId: z.string().min(1) })
        .parse(request.params);
      const revision = await changeSetRevisions.getRevision({
        changeSetId: params.changeSetId,
        revisionId: params.revisionId,
      });
      if (!revision) {
        return reply.code(404).send({ error: "Change Set Revision not found" });
      }
      return pipeline.execute(
        routeContracts.approvalEvidence,
        routeBoundaryContext(request, revision.novelId),
        routeBoundaryInput(request),
        async () => {
          const decisions = await reviewDecisions.listForRevision({
            changeSetId: params.changeSetId,
            revisionId: params.revisionId,
          });
          return reply.code(200).send(decisions);
        },
      );
    },
  );

  /**
   * The commit gate is evaluated by the same function the commit uses, so this
   * preview and the commit report the same gate over the same artefacts. The
   * five conditions are reported separately and never collapsed into one
   * indicator. The authorization resource is the workspace of the revision.
   */
  app.get("/change-sets/:changeSetId/revisions/:revisionId/commit-gate", async (request, reply) => {
    const params = z
      .object({ changeSetId: z.string().min(1), revisionId: z.string().min(1) })
      .parse(request.params);
    const query = commitGateRequestSchema.parse(request.query);
    const revision = await changeSetRevisions.getRevision({
      changeSetId: params.changeSetId,
      revisionId: params.revisionId,
    });
    if (!revision) {
      return reply.code(404).send({ error: "Change Set Revision not found" });
    }
    return pipeline.execute(
      routeContracts.commitGate,
      routeBoundaryContext(request, revision.novelId),
      routeBoundaryInput(request),
      async () => {
        const gate = await commitGate.evaluate({
          changeSetId: params.changeSetId,
          revisionId: params.revisionId,
          validationRunIds: query.validationRunIds,
          currentRevisionFacts: {
            unresolvedConflict: query.unresolvedConflict === "true",
            stale: query.stale === "true",
          },
          occConflict: query.occConflict === "true",
          targetInvariantViolations: query.targetInvariantViolations ?? [],
          approvalRequirements: query.approvalRequirements ?? [],
        });
        if (!gate) return reply.code(404).send({ error: "Change Set Revision not found" });
        return reply.code(200).send(gate);
      },
    );
  });

  /**
   * Commit provenance is a read of what a commit was made of: the commit, the
   * revision it carries, the validation runs and review decisions it
   * referenced, and its audit events. It never re-derives the gate or the
   * commit, and a commit of another novel is not this novel's provenance.
   */
  app.get("/novels/:novelId/commits/:commitId", async (request, reply) => {
    const params = z
      .object({ novelId: z.string().min(1), commitId: z.string().min(1) })
      .parse(request.params);
    return pipeline.execute(
      routeContracts.commitProvenance,
      routeBoundaryContext(request, params.novelId),
      routeBoundaryInput(request),
      async () => {
        const provenance = await commitProvenance.get({
          novelId: params.novelId,
          commitId: params.commitId,
        });
        if (!provenance) return reply.code(404).send({ error: "Commit not found" });
        return reply.code(200).send(provenance);
      },
    );
  });

  app.get("/novels/:novelId/events", async request => {
    const novelId = requiredPathParameter(request, "novelId");
    return pipeline.execute(
      routeContracts.listNovelEvents,
      routeBoundaryContext(request, novelId),
      routeBoundaryInput(request),
      async () => {
        const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
        return dependencies.eventStore.listByNovel(params.novelId);
      },
    );
  });

  /**
   * Focus resolution policy lives on the server: the client names the object
   * kind it wants to work on and renders the answer, so there is exactly one
   * source for the default Mode, surface, panels, and Lens. The authorization
   * resource is the workspace named by the request itself, never a placeholder
   * and never the consistency header.
   */
  app.get("/workspace/resolution", async (request, reply) => {
    const workspaceId = requiredQueryParameter(request, "workspaceId");
    const kind = requiredQueryParameter(request, "kind");
    if (!isWorkspaceObjectKind(kind)) {
      return reply.code(400).send({
        error: "Bad Request",
        message: `unknown workspace object kind: ${kind}`,
      });
    }
    const rawMode = (request.query as Record<string, unknown> | undefined)?.mode;
    const requestedMode = rawMode === undefined ? undefined : workspaceModeSchema.parse(rawMode);
    return pipeline.execute(
      routeContracts.focusResolution,
      routeBoundaryContext(request, workspaceId),
      routeBoundaryInput(request),
      async () => {
        const resolution = resolveFocus({
          kind,
          ...(requestedMode === undefined ? {} : { requestedMode }),
        });
        if (!resolution.resolved) {
          return reply.code(400).send({ error: "Bad Request", message: resolution.reason });
        }
        const entry = getObjectEntryContract(resolution.kind);
        return reply.code(200).send({
          workspaceId,
          resolved: true,
          kind: resolution.kind,
          mode: resolution.mode,
          surfaceKind: entry.surfaceKind,
          defaultPanels: entry.defaultPanels,
          defaultLens: entry.defaultLens,
        });
      },
    );
  });

  app.get("/workspace/:novelId", async (request, reply) => {
    const novelId = requiredPathParameter(request, "novelId");
    return pipeline.execute(
      routeContracts.workspaceFocus,
      routeBoundaryContext(request, novelId),
      routeBoundaryInput(request),
      async () => {
        if (!workspaceQueryService) return productSurfaceUnavailable(reply);
        const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
        const query = workspaceFocusQuerySchema.parse(request.query ?? {});
        const focus: FoundationWorkspaceFocus = {
          object: query.object ?? "story-foundation",
          ...(query.objectId === undefined ? {} : { objectId: query.objectId }),
          mode: query.mode ?? "design",
          ...(query.taskId === undefined ? {} : { taskId: query.taskId }),
        };
        const view = await workspaceQueryService.getWorkspaceView({
          novelId: params.novelId,
          focus,
        });
        return reply.code(200).send(view);
      },
    );
  });

  app.post("/foundation/entries", async (request, reply) => {
    if (!productSurface) return productSurfaceUnavailable(reply);
    const mode = foundationEntryModeSchema.parse(
      (request.body as { mode?: unknown } | undefined)?.mode,
    );
    const novelId = z
      .object({ novelId: z.string().min(1) })
      .parse(request.body).novelId;
    const contractId =
      mode === "idea"
        ? routeContracts.enterFoundationIdea
        : mode === "existing_text"
          ? routeContracts.extractFoundationText
          : routeContracts.createBlankFoundation;
    return pipeline.execute(
      contractId,
      routeBoundaryContext(request, novelId),
      routeBoundaryInput(request),
      async () => {
        const body = foundationEntryRequestSchema.parse(request.body);
        const entry = await productSurface.createFoundationEntry({
          entryId: body.entryId,
          novelId: body.novelId,
          mode: body.mode,
          ...(body.proposalId === undefined ? {} : { proposalId: body.proposalId }),
          ...(body.idea === undefined ? {} : { idea: body.idea }),
          ...(body.text === undefined ? {} : { text: body.text }),
          ...(body.proposalType === undefined ? {} : { proposalType: body.proposalType }),
          ...(body.scope === undefined ? {} : { scope: body.scope }),
          ...(body.occurredAt === undefined ? {} : { occurredAt: new Date(body.occurredAt) }),
          ...(body.sourceReference === undefined ? {} : { sourceReference: body.sourceReference }),
          ...(body.generation === undefined
            ? {}
            : { generation: body.generation as FoundationGenerationOptions }),
        });
        return reply.code(201).send(entry);
      },
    );
  });

  app.post("/foundation/proposals/:proposalId/transitions", async (request, reply) => {
    if (!productSurface || !productDependencies) return productSurfaceUnavailable(reply);
    const params = z.object({ proposalId: z.string().min(1) }).parse(request.params);
    const proposal = await productDependencies.foundationPersistence.proposals.findById(
      params.proposalId,
    );
    if (!proposal) return reply.code(404).send({ error: "Proposal not found" });
    return pipeline.execute(
      routeContracts.reviseProposal,
      routeBoundaryContext(request, proposal.novelId),
      routeBoundaryInput(request),
      async () => {
        const body = proposalTransitionRequestSchema.parse(request.body);
        const result = await productSurface.advanceProposal({
          proposalId: params.proposalId,
          from: body.from,
          to: body.to,
          changes: body.changes as ProposalWorkflowChangeInput[],
          ...(body.actor === undefined ? {} : { actor: body.actor }),
          ...(body.evidence === undefined ? {} : { evidence: body.evidence }),
          revisedAt: body.revisedAt === undefined ? new Date() : new Date(body.revisedAt),
        });
        return reply.code(201).send(result);
      },
    );
  });

  app.post("/foundation/proposals/:proposalId/adoption-preparations", async (request, reply) => {
    if (!productSurface || !productDependencies) return productSurfaceUnavailable(reply);
    const params = z.object({ proposalId: z.string().min(1) }).parse(request.params);
    const proposal = await productDependencies.foundationPersistence.proposals.findById(
      params.proposalId,
    );
    if (!proposal) return reply.code(404).send({ error: "Proposal not found" });
    return pipeline.execute(
      routeContracts.adoptProposalContent,
      routeBoundaryContext(request, proposal.novelId),
      routeBoundaryInput(request),
      async () => {
        const body = adoptionPreparationRequestSchema.parse(request.body);

        const parentRevision = reviveChangeSetRevision(body.parentRevision);
        const changeSet = reviveChangeSet(body.changeSet, parentRevision);
        const decidedAt =
          body.decision.decidedAt === undefined ? new Date() : new Date(body.decision.decidedAt);
        const targets: AdoptionTarget[] = body.decision.targets.map(target => {
          const section = proposal.sections.find(entry => entry.id === target.sectionIdentity);
          if (!section) throw new Error("Adoption target section must exist in Proposal");
          const contentHash = proposalSectionHash(section);
          return {
            id: target.id,
            scope: {
              proposalIdentity: proposal.id,
              proposalRevision: proposal.currentRevisionId,
              sectionIdentity: target.sectionIdentity,
            },
            targetType: target.targetType,
            objectId: target.objectId,
            ...(target.subAddress === undefined ? {} : { subAddress: target.subAddress }),
            proposedChangeId: target.proposedChangeId,
            payload: target.payload,
            basedOnVersionSet: target.basedOnVersionSet,
            adoptedContent: {
              contentReference: {
                identity: section.id,
                version: proposal.currentRevisionId,
                hash: contentHash,
              },
              contentHash,
            },
          };
        });
        const decision = createAdoptionDecision({
          proposal,
          id: body.decision.id,
          decisionType: "adopt",
          targets,
          actor: body.decision.actor,
          reason: body.decision.reason,
          decidedAt,
        });
        const preparation = await productSurface.prepareAdoption({
          changeSet,
          parentRevision,
          proposal,
          decision,
          revisionId: body.revisionId,
          createdAt: decidedAt,
        });
        return reply.code(201).send(preparation);
      },
    );
  });

  app.post("/run-plans", async (request, reply) => {
    if (!productSurface) return productSurfaceUnavailable(reply);
    const novelId = z.object({ novelId: z.string().min(1) }).parse(request.body).novelId;
    return pipeline.execute(
      routeContracts.createRunPlanRevision,
      routeBoundaryContext(request, novelId),
      routeBoundaryInput(request),
      async () => {
        const body = runPlanRevisionRequestSchema.parse(request.body);
        const revision = await productSurface.createRunPlanRevision({
          id: body.id,
          planId: body.planId,
          novelId: body.novelId,
          revisionNumber: body.revisionNumber,
          ...(body.parentRevisionId === undefined
            ? {}
            : { parentRevisionId: body.parentRevisionId }),
          goal: body.goal,
          steps: body.steps,
          createdAt: body.createdAt === undefined ? new Date() : new Date(body.createdAt),
        });
        return reply.code(201).send(revision);
      },
    );
  });

  app.post("/run-plans/:planRevisionId/approvals", async (request, reply) => {
    const params = z.object({ planRevisionId: z.string().min(1) }).parse(request.params);
    if (!productSurface || !productDependencies) return productSurfaceUnavailable(reply);
    const revision = await productDependencies.runPersistence.planRevisions.findById(
      params.planRevisionId,
    );
    if (!revision) return reply.code(404).send({ error: "Run Plan Revision not found" });
    return pipeline.execute(
      routeContracts.approveRunPlan,
      routeBoundaryContext(request, revision.novelId),
      routeBoundaryInput(request),
      async () => {
        const body = runPlanApprovalRequestSchema.parse(request.body);
        const approval = await productSurface.approveRunPlan({
          approvalId: body.approvalId,
          planRevisionId: params.planRevisionId,
          approvedBy: body.approvedBy,
          approvedAt: body.approvedAt === undefined ? new Date() : new Date(body.approvedAt),
          evidenceReferences: body.evidenceReferences,
        });
        return reply.code(201).send(approval);
      },
    );
  });

  app.post("/runs", async (request, reply) => {
    if (!productSurface || !productDependencies) return productSurfaceUnavailable(reply);
    const body = startRunRequestSchema.parse(request.body);
    return pipeline.execute(
      routeContracts.startRun,
      routeBoundaryContext(request, body.novelId),
      routeBoundaryInput(request),
      async () => {
        const revision = await productDependencies.runPersistence.planRevisions.findById(
          body.runPlanRevisionId,
        );
        if (!revision) return reply.code(404).send({ error: "Run Plan Revision not found" });
        if (revision.novelId !== body.novelId) {
          throw new ResourceIsolationError(
            `Run Plan Revision ${revision.id} belongs to a different workspace`,
          );
        }
        const approval = await productDependencies.runPersistence.planApprovals.findByRevisionId(
          revision.id,
          revision.novelId,
        );
        if (!approval || !approveRunPlanRevision(approval, revision)) {
          return reply.code(409).send({ error: "Run Plan Revision is not approved" });
        }
        const view = await productSurface.startRun({
          id: body.id,
          novelId: body.novelId,
          runPlanRevision: revision,
          createdAt: body.createdAt === undefined ? new Date() : new Date(body.createdAt),
        });
        return reply.code(201).send(view);
      },
    );
  });

  app.post("/runs/:runId/pause", async (request, reply) => {
    if (!productSurface || !productDependencies) return productSurfaceUnavailable(reply);
    const params = z.object({ runId: z.string().min(1) }).parse(request.params);
    const run = await productDependencies.runPersistence.runs.findById(params.runId);
    if (!run) return reply.code(404).send({ error: "Production Run not found" });
    return pipeline.execute(
      routeContracts.pauseRun,
      routeBoundaryContext(request, run.novelId),
      routeBoundaryInput(request),
      async () => {
        const body = runTransitionRequestSchema.parse(request.body ?? {});
        const view = await productSurface.pauseRun({
          runId: params.runId,
          at: body.at === undefined ? new Date() : new Date(body.at),
          ...(body.reason === undefined ? {} : { reason: body.reason }),
        });
        return reply.code(200).send(view);
      },
    );
  });

  app.post("/runs/:runId/resume", async (request, reply) => {
    if (!productSurface || !productDependencies) return productSurfaceUnavailable(reply);
    const params = z.object({ runId: z.string().min(1) }).parse(request.params);
    const run = await productDependencies.runPersistence.runs.findById(params.runId);
    if (!run) return reply.code(404).send({ error: "Production Run not found" });
    return pipeline.execute(
      routeContracts.resumeRun,
      routeBoundaryContext(request, run.novelId),
      routeBoundaryInput(request),
      async () => {
        const body = runTransitionRequestSchema.parse(request.body ?? {});
        const view = await productSurface.resumeRun({
          runId: params.runId,
          at: body.at === undefined ? new Date() : new Date(body.at),
        });
        return reply.code(200).send(view);
      },
    );
  });

  app.get("/runs/:runId/status", async (request, reply) => {
    if (!productSurface || !productDependencies) return productSurfaceUnavailable(reply);
    const params = z.object({ runId: z.string().min(1) }).parse(request.params);
    const run = await productDependencies.runPersistence.runs.findById(params.runId);
    if (!run) return reply.code(404).send({ error: "Production Run not found" });
    return pipeline.execute(
      routeContracts.runStatus,
      routeBoundaryContext(request, run.novelId),
      routeBoundaryInput(request),
      async () => {
        const view = await productSurface.getRunStatus({ runId: params.runId });
        return reply.code(200).send(view);
      },
    );
  });

  app.get("/novels/:novelId/attention", async (request, reply) => {
    const novelId = requiredPathParameter(request, "novelId");
    return pipeline.execute(
      routeContracts.recallAttention,
      routeBoundaryContext(request, novelId),
      routeBoundaryInput(request),
      async () => {
        if (!productSurface) return productSurfaceUnavailable(reply);
        const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
        const view = await productSurface.getAttention({ novelId: params.novelId });
        return reply.code(200).send(view);
      },
    );
  });

  app.post("/attention/:itemId/dispositions", async (request, reply) => {
    const params = z.object({ itemId: z.string().min(1) }).parse(request.params);
    const body = attentionDispositionRequestSchema.parse(request.body);
    const context = recallBoundaryContext(request, params.itemId, body.novelId);
    return pipeline.execute(
      routeContracts.recordRecallDisposition,
      context,
      routeBoundaryInput(request),
      async () => {
        if (!productSurface) return productSurfaceUnavailable(reply);
        const record = await productSurface.disposeAttention({
          item: {
            itemId: params.itemId,
            novelId: body.novelId,
            candidateId: body.candidateId,
            evidenceFingerprint: body.evidenceFingerprint,
            explanation: {
              reason: body.reason,
              evidenceReferences: body.evidenceReferences,
            },
          },
          action: body.action,
          actorId: body.actorId ?? context.principal.subjectId,
          occurredAt: new Date().toISOString(),
          ...(body.snoozedUntil === undefined ? {} : { snoozedUntil: body.snoozedUntil }),
          ...(body.actionId === undefined ? {} : { actionId: body.actionId }),
        });
        return reply.code(201).send(record);
      },
    );
  });

  app.get("/novels/:novelId/structure", async (request, reply) => {
    const novelId = requiredPathParameter(request, "novelId");
    return pipeline.execute(
      routeContracts.structuralNavigation,
      routeBoundaryContext(request, novelId),
      routeBoundaryInput(request),
      async () => {
        const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
        const view = await structuralNavigation.getStructure(params.novelId);
        return reply.code(200).send(view);
      },
    );
  });

  app.get("/novels/:novelId/scenes/:sceneId", async (request, reply) => {
    const novelId = requiredPathParameter(request, "novelId");
    return pipeline.execute(
      routeContracts.sceneRead,
      routeBoundaryContext(request, novelId),
      routeBoundaryInput(request),
      async () => {
        const params = z
          .object({ novelId: z.string().min(1), sceneId: z.string().min(1) })
          .parse(request.params);
        const view = await sceneRead.getScene({
          novelId: params.novelId,
          sceneId: params.sceneId,
        });
        if (!view) return reply.code(404).send({ error: "Scene not found" });
        return reply.code(200).send(view);
      },
    );
  });

  /**
   * The transport is POST only because the span descriptor carries text. The
   * contract is a read-only query: the handler writes nothing and the boundary
   * treats it as a query.
   */
  app.post("/novels/:novelId/scenes/:sceneId/span-resolution", async (request, reply) => {
    const novelId = requiredPathParameter(request, "novelId");
    return pipeline.execute(
      routeContracts.targetSpanResolution,
      routeBoundaryContext(request, novelId),
      routeBoundaryInput(request),
      async () => {
        const params = z
          .object({ novelId: z.string().min(1), sceneId: z.string().min(1) })
          .parse(request.params);
        const span = targetSpanDescriptorSchema.parse(request.body);
        const view = await targetSpanResolution.resolveSpan({
          novelId: params.novelId,
          sceneId: params.sceneId,
          span,
        });
        if (!view) return reply.code(404).send({ error: "Scene not found" });
        return reply.code(200).send(view);
      },
    );
  });

  app.post("/novels/:novelId/arcs", async (request, reply) => {
    const novelId = requiredPathParameter(request, "novelId");
    return pipeline.execute(
      routeContracts.createArc,
      routeBoundaryContext(request, novelId),
      routeBoundaryInput(request),
      async () => {
        const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
        const body = z
          .object({ id: z.string().min(1), title: z.string().min(1) })
          .parse(request.body);
        const arc = await structureCommands.createArc({
          id: body.id,
          novelId: params.novelId,
          title: body.title,
          createdAt: new Date(),
        });
        return reply.code(201).send(arc);
      },
    );
  });

  app.post("/novels/:novelId/chapters", async (request, reply) => {
    const novelId = requiredPathParameter(request, "novelId");
    return pipeline.execute(
      routeContracts.createChapter,
      routeBoundaryContext(request, novelId),
      routeBoundaryInput(request),
      async () => {
        const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
        const body = z
          .object({ id: z.string().min(1), arcId: z.string().min(1), title: z.string().min(1) })
          .parse(request.body);
        const chapter = await structureCommands.createChapter({
          id: body.id,
          novelId: params.novelId,
          arcId: body.arcId,
          title: body.title,
          createdAt: new Date(),
        });
        return reply.code(201).send(chapter);
      },
    );
  });

  app.post("/arcs/:arcId/chapter-order", async (request, reply) => {
    const arcId = requiredPathParameter(request, "arcId");
    const arc = await dependencies.arcs.findById(arcId);
    if (!arc) return reply.code(404).send({ error: "Arc not found" });
    return pipeline.execute(
      routeContracts.reorderStructure,
      routeBoundaryContext(request, arc.novelId),
      routeBoundaryInput(request),
      async () => {
        const body = z
          .object({ chapterIds: z.array(z.string().min(1)) })
          .parse(request.body);
        const updated = await structureCommands.reorderArcChapters({
          arcId,
          chapterIds: body.chapterIds,
          updatedAt: new Date(),
        });
        return reply.code(200).send(updated);
      },
    );
  });

  app.post("/chapters/:chapterId/scene-order", async (request, reply) => {
    const chapterId = requiredPathParameter(request, "chapterId");
    const chapter = await dependencies.chapters.findById(chapterId);
    if (!chapter) return reply.code(404).send({ error: "Chapter not found" });
    return pipeline.execute(
      routeContracts.reorderStructure,
      routeBoundaryContext(request, chapter.novelId),
      routeBoundaryInput(request),
      async () => {
        const body = z.object({ sceneIds: z.array(z.string().min(1)) }).parse(request.body);
        const updated = await structureCommands.reorderChapterScenes({
          chapterId,
          sceneIds: body.sceneIds,
          updatedAt: new Date(),
        });
        return reply.code(200).send(updated);
      },
    );
  });
}

const workspaceFocusQuerySchema = z.object({
  object: z
    .enum([
      "story-foundation",
      "proposal",
      "canonical_fact",
      "plan",
      "structure",
      "manuscript",
      "story_state",
    ])
    .optional(),
  objectId: z.string().min(1).optional(),
  mode: z.enum(["design", "review"]).optional(),
  taskId: z.string().min(1).optional(),
});

const foundationEntryModeSchema = z.enum(["idea", "existing_text", "blank"]);

const targetSpanDescriptorSchema = z.object({
  anchorId: z.string().min(1),
  text: z.string(),
  sourceContentHash: z.string().min(1),
});

const sourceReferenceSchema = z.object({
  identity: z.string().min(1),
  version: z.string().min(1),
  hash: z.string().min(1),
});

const foundationEntryGenerationOptionsSchema = z.object({
  taskId: z.string().min(1),
  agentRole: z.enum([
    "planner",
    "writer",
    "editor",
    "reviewer",
    "consistency_agent",
    "memory_agent",
  ]),
  modelPolicy: modelPolicySchema,
  basedOnVersionSet: versionSetSchema,
  context: freeFormRecordSchema.optional(),
});

const foundationEntryRequestSchema = z.object({
  entryId: z.string().min(1),
  novelId: z.string().min(1),
  proposalId: z.string().min(1).optional(),
  mode: foundationEntryModeSchema,
  idea: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  proposalType: z.enum([
    "story_concept",
    "core_conflict",
    "world_direction",
    "protagonist_direction",
    "main_plot_story_engine",
    "character",
    "relationship",
    "plot_thread",
    "foreshadowing",
    "theme",
    "long_form_direction",
  ]).optional(),
  scope: freeFormRecordSchema.optional(),
  occurredAt: z.string().min(1).optional(),
  sourceReference: sourceReferenceSchema.optional(),
  generation: foundationEntryGenerationOptionsSchema.optional(),
});

const proposalTransitionRequestSchema = z.object({
  from: z.enum(["frame", "explore", "deepen", "refine"]),
  to: z.enum(["frame", "explore", "deepen", "refine"]),
  changes: z.array(z.unknown()).min(1),
  actor: z.enum(["author", "ai", "system"]).optional(),
  evidence: sourceReferenceSchema.optional(),
  revisedAt: z.string().min(1).optional(),
});

const adoptionTargetRequestSchema = z.object({
  id: z.string().min(1),
  sectionIdentity: z.string().min(1),
  targetType: z.enum(["canonical_fact", "plan", "structure", "manuscript", "story_state"]),
  objectId: z.string().min(1),
  subAddress: z.string().min(1).optional(),
  proposedChangeId: z.string().min(1),
  payload: freeFormRecordSchema,
  basedOnVersionSet: versionSetSchema,
});

const adoptionPreparationRequestSchema = z.object({
  revisionId: z.string().min(1),
  changeSet: z.object({
    id: z.string().min(1),
    novelId: z.string().min(1),
    initialRevisionId: z.string().min(1),
    createdAt: z.string().min(1),
  }),
  parentRevision: z.object({
    revisionId: z.string().min(1),
    changeSetId: z.string().min(1),
    novelId: z.string().min(1),
    revisionNumber: z.number().int().positive(),
    trigger: z.object({
      type: z.enum(["initial_assembly", "edit", "conflict_resolution", "rebase", "regenerate"]),
      references: z.array(z.string().min(1)),
    }),
    changes: z.array(z.unknown()),
    createdAt: z.string().min(1),
  }),
  decision: z.object({
    id: z.string().min(1),
    reason: z.string().min(1),
    actor: z.object({
      type: z.enum(["author", "policy"]),
      identity: z.string().min(1),
    }),
    decidedAt: z.string().min(1).optional(),
    targets: z.array(adoptionTargetRequestSchema).min(1),
  }),
});

const runPlanStepSchema = z.object({
  id: z.string().min(1),
  ordinal: z.number().int().positive(),
  generationTaskId: z.string().min(1),
  dependsOn: z.array(z.string().min(1)),
});

const runPlanRevisionRequestSchema = z.object({
  id: z.string().min(1),
  planId: z.string().min(1),
  novelId: z.string().min(1),
  revisionNumber: z.number().int().positive(),
  parentRevisionId: z.string().min(1).optional(),
  goal: z.string().min(1),
  steps: z.array(runPlanStepSchema).min(1),
  createdAt: z.string().min(1).optional(),
});

const startRunRequestSchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  runPlanRevisionId: z.string().min(1),
  createdAt: z.string().min(1).optional(),
});

const runPlanApprovalRequestSchema = z.object({
  approvalId: z.string().min(1),
  approvedBy: z.string().min(1),
  approvedAt: z.string().min(1).optional(),
  evidenceReferences: z.array(z.string().min(1)).min(1),
});

const runTransitionRequestSchema = z.object({
  at: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
});

const attentionDispositionRequestSchema = z.object({
  novelId: z.string().min(1),
  candidateId: z.string().min(1),
  evidenceFingerprint: z.string().min(1),
  reason: z.string().min(1),
  evidenceReferences: z.array(z.string().min(1)).min(1),
  action: z.enum(["inspect", "dismiss", "snooze", "confirm", "ignore", "why"]),
  actorId: z.string().min(1).optional(),
  snoozedUntil: z.string().min(1).optional(),
  actionId: z.string().min(1).optional(),
});

function productSurfaceUnavailable(reply: FastifyReply) {
  return reply.code(503).send({ error: "Product surface unavailable" });
}

/**
 * Recall attention is auditable, so the boundary resource and correlation bind
 * the same recall item identity.
 */
function recallBoundaryContext(
  request: FastifyRequest,
  itemId: string,
  workspaceId: string,
): HttpBoundaryContext {
  const base = routeBoundaryContext(request, workspaceId);
  return {
    ...base,
    resource: { kind: "recall", id: itemId },
    correlation: { ...base.correlation, recallId: itemId },
  };
}

function reviveChange(value: unknown): Change {
  return createChange(value as Parameters<typeof createChange>[0]);
}

function reviveChangeSetRevision(
  payload: z.infer<typeof adoptionPreparationRequestSchema>["parentRevision"],
): ChangeSetRevision {
  const base = createInitialChangeSetRevision({
    revisionId: payload.revisionId,
    changeSetId: payload.changeSetId,
    novelId: payload.novelId,
    createdAt: new Date(payload.createdAt),
  });
  return Object.freeze({
    ...base,
    revisionNumber: payload.revisionNumber,
    trigger: Object.freeze({
      type: payload.trigger.type,
      references: Object.freeze([...payload.trigger.references]),
    }),
    changes: Object.freeze(payload.changes.map(reviveChange)),
  });
}

function reviveChangeSet(
  payload: z.infer<typeof adoptionPreparationRequestSchema>["changeSet"],
  parentRevision: ChangeSetRevision,
): ChangeSet {
  const base = createChangeSet({
    id: payload.id,
    novelId: payload.novelId,
    initialRevisionId: payload.initialRevisionId,
    createdAt: new Date(payload.createdAt),
  });
  return replaceChangeSetChanges({
    changeSet: base,
    changes: parentRevision.changes,
    revisionId: parentRevision.revisionId,
    updatedAt: new Date(parentRevision.createdAt),
  });
}
