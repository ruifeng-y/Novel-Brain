import { describe, expect, it } from "vitest";
import {
  InMemoryRepository,
  InMemoryRevisionedRepository,
} from "../../src/app/inMemoryRepositories";
import {
  CommitGateBlockedError,
  commitChangeSetRevision,
  type CommitChangeSetRevisionApprovalRequirement,
  type CommitChangeSetRevisionEventStore,
  type CommitChangeSetRevisionRepositories,
  type CommitChangeSetRevisionTransaction,
  type CommitChangeSetRevisionTransactionWork,
} from "../../src/safety/application/commitChangeSetRevision";
import { createChange, type Change, type TargetType } from "../../src/production/domain/change";
import {
  createInitialChangeSetRevision,
  type ChangeSetRevision,
} from "../../src/production/domain/changeSetRevision";
import {
  createValidationRun,
  type ValidationOutcome,
} from "../../src/production/domain/validationRun";
import {
  approvalScopeKey,
  createReviewDecision,
  type ReviewDecision,
  type ReviewDecisionType,
  type RequirementDomain,
  type ApprovalScope,
} from "../../src/production/domain/reviewDecision";
import { commitSceneText, createScene, type Scene } from "../../src/manuscript/domain/scene";
import { hashContent } from "../../src/shared/domain/contentHash";
import {
  createCanonicalFact,
  type CanonicalFact,
} from "../../src/narrative/canon/domain/canonicalFact";
import {
  createStateRecord,
  type StateRecord,
} from "../../src/narrative/state/domain/stateRecord";
import type { NarrativeCommit } from "../../src/safety/domain/narrativeCommit";
import type { DomainEvent } from "../../src/safety/domain/domainEvent";
import type { EventStore } from "../../src/safety/infrastructure/eventStore";
import { InMemoryEventStore } from "../../src/safety/infrastructure/eventStore";
import {
  createVersionReference,
  createVersionSet,
  type VersionReference,
} from "../../src/shared/domain/versioning";
import type {
  Repository,
  Revisioned,
  RevisionedRepository,
} from "../../src/shared/application/repository";

const now = new Date("2026-10-03T00:00:00.000Z");
const later = new Date("2026-10-03T01:00:00.000Z");

type TestRepositories = {
  readonly scenes: RevisionedRepository<Scene>;
  readonly canonicalFacts: RevisionedRepository<CanonicalFact>;
  readonly stateRecords: RevisionedRepository<StateRecord>;
  readonly narrativeCommits: Repository<NarrativeCommit>;
};

async function setup() {
  const scenes = new InMemoryRevisionedRepository<Scene>();
  const canonicalFacts = new InMemoryRevisionedRepository<CanonicalFact>();
  const stateRecords = new InMemoryRevisionedRepository<StateRecord>();
  const narrativeCommits = new InMemoryRepository<NarrativeCommit>();

  const scene = commitSceneText({
    scene: createScene({
      id: "scene-1",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "The Northern Gate",
      revisionId: "scene-rev-1",
      commitId: "initial",
      createdAt: now,
    }),
    text: "Old text",
    revisionId: "scene-rev-2",
    commitId: "initial",
    updatedAt: now,
  });
  await scenes.save(scene);

  const fact = createCanonicalFact({
    id: "fact-1",
    novelId: "novel-1",
    type: "world_rule",
    content: { rule: "old" },
    revisionId: "fact-rev-1",
    commitId: "initial",
    createdAt: now,
  });
  await canonicalFacts.save(fact);

  const state = createStateRecord({
    id: "state-1",
    novelId: "novel-1",
    type: "world_state",
    subjectId: "world-1",
    position: { sceneId: "scene-1", ordinal: 1 },
    content: { status: "old" },
    revisionId: "state-rev-1",
    commitId: "initial",
    createdAt: now,
  });
  await stateRecords.save(state);

  return { scenes, canonicalFacts, stateRecords, narrativeCommits };
}

function revisionWith(changes: readonly Change[], revisionId = "cs-1-r1"): ChangeSetRevision {
  const revision = createInitialChangeSetRevision({
    revisionId,
    changeSetId: "cs-1",
    novelId: "novel-1",
    createdAt: now,
  });
  return Object.freeze({
    ...revision,
    changes: Object.freeze([...changes]),
  });
}

function sceneChange(
  basedOn: VersionReference = createVersionReference("Scene", "scene-1", "scene-rev-2"),
  objectId = "scene-1",
  targetType: TargetType = "manuscript",
) {
  return createChange({
    id: `change-${targetType}-${objectId}`,
    sourceType: "author_edit",
    sourceReference: { identity: "author-1", version: "r1", hash: "hash-1" },
    targetAddress: { targetType, objectId },
    payload: { text: "New text" },
    basedOnVersionSet: createVersionSet({ target: basedOn }),
  });
}

function canonicalChange(
  basedOn: VersionReference = createVersionReference("CanonicalFact", "fact-1", "fact-rev-1"),
  objectId = "fact-1",
) {
  return createChange({
    id: `change-canonical-${objectId}`,
    sourceType: "author_edit",
    sourceReference: { identity: "author-1", version: "r1", hash: "hash-2" },
    targetAddress: { targetType: "canonical_fact", objectId },
    payload: { rule: "new" },
    basedOnVersionSet: createVersionSet({ target: basedOn }),
  });
}

function stateChange(
  basedOn: VersionReference = createVersionReference("StateRecord", "state-1", "state-rev-1"),
  objectId = "state-1",
) {
  return createChange({
    id: `change-state-${objectId}`,
    sourceType: "author_edit",
    sourceReference: { identity: "author-1", version: "r1", hash: "hash-3" },
    targetAddress: { targetType: "story_state", objectId },
    payload: { status: "new" },
    basedOnVersionSet: createVersionSet({ target: basedOn }),
  });
}

function validation(
  outcome: ValidationOutcome = "pass",
  revisionId = "cs-1-r1",
  id = "validation-1",
) {
  return createValidationRun({
    id,
    changeSetRevisionId: revisionId,
    planVersionId: "plan-1",
    validatorId: "validator",
    entryResults: [],
    executionState: "completed",
    outcome,
    createdAt: now,
  });
}

function requirementDomain(targetType: TargetType): RequirementDomain {
  if (targetType === "canonical_fact") return "canon";
  if (targetType === "story_state") return "story_state";
  return targetType;
}

function review(
  targetType: TargetType,
  objectId: string,
  decision: ReviewDecisionType = "approve",
  id = `review-${targetType}-${objectId}-${decision}`,
) {
  return createReviewDecision({
    id,
    changeSetRevisionId: "cs-1-r1",
    approvalScope: {
      requirementDomain: requirementDomain(targetType),
      targetType,
      objectId,
    },
    decision,
    decidedBy: "human",
    actorId: "reviewer-1",
    reason: decision === "reject" ? "Rejected by reviewer" : "",
    evidenceReferences: ["validation-1"],
    createdAt: now,
  });
}

function approvalsFor(changes: readonly Change[], decision: ReviewDecisionType = "approve") {
  return changes.map((change, index) =>
    review(
      change.targetAddress.targetType,
      change.targetAddress.objectId,
      decision,
      `review-${index}-${decision}`,
    ),
  );
}

