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
 *
 * A revision id is unique only inside its Change Set, so the address of the
 * revision is the pair (`changeSetId` + `revisionId`). The stored payload
 * carries that pair, which is why a run can never be read under another
 * Change Set even when two Change Sets use the same revision id string.
 */
export interface StoredValidationRun extends ValidationRun {
  readonly changeSetId: string;
}

export type ValidationRunStore = UniqueCreatePort<StoredValidationRun>;

export function createInMemoryValidationRunStore(): ValidationRunStore {
  return new InMemoryRepository<StoredValidationRun>(capabilityPersistencePayloadCodec);
}

export function createPrismaValidationRunStore(
  prisma: PrismaClient,
  aggregateType = "ValidationRun",
): ValidationRunStore {
  return new PrismaRepository<StoredValidationRun>(
    prisma,
    aggregateType,
    payload => payload as unknown as StoredValidationRun,
    capabilityPersistencePayloadCodec,
  );
}

/**
 * The run as the domain defines it: the Change Set half of the address is
 * dropped, and absent optional fields stay absent so the payload codec never
 * sees an `undefined` value.
 */
export function validationRunOf(stored: ValidationRun): ValidationRun {
  return Object.freeze({
    id: stored.id,
    changeSetRevisionId: stored.changeSetRevisionId,
    planVersionId: stored.planVersionId,
    validatorId: stored.validatorId,
    entryResults: stored.entryResults,
    executionState: stored.executionState,
    ...(stored.outcome === undefined ? {} : { outcome: stored.outcome }),
    createdAt: new Date(stored.createdAt.getTime()),
  });
}

/** The run as it is stored: the domain run plus the Change Set half of the address. */
export function storedValidationRun(run: ValidationRun, changeSetId: string): StoredValidationRun {
  return Object.freeze({ ...validationRunOf(run), changeSetId });
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
  /** The Change Set the run's revision belongs to. */
  readonly changeSetId: string;
  /** The run is only returned if it validated this exact revision. */
  readonly revisionId: string;
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

/**
 * Run identity excludes `createdAt`, so a retry is idempotent, not a conflict,
 * and includes the Change Set half of the revision address, so the same run id
 * under another Change Set is a conflict rather than a silent substitution.
 */
function validationIdentity(run: StoredValidationRun): string {
  return canonicalJson({
    id: run.id,
    changeSetId: run.changeSetId,
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

      const persisted = storedValidationRun(run, input.changeSetId);
      const existing = await dependencies.validations.findById(run.id);
      if (existing) {
        if (validationIdentity(existing) !== validationIdentity(persisted)) throw alreadyExists();
        return validationRunOf(existing);
      }
      try {
        await dependencies.validations.saveIfAbsent(persisted);
      } catch {
        const raced = await dependencies.validations.findById(run.id);
        if (!raced || validationIdentity(raced) !== validationIdentity(persisted)) {
          throw alreadyExists();
        }
        return validationRunOf(raced);
      }
      return validationRunOf(persisted);
    },

    async getValidation({ validationId, changeSetId, revisionId }) {
      const run = await dependencies.validations.findById(validationId);
      if (!run) return undefined;
      // A run for one revision is never returned as another revision's result,
      // and the revision address includes the Change Set it belongs to.
      if (run.changeSetId !== changeSetId || run.changeSetRevisionId !== revisionId) return undefined;
      return validationRunOf(run);
    },
  };
}
