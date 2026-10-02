import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { Repository, RevisionedRepository } from "../shared/application/repository";
import type { VersionSet } from "../shared/domain/versioning";
import type { Novel } from "../narrative/novel/domain/novel";
import { createNovel } from "../narrative/novel/domain/novel";
import type { Scene } from "../manuscript/domain/scene";
import { createScene } from "../manuscript/domain/scene";
import type { GenerationTask } from "../production/domain/generationTask";
import {
  addCandidateReference,
  createGenerationTask,
  startGenerationTask,
} from "../production/domain/generationTask";
import type { Candidate } from "../production/domain/candidate";
import {
  createCandidate,
  markCandidateValidated,
  selectCandidate,
} from "../production/domain/candidate";
import type { ValidationRun } from "../production/domain/validationRun";
import type { ReviewDecision } from "../production/domain/reviewDecision";
import { createReviewDecision } from "../production/domain/reviewDecision";
import type { CanonicalFact } from "../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../narrative/state/domain/stateRecord";
import type { NarrativeCommit } from "../safety/domain/narrativeCommit";
import type { EventStore } from "../safety/infrastructure/eventStore";
import type { RuntimeAdapter } from "../production/runtime/runtimeAdapter";
import { validateCandidate } from "../production/application/validateCandidate";
import { commitCandidate } from "../safety/application/commitCandidate";

export interface ApiDependencies {
  readonly novels: Repository<Novel>;
  readonly scenes: RevisionedRepository<Scene>;
  readonly generationTasks: Repository<GenerationTask>;
  readonly candidates: RevisionedRepository<Candidate>;
  readonly validationRuns: Repository<ValidationRun>;
  readonly reviewDecisions: Repository<ReviewDecision>;
  readonly canonicalFacts: RevisionedRepository<CanonicalFact>;
  readonly stateRecords: RevisionedRepository<StateRecord>;
  readonly narrativeCommits: Repository<NarrativeCommit>;
  readonly eventStore: EventStore;
  readonly runtime: RuntimeAdapter;
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

const freeFormRecordSchema = z.custom<Record<string, unknown>>(
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

export function registerNovelBrainRoutes(app: FastifyInstance, dependencies: ApiDependencies): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "Bad Request", details: error.issues });
    }
    return reply.send(error);
  });

  app.post("/novels", async (request, reply) => {
    const body = z
      .object({ id: z.string().min(1), authorId: z.string().min(1), title: z.string().min(1) })
      .parse(request.body);
    const novel = createNovel({ ...body, createdAt: new Date() });
    await dependencies.novels.save(novel);
    return reply.code(201).send(novel);
  });

  app.post("/novels/:novelId/scenes", async (request, reply) => {
    const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
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
  });

  app.post("/novels/:novelId/generation-tasks", async (request, reply) => {
    const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        id: z.string().min(1),
        operation: generationOperationSchema,
        targetSceneId: z.string().min(1),
        intent: z.string().min(1),
        basedOnVersionSet: versionSetSchema,
      })
      .parse(request.body);
    const task = createGenerationTask({
      ...body,
      novelId: params.novelId,
      createdAt: new Date(),
    });
    await dependencies.generationTasks.save(task);
    return reply.code(201).send(task);
  });

  app.post("/generation-tasks/:taskId/candidates", async (request, reply) => {
    const params = z.object({ taskId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        id: z.string().min(1),
        agentRole: z.enum(["planner", "writer", "editor", "reviewer", "consistency_agent", "memory_agent"]),
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
    const updatedTask = addCandidateReference(startedTask, candidate.id);
    await dependencies.generationTasks.save(updatedTask);
    await dependencies.candidates.save(candidate);
    return reply.code(201).send(candidate);
  });

  app.post("/candidates/:candidateId/commit", async (request, reply) => {
    const params = z.object({ candidateId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        commitId: z.string().min(1),
        validationId: z.string().min(1),
        reviewId: z.string().min(1),
        actorId: z.string().min(1),
        mustPreserve: z.array(z.string().min(1)),
      })
      .parse(request.body);
    const candidate = await dependencies.candidates.findById(params.candidateId);
    if (!candidate) return reply.code(404).send({ error: "Not Found" });
    const scene = await dependencies.scenes.findById(taskSceneId(candidate));
    if (!scene) return reply.code(409).send({ error: "Target scene not found" });

    const selectedCandidate = selectCandidate(
      markCandidateValidated(candidate, new Date()),
      new Date(),
    );
    await dependencies.candidates.save(selectedCandidate);

    const validation = validateCandidate({
      validationId: body.validationId,
      candidate: selectedCandidate,
      scene,
      mustPreserve: body.mustPreserve,
      createdAt: new Date(),
    });
    if (validation.outcome === "fail") return reply.code(422).send(validation.run);

    const reviewDecision = createReviewDecision({
      id: body.reviewId,
      candidateId: selectedCandidate.id,
      candidateRevisionId: selectedCandidate.currentRevisionId,
      decision: "approve",
      decidedBy: "human",
      actorId: body.actorId,
      reason: "",
      createdAt: new Date(),
    });
    await dependencies.validationRuns.save(validation.run);
    await dependencies.reviewDecisions.save(reviewDecision);

    const commit = await commitCandidate({
      repositories: {
        scenes: dependencies.scenes,
        candidates: dependencies.candidates,
        canonicalFacts: dependencies.canonicalFacts,
        stateRecords: dependencies.stateRecords,
        narrativeCommits: dependencies.narrativeCommits,
      },
      eventStore: dependencies.eventStore,
      input: {
        commitId: body.commitId,
        candidateId: selectedCandidate.id,
        validationRuns: [validation.run],
        reviewDecision,
        now: new Date(),
      },
    });
    return reply.code(201).send(commit);
  });

  app.get("/novels/:novelId/events", async request => {
    const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
    return dependencies.eventStore.listByNovel(params.novelId);
  });
}

function taskSceneId(candidate: Candidate): string {
  const taskVersion = Object.values(candidate.basedOnVersionSet).find(
    reference => reference.aggregateType === "Scene",
  );
  if (!taskVersion) throw new Error("Candidate has no scene target");
  return taskVersion.objectId;
}