function call(
  repositories: TestRepositories,
  eventStore: EventStore,
  revision: ChangeSetRevision,
  options: {
    readonly validationRuns?: readonly ReturnType<typeof validation>[];
    readonly reviewDecisions?: readonly ReviewDecision[];
    readonly unresolvedConflict?: boolean;
    readonly stale?: boolean;
    readonly targetInvariantViolations?: readonly (string | {
      readonly message: string;
      readonly evidenceReferences?: readonly string[];
    })[];
    readonly unresolvedConflictEvidenceReferences?: readonly string[];
    readonly staleEvidenceReferences?: readonly string[];
    readonly requiredApproval?: boolean;
    readonly commitId?: string;
    readonly transaction?: CommitTestTransaction;
    readonly approvalScopeRequirements?: readonly CommitChangeSetRevisionApprovalRequirement[];
  } = {},
) {
  return commitChangeSetRevision({
    transaction: options.transaction ?? new SnapshotTransactionRunner(repositories, eventStore),
    input: {
      commitId: options.commitId ?? "commit-1",
      changeSetRevision: revision,
      validationRuns: options.validationRuns ?? [validation()],
      reviewDecisions: options.reviewDecisions ?? approvalsFor(revision.changes),
      currentRevisionFacts: {
        unresolvedConflict: options.unresolvedConflict ?? false,
        stale: options.stale ?? false,
        unresolvedConflictEvidenceReferences: options.unresolvedConflictEvidenceReferences,
        staleEvidenceReferences: options.staleEvidenceReferences,
      },
      targetInvariantViolations: options.targetInvariantViolations ?? [],
      requiredApproval: options.requiredApproval ?? true,
      approvalScopeRequirements: options.approvalScopeRequirements,
      now,
    },
  });
}
async function expectBlocked(
  promise: Promise<unknown>,
  expectedTypes: readonly string[],
): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  const message = error instanceof Error ? error.message : "";
  for (const type of expectedTypes) expect(message).toContain(type);
}

class FailingEventStore implements EventStore {
  public readonly appended: DomainEvent[] = [];

  async append(event: DomainEvent): Promise<void> {
    await this.appendMany([event]);
  }

  async appendMany(events: readonly DomainEvent[]): Promise<void> {
    throw new Error("event write failed");
  }

  async listByNovel(novelId: string): Promise<readonly DomainEvent[]> {
    return this.appended.filter(event => event.novelId === novelId);
  }
}

class FailingCommittedCommitRepository implements Repository<NarrativeCommit> {
  public readonly saved: NarrativeCommit[] = [];

  constructor(private readonly inner: Repository<NarrativeCommit>) {}

  async save(entity: NarrativeCommit): Promise<void> {
    if (entity.status === "committed") throw new Error("commit save failed");
    this.saved.push(entity);
    await this.inner.save(entity);
  }

  async findById(id: string): Promise<NarrativeCommit | undefined> {
    return this.inner.findById(id);
  }

  async listByNovel(novelId: string): Promise<readonly NarrativeCommit[]> {
    return this.inner.listByNovel(novelId);
  }
}

class FailOnceCanonicalRepository extends InMemoryRevisionedRepository<CanonicalFact> {
  private shouldFail = false;

  failNextSave(): void {
    this.shouldFail = true;
  }

  async save(entity: CanonicalFact): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error("canonical save failed");
    }
    await super.save(entity);
  }
}


type CommitTestWork = CommitChangeSetRevisionTransactionWork;
type CommitTestTransaction = CommitChangeSetRevisionTransaction;

type SnapshotCapableRepository = {
  currentEntities?: Map<string, unknown>;
  entities?: Map<string, unknown>;
  revisions?: Map<string, unknown>;
};

type SnapshotCapableEventStore = {
  events: DomainEvent[];
  eventIds: Set<string>;
};

function repositoryTarget(repository: unknown): SnapshotCapableRepository {
  const wrapper = repository as { inner?: unknown };
  return (wrapper.inner ?? repository) as SnapshotCapableRepository;
}

function repositorySnapshot(repository: unknown): {
  current: [string, unknown][];
  revisions: [string, unknown][];
} {
  const value = repositoryTarget(repository);
  const current = value.currentEntities ?? value.entities;
  if (!current) throw new Error("snapshot repository map is unavailable");
  return {
    current: [...current.entries()],
    revisions: value.revisions ? [...value.revisions.entries()] : [],
  };
}

function restoreRepository(
  repository: unknown,
  snapshot: ReturnType<typeof repositorySnapshot>,
): void {
  const value = repositoryTarget(repository);
  const current = value.currentEntities ?? value.entities;
  if (!current) throw new Error("snapshot repository map is unavailable");
  current.clear();
  for (const entry of snapshot.current) current.set(entry[0], entry[1]);
  if (value.revisions) {
    value.revisions.clear();
    for (const entry of snapshot.revisions) value.revisions.set(entry[0], entry[1]);
  }
}

function eventStoreSnapshot(eventStore: EventStore): {
  events: DomainEvent[];
  eventIds: string[];
} {
  const value = eventStore as unknown as {
    events?: DomainEvent[];
    appended?: DomainEvent[];
    eventIds?: Set<string>;
  };
  return {
    events: [...(value.events ?? value.appended ?? [])],
    eventIds: value.eventIds ? [...value.eventIds] : [],
  };
}

function restoreEventStore(
  eventStore: EventStore,
  snapshot: ReturnType<typeof eventStoreSnapshot>,
): void {
  const value = eventStore as unknown as {
    events?: DomainEvent[];
    appended?: DomainEvent[];
    eventIds?: Set<string>;
  };
  const events = value.events ?? value.appended;
  if (events) events.splice(0, events.length, ...snapshot.events);
  if (value.eventIds) {
    value.eventIds.clear();
    for (const id of snapshot.eventIds) value.eventIds.add(id);
  }
}
function testRepositories(repositories: TestRepositories): CommitChangeSetRevisionRepositories {
  return {
    scenes: {
      findById: id => repositories.scenes.findById(id),
      getRevision: (id, revisionId) => repositories.scenes.getRevision(id, revisionId),
      saveSceneIfCurrent: async (expectedRevisionId, scene) => {
        const current = await repositories.scenes.findById(scene.id);
        if (!current || current.currentRevisionId !== expectedRevisionId) {
          throw new Error(`CAS revision conflict: ${scene.id}`);
        }
        await repositories.scenes.save(scene);
      },
    },
    canonicalFacts: {
      findById: id => repositories.canonicalFacts.findById(id),
      getRevision: (id, revisionId) => repositories.canonicalFacts.getRevision(id, revisionId),
      saveCanonicalFactIfCurrent: async (expectedRevisionId, fact) => {
        const current = await repositories.canonicalFacts.findById(fact.id);
        if (!current || current.currentRevisionId !== expectedRevisionId) {
          throw new Error(`CAS revision conflict: ${fact.id}`);
        }
        await repositories.canonicalFacts.save(fact);
      },
    },
    stateRecords: {
      findById: id => repositories.stateRecords.findById(id),
      getRevision: (id, revisionId) => repositories.stateRecords.getRevision(id, revisionId),
      saveStateRecordIfCurrent: async (expectedRevisionId, record) => {
        const current = await repositories.stateRecords.findById(record.id);
        if (!current || current.currentRevisionId !== expectedRevisionId) {
          throw new Error(`CAS revision conflict: ${record.id}`);
        }
        await repositories.stateRecords.save(record);
      },
    },
    narrativeCommits: {
      findById: id => repositories.narrativeCommits.findById(id),
      listByNovel: novelId => repositories.narrativeCommits.listByNovel(novelId),
      saveNarrativeCommitIfAbsent: async commit => {
        const existing = await repositories.narrativeCommits.findById(commit.id);
        const sameRevision = (await repositories.narrativeCommits.listByNovel(commit.novelId))
          .some(entry => entry.changeSetRevisionId === commit.changeSetRevisionId);
        if (existing || sameRevision) {
          throw new Error("NarrativeCommit reservation already exists");
        }
        await repositories.narrativeCommits.save(commit);
      },
      saveNarrativeCommitIfCurrent: async (expectedStatus, commit) => {
        const current = await repositories.narrativeCommits.findById(commit.id);
        if (!current || current.status !== expectedStatus) {
          throw new Error(`CAS commit status conflict: ${commit.id}`);
        }
        await repositories.narrativeCommits.save(commit);
      },
    },
  };
}

