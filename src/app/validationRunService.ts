import type { PrismaClient } from "@prisma/client";
import { CommitConflictError } from "../shared/application/commitConflict";
import type { RevisionedRepository, UniqueCreatePort } from "../shared/application/repository";
import { canonicalJson } from "../shared/domain/contentHash";
import { capabilityPersistencePayloadCodec } from "../shared/domain/persistencePayload";
import { PrismaRepository } from "../shared/infrastructure/prismaRepositories";
import type { Scene } from "../manuscript/domain/scene";
import type { Candidate } from "../production/domain/candidate";
import type { ValidationRun } from "../production/domain/validationRun";
import { validateCandidate } from "../production/application/validateCandidate";
import {
  changeSetRevisionOf,
  type ChangeSetRevisionRepository,
} from "../production/application/changeSetPersistence";
import { InMemoryRepository } from "./inMemoryRepositories";

/**
 * A ValidationRun is an immutable run, not a revisioned aggregate, so it is
 * created once under its own id. `"ValidationRun"` is a frozen VersionReference
 * aggregate name; the run binds to the Change Set Revision it validated.
 */
export type ValidationRunStore = UniqueCreatePort<ValidationRun>;

export function createInMemoryValidationRunStore(): ValidationRunStore {
  return new InMemoryRepository<ValidationRun>(capabilityPersistencePayloadCodec);
}

export function createPrismaValidationRunStore(
  prisma: PrismaClient,
  aggregateType = "ValidationRun",
): ValidationRunStore {
  return new PrismaRepository<ValidationRun>(
    prisma,
    aggregateType,
    payload => payload as unknown as ValidationRun,
    capabilityPersistencePayloadCodec,
  );
}

export interface RunValidationInput {
  readonly changeSetId: string;
  readonly revisionId: string;
  readonly validationId: string;
  readonly planVersionId: string;
  readonly candidateId: string;
  readonly mustPreserve: readonly string[];
  readonly createdAt: Date;
}

export interface GetValidationInput {
  readonly validationId: string;
  /** When given, the run is only returned if it validated this exact revision. */
  readonly revisionId?: string;
}

export interface ValidationRunService {
  runValidation(input: RunValidationInput): Promise<ValidationRun>;
  getValidation(input: GetValidationInput): Promise<ValidationRun | undefined>;
}

/**
 * Raised when the addressed revision and the supplied content source do not
 * describe the same thing: a run may only be produced for the revision whose
 * content it validates.
 */
export class ValidationBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationBindingError";
  }
}

/** Run identity excludes `createdAt`, so a retry is idempotent, not a conflict. */
function validationIdentity(run: ValidationRun): string {
  return canonicalJson({
    id: run.id,
    changeSetRevisionId: run.changeSetRevisionId,
    planVersionId: run.planVersionId,
    validatorId: run.validatorId,
    entryResults: run.entryResults,
    executionState: run.executionState,
    outcome: run.outcome ?? null,
  });
}

function alreadyExists(): CommitConflictError {
  return new CommitConflictError(
    "unique_record",
    "Validation run already exists with different content",
  );
}

function sceneTargetOf(candidate: Candidate): string | undefined {
  const change = candidate.change;
  const atomicChanges = change.type === "composite" ? change.changes : [change];
  const sceneChange = atomicChanges.find(
    candidateChange => candidateChange.type === "text" || candidateChange.type === "local_text",
  );
  return sceneChange?.sceneId;
}

export function createValidationRunService(dependencies: {
  readonly changeSets: ChangeSetRevisionRepository;
  readonly validations: ValidationRunStore;
  readonly scenes: RevisionedRepository<Scene>;
  readonly candidates: RevisionedRepository<Candidate>;
}): ValidationRunService {
  return {
    async runValidation(input) {
      const stored = await dependencies.changeSets.getRevision(input.changeSetId, input.revisionId);
      if (!stored) {
        throw new ValidationBindingError(
          `Change Set Revision not found: ${input.changeSetId}:${input.revisionId}`,
        );
      }
      const revision = changeSetRevisionOf(stored);

      const candidate = await dependencies.candidates.findById(input.candidateId);
      if (!candidate) {
        throw new ValidationBindingError(`Candidate not found: ${input.candidateId}`);
      }
      // The Candidate only supplies content. The run's subject is the revision,
      // so the revision's changes must actually originate from this candidate.
      const sourced = revision.changes.some(
        change => change.sourceReference.identity === input.candidateId,
      );
      if (!sourced) {
        throw new ValidationBindingError(
          `Candidate ${input.candidateId} is not the source of revision ${input.revisionId}`,
        );
      }

      // A missing scene is a validation finding, not a hard failure: the author
      // runs validation precisely to see what is wrong before deciding to commit.
      const sceneTarget = sceneTargetOf(candidate);
      const scene = sceneTarget === undefined ? undefined : await dependencies.scenes.findById(sceneTarget);

      const { run } = validateCandidate({
        validationId: input.validationId,
        changeSetRevisionId: revision.revisionId,
        planVersionId: input.planVersionId,
        candidate,
        ...(scene === undefined ? {} : { scene }),
        mustPreserve: input.mustPreserve,
        createdAt: input.createdAt,
      });

      const existing = await dependencies.validations.findById(run.id);
      if (existing) {
        if (validationIdentity(existing) !== validationIdentity(run)) throw alreadyExists();
        return existing;
      }
      try {
        await dependencies.validations.saveIfAbsent(run);
      } catch {
        const raced = await dependencies.validations.findById(run.id);
        if (!raced || validationIdentity(raced) !== validationIdentity(run)) throw alreadyExists();
        return raced;
      }
      return run;
    },

    async getValidation({ validationId, revisionId }) {
      const run = await dependencies.validations.findById(validationId);
      if (!run) return undefined;
      // A run for one revision is never returned as another revision's result.
      if (revisionId !== undefined && run.changeSetRevisionId !== revisionId) return undefined;
      return run;
    },
  };
}
