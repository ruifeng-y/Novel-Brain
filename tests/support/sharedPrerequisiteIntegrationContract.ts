import { describe, expect, it } from "vitest";
import { recordExecutionAttemptFromRuntimeResult } from "../../src/production/application/executionAttemptService";
import { candidateSourceReference, type ExecutionAttempt } from "../../src/production/domain/executionAttempt";
import type { Candidate } from "../../src/production/domain/candidate";
import type { ValidationRun } from "../../src/production/domain/validationRun";
import { DependencyImpactApplicationService } from "../../src/dependency/application/dependencyImpactService";
import type { DependencyRelationFact } from "../../src/dependency/domain/dependencyRegistry";
import type { ImpactAnalysisResult } from "../../src/dependency/domain/impactAnalysis";
import {
  recordAdoptionDecision,
  saveNarrativeProposalRevision,
} from "../../src/story/application/narrativeProposalService";
import {
  adoptionDecisionSourceReference,
  createAdoptionChangeSetInputs,
} from "../../src/story/domain/adoptionDecision";
import type { AdoptionDecision } from "../../src/story/domain/adoptionDecision";
import type { NarrativeProposal } from "../../src/story/domain/narrativeProposal";
import type { UniqueCreatePort } from "../../src/shared/application/repository";
import type {
  FrozenCoreChangeSetRevisionRecord,
  SharedPrerequisiteEnvironment,
  SharedPrerequisiteFixture,
} from "./sharedPrerequisiteFixtures";


type GateName =
  | "domain"
  | "integration"
  | "persistence"
  | "transaction"
  | "concurrency"
  | "recovery"
  | "replay"
  | "cross-system"
  | "regression";

interface PersistedPrerequisites {
  readonly attempt: ExecutionAttempt;
  readonly proposal: NarrativeProposal;
  readonly adoptionDecision: AdoptionDecision;
  readonly relations: readonly DependencyRelationFact[];
  readonly impact: ImpactAnalysisResult;
  readonly candidate: Candidate;
  readonly changeSetRevision: FrozenCoreChangeSetRevisionRecord;
  readonly validationRun: ValidationRun;
}

async function saveIfAbsentMatching<T extends { readonly id: string }>(
  repository: UniqueCreatePort<T>,
  entity: T,
): Promise<T> {
  const existing = await repository.findById(entity.id);
  if (existing) {
    expect(existing).toEqual(entity);
    return existing;
  }
  try {
    await repository.saveIfAbsent(entity);
    return entity;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Record already exists:")) {
      throw error;
    }
    const raced = await repository.findById(entity.id);
    expect(raced).toEqual(entity);
    return raced ?? entity;
  }
}

async function persistPrerequisites(
  environment: SharedPrerequisiteEnvironment,
): Promise<PersistedPrerequisites> {
  const { persistence, fixture } = environment;
  const attempt = await recordExecutionAttemptFromRuntimeResult({
    persistence: persistence.executionAttempts,
    executionKey: "shared-prerequisite-2.4",
    relation: "initial",
    generationTask: fixture.generationTask,
    routingDecision: fixture.routingDecision,
    runtimeRequest: fixture.runtimeRequest,
    runtimeResult: fixture.runtimeResult,
    startedAt: new Date("2026-10-04T00:00:00.000Z"),
    completedAt: new Date("2026-10-04T00:01:00.000Z"),
    candidate: fixture.candidate,
  });
  const proposal = await saveNarrativeProposalRevision(
    persistence.narrativeProposals,
    fixture.proposal,
  );
  const adoptionDecision = await recordAdoptionDecision(
    persistence.narrativeProposals,
    fixture.adoptionDecision,
  );
  const dependencyService = new DependencyImpactApplicationService(persistence.dependencyImpact);
  const relations = await dependencyService.recordRelations({
    relations: [fixture.relation],
  });
  const impact = await dependencyService.analyzeImpact(fixture.impactInput);
  const core = await persistence.frozenCore.transaction.run(async (work) => ({
    candidate: await saveIfAbsentMatching(work.candidates, fixture.candidate),
    changeSetRevision: await saveIfAbsentMatching(
      work.changeSetRevisions,
      fixture.changeSetRevisionRecord,
    ),
    validationRun: await saveIfAbsentMatching(work.validationRuns, fixture.validationRun),
  }));
  return {
    attempt,
    proposal,
    adoptionDecision,
    relations,
    impact,
    ...core,
  };
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys);
    return keys;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectKeys(nested, keys);
  }
  return keys;
}