function testEventStore(eventStore: EventStore): CommitChangeSetRevisionEventStore {
  return {
    listByNovel: novelId => eventStore.listByNovel(novelId),
    appendEventsIfAbsent: events => eventStore.appendMany(events),
  };
}
class SnapshotTransactionRunner implements CommitTestTransaction {
  constructor(
    private readonly repositories: TestRepositories,
    private readonly eventStore: EventStore,
  ) {}

  async run<T>(operation: (work: CommitTestWork) => Promise<T>): Promise<T> {
    const snapshots = {
      scenes: repositorySnapshot(this.repositories.scenes),
      canonicalFacts: repositorySnapshot(this.repositories.canonicalFacts),
      stateRecords: repositorySnapshot(this.repositories.stateRecords),
      narrativeCommits: repositorySnapshot(this.repositories.narrativeCommits),
      eventStore: eventStoreSnapshot(this.eventStore),
    };
    try {
      return await operation({
        repositories: testRepositories(this.repositories),
        eventStore: testEventStore(this.eventStore),
      });
    } catch (error) {
      restoreRepository(this.repositories.scenes, snapshots.scenes);
      restoreRepository(this.repositories.canonicalFacts, snapshots.canonicalFacts);
      restoreRepository(this.repositories.stateRecords, snapshots.stateRecords);
      restoreRepository(this.repositories.narrativeCommits, snapshots.narrativeCommits);
      restoreEventStore(this.eventStore, snapshots.eventStore);
      throw error;
    }
  }
}

class PartiallyFailingEventStore implements EventStore {
  public readonly events: DomainEvent[] = [];
  public readonly eventIds = new Set<string>();
  private shouldFail = false;

  failAfterFirstAppend(): void {
    this.shouldFail = true;
  }

  async append(event: DomainEvent): Promise<void> {
    await this.appendMany([event]);
  }

