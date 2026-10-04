import type { PrismaClient } from "@prisma/client";
import { InMemoryRepository } from "../../src/app/inMemoryRepositories";
import {
  createCandidate,
  type Candidate,
} from "../../src/production/domain/candidate";
import { createChange, type Change } from "../../src/production/domain/change";
import {
  createChangeSetRevision,
  createInitialChangeSetRevision,
  type ChangeSetRevision,
} from "../../src/production/domain/changeSetRevision";
import { createGenerationTask } from "../../src/production/domain/generationTask";
import {
  candidateSourceReference,
} from "../../src/production/domain/executionAttempt";
import {
  createValidationRun,
  type ValidationEvidence,
  type ValidationRun,
} from "../../src/production/domain/validationRun";
import type {
  RuntimeRequest,
  RuntimeResult,
} from "../../src/production/runtime/runtimeAdapter";
import {
  createDependencyIdentity,
  createDependencyRelationFact,
  createDependencyRevisionProvenance,
  type DependencyIdentity,
  type DependencyRelationFact,
} from "../../src/dependency/domain/dependencyRegistry";
import {
  createImpactClassificationFact,
  type ImpactClassificationFact,
} from "../../src/dependency/domain/impactAnalysis";
import {
  createAdoptionChangeSetInputs,
  createAdoptionDecision,
  type AdoptionDecision,
  type AdoptionTarget,
} from "../../src/story/domain/adoptionDecision";
import {
  createNarrativeProposal,
  proposalSectionHash,
  type NarrativeProposal,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";
import type { UniqueCreatePort, PersistenceTransaction } from "../../src/shared/application/repository";
import { capabilityPersistencePayloadCodec } from "../../src/shared/domain/persistencePayload";
import {
  createObservation,
  createObservationSnapshot,
  createSourceReference,
  type Observation,
  type ObservationSource,
  type ObservationSnapshot,
} from "../../src/shared/domain/observationSource";
import {
  createVersionReference,
  createVersionSet,
  type VersionSet,
} from "../../src/shared/domain/versioning";
import {
  InMemoryPersistenceTransaction,
  PrismaPersistenceTransaction,
} from "../../src/shared/infrastructure/persistenceTransaction";
import {
  PrismaRepository,
  type PrismaRepositoryClient,
} from "../../src/shared/infrastructure/prismaRepositories";
import type { ExecutionAttemptPersistence } from "../../src/production/application/executionAttemptPersistence";
import { createInMemoryExecutionAttemptPersistence, createPrismaExecutionAttemptPersistence } from "../../src/production/application/executionAttemptPersistence";
import type { NarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";
import { createInMemoryNarrativeProposalPersistence, createPrismaNarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";
import type { DependencyImpactPersistence } from "../../src/dependency/application/dependencyImpactPersistence";
import { createInMemoryDependencyImpactPersistence, createPrismaDependencyImpactPersistence } from "../../src/dependency/application/dependencyImpactPersistence";

const now = new Date("2026-10-04T00:00:00.000Z");
const later = new Date("2026-10-04T00:01:00.000Z");
const computedAt = new Date("2026-10-04T00:02:00.000Z");

export interface FrozenCoreChangeSetRevisionRecord {
  readonly id: string;
  readonly novelId: string;
  readonly revision: ChangeSetRevision;
}

export interface FrozenCoreWork {
  readonly candidates: UniqueCreatePort<Candidate>;
  readonly changeSetRevisions: UniqueCreatePort<FrozenCoreChangeSetRevisionRecord>;
  readonly validationRuns: UniqueCreatePort<ValidationRun>;
}

export interface FrozenCorePersistence {
  readonly transaction: PersistenceTransaction<FrozenCoreWork>;
  readonly candidates: UniqueCreatePort<Candidate>;
  readonly changeSetRevisions: UniqueCreatePort<FrozenCoreChangeSetRevisionRecord>;
  readonly validationRuns: UniqueCreatePort<ValidationRun>;
}

export interface SharedPrerequisiteFixture {
  readonly novelId: string;
  readonly versionSet: VersionSet;
  readonly generationTask: ReturnType<typeof createGenerationTask>;
  readonly candidate: Candidate;
  readonly runtimeRequest: RuntimeRequest;
  readonly runtimeResult: RuntimeResult;
  readonly routingDecision: {
    readonly routingDecisionId: string;
    readonly resolverVersion: string;
    readonly routingPolicyVersion: string;
    readonly provider: string;
    readonly model: string;
    readonly reason: string;
  };
  readonly proposal: NarrativeProposal;
  readonly adoptionTarget: AdoptionTarget;
  readonly adoptionDecision: AdoptionDecision;
  readonly adoptionChanges: readonly Change[];
  readonly changeSetRevision: ChangeSetRevision;
  readonly changeSetRevisionRecord: FrozenCoreChangeSetRevisionRecord;
  readonly validationEvidence: ValidationEvidence;
  readonly validationEvidenceObservation: Observation<ValidationEvidence>;
  readonly validationEvidenceSnapshot: ObservationSnapshot<ValidationEvidence>;
  readonly evidenceSource: ObservationSource<ValidationEvidence>;
  readonly validationRun: ValidationRun;
  readonly dependencySubject: DependencyIdentity;
  readonly dependencyTarget: DependencyIdentity;
  readonly relation: DependencyRelationFact;
  readonly classificationFacts: readonly ImpactClassificationFact[];
  readonly impactInput: {
    readonly analysisId: string;
    readonly novelId: string;
    readonly subject: DependencyIdentity;
    readonly currentVersionSet: VersionSet;
    readonly evidenceSource: ObservationSource<ValidationEvidence>;
    readonly classificationFacts: readonly ImpactClassificationFact[];
    readonly maxDepth: number;
    readonly computedAt: Date;
  };
}

export interface SharedPrerequisitePersistence {
  readonly executionAttempts: ExecutionAttemptPersistence;
  readonly narrativeProposals: NarrativeProposalPersistence;
  readonly dependencyImpact: DependencyImpactPersistence;
  readonly frozenCore: FrozenCorePersistence;
}

export interface SharedPrerequisiteEnvironment {
  readonly persistence: SharedPrerequisitePersistence;
  readonly fixture: SharedPrerequisiteFixture;
}

function proposalSection(): NarrativeProposalSectionInput {
  return {
    id: "section-shared-2.4",
    content: { text: "A city remembers every route" },
    provenance: {
      origin: { type: "ai_generated", references: [] },
      editLineage: [],
      evidenceReferences: [],
      adoptionDecisionReferences: [],
    },
  };
}

function adoptionTarget(proposal: NarrativeProposal): AdoptionTarget {
  const section = proposal.sections[0];
  if (!section) throw new Error("shared proposal section is required");
  return {
    id: "target-shared-2.4",
    scope: {
      proposalIdentity: proposal.id,
      proposalRevision: proposal.currentRevisionId,
      sectionIdentity: section.id,
    },
    targetType: "plan",
    objectId: "plan-shared-2.4",
    proposedChangeId: "change-shared-plan-2.4",
    adoptedContent: {
      contentReference: {
        identity: section.id,
        version: proposal.currentRevisionId,
        hash: proposalSectionHash(section),
      },
      contentHash: proposalSectionHash(section),
    },
    payload: { text: section.content.text },
    basedOnVersionSet: createVersionSet({
      state: createVersionReference("StateRecord", "state-shared-2.4", "state-shared-2.4:rev-1"),
    }),
  };
}

function candidateChange(candidate: Candidate): Change {
  return createChange({
    id: "change-shared-candidate-2.4",
    sourceType: "candidate",
    sourceReference: candidateSourceReference(candidate),
    targetAddress: {
      targetType: "manuscript",
      objectId: "manuscript-shared-2.4",
    },
    payload: { source: candidate.id },
    basedOnVersionSet: candidate.basedOnVersionSet,
  });
}
function changeSetRevisionRecord(revision: ChangeSetRevision): FrozenCoreChangeSetRevisionRecord {
  return {
    id: revision.revisionId,
    novelId: revision.novelId,
    revision,
  };
}

export function createSharedPrerequisiteFixture(): SharedPrerequisiteFixture {
  const novelId = "novel-shared-prerequisite-2.4";
  const versionSet = createVersionSet({
    scene: createVersionReference("Scene", "scene-shared-2.4", "scene-shared-2.4:rev-1"),
    state: createVersionReference("StateRecord", "state-shared-2.4", "state-shared-2.4:rev-1"),
  });
  const generationTask = createGenerationTask({
    id: "task-shared-2.4",
    novelId,
    operation: "rewrite",
    targetSceneId: "scene-shared-2.4",
    intent: "Rewrite the shared scene.",
    basedOnVersionSet: versionSet,
    createdAt: now,
  });
  const candidate = createCandidate({
    id: "candidate-shared-2.4",
    taskId: generationTask.id,
    novelId,
    basedOnVersionSet: versionSet,
    change: { type: "text", sceneId: "scene-shared-2.4", text: "Generated text" },
    createdAt: now,
  });
  const routingDecision = {
    routingDecisionId: "routing-shared-2.4",
    resolverVersion: "resolver-1",
    routingPolicyVersion: "policy-1",
    provider: "test",
    model: "deterministic",
    reason: "shared prerequisite capability match",
  };
  const runtimeRequest: RuntimeRequest = {
    taskId: generationTask.id,
    agentRole: "writer",
    modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
    basedOnVersionSet: versionSet,
    context: { proposalId: "proposal-shared-2.4" },
    requestedChange: candidate.change,
  };
  const runtimeResult: RuntimeResult = {
    taskId: generationTask.id,
    agentRole: "writer",
    modelPolicy: runtimeRequest.modelPolicy,
    change: candidate.change,
    basedOnVersionSet: versionSet,
  };

  const proposal = createNarrativeProposal({
    id: "proposal-shared-2.4",
    novelId,
    proposalType: "story_concept",
    scope: { dimension: "shared-prerequisite" },
    sections: [proposalSection()],
    createdAt: now,
  });
  const target = adoptionTarget(proposal);
  const adoptionDecision = createAdoptionDecision({
    proposal,
    id: "decision-shared-2.4",
    decisionType: "adopt",
    targets: [target],
    actor: { type: "author", identity: "author-shared-2.4" },
    reason: "adopt shared prerequisite proposal",
    decidedAt: later,
  });
  const adoptionChanges = createAdoptionChangeSetInputs(adoptionDecision).changes;
  const changeSetRevision = createChangeSetRevision({
    parent: createInitialChangeSetRevision({
      revisionId: "change-set-shared-2.4:r0",
      changeSetId: "change-set-shared-2.4",
      novelId,
      createdAt: now,
    }),
    revisionId: "change-set-shared-2.4:r1",
    trigger: {
      type: "initial_assembly",
      references: [adoptionDecision.id, candidate.id],
    },
    changes: [...adoptionChanges, candidateChange(candidate)],
    createdAt: later,
  });

  const validationEvidence: ValidationEvidence = {
    id: "validation-shared-2.4",
    type: "dependency-provenance",
    sourceReference: {
      identity: "validation-source-shared-2.4",
      version: "source-rev-1",
      hash: "validation-source-hash-shared-2.4",
    },
    observation: "Shared prerequisite provenance was validated.",
  };
  const validationEvidenceObservation = createObservation<ValidationEvidence>({
    evidenceReference: "validation:shared-2.4",
    sourceReference: createSourceReference(validationEvidence.sourceReference),
    ordinal: 1,
    data: validationEvidence,
  });
  const validationEvidenceSnapshot = createObservationSnapshot<ValidationEvidence>({
    sourceReference: createSourceReference({
      identity: "validation-snapshot-shared-2.4",
      version: "snapshot-1",
      hash: "validation-snapshot-hash-shared-2.4",
    }),
    observations: [validationEvidenceObservation],
  });
  const evidenceSource: ObservationSource<ValidationEvidence> = {
    snapshot: async () => validationEvidenceSnapshot,
  };
  const validationRun = createValidationRun({
    id: "validation-run-shared-2.4",
    changeSetRevisionId: changeSetRevision.revisionId,
    planVersionId: "plan-version-shared-2.4",
    validatorId: "validator-shared-2.4",
    entryResults: [
      {
        entryReference: changeSetRevision.revisionId,
        executionMode: "full_reexecution",
        verdict: "pass",
        findings: [],
        evidence: [validationEvidence],
      },
    ],
    executionState: "completed",
    outcome: "pass",
    createdAt: later,
  });

  const dependencySubject = createDependencyIdentity({
    novelId,
    aggregateType: "Scene",
    objectId: "scene-shared-2.4",
    revisionId: "scene-shared-2.4:rev-1",
  });
  const dependencyTarget = createDependencyIdentity({
    novelId,
    aggregateType: "StateRecord",
    objectId: "state-shared-2.4",
    revisionId: "state-shared-2.4:rev-1",
  });
  const relation = createDependencyRelationFact({
    id: "relation-shared-2.4",
    novelId,
    family: "narrative",
    relationType: "causes",
    inverseSemantics: "inverse",
    sourceKind: "commit-derived",
    lifecycle: "active",
    dependent: dependencyTarget,
    dependency: dependencySubject,
    revisionProvenance: createDependencyRevisionProvenance({
      revision: changeSetRevision,
      dependent: dependencyTarget,
      dependency: dependencySubject,
      versionSet,
      evidence: [validationEvidenceObservation],
    }),
    createdAt: computedAt,
  });
  const classificationFacts = [
    createImpactClassificationFact({
      relationId: relation.id,
      evidenceReference: validationEvidenceObservation.evidenceReference,
      evidenceClass: "definite_direct",
    }),
  ];

  return {
    novelId,
    versionSet,
    generationTask,
    candidate,
    runtimeRequest,
    runtimeResult,
    routingDecision,
    proposal,
    adoptionTarget: target,
    adoptionDecision,
    adoptionChanges,
    changeSetRevision,
    changeSetRevisionRecord: changeSetRevisionRecord(changeSetRevision),
    validationEvidence,
    validationEvidenceObservation,
    validationEvidenceSnapshot,
    evidenceSource,
    validationRun,
    dependencySubject,
    dependencyTarget,
    relation,
    classificationFacts,
    impactInput: {
      analysisId: "impact-shared-2.4",
      novelId,
      subject: dependencySubject,
      currentVersionSet: versionSet,
      evidenceSource,
      classificationFacts,
      maxDepth: 1,
      computedAt,
    },
  };
}

function createInMemoryFrozenCorePersistence(): FrozenCorePersistence {
  const candidates = new InMemoryRepository<Candidate>(capabilityPersistencePayloadCodec);
  const changeSetRevisions = new InMemoryRepository<FrozenCoreChangeSetRevisionRecord>(
    capabilityPersistencePayloadCodec,
  );
  const validationRuns = new InMemoryRepository<ValidationRun>(capabilityPersistencePayloadCodec);
  const transaction = new InMemoryPersistenceTransaction<FrozenCoreWork>(
    (access) => ({
      candidates: access.unique(candidates),
      changeSetRevisions: access.unique(changeSetRevisions),
      validationRuns: access.unique(validationRuns),
    }),
    [candidates, changeSetRevisions, validationRuns],
  );
  return {
    transaction,
    candidates: transaction.unique(candidates),
    changeSetRevisions: transaction.unique(changeSetRevisions),
    validationRuns: transaction.unique(validationRuns),
  };
}

function reviveChangeSetRevisionRecord(
  payload: Record<string, unknown>,
): FrozenCoreChangeSetRevisionRecord {
  const record = payload as unknown as FrozenCoreChangeSetRevisionRecord;
  return {
    ...record,
    revision: {
      ...record.revision,
      createdAt: new Date(record.revision.createdAt.getTime()),
    },
  };
}

function createPrismaFrozenCorePersistence(
  prisma: PrismaClient,
  aggregateType: string,
): FrozenCorePersistence {
  const candidatePort = (client: PrismaRepositoryClient) =>
    new PrismaRepository<Candidate>(
      client,
      `${aggregateType}:Candidate`,
      (payload) => payload as unknown as Candidate,
      capabilityPersistencePayloadCodec,
    );
  const revisionPort = (client: PrismaRepositoryClient) =>
    new PrismaRepository<FrozenCoreChangeSetRevisionRecord>(
      client,
      `${aggregateType}:ChangeSetRevision`,
      reviveChangeSetRevisionRecord,
      capabilityPersistencePayloadCodec,
    );
  const validationPort = (client: PrismaRepositoryClient) =>
    new PrismaRepository<ValidationRun>(
      client,
      `${aggregateType}:ValidationRun`,
      (payload) => ({
        ...(payload as unknown as ValidationRun),
        createdAt: new Date((payload as unknown as ValidationRun).createdAt.getTime()),
      }),
      capabilityPersistencePayloadCodec,
    );
  const transaction = new PrismaPersistenceTransaction<FrozenCoreWork>(
    prisma,
    (client) => ({
      candidates: candidatePort(client),
      changeSetRevisions: revisionPort(client),
      validationRuns: validationPort(client),
    }),
  );
  return {
    transaction,
    candidates: candidatePort(prisma),
    changeSetRevisions: revisionPort(prisma),
    validationRuns: validationPort(prisma),
  };
}

export function createInMemorySharedPrerequisiteEnvironment(): SharedPrerequisiteEnvironment {
  return {
    persistence: {
      executionAttempts: createInMemoryExecutionAttemptPersistence(),
      narrativeProposals: createInMemoryNarrativeProposalPersistence(),
      dependencyImpact: createInMemoryDependencyImpactPersistence(),
      frozenCore: createInMemoryFrozenCorePersistence(),
    },
    fixture: createSharedPrerequisiteFixture(),
  };
}

export function createPrismaSharedPrerequisiteEnvironment(
  prisma: PrismaClient,
  aggregateType = "SharedPrerequisiteTask24",
): SharedPrerequisiteEnvironment {
  return {
    persistence: {
      executionAttempts: createPrismaExecutionAttemptPersistence(
        prisma,
        `${aggregateType}:ExecutionAttempt`,
      ),
      narrativeProposals: createPrismaNarrativeProposalPersistence(
        prisma,
        `${aggregateType}:NarrativeProposal`,
      ),
      dependencyImpact: createPrismaDependencyImpactPersistence(
        prisma,
        `${aggregateType}:DependencyImpact`,
      ),
      frozenCore: createPrismaFrozenCorePersistence(prisma, aggregateType),
    },
    fixture: createSharedPrerequisiteFixture(),
  };
}