function expectSharedIdentity(fixture: SharedPrerequisiteFixture): void {
  expect([
    fixture.generationTask.novelId,
    fixture.candidate.novelId,
    fixture.proposal.novelId,
    fixture.adoptionDecision.novelId,
    fixture.changeSetRevision.novelId,
    fixture.relation.novelId,
  ]).toEqual(Array(6).fill(fixture.novelId));
  expect(fixture.candidate.basedOnVersionSet).toEqual(fixture.versionSet);
  expect(fixture.runtimeRequest.basedOnVersionSet).toEqual(fixture.versionSet);
  expect(fixture.runtimeResult.basedOnVersionSet).toEqual(fixture.versionSet);
  expect(fixture.relation.revisionProvenance.versionSet).toEqual(fixture.versionSet);
  expect(fixture.impactInput.currentVersionSet).toEqual(fixture.versionSet);
}

export function runSharedPrerequisiteIntegrationContract(
  adapterName: string,
  createEnvironment: () => Promise<SharedPrerequisiteEnvironment>,
): void {
  const create = async () => {
    const environment = await createEnvironment();
    expectSharedIdentity(environment.fixture);
    return environment;
  };

  const cases: readonly [GateName, string, (environment: SharedPrerequisiteEnvironment) => void | Promise<void>][] = [
    ["domain", "aligns Attempt, Proposal, Adoption, Dependency, and Frozen Core identities", async (environment) => {
      const { fixture } = environment;
      expect(fixture.candidate.taskId).toBe(fixture.generationTask.id);
      expect(fixture.runtimeResult.change).toEqual(fixture.candidate.change);
      expect(fixture.changeSetRevision.changeSetId).toBe("change-set-shared-2.4");
      expect(fixture.changeSetRevision.changes.map(({ id }) => id)).toEqual([
        "change-shared-plan-2.4",
        "change-shared-candidate-2.4",
      ]);
      const adoptionInputs = createAdoptionChangeSetInputs(fixture.adoptionDecision);
      expect(fixture.changeSetRevision.changes[0]?.sourceReference).toEqual(
        fixture.adoptionDecision.proposalReference,
      );
      expect(adoptionInputs.proposedChanges[0]?.decisionReference).toEqual(
        adoptionDecisionSourceReference(fixture.adoptionDecision),
      );
      expect(fixture.changeSetRevision.changes[1]?.sourceReference).toEqual(
        candidateSourceReference(fixture.candidate),
      );
      expect(fixture.validationRun.changeSetRevisionId).toBe(fixture.changeSetRevision.revisionId);
      expect(fixture.relation.revisionProvenance.changeSet.identity.revisionId).toBe(
        fixture.changeSetRevision.revisionId,
      );
    }],
    ["integration", "writes all shared prerequisites and Frozen Core evidence together", async (environment) => {
      const persisted = await persistPrerequisites(environment);
      expect(persisted.attempt.candidateReference).toEqual(
        candidateSourceReference(environment.fixture.candidate),
      );
      expect(persisted.relations.map(({ id }) => id)).toEqual(["relation-shared-2.4"]);
      expect(persisted.impact.readSet.relations.map(({ id }) => id)).toEqual([
        "relation-shared-2.4",
      ]);
      expect(persisted.changeSetRevision.revision.changes).toEqual(
        environment.fixture.changeSetRevision.changes,
      );
    }],
    ["persistence", "round-trips every prerequisite and Frozen Core artifact", async (environment) => {
      const { persistence, fixture } = environment;
      const persisted = await persistPrerequisites(environment);
      const loadedAttempt = await persistence.executionAttempts.attempts.findById(persisted.attempt.id);
      const loadedProposal = await persistence.narrativeProposals.proposals.findById(fixture.proposal.id);
      const loadedDecision = await persistence.narrativeProposals.decisions.findById(fixture.adoptionDecision.id);
      const loadedRelation = await persistence.dependencyImpact.relations.findById(fixture.relation.id);
      const loadedImpact = await persistence.dependencyImpact.impactResults.findById(persisted.impact.id);
      const loadedCandidate = await persistence.frozenCore.candidates.findById(fixture.candidate.id);
      const loadedRevision = await persistence.frozenCore.changeSetRevisions.findById(
        fixture.changeSetRevisionRecord.id,
      );
      const loadedValidation = await persistence.frozenCore.validationRuns.findById(fixture.validationRun.id);

      expect(loadedAttempt).toEqual(persisted.attempt);
      expect(loadedProposal).toEqual(persisted.proposal);
      expect(loadedDecision).toEqual(persisted.adoptionDecision);
      expect(loadedRelation).toEqual(fixture.relation);
      expect(loadedImpact).toEqual(persisted.impact);
      expect(loadedCandidate).toEqual(fixture.candidate);
      expect(loadedRevision).toEqual(fixture.changeSetRevisionRecord);
      expect(loadedValidation).toEqual(fixture.validationRun);
    }],
    ["transaction", "rolls back a multi-record Frozen Core transaction without disturbing prerequisites", async (environment) => {
      const { persistence, fixture } = environment;
      await persistPrerequisites(environment);
      const candidate = { ...fixture.candidate, id: "candidate-rollback-2.4" };
      const revision = {
        ...fixture.changeSetRevisionRecord,
        id: "change-set-rollback-2.4:r1",
      };
      const validationRun = { ...fixture.validationRun, id: "validation-run-rollback-2.4" };

      await expect(
        persistence.frozenCore.transaction.run(async (work) => {
          await work.candidates.saveIfAbsent(candidate);
          await work.changeSetRevisions.saveIfAbsent(revision);
          await work.validationRuns.saveIfAbsent(validationRun);
          throw new Error("shared prerequisite rollback requested");
        }),
      ).rejects.toThrow("shared prerequisite rollback requested");

      expect(await persistence.frozenCore.candidates.findById(candidate.id)).toBeUndefined();
      expect(await persistence.frozenCore.changeSetRevisions.findById(revision.id)).toBeUndefined();
      expect(await persistence.frozenCore.validationRuns.findById(validationRun.id)).toBeUndefined();
      expect(await persistence.executionAttempts.attempts.listByNovel(fixture.novelId)).toHaveLength(1);
      expect(await persistence.dependencyImpact.relations.findById(fixture.relation.id)).toEqual(
        fixture.relation,
      );
    }],
    ["concurrency", "serializes idempotent shared writes to one coherent result", async (environment) => {
      const { persistence, fixture } = environment;
      const [first, second] = await Promise.all([
        persistPrerequisites(environment),
        persistPrerequisites(environment),
      ]);

      expect(second).toEqual(first);
      expect(await persistence.executionAttempts.attempts.listByNovel(fixture.novelId)).toHaveLength(1);
      expect(await persistence.narrativeProposals.proposals.listByNovel(fixture.novelId)).toHaveLength(1);
      expect(await persistence.dependencyImpact.relations.listByNovel(fixture.novelId)).toHaveLength(1);
    }],
    ["recovery", "resumes from any prerequisite subset without identity drift", async (environment) => {
      const { persistence, fixture } = environment;
      const partialAttempt = await recordExecutionAttemptFromRuntimeResult({
        persistence: persistence.executionAttempts,
        executionKey: "shared-prerequisite-2.4",
        relation: "initial",
        generationTask: fixture.generationTask,
        routingDecision: fixture.routingDecision,
        runtimeRequest: fixture.runtimeRequest,
        runtimeResult: fixture.runtimeResult,
        startedAt: new Date("2026-10-04T00:00:00.000Z"),
        completedAt: new Date("2026-10-04T00:01:00.000Z"),
        candidate: fixture.candidate,
      });
      await saveNarrativeProposalRevision(persistence.narrativeProposals, fixture.proposal);

      const resumed = await persistPrerequisites(environment);
      expect(resumed.attempt).toEqual(partialAttempt);
      expect(resumed.attempt.id).toBe(partialAttempt.id);
      expect(resumed.proposal.currentRevisionId).toBe(fixture.proposal.currentRevisionId);
      expect(resumed.impact.id).toBe(fixture.impactInput.analysisId);
    }],
    ["replay", "replays all services and evidence with stable hashes and identities", async (environment) => {
      const first = await persistPrerequisites(environment);
      const replay = await persistPrerequisites(environment);

      expect(replay).toEqual(first);
      expect(replay.attempt.currentRevisionId).toBe(first.attempt.currentRevisionId);
      expect(replay.proposal.revisionHash).toBe(first.proposal.revisionHash);
      expect(replay.impact.contentHash).toBe(first.impact.contentHash);
      expect(replay.impact.readSet.version).toBe(first.impact.readSet.version);
    }],
    ["cross-system", "preserves ChangeSetRevision, Candidate, and ValidationEvidence bindings", async (environment) => {
      const { fixture } = environment;
      const persisted = await persistPrerequisites(environment);
      const changeIds = new Set(
        persisted.changeSetRevision.revision.changes.map(({ id }) => id),
      );

      expect(changeIds.has("change-shared-plan-2.4")).toBe(true);
      expect(changeIds.has("change-shared-candidate-2.4")).toBe(true);
      expect(persisted.attempt.runtimeEvidence?.data.result.change).toEqual(fixture.candidate.change);
      expect(persisted.impact.basedOnVersionSet).toEqual(fixture.versionSet);
      expect(persisted.validationRun.entryResults[0]?.evidence[0]).toEqual(fixture.validationEvidence);
      expect(fixture.relation.revisionProvenance.evidence[0]?.data).toEqual(
        fixture.validationRun.entryResults[0]?.evidence[0],
      );
      expect(persisted.impact.evidenceSnapshot.sourceReference).toEqual(
        fixture.validationEvidenceSnapshot.sourceReference,
      );
      expect(persisted.impact.evidenceSnapshot.observations).toEqual(
        fixture.validationEvidenceSnapshot.observations,
      );
      expect(persisted.impact.evidenceSnapshot.hash).toHaveLength(64);
    }],
    ["regression", "does not add duplicate Frozen Core or deferred semantic fields", async (environment) => {
      const { fixture } = environment;
      const persisted = await persistPrerequisites(environment);
      const frozenCoreKeys = collectKeys([
        fixture.candidate,
        fixture.changeSetRevision,
        fixture.validationRun,
      ]);
      const impactKeys = collectKeys(persisted.impact);

      for (const forbidden of ["proposalId", "adoptionDecisionId", "proposalReference", "decisionReference"]) {
        expect(frozenCoreKeys.has(forbidden)).toBe(false);
      }
      for (const forbidden of ["recallItem", "runId", "checkpointId", "narrativeTruth", "semanticHardening"]) {
        expect(impactKeys.has(forbidden)).toBe(false);
      }
      expect(Object.isFrozen(fixture.candidate)).toBe(true);
      expect(Object.isFrozen(fixture.changeSetRevision)).toBe(true);
      expect(Object.isFrozen(fixture.validationRun)).toBe(true);
      expect(fixture.changeSetRevision.changes.map(({ sourceType }) => sourceType)).toEqual([
        "proposal_adoption",
        "candidate",
      ]);
    }],
  ];

  describe(`${adapterName} [task:2.4] shared prerequisite integration gate`, () => {
    for (const [name, title, body] of cases) {
      it(`[${name}] ${title}`, async () => body(await create()));
    }
  });
}