  async appendMany(events: readonly DomainEvent[]): Promise<void> {
    const first = events[0];
    if (!first) return;
    this.events.push(first);
    this.eventIds.add(first.eventId);
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error("partial event append failed");
    }
    for (const event of events.slice(1)) {
      this.events.push(event);
      this.eventIds.add(event.eventId);
    }
  }

  async listByNovel(novelId: string): Promise<readonly DomainEvent[]> {
    return this.events.filter(event => event.novelId === novelId);
  }
}
describe("commitChangeSetRevision", () => {
  it("applies manuscript, canonical fact, and story state changes atomically", async () => {
    const repositories = await setup();
    const changes = [sceneChange(), canonicalChange(), stateChange()];
    const eventStore = new InMemoryEventStore();

    const commit = await call(
      repositories,
      eventStore,
      revisionWith(changes),
      { validationRuns: [validation("needs_review")], reviewDecisions: approvalsFor(changes) },
    );

    expect(commit.status).toBe("committed");
    expect((await repositories.scenes.findById("scene-1"))?.text).toBe("New text");
    expect((await repositories.canonicalFacts.findById("fact-1"))?.content).toEqual({ rule: "new" });
    expect((await repositories.stateRecords.findById("state-1"))?.content).toEqual({ status: "new" });
    const events = await eventStore.listByNovel("novel-1");
    expect(events.map(event => event.eventId)).toEqual([
      "event:commit-1:manuscript:scene-1",
      "event:commit-1:canonical_fact:fact-1",
      "event:commit-1:story_state:state-1",
      "event:commit-1:recorded",
    ]);
  });

  it("returns every gate blocker and leaves no side effects when blocked", async () => {
    const repositories = await setup();
    await repositories.scenes.save(
      commitSceneText({
        scene: (await repositories.scenes.findById("scene-1"))!,
        text: "Author changed it",
        revisionId: "scene-rev-3",
        commitId: "author-commit",
        updatedAt: later,
      }),
    );
    const eventStore = new InMemoryEventStore();
    const revision = revisionWith([sceneChange()]);

    await expectBlocked(
      call(repositories, eventStore, revision, {
        validationRuns: [validation("fail")],
        reviewDecisions: [review("manuscript", "scene-1", "request_regeneration")],
        unresolvedConflict: true,
        stale: true,
        targetInvariantViolations: ["explicit invariant failure"],
      }),
      [
        "invalid_revision",
        "stale_revision",
        "occ_conflict",
        "invariant_violation",
        "mandatory_validation_failed",
        "regeneration_requested",
      ],
    );

    expect((await repositories.scenes.findById("scene-1"))?.text).toBe("Author changed it");
    expect(await repositories.narrativeCommits.listByNovel("novel-1")).toEqual([]);
    expect(await eventStore.listByNovel("novel-1")).toEqual([]);
  });

  it("checks every basedOnVersionSet reference for OCC", async () => {
    const repositories = await setup();
    await repositories.canonicalFacts.save(
      createCanonicalFact({
        id: "fact-1",
        novelId: "novel-1",
        type: "world_rule",
        content: { rule: "author" },
        revisionId: "fact-rev-2",
        commitId: "author-commit",
        createdAt: later,
      }),
    );
    const change = createChange({
      id: "change-occ",
      sourceType: "author_edit",
      sourceReference: { identity: "author-1", version: "r1", hash: "hash" },
      targetAddress: { targetType: "manuscript", objectId: "scene-1" },
      payload: { text: "New text" },
      basedOnVersionSet: createVersionSet({
        target: createVersionReference("Scene", "scene-1", "scene-rev-2"),
        extra: createVersionReference("CanonicalFact", "fact-1", "fact-rev-1"),
      }),
    });
    const eventStore = new InMemoryEventStore();

    await expectBlocked(call(repositories, eventStore, revisionWith([change])), ["occ_conflict"]);
    expect((await repositories.scenes.findById("scene-1"))?.text).toBe("Old text");
    expect(await repositories.narrativeCommits.listByNovel("novel-1")).toEqual([]);
    expect(await eventStore.listByNovel("novel-1")).toEqual([]);
  });

  it("blocks unsupported, missing, mismatched, and dependency-less targets before writes", async () => {
    const repositories = await setup();
    await repositories.canonicalFacts.save(
      createCanonicalFact({
        id: "fact-foreign",
        novelId: "novel-2",
        type: "world_rule",
        content: { rule: "foreign" },
        revisionId: "fact-foreign-rev-1",
        commitId: "initial",
        createdAt: now,
      }),
    );

    const unsupported = createChange({
      id: "change-unsupported",
      sourceType: "author_edit",
      sourceReference: { identity: "author-1", version: "r1", hash: "hash" },
      targetAddress: { targetType: "plan", objectId: "plan-1" },
      payload: { text: "unsupported" },
      basedOnVersionSet: createVersionSet({
        target: createVersionReference("GenerationTask", "plan-1", "plan-rev-1"),
      }),
    });
    const missing = sceneChange(
      createVersionReference("Scene", "scene-missing", "scene-rev-1"),
      "scene-missing",
    );
    const mismatched = canonicalChange(
      createVersionReference("CanonicalFact", "fact-foreign", "fact-foreign-rev-1"),
      "fact-foreign",
    );
    const dependencyLess = stateChange(
      createVersionReference("StateRecord", "other-state", "state-rev-1"),
    );
    const eventStore = new InMemoryEventStore();

    await expectBlocked(
      call(
        repositories,
        eventStore,
        revisionWith([unsupported, missing, mismatched, dependencyLess]),
        {
          reviewDecisions: [
            review("plan", "plan-1"),
            review("manuscript", "scene-missing"),
            review("canonical_fact", "fact-foreign"),
            review("story_state", "state-1"),
          ],
        },
      ),
      ["invariant_violation"],
    );

    expect((await repositories.scenes.findById("scene-1"))?.text).toBe("Old text");
    expect((await repositories.canonicalFacts.findById("fact-1"))?.content).toEqual({ rule: "old" });
    expect((await repositories.stateRecords.findById("state-1"))?.content).toEqual({ status: "old" });
    expect(await repositories.narrativeCommits.listByNovel("novel-1")).toEqual([]);
    expect(await eventStore.listByNovel("novel-1")).toEqual([]);
  });

  it("restores all originals when an event write fails and records a failed commit", async () => {
    const repositories = await setup();
    const eventStore = new FailingEventStore();
    const revision = revisionWith([sceneChange(), canonicalChange()]);

    await expect(call(repositories, eventStore, revision)).rejects.toThrow("event write failed");

    expect((await repositories.scenes.findById("scene-1"))?.text).toBe("Old text");
    expect((await repositories.canonicalFacts.findById("fact-1"))?.content).toEqual({ rule: "old" });
    expect((await repositories.narrativeCommits.listByNovel("novel-1"))[0]?.status).toBe("failed");
    expect(eventStore.appended.every(event => event.name !== "NarrativeCommitRecorded")).toBe(true);
  });

  it("restores originals when a domain save fails and records a failed commit", async () => {
    const repositories = await setup();
    const canonicalFacts = new FailOnceCanonicalRepository();
    await canonicalFacts.save(
      createCanonicalFact({
        id: "fact-1",
        novelId: "novel-1",
        type: "world_rule",
        content: { rule: "old" },
        revisionId: "fact-rev-1",
        commitId: "initial",
        createdAt: now,
      }),
    );
    canonicalFacts.failNextSave();
    const all = { ...repositories, canonicalFacts };
    const eventStore = new InMemoryEventStore();

    await expect(call(all, eventStore, revisionWith([sceneChange(), canonicalChange()])))
      .rejects.toThrow("canonical save failed");

    expect((await repositories.scenes.findById("scene-1"))?.text).toBe("Old text");
    expect((await canonicalFacts.findById("fact-1"))?.content).toEqual({ rule: "old" });
    expect((await all.narrativeCommits.listByNovel("novel-1"))[0]?.status).toBe("failed");
    expect(await eventStore.listByNovel("novel-1")).toEqual([]);
  });

  it("restores originals and records failed when the committed NarrativeCommit save fails", async () => {
    const repositories = await setup();
    const inner = repositories.narrativeCommits;
    const narrativeCommits = new FailingCommittedCommitRepository(inner);
    const all = { ...repositories, narrativeCommits };
    const eventStore = new InMemoryEventStore();

    await expect(call(all, eventStore, revisionWith([sceneChange(), canonicalChange()])))
      .rejects.toThrow("commit save failed");

    expect((await repositories.scenes.findById("scene-1"))?.text).toBe("Old text");
    expect((await repositories.canonicalFacts.findById("fact-1"))?.content).toEqual({ rule: "old" });
    expect((await narrativeCommits.listByNovel("novel-1"))[0]?.status).toBe("failed");
    expect(await eventStore.listByNovel("novel-1")).toEqual([]);
  });

  it("is idempotent by changeSetRevisionId and advances target revisions only once", async () => {
    const repositories = await setup();
    const eventStore = new InMemoryEventStore();
    const revision = revisionWith([sceneChange()]);

    const first = await call(repositories, eventStore, revision);
    const firstRevision = (await repositories.scenes.findById("scene-1"))?.currentRevisionId;
    const second = await call(repositories, eventStore, revision, { commitId: "commit-2" });

    expect(second.id).toBe(first.id);
    expect((await repositories.scenes.findById("scene-1"))?.currentRevisionId).toBe(firstRevision);
    expect(await repositories.narrativeCommits.listByNovel("novel-1")).toHaveLength(1);
    expect(await eventStore.listByNovel("novel-1")).toHaveLength(2);
  });

  it("aggregates approval by scope and keeps regeneration distinct from rejection", async () => {
    const repositories = await setup();
    const changes = [sceneChange(), canonicalChange()];
    const eventStore = new InMemoryEventStore();
    const reviewDecisions = [
      review("manuscript", "scene-1", "approve", "review-scene-approve"),
      review("manuscript", "scene-1", "request_regeneration", "review-scene-regenerate"),
      review("canonical_fact", "fact-1", "approve", "review-fact-approve"),
    ];

    await expectBlocked(
      call(repositories, eventStore, revisionWith(changes), { reviewDecisions }),
      ["regeneration_requested"],
    );

    expect((await repositories.scenes.findById("scene-1"))?.text).toBe("Old text");
    expect((await repositories.canonicalFacts.findById("fact-1"))?.content).toEqual({ rule: "old" });
    expect(await repositories.narrativeCommits.listByNovel("novel-1")).toEqual([]);
    expect(await eventStore.listByNovel("novel-1")).toEqual([]);
    expect(approvalScopeKey(reviewDecisions[1]!.approvalScope)).toBe(
      "manuscript:manuscript:scene-1",
    );
  });
  it("commits distinct sub-addresses as one ordered next entity with full result keys", async () => {
    const repositories = await setup();
    await repositories.stateRecords.save(
      createStateRecord({
        id: "state-1",
        novelId: "novel-1",
        type: "world_state",
        subjectId: "world-1",
        position: { sceneId: "scene-1", ordinal: 1 },
        content: {
          "character_state:john": { mood: "old", rank: 1 },
          "character_state:mary": { mood: "old" },
        },
        revisionId: "state-rev-2",
        commitId: "initial",
        createdAt: now,
      }),
    );
    const eventStore = new InMemoryEventStore();
    const changes = [
      subStateChange("character_state:john", { mood: "calm", rank: 2 }, "change-john"),
      subStateChange("character_state:mary", { mood: "bright" }, "change-mary"),
      subStateChange("character_state:goal", { status: "resolved" }, "change-goal"),
    ];
    const revision = revisionWith(changes);

    const commit = await call(repositories, eventStore, revision, {
      reviewDecisions: changes.map((change, index) =>
        scopedReview({
          id: `review-sub-${index}`,
          requirementDomain: "story_state",
          targetType: "story_state",
          objectId: "state-1",
          subAddress: change.targetAddress.subAddress,
        }),
      ),
    });

    const state = await repositories.stateRecords.findById("state-1");
    expect(state?.content).toEqual({
      "character_state:john": { mood: "calm", rank: 2 },
      "character_state:mary": { mood: "bright" },
      "character_state:goal": { status: "resolved" },
    });
    expect(state?.currentRevisionId).toBe("state-rev-2:commit-1");
    expect(Object.keys(commit.resultingVersionSet ?? {})).toEqual([
      "story_state:state-1#character_state:john",
      "story_state:state-1#character_state:mary",
      "story_state:state-1#character_state:goal",
    ]);
    expect(
      Object.values(commit.resultingVersionSet ?? {}).every(
        reference => reference.revisionId === "state-rev-2:commit-1",
      ),
    ).toBe(true);
  });

  it("uses explicit ApprovalScope requirement levels without domain substitution", async () => {
    const repositories = await setup();
    const eventStore = new InMemoryEventStore();
    const changes = [sceneChange(), canonicalChange(), stateChange()];
    const planScope: ApprovalScope = {
      requirementDomain: "plan",
      targetType: "manuscript",
      objectId: "scene-1",
    };
    const reviewDecisions = [scopedReview({ id: "review-plan", ...planScope })];

    const commit = await call(repositories, eventStore, revisionWith(changes), {
      requiredApproval: false,
      reviewDecisions,
      approvalScopeRequirements: [
        explicitRequirement(planScope, "human", "plan-human-rule"),
        explicitRequirement(
          {
            requirementDomain: "canon",
            targetType: "canonical_fact",
            objectId: "fact-1",
          },
          "not_required",
          "canon-optional-rule",
        ),
        explicitRequirement(
          {
            requirementDomain: "story_state",
            targetType: "story_state",
            objectId: "state-1",
          },
          "not_required",
          "state-optional-rule",
        ),
      ],
    });

    expect(commit.status).toBe("committed");
    expect(commit.reviewDecisionIds).toEqual(["review-plan"]);
  });

  it("does not manufacture approval when requiredApproval is false and no decision exists", async () => {
    const repositories = await setup();
    const eventStore = new InMemoryEventStore();

    let caught: unknown;
    try {
      await call(repositories, eventStore, revisionWith([sceneChange()]), {
        requiredApproval: false,
        reviewDecisions: [],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CommitGateBlockedError);
    const gate = caught instanceof CommitGateBlockedError ? caught.gate : undefined;
    expect(gate?.blockers.some(blocker => blocker.type === "missing_required_approval")).toBe(false);
    expect(gate?.blockers.some(blocker => blocker.type === "invariant_violation")).toBe(true);
    expect(await repositories.narrativeCommits.listByNovel("novel-1")).toEqual([]);
  });

  it("supersedes provenance and carries source evidence into blockers", async () => {
    const repositories = await setup();
    const eventStore = new InMemoryEventStore();
    const reviewDecisions = [
      scopedReview(
        {
          id: "decision-early-policy",
          requirementDomain: "canon",
          targetType: "canonical_fact",
          objectId: "fact-1",
        },
        "approve",
        "policy",
        new Date("2026-10-03T00:00:00.000Z"),
        ["policy-evidence"],
      ),
      scopedReview(
        {
          id: "decision-later-human",
          requirementDomain: "canon",
          targetType: "canonical_fact",
          objectId: "fact-1",
        },
        "reject",
        "human",
        new Date("2026-10-03T01:00:00.000Z"),
        ["human-evidence"],
      ),
    ];

    let caught: unknown;
    try {
      await call(repositories, eventStore, revisionWith([canonicalChange()]), { reviewDecisions });
    } catch (error) {
      caught = error;
    }

    const gate = caught instanceof CommitGateBlockedError ? caught.gate : undefined;
    const blocker = gate?.blockers.find(entry => entry.type === "review_rejected");
    expect(blocker?.evidenceReferences).toEqual(["decision-later-human", "human-evidence"]);
    expect(blocker?.facts.join("|")).toContain("decidedBy=human");
  });

  it("rolls back partial domain saves and immutable revision history", async () => {
    const repositories = await setup();
    const canonicalFacts = new FailOnceCanonicalRepository();
    await canonicalFacts.save(
      createCanonicalFact({
        id: "fact-1",
        novelId: "novel-1",
        type: "world_rule",
        content: { rule: "old" },
        revisionId: "fact-rev-1",
        commitId: "initial",
        createdAt: now,
      }),
    );
    canonicalFacts.failNextSave();
    const all = { ...repositories, canonicalFacts };
    const eventStore = new InMemoryEventStore();

    await expect(call(all, eventStore, revisionWith([sceneChange(), canonicalChange()])))
      .rejects.toThrow("canonical save failed");

    expect((await all.scenes.findById("scene-1"))?.currentRevisionId).toBe("scene-rev-2");
    expect(await all.scenes.getRevision("scene-1", "scene-rev-2:commit-1")).toBeUndefined();
    expect((await all.canonicalFacts.findById("fact-1"))?.currentRevisionId).toBe("fact-rev-1");
    expect(await all.canonicalFacts.getRevision("fact-1", "fact-rev-1:commit-1")).toBeUndefined();
    expect((await all.narrativeCommits.listByNovel("novel-1")).map(commit => commit.status)).toEqual(["failed"]);
  });

  it("rolls back partially appended events", async () => {
    const repositories = await setup();
    const eventStore = new PartiallyFailingEventStore();
    eventStore.failAfterFirstAppend();

    await expect(call(repositories, eventStore, revisionWith([sceneChange(), canonicalChange()])))
      .rejects.toThrow("partial event append failed");

    expect((await repositories.scenes.findById("scene-1"))?.currentRevisionId).toBe("scene-rev-2");
    expect(await repositories.scenes.getRevision("scene-1", "scene-rev-2:commit-1")).toBeUndefined();
    expect((await repositories.canonicalFacts.findById("fact-1"))?.currentRevisionId).toBe("fact-rev-1");
    expect(await eventStore.listByNovel("novel-1")).toEqual([]);
    expect((await repositories.narrativeCommits.listByNovel("novel-1")).map(commit => commit.status)).toEqual(["failed"]);
    expect((await repositories.narrativeCommits.listByNovel("novel-1")).some(commit => commit.status === "committed")).toBe(false);
  });

  it("rolls back all writes when committed NarrativeCommit save fails", async () => {
    const repositories = await setup();
    const inner = repositories.narrativeCommits;
    const narrativeCommits = new FailingCommittedCommitRepository(inner);
    const all = { ...repositories, narrativeCommits };
    const eventStore = new InMemoryEventStore();

    await expect(call(all, eventStore, revisionWith([sceneChange(), canonicalChange()])))
      .rejects.toThrow("commit save failed");

    expect((await all.scenes.findById("scene-1"))?.currentRevisionId).toBe("scene-rev-2");
    expect(await all.scenes.getRevision("scene-1", "scene-rev-2:commit-1")).toBeUndefined();
    expect(await all.canonicalFacts.getRevision("fact-1", "fact-rev-1:commit-1")).toBeUndefined();
    expect(await eventStore.listByNovel("novel-1")).toEqual([]);
    expect((await all.narrativeCommits.listByNovel("novel-1")).map(commit => commit.status)).toEqual(["failed"]);
    expect((await all.narrativeCommits.listByNovel("novel-1")).some(commit => commit.status === "committed")).toBe(false);
  });

  it("carries validation, OCC, invariant, and revision source identities into blockers", async () => {
    const repositories = await setup();
    const eventStore = new InMemoryEventStore();
    const revision = revisionWith([
      sceneChange(createVersionReference("Scene", "scene-1", "scene-rev-1")),
      canonicalChange(),
    ]);

    let caught: unknown;
    try {
      await call(repositories, eventStore, revision, {
        validationRuns: [validation("fail", "cs-1-r1", "validation-99")],
        reviewDecisions: [
          scopedReview(
            {
              requirementDomain: "canon",
              targetType: "canonical_fact",
              objectId: "fact-1",
            },
            "reject",
            "human",
            later,
            ["review-source-evidence"],
          ),
        ],
        unresolvedConflict: true,
        stale: true,
        unresolvedConflictEvidenceReferences: ["revision-fact-conflict"],
        staleEvidenceReferences: ["revision-fact-stale"],
        targetInvariantViolations: [
          { message: "span invariant failed", evidenceReferences: ["invariant-source"] },
        ],
      });
    } catch (error) {
      caught = error;
    }

    const gate = caught instanceof CommitGateBlockedError ? caught.gate : undefined;
    expect(gate?.blockers.find(blocker => blocker.type === "mandatory_validation_failed")?.evidenceReferences)
      .toEqual(["validation-99"]);
    expect(gate?.blockers.find(blocker => blocker.type === "occ_conflict")?.evidenceReferences)
      .toEqual(["Scene:scene-1@scene-rev-1", "current:Scene:scene-1@scene-rev-2"]);
    expect(gate?.blockers.find(blocker => blocker.type === "invariant_violation")?.evidenceReferences)
      .toContain("invariant-source");
    expect(gate?.blockers.find(blocker => blocker.type === "invalid_revision")?.evidenceReferences)
      .toEqual(["revision-fact-conflict"]);
    expect(gate?.blockers.find(blocker => blocker.type === "stale_revision")?.evidenceReferences)
      .toEqual(["revision-fact-stale"]);
    expect(gate?.blockers.every(blocker => blocker.evidenceReferences.every(ref => !ref.startsWith("fact:"))))
      .toBe(true);
  });
});

function subStateChange(subAddress: string, payload: Record<string, unknown>, id: string) {
  return createChange({
    id,
    sourceType: "author_edit",
    sourceReference: { identity: "author-1", version: "r1", hash: id },
    targetAddress: { targetType: "story_state", objectId: "state-1", subAddress },
    payload,
    basedOnVersionSet: createVersionSet({
      target: createVersionReference("StateRecord", "state-1", "state-rev-2"),
    }),
  });
}

function scopedReview(
  approvalScope: ApprovalScope & { readonly id?: string },
  decision: ReviewDecisionType = "approve",
  decidedBy: "human" | "policy" = "human",
  createdAt: Date = now,
  evidenceReferences: readonly string[] = ["validation-1"],
  id = "review-" + approvalScope.requirementDomain + "-" + approvalScope.objectId + "-" + (approvalScope.subAddress ?? "root") + "-" + decision,
) {
  const { id: explicitId, ...scope } = approvalScope;
  return createReviewDecision({
    id: explicitId ?? id,
    changeSetRevisionId: "cs-1-r1",
    approvalScope: scope,
    decision,
    decidedBy,
    actorId: decidedBy === "human" ? "reviewer-1" : "policy-engine",
    reason: decision === "reject" ? "Rejected after provenance review" : "",
    evidenceReferences,
    ...(decidedBy === "policy" ? { policyVersion: "policy-1", decisionRule: "approval-rule" } : {}),
    createdAt,
  });
}


class CasRevisionedRepository<T extends Revisioned<T>> extends InMemoryRevisionedRepository<T> {
  async seed(entity: T): Promise<void> {
    await super.save(entity);
  }

  private failureMessage?: string;

  failNextSaveWith(message: string): void {
    this.failureMessage = message;
  }

  async saveIfCurrent(expectedRevisionId: string, entity: T): Promise<void> {
    const current = await this.findById(entity.id);
    if (!current || current.currentRevisionId !== expectedRevisionId) {
      throw new Error(`CAS revision conflict: ${entity.id}`);
    }
    if (this.failureMessage) {
      const message = this.failureMessage;
      this.failureMessage = undefined;
      throw new Error(message);
    }
    await super.save(entity);
  }

  async save(): Promise<void> {
    throw new Error("naked repository save is forbidden");
  }
}

class CasNarrativeCommitRepository extends InMemoryRepository<NarrativeCommit> {
  private readonly reservedIds = new Set<string>();
  private readonly reservedRevisionIds = new Set<string>();

  async seed(entity: NarrativeCommit): Promise<void> {
    await super.save(entity);
  }

  async saveIfAbsent(entity: NarrativeCommit): Promise<void> {
    const reservation = `${entity.novelId}:${entity.changeSetRevisionId}`;
    if (this.reservedIds.has(entity.id) || this.reservedRevisionIds.has(reservation)) {
      throw new Error("NarrativeCommit reservation already exists");
    }
    this.reservedIds.add(entity.id);
    this.reservedRevisionIds.add(reservation);
    try {
      const existing = await this.findById(entity.id);
      const sameRevision = (await this.listByNovel(entity.novelId)).some(
        commit => commit.changeSetRevisionId === entity.changeSetRevisionId,
      );
      if (existing || sameRevision) {
        throw new Error("NarrativeCommit reservation already exists");
      }
      await super.save(entity);
    } finally {
      this.reservedIds.delete(entity.id);
      this.reservedRevisionIds.delete(reservation);
    }
  }

  async saveIfCurrent(expectedStatus: NarrativeCommit["status"], entity: NarrativeCommit): Promise<void> {
    const current = await this.findById(entity.id);
    if (!current || current.status !== expectedStatus) {
      throw new Error(`CAS commit status conflict: ${entity.id}`);
    }
    await super.save(entity);
  }

  async save(): Promise<void> {
    throw new Error("naked repository save is forbidden");
  }
}

class CasEventStore extends InMemoryEventStore {
  async appendIfAbsent(events: readonly DomainEvent[]): Promise<void> {
    await super.appendMany(events);
  }

  async append(): Promise<void> {
    throw new Error("naked event append is forbidden");
  }

  async appendMany(): Promise<void> {
    throw new Error("naked event append is forbidden");
  }
}

function casWorkRepositories(
  scenes: CasRevisionedRepository<Scene>,
  canonicalFacts: CasRevisionedRepository<CanonicalFact>,
  stateRecords: CasRevisionedRepository<StateRecord>,
  narrativeCommits: CasNarrativeCommitRepository,
  events: CasEventStore,
): CommitChangeSetRevisionTransactionWork {
  return {
    repositories: {
      scenes: {
      findById: (id: string) => scenes.findById(id),
      getRevision: (id: string, revisionId: string) => scenes.getRevision(id, revisionId),
      saveSceneIfCurrent: (expectedRevisionId: string, entity: Scene) =>
        scenes.saveIfCurrent(expectedRevisionId, entity),
    },
    canonicalFacts: {
      findById: (id: string) => canonicalFacts.findById(id),
      getRevision: (id: string, revisionId: string) => canonicalFacts.getRevision(id, revisionId),
      saveCanonicalFactIfCurrent: (expectedRevisionId: string, entity: CanonicalFact) =>
        canonicalFacts.saveIfCurrent(expectedRevisionId, entity),
    },
    stateRecords: {
      findById: (id: string) => stateRecords.findById(id),
      getRevision: (id: string, revisionId: string) => stateRecords.getRevision(id, revisionId),
      saveStateRecordIfCurrent: (expectedRevisionId: string, entity: StateRecord) =>
        stateRecords.saveIfCurrent(expectedRevisionId, entity),
    },
      narrativeCommits: {
        findById: (id: string) => narrativeCommits.findById(id),
        listByNovel: (novelId: string) => narrativeCommits.listByNovel(novelId),
        saveNarrativeCommitIfAbsent: (entity: NarrativeCommit) => narrativeCommits.saveIfAbsent(entity),
        saveNarrativeCommitIfCurrent: (
          expectedStatus: NarrativeCommit["status"],
          entity: NarrativeCommit,
        ) => narrativeCommits.saveIfCurrent(expectedStatus, entity),
      },
    },
    eventStore: {
      listByNovel: (novelId: string) => events.listByNovel(novelId),
      appendEventsIfAbsent: (batch: readonly DomainEvent[]) => events.appendIfAbsent(batch),
    },
  };
}

async function casSetup() {
  const scenes = new CasRevisionedRepository<Scene>();
  const canonicalFacts = new CasRevisionedRepository<CanonicalFact>();
  const stateRecords = new CasRevisionedRepository<StateRecord>();
  const narrativeCommits = new CasNarrativeCommitRepository();
  const events = new CasEventStore();

  await scenes.seed(
    commitSceneText({
      scene: createScene({
        id: "scene-1",
        novelId: "novel-1",
        chapterId: "chapter-1",
        title: "The Northern Gate",
        revisionId: "scene-rev-1",
        commitId: "initial",
        createdAt: now,
      }),
      text: "Old text",
      revisionId: "scene-rev-2",
      commitId: "initial",
      updatedAt: now,
    }),
  );
  await canonicalFacts.seed(
    createCanonicalFact({
      id: "fact-1",
      novelId: "novel-1",
      type: "world_rule",
      content: { rule: "old" },
      revisionId: "fact-rev-1",
      commitId: "initial",
      createdAt: now,
    }),
  );
  await stateRecords.seed(
    createStateRecord({
      id: "state-1",
      novelId: "novel-1",
      type: "world_state",
      subjectId: "world-1",
      position: { sceneId: "scene-1", ordinal: 1 },
      content: { status: "old" },
      revisionId: "state-rev-1",
      commitId: "initial",
      createdAt: now,
    }),
  );

  return { scenes, canonicalFacts, stateRecords, narrativeCommits, events };
}

type AwaitedCasSetup = Awaited<ReturnType<typeof casSetup>>;

class RollingBackCasTransaction {
  constructor(private readonly state: AwaitedCasSetup) {}

  async run<T>(
    operation: (work: ReturnType<typeof casWorkRepositories>) => Promise<T>,
  ): Promise<T> {
    const snapshots = {
      scenes: repositorySnapshot(this.state.scenes),
      canonicalFacts: repositorySnapshot(this.state.canonicalFacts),
      stateRecords: repositorySnapshot(this.state.stateRecords),
      narrativeCommits: repositorySnapshot(this.state.narrativeCommits),
      events: eventStoreSnapshot(this.state.events),
    };
    try {
      return await operation(casWorkRepositories(
        this.state.scenes,
        this.state.canonicalFacts,
        this.state.stateRecords,
        this.state.narrativeCommits,
        this.state.events,
      ) as never);
    } catch (error) {
      restoreRepository(this.state.scenes, snapshots.scenes);
      restoreRepository(this.state.canonicalFacts, snapshots.canonicalFacts);
      restoreRepository(this.state.stateRecords, snapshots.stateRecords);
      restoreRepository(this.state.narrativeCommits, snapshots.narrativeCommits);
      restoreEventStore(this.state.events, snapshots.events);
      throw error;
    }
  }
}

class DirectCasTransaction {
  constructor(private readonly state: AwaitedCasSetup) {}

  async run<T>(
    operation: (work: CommitChangeSetRevisionTransactionWork) => Promise<T>,
  ): Promise<T> {
    return operation(casWorkRepositories(
      this.state.scenes,
      this.state.canonicalFacts,
      this.state.stateRecords,
      this.state.narrativeCommits,
      this.state.events,
    ));
  }
}

describe("commitChangeSetRevision concurrency, manuscript composition, and scoped requirements", () => {
  it("allows only one concurrent commit for the same expected revisions and reserves one revision commit", async () => {
    const state = await casSetup();
    const changes = [sceneChange()];
    const revision = revisionWith(changes);

    const results = await Promise.allSettled([
      casCall(state, revision, "commit-1"),
      casCall(state, revision, "commit-2"),
    ]);

    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await state.scenes.findById("scene-1"))?.currentRevisionId).toBe("scene-rev-2:commit-1");
    expect(await state.narrativeCommits.listByNovel("novel-1")).toHaveLength(1);
    expect(await state.events.listByNovel("novel-1")).toHaveLength(2);
  });

  it("allows only one concurrent writer for the same expected scene revision across distinct revisions", async () => {
    const state = await casSetup();
    const first = revisionWith([sceneChange()], "cs-1-r1");
    const second = revisionWith([sceneChange()], "cs-1-r2");

    const results = await Promise.allSettled([
      casCall(state, first, "commit-1"),
      casCall(state, second, "commit-2"),
    ]);

    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const scene = await state.scenes.findById("scene-1");
    expect(scene?.currentRevisionId).toBeOneOf([
      "scene-rev-2:commit-1",
      "scene-rev-2:commit-2",
    ]);
  });

  it("rolls back earlier CAS writes when a later CAS write fails", async () => {
    const state = await casSetup();
    state.canonicalFacts.failNextSaveWith("canonical CAS failed");

    await expect(casCall(state, revisionWith([sceneChange(), canonicalChange()]), "commit-1", new RollingBackCasTransaction(state)))
      .rejects.toThrow("canonical CAS failed");

    expect((await state.scenes.findById("scene-1"))?.currentRevisionId).toBe("scene-rev-2");
    expect(await state.scenes.getRevision("scene-1", "scene-rev-2:commit-1")).toBeUndefined();
    expect((await state.canonicalFacts.findById("fact-1"))?.currentRevisionId).toBe("fact-rev-1");
    expect((await state.narrativeCommits.listByNovel("novel-1")).map(commit => commit.status)).toEqual(["failed"]);
    expect(await state.events.listByNovel("novel-1")).toEqual([]);
  });

  it("composes multiple manuscript subAddress target-span edits in order without later writes winning", async () => {
    const repositories = await setup();
    const original = (await repositories.scenes.findById("scene-1"))!;
    const text = "Alpha middle Omega.";
    const anchors = {
      alpha: {
        anchorId: "alpha",
        start: 0,
        end: 5,
        text: "Alpha",
        sourceContentHash: hashContent("Alpha"),
      },
      middle: {
        anchorId: "middle",
        start: 6,
        end: 12,
        text: "middle",
        sourceContentHash: hashContent("middle"),
      },
      omega: {
        anchorId: "omega",
        start: 13,
        end: 18,
        text: "Omega",
        sourceContentHash: hashContent("Omega"),
      },
    };
    await repositories.scenes.save(
      commitSceneText({
        scene: original,
        text,
        spanAnchors: anchors,
        revisionId: "scene-rev-3",
        commitId: "anchor-setup",
        updatedAt: now,
      }),
    );
    const eventStore = new InMemoryEventStore();
    const changes = [
      subSceneChange(
        "opening",
        { anchorId: "alpha", text: "Alpha", sourceContentHash: hashContent("Alpha") },
        "Beta",
        "change-opening",
      ),
      subSceneChange(
        "center",
        { anchorId: "middle", text: "middle", sourceContentHash: hashContent("middle") },
        "core",
        "change-center",
      ),
    ];

    const commit = await call(repositories, eventStore, revisionWith(changes), {
      reviewDecisions: changes.map((change, index) =>
        scopedReview({
          id: `review-scene-sub-${index}`,
          requirementDomain: "manuscript",
          targetType: "manuscript",
          objectId: "scene-1",
          subAddress: change.targetAddress.subAddress,
        }),
      ),
    });

    expect((await repositories.scenes.findById("scene-1"))?.text).toBe("Beta core Omega.");
    expect(Object.keys(commit.resultingVersionSet ?? {})).toEqual([
      "manuscript:scene-1#opening",
      "manuscript:scene-1#center",
    ]);
    expect((await eventStore.listByNovel("novel-1")).map(event => event.eventId)).toEqual([
      "event:commit-1:manuscript:scene-1#opening",
      "event:commit-1:manuscript:scene-1#center",
      "event:commit-1:recorded",
    ]);
  });

  it("blocks a manuscript subAddress change without a legal target-span payload before writing", async () => {
    const repositories = await setup();
    const eventStore = new InMemoryEventStore();
    const change = createChange({
      id: "change-invalid-local",
      sourceType: "author_edit",
      sourceReference: { identity: "author-1", version: "r1", hash: "invalid-local" },
      targetAddress: { targetType: "manuscript", objectId: "scene-1", subAddress: "opening" },
      payload: { replacement: "Beta" },
      basedOnVersionSet: createVersionSet({
        target: createVersionReference("Scene", "scene-1", "scene-rev-2"),
      }),
    });

    await expectBlocked(
      call(repositories, eventStore, revisionWith([change]), {
        reviewDecisions: [
          scopedReview({
            id: "review-invalid-local",
            requirementDomain: "manuscript",
            targetType: "manuscript",
            objectId: "scene-1",
            subAddress: "opening",
          }),
        ],
      }),
      ["invariant_violation"],
    );

    expect((await repositories.scenes.findById("scene-1"))?.text).toBe("Old text");
    expect((await repositories.scenes.findById("scene-1"))?.currentRevisionId).toBe("scene-rev-2");
    expect(await repositories.narrativeCommits.listByNovel("novel-1")).toEqual([]);
  });

  it("takes the strictest requirement level for multiple rules on one scope and never substitutes requirementDomain", async () => {
    const repositories = await setup();
    const eventStore = new InMemoryEventStore();
    const approvalScope: ApprovalScope = {
      requirementDomain: "plan",
      targetType: "manuscript",
      objectId: "scene-1",
    };
    const requirements = [
      explicitRequirement(approvalScope, "human", "manual-floor"),
      explicitRequirement(approvalScope, "policy", "policy-rule"),
      explicitRequirement(approvalScope, "not_required", "optional-rule"),
    ];

    let caught: unknown;
    try {
      await call(repositories, eventStore, revisionWith([sceneChange()]), {
        requiredApproval: false,
        reviewDecisions: [scopedReview(approvalScope, "approve", "policy", now, ["policy-evidence"])],
        approvalScopeRequirements: requirements,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CommitGateBlockedError);
    const blocker = caught instanceof CommitGateBlockedError
      ? caught.gate.blockers.find(entry => entry.type === "missing_required_approval")
      : undefined;
    expect(blocker?.facts).toContain("requirement=manual-floor");
    expect(blocker?.facts).toContain("requirementLevel=human");
    expect(blocker?.facts).not.toContain("requirement=plan");

    const commit = await call(repositories, eventStore, revisionWith([sceneChange()]), {
      commitId: "commit-human",
      requiredApproval: false,
      reviewDecisions: [scopedReview(approvalScope, "approve", "human", later, ["human-evidence"])],
      approvalScopeRequirements: requirements,
    });
    expect(commit.status).toBe("committed");
  });

  it("orders not_required below policy below human for same-scope requirements", async () => {
    const policyState = await setup();
    const policyScope: ApprovalScope = {
      requirementDomain: "canon",
      targetType: "canonical_fact",
      objectId: "fact-1",
    };
    const policyCommit = await call(policyState, new InMemoryEventStore(), revisionWith([canonicalChange()]), {
      requiredApproval: false,
      reviewDecisions: [scopedReview(policyScope, "approve", "policy")],
      approvalScopeRequirements: [
        explicitRequirement(policyScope, "not_required", "optional"),
        explicitRequirement(policyScope, "policy", "policy"),
      ],
    });
    expect(policyCommit.status).toBe("committed");

    const notRequiredState = await setup();
    const notRequiredCommit = await call(
      notRequiredState,
      new InMemoryEventStore(),
      revisionWith([canonicalChange()]),
      {
        requiredApproval: false,
        reviewDecisions: [scopedReview(policyScope, "approve", "policy")],
        approvalScopeRequirements: [explicitRequirement(policyScope, "not_required", "optional")],
      },
    );
    expect(notRequiredCommit.status).toBe("committed");
  });

  it("evaluates different approval scopes independently", async () => {
    const repositories = await setup();
    const eventStore = new InMemoryEventStore();
    const sceneScope: ApprovalScope = {
      requirementDomain: "manuscript",
      targetType: "manuscript",
      objectId: "scene-1",
    };
    const factScope: ApprovalScope = {
      requirementDomain: "canon",
      targetType: "canonical_fact",
      objectId: "fact-1",
    };

    const commit = await call(
      repositories,
      eventStore,
      revisionWith([sceneChange(), canonicalChange()]),
      {
        requiredApproval: false,
        reviewDecisions: [
          scopedReview(sceneScope, "approve", "human"),
          scopedReview(factScope, "approve", "policy"),
        ],
        approvalScopeRequirements: [
          explicitRequirement(sceneScope, "human", "scene-human"),
          explicitRequirement(factScope, "policy", "fact-policy"),
        ],
      },
    );

    expect(commit.status).toBe("committed");
  });

  it("does not apply a ReviewDecision to a requirement whose ApprovalScope does not match", async () => {
    const repositories = await setup();
    const eventStore = new InMemoryEventStore();
    const requiredScope: ApprovalScope = {
      requirementDomain: "manuscript",
      targetType: "manuscript",
      objectId: "scene-1",
    };
    const mismatchedScope: ApprovalScope = {
      ...requiredScope,
      subAddress: "summary",
    };

    let caught: unknown;
    try {
      await call(repositories, eventStore, revisionWith([sceneChange()]), {
        requiredApproval: false,
        reviewDecisions: [scopedReview(mismatchedScope, "approve", "human")],
        approvalScopeRequirements: [explicitRequirement(requiredScope, "human", "scene-human")],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CommitGateBlockedError);
    const gate = caught instanceof CommitGateBlockedError ? caught.gate : undefined;
    expect(gate?.blockers.map(blocker => blocker.type)).toContain("missing_required_approval");
    expect(gate?.blockers.find(blocker => blocker.type === "missing_required_approval")?.approvalScope)
      .toBe(approvalScopeKey(requiredScope));
  });
});

function explicitRequirement(
  approvalScope: ApprovalScope,
  requirementLevel: "not_required" | "policy" | "human",
  requirement: string,
) {
  return { approvalScope, requirement, requirementLevel };
}

function subSceneChange(
  subAddress: string,
  targetSpan: {
    readonly anchorId: string;
    readonly text: string;
    readonly sourceContentHash: string;
  },
  replacement: string,
  id: string,
) {
  return createChange({
    id,
    sourceType: "author_edit",
    sourceReference: { identity: "author-1", version: "r1", hash: id },
    targetAddress: { targetType: "manuscript", objectId: "scene-1", subAddress },
    payload: { targetSpan, replacement },
    basedOnVersionSet: createVersionSet({
      target: createVersionReference("Scene", "scene-1", "scene-rev-3"),
    }),
  });
}

async function casCall(
  state: AwaitedCasSetup,
  revision: ChangeSetRevision,
  commitId: string,
  transaction: CommitChangeSetRevisionTransaction = new DirectCasTransaction(state),
) {
  return commitChangeSetRevision({
    transaction,
    input: {
      commitId,
      changeSetRevision: revision,
      validationRuns: [validation()],
      reviewDecisions: revision.changes.map((change, index) =>
        review(
          change.targetAddress.targetType,
          change.targetAddress.objectId,
          "approve",
          `review-${revision.revisionId}-${index}`,
        ),
      ),
      currentRevisionFacts: { unresolvedConflict: false, stale: false },
      targetInvariantViolations: [],
      requiredApproval: false,
      now,
    },
  });
}
