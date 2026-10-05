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
import type { GenerationTask } from "../production/domain/generationTask";
import {
  createGenerationTask,
  startGenerationTask,
} from "../production/domain/generationTask";
import type {
  Candidate,
  CandidateAtomicChange,
} from "../production/domain/candidate";
import { createCandidate } from "../production/domain/candidate";
import {
  assertNoDuplicateTargets,
  createChange,
  type Change,
  type ChangeSourceType,
} from "../production/domain/change";
import {
  createInitialChangeSetRevision,
  type ChangeSetRevision,
} from "../production/domain/changeSetRevision";
import { validateCandidate } from "../production/application/validateCandidate";
import {
  approvalScopeKey,
  createReviewDecision,
  type ApprovalScope,
  type ReviewDecision,
} from "../production/domain/reviewDecision";
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

export interface ApiDependencies {
  readonly novels: Repository<Novel>;
  readonly scenes: RevisionedRepository<Scene>;
  readonly generationTasks: Repository<GenerationTask>;
  readonly candidates: RevisionedRepository<Candidate>;
  readonly canonicalFacts: RevisionedRepository<CanonicalFact>;
  readonly stateRecords: RevisionedRepository<StateRecord>;
  readonly narrativeCommits: Repository<NarrativeCommit>;
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

const commitRequestSchema = z.object({
  commitId: z.string().min(1),
  changeSetRevisionId: z.string().min(1),
  candidateId: z.string().min(1),
  candidateSource: z.object({
    version: z.string().min(1),
    hash: z.string().min(1),
  }),
  planVersionId: z.string().min(1),
  validationId: z.string().min(1),
  mustPreserve: z.array(z.string().min(1)),
  currentRevisionFacts: z.object({
    unresolvedConflict: z.boolean(),
    unresolvedConflictEvidenceReferences: z.array(z.string().min(1)).optional(),
    stale: z.boolean(),
    staleEvidenceReferences: z.array(z.string().min(1)).optional(),
  }),
  targetInvariantViolations: z.array(targetInvariantViolationSchema),
  requiredApproval: z.boolean(),
  approvalScopeRequirements: z.array(approvalScopeRequirementSchema).min(1),
  reviewDecision: z.object({
    id: z.string().min(1),
    decidedBy: z.enum(["human", "policy"]),
    actorId: z.string().min(1),
    reason: z.string(),
    evidenceReferences: z.array(z.string().min(1)),
    policyVersion: z.string().min(1).optional(),
    decisionRule: z.string().min(1).optional(),
  }),
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
  listNovelEvents: "commit.query.commit-evidence",
  workspaceFocus: "foundation.query.workspace-focus",
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
} as const;

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function routeWorkspaceId(request: FastifyRequest): string {
  const header = headerValue(request, "x-workspace-id");
  if (header !== undefined) return header;
  const params = request.params as { novelId?: unknown } | undefined;
  if (params && typeof params.novelId === "string" && params.novelId.length > 0) {
    return params.novelId;
  }
  return "default-workspace";
}

function routeBoundaryContext(request: FastifyRequest): HttpBoundaryContext {
  const workspaceId = routeWorkspaceId(request);
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

  app.post("/novels", async (request, reply) =>
    pipeline.execute(
      routeContracts.createNovel,
      routeBoundaryContext(request),
      routeBoundaryInput(request),
      async () => {
        const body = z
          .object({ id: z.string().min(1), authorId: z.string().min(1), title: z.string().min(1) })
          .parse(request.body);
        const novel = createNovel({ ...body, createdAt: new Date() });
        await dependencies.novels.save(novel);
        return reply.code(201).send(novel);
      },
    ),
  );

  app.post("/novels/:novelId/scenes", async (request, reply) =>
    pipeline.execute(
      routeContracts.createScene,
      routeBoundaryContext(request),
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
    ),
  );

  app.post("/novels/:novelId/generation-tasks", async (request, reply) =>
    pipeline.execute(
      routeContracts.createGenerationTask,
      routeBoundaryContext(request),
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
    ),
  );

  app.post("/generation-tasks/:taskId/candidates", async (request, reply) =>
    pipeline.execute(
      routeContracts.submitGenerationCandidate,
      routeBoundaryContext(request),
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
        const task = await dependencies.generationTasks.findById(params.taskId);
        if (!task) return reply.code(404).send({ error: "Not Found" });

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
    ),
  );

  app.post("/change-sets/:changeSetId/commit", async (request, reply) =>
    pipeline.execute(
      routeContracts.commitChangeSetRevision,
      routeBoundaryContext(request),
      routeBoundaryInput(request),
      async () => {
        const params = z.object({ changeSetId: z.string().min(1) }).parse(request.params);
        const body = commitRequestSchema.parse(request.body);
        const candidate = await dependencies.candidates.findById(body.candidateId);
        if (!candidate) {
          return reply.code(404).send({ error: "Not Found" });
        }

        const now = new Date();
        const atomicChanges = candidateAtomicChanges(candidate.change);
        const sceneChange = atomicChanges.find(change =>
          change.type === "text" || change.type === "local_text",
        );
        const scene =
          sceneChange && (sceneChange.type === "text" || sceneChange.type === "local_text")
            ? await dependencies.scenes.findById(sceneChange.sceneId)
            : undefined;
        if (sceneChange && !scene) {
          return reply.code(409).send({ error: "Target scene not found" });
        }

        const changes = atomicChanges.map((change, index) =>
          candidateChangeToDomainChange({
            change,
            id: `change:${body.changeSetRevisionId}:${index + 1}`,
            sourceType: "candidate",
            sourceReference: {
              identity: body.candidateId,
              version: body.candidateSource.version,
              hash: body.candidateSource.hash,
            },
            basedOnVersionSet: candidate.basedOnVersionSet,
          }),
        );
        const revision = withChanges(
          createInitialChangeSetRevision({
            revisionId: body.changeSetRevisionId,
            changeSetId: params.changeSetId,
            novelId: candidate.novelId,
            createdAt: now,
          }),
          changes,
        );

        const validation = validateCandidate({
          validationId: body.validationId,
          changeSetRevisionId: revision.revisionId,
          planVersionId: body.planVersionId,
          candidate,
          scene,
          mustPreserve: body.mustPreserve,
          createdAt: now,
        });
        if (validation.outcome === "fail") return reply.code(422).send(validation.run);

        const requirements = body.approvalScopeRequirements.map(
          (requirement): CommitChangeSetRevisionApprovalRequirement => requirement,
        );
        const reviewDecisions = reviewsForRequirements({
          revision,
          requirements,
          template: body.reviewDecision,
          validationId: body.validationId,
          createdAt: now,
        });

        try {
          const commit = await commitChangeSetRevision({
            transaction: dependencies.commitTransaction,
            input: {
              commitId: body.commitId,
              changeSetRevision: revision,
              validationRuns: [validation.run],
              reviewDecisions,
              currentRevisionFacts: body.currentRevisionFacts,
              targetInvariantViolations: body.targetInvariantViolations,
              requiredApproval: body.requiredApproval,
              approvalScopeRequirements: requirements,
              now,
            },
          });
          return reply.code(201).send(commit);
        } catch (error) {
          if (error instanceof CommitGateBlockedError) {
            return reply.code(409).send({
              error: "Commit Conflict",
              blockers: error.gate.blockers,
              requiredActions: error.gate.requiredActions,
            });
          }
          if (error instanceof Error && error.message.startsWith("Stale dependency:")) {
            return reply.code(409).send({ error: "Commit Conflict", reason: error.message });
          }
          throw error;
        }
      },
    ),
  );

  app.get("/novels/:novelId/events", async request =>
    pipeline.execute(
      routeContracts.listNovelEvents,
      routeBoundaryContext(request),
      routeBoundaryInput(request),
      async () => {
        const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
        return dependencies.eventStore.listByNovel(params.novelId);
      },
    ),
  );

  app.get("/workspace/:novelId", async (request, reply) =>
    pipeline.execute(
      routeContracts.workspaceFocus,
      routeBoundaryContext(request),
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
    ),
  );

  app.post("/foundation/entries", async (request, reply) => {
    if (!productSurface) return productSurfaceUnavailable(reply);
    const mode = foundationEntryModeSchema.parse(
      (request.body as { mode?: unknown } | undefined)?.mode,
    );
    const contractId =
      mode === "idea"
        ? routeContracts.enterFoundationIdea
        : mode === "existing_text"
          ? routeContracts.extractFoundationText
          : routeContracts.createBlankFoundation;
    return pipeline.execute(
      contractId,
      routeBoundaryContext(request),
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

  app.post("/foundation/proposals/:proposalId/transitions", async (request, reply) =>
    pipeline.execute(
      routeContracts.reviseProposal,
      routeBoundaryContext(request),
      routeBoundaryInput(request),
      async () => {
        if (!productSurface) return productSurfaceUnavailable(reply);
        const params = z.object({ proposalId: z.string().min(1) }).parse(request.params);
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
    ),
  );

  app.post("/foundation/proposals/:proposalId/adoption-preparations", async (request, reply) =>
    pipeline.execute(
      routeContracts.adoptProposalContent,
      routeBoundaryContext(request),
      routeBoundaryInput(request),
      async () => {
        if (!productSurface || !productDependencies) return productSurfaceUnavailable(reply);
        const params = z.object({ proposalId: z.string().min(1) }).parse(request.params);
        const body = adoptionPreparationRequestSchema.parse(request.body);
        const proposal = await productDependencies.foundationPersistence.proposals.findById(
          params.proposalId,
        );
        if (!proposal) return reply.code(404).send({ error: "Proposal not found" });

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
    ),
  );

  app.post("/run-plans", async (request, reply) =>
    pipeline.execute(
      routeContracts.createRunPlanRevision,
      routeBoundaryContext(request),
      routeBoundaryInput(request),
      async () => {
        if (!productSurface) return productSurfaceUnavailable(reply);
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
    ),
  );

  app.post("/run-plans/:planRevisionId/approvals", async (request, reply) => {
    const params = z.object({ planRevisionId: z.string().min(1) }).parse(request.params);
    return pipeline.execute(
      routeContracts.approveRunPlan,
      routeBoundaryContext(request),
      routeBoundaryInput(request),
      async () => {
        if (!productSurface || !productDependencies) return productSurfaceUnavailable(reply);
        const body = runPlanApprovalRequestSchema.parse(request.body);
        const revision = await productDependencies.runPersistence.planRevisions.findById(
          params.planRevisionId,
        );
        if (!revision) return reply.code(404).send({ error: "Run Plan Revision not found" });
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

  app.post("/runs", async (request, reply) =>
    pipeline.execute(
      routeContracts.startRun,
      routeBoundaryContext(request),
      routeBoundaryInput(request),
      async () => {
        if (!productSurface || !productDependencies) return productSurfaceUnavailable(reply);
        const body = startRunRequestSchema.parse(request.body);
        const revision = await productDependencies.runPersistence.planRevisions.findById(
          body.runPlanRevisionId,
        );
        if (!revision) return reply.code(404).send({ error: "Run Plan Revision not found" });
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
    ),
  );

  app.post("/runs/:runId/pause", async (request, reply) =>
    pipeline.execute(
      routeContracts.pauseRun,
      routeBoundaryContext(request),
      routeBoundaryInput(request),
      async () => {
        if (!productSurface || !productDependencies) return productSurfaceUnavailable(reply);
        const params = z.object({ runId: z.string().min(1) }).parse(request.params);
        const run = await productDependencies.runPersistence.runs.findById(params.runId);
        if (!run) return reply.code(404).send({ error: "Production Run not found" });
        const body = runTransitionRequestSchema.parse(request.body ?? {});
        const view = await productSurface.pauseRun({
          runId: params.runId,
          at: body.at === undefined ? new Date() : new Date(body.at),
          ...(body.reason === undefined ? {} : { reason: body.reason }),
        });
        return reply.code(200).send(view);
      },
    ),
  );

  app.post("/runs/:runId/resume", async (request, reply) =>
    pipeline.execute(
      routeContracts.resumeRun,
      routeBoundaryContext(request),
      routeBoundaryInput(request),
      async () => {
        if (!productSurface || !productDependencies) return productSurfaceUnavailable(reply);
        const params = z.object({ runId: z.string().min(1) }).parse(request.params);
        const run = await productDependencies.runPersistence.runs.findById(params.runId);
        if (!run) return reply.code(404).send({ error: "Production Run not found" });
        const body = runTransitionRequestSchema.parse(request.body ?? {});
        const view = await productSurface.resumeRun({
          runId: params.runId,
          at: body.at === undefined ? new Date() : new Date(body.at),
        });
        return reply.code(200).send(view);
      },
    ),
  );

  app.get("/runs/:runId/status", async (request, reply) =>
    pipeline.execute(
      routeContracts.runStatus,
      routeBoundaryContext(request),
      routeBoundaryInput(request),
      async () => {
        if (!productSurface || !productDependencies) return productSurfaceUnavailable(reply);
        const params = z.object({ runId: z.string().min(1) }).parse(request.params);
        const run = await productDependencies.runPersistence.runs.findById(params.runId);
        if (!run) return reply.code(404).send({ error: "Production Run not found" });
        const view = await productSurface.getRunStatus({ runId: params.runId });
        return reply.code(200).send(view);
      },
    ),
  );

  app.get("/novels/:novelId/attention", async (request, reply) =>
    pipeline.execute(
      routeContracts.recallAttention,
      routeBoundaryContext(request),
      routeBoundaryInput(request),
      async () => {
        if (!productSurface) return productSurfaceUnavailable(reply);
        const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
        const view = await productSurface.getAttention({ novelId: params.novelId });
        return reply.code(200).send(view);
      },
    ),
  );

  app.post("/attention/:itemId/dispositions", async (request, reply) => {
    const params = z.object({ itemId: z.string().min(1) }).parse(request.params);
    return pipeline.execute(
      routeContracts.recordRecallDisposition,
      recallBoundaryContext(request, params.itemId),
      routeBoundaryInput(request),
      async () => {
        if (!productSurface) return productSurfaceUnavailable(reply);
        const body = attentionDispositionRequestSchema.parse(request.body);
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
          actorId: body.actorId ?? routeBoundaryContext(request).principal.subjectId,
          occurredAt: new Date().toISOString(),
          ...(body.snoozedUntil === undefined ? {} : { snoozedUntil: body.snoozedUntil }),
          ...(body.actionId === undefined ? {} : { actionId: body.actionId }),
        });
        return reply.code(201).send(record);
      },
    );
  });
}

function candidateAtomicChanges(
  change: Candidate["change"],
): readonly CandidateAtomicChange[] {
  return change.type === "composite" ? change.changes : [change];
}

function candidateChangeToDomainChange(input: {
  change: CandidateAtomicChange;
  id: string;
  sourceType: ChangeSourceType;
  sourceReference: {
    identity: string;
    version: string;
    hash: string;
  };
  basedOnVersionSet: VersionSet;
}): Change {
  const { change } = input;
  if (change.type === "text") {
    return createChange({
      id: input.id,
      sourceType: input.sourceType,
      sourceReference: input.sourceReference,
      targetAddress: { targetType: "manuscript", objectId: change.sceneId },
      payload: { text: change.text },
      basedOnVersionSet: input.basedOnVersionSet,
    });
  }
  if (change.type === "local_text") {
    return createChange({
      id: input.id,
      sourceType: input.sourceType,
      sourceReference: input.sourceReference,
      targetAddress: {
        targetType: "manuscript",
        objectId: change.sceneId,
        subAddress: change.targetSpan.anchorId,
      },
      payload: { targetSpan: change.targetSpan, replacement: change.replacement },
      basedOnVersionSet: input.basedOnVersionSet,
    });
  }
  if (change.type === "canonical_fact") {
    return createChange({
      id: input.id,
      sourceType: input.sourceType,
      sourceReference: input.sourceReference,
      targetAddress: { targetType: "canonical_fact", objectId: change.canonicalFactId },
      payload: change.content,
      basedOnVersionSet: input.basedOnVersionSet,
    });
  }
  return createChange({
    id: input.id,
    sourceType: input.sourceType,
    sourceReference: input.sourceReference,
    targetAddress: { targetType: "story_state", objectId: change.stateRecordId },
    payload: change.content,
    basedOnVersionSet: input.basedOnVersionSet,
  });
}

function withChanges(revision: ChangeSetRevision, changes: readonly Change[]): ChangeSetRevision {
  try {
    assertNoDuplicateTargets(changes);
  } catch (error) {
    throw new CommitConflictError(
      "duplicate_target",
      error instanceof Error ? error.message : "Duplicate target address",
    );
  }
  return Object.freeze({
    ...revision,
    changes: Object.freeze([...changes]),
  });
}

function reviewsForRequirements(input: {
  revision: ChangeSetRevision;
  requirements: readonly CommitChangeSetRevisionApprovalRequirement[];
  template: z.infer<typeof commitRequestSchema>["reviewDecision"];
  validationId: string;
  createdAt: Date;
}): readonly ReviewDecision[] {
  const unique = new Map<string, ApprovalScope>();
  for (const requirement of input.requirements) {
    const key = approvalScopeKey(requirement.approvalScope);
    if (!unique.has(key)) unique.set(key, requirement.approvalScope);
  }
  const scopes = [...unique.values()];
  return scopes.map((approvalScope, index) =>
    createReviewDecision({
      id: scopes.length === 1 ? input.template.id : `${input.template.id}:${index + 1}`,
      changeSetRevisionId: input.revision.revisionId,
      approvalScope,
      decision: "approve",
      decidedBy: input.template.decidedBy,
      actorId: input.template.actorId,
      reason: input.template.reason,
      evidenceReferences: [input.validationId, ...input.template.evidenceReferences],
      ...(input.template.policyVersion
        ? { policyVersion: input.template.policyVersion }
        : {}),
      ...(input.template.decisionRule ? { decisionRule: input.template.decisionRule } : {}),
      createdAt: input.createdAt,
    }),
  );
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
function recallBoundaryContext(request: FastifyRequest, itemId: string): HttpBoundaryContext {
  const base = routeBoundaryContext(request);
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
