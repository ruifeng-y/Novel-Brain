import { describe, expect, it } from "vitest";
import {
  createInMemoryReviewDecisionStore,
  createReviewDecisionService,
  ReviewDecisionBindingError,
  type RecordReviewInput,
} from "../../src/app/reviewDecisionService";
import { createInMemoryChangeSetPersistence } from "../../src/production/application/changeSetPersistence";
import { createChangeSetRevisionService } from "../../src/app/changeSetRevisionService";
import { InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import { createCandidate, type Candidate } from "../../src/production/domain/candidate";
import type { ApprovalScope } from "../../src/production/domain/reviewDecision";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import { isCommitConflictError } from "../../src/shared/application/commitConflict";

const AT = new Date("2026-10-06T00:00:00.000Z");
const LATER = new Date("2026-10-06T01:00:00.000Z");

function candidateFixture(id = "candidate-1", novelId = "novel-1"): Candidate {
  return createCandidate({
    id,
    taskId: `task-${id}`,
    novelId,
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-1:rev-1"),
    }),
    change: { type: "text", sceneId: "scene-1", text: "新文本。" },
    createdAt: AT,
  });
}

const approvalScope: ApprovalScope = {
  requirementDomain: "manuscript",
  targetType: "manuscript",
  objectId: "scene-1",
};

async function harness() {
  const persistence = createInMemoryChangeSetPersistence();
  const changeSetRevisions = createChangeSetRevisionService({
    changeSets: persistence.changeSets,
  });
  const candidates = new InMemoryRevisionedRepository<Candidate>();
  await candidates.save(candidateFixture());
  await changeSetRevisions.adoptCandidate({
    candidate: candidateFixture(),
    changeSetId: "cs-1",
    revisionId: "cs-1:r1",
    createdAt: AT,
  });
  const firstRevision = await changeSetRevisions.getRevision({
    changeSetId: "cs-1",
    revisionId: "cs-1:r1",
  });
  await changeSetRevisions.adoptCandidate({
    candidate: candidateFixture("candidate-2"),
    changeSetId: "cs-1",
    revisionId: "cs-1:r2",
    parentRevision: firstRevision,
    createdAt: AT,
  });

  const reviews = createInMemoryReviewDecisionStore();
  const service = createReviewDecisionService({
    reviews,
    changeSets: persistence.changeSets,
  });
  return { service, reviews, changeSetRevisions, persistence };
}

function approvalInput(overrides: Partial<RecordReviewInput> = {}): RecordReviewInput {
  return {
    reviewDecisionId: "review-1",
    changeSetId: "cs-1",
    revisionId: "cs-1:r1",
    approvalScope,
    decision: "approve",
    decidedBy: "human",
    actorId: "author-1",
    reason: "可以提交。",
    evidenceReferences: ["validation-run-1"],
    createdAt: AT,
    ...overrides,
  };
}

describe("[task:W3] [domain] review decision service", () => {
  it("records a decision bound to a revision and reads it back for that revision only", async () => {
    const { service } = await harness();

    const decision = await service.recordReview(approvalInput({ revisionId: "cs-1:r1" }));
    expect(decision.changeSetRevisionId).toBe("cs-1:r1");
    expect(decision.decision).toBe("approve");
    expect(decision.approvalScope).toEqual(approvalScope);
    expect((await service.listForRevision({ changeSetId: "cs-1", revisionId: "cs-1:r1" })).length).toBe(1);
    expect((await service.listForRevision({ changeSetId: "cs-1", revisionId: "cs-1:r2" })).length).toBe(0);
  });

  it("never answers with a decision recorded against another revision", async () => {
    const { service } = await harness();
    await service.recordReview(approvalInput({ revisionId: "cs-1:r1" }));
    await service.recordReview(
      approvalInput({
        reviewDecisionId: "review-2",
        revisionId: "cs-1:r2",
        decidedBy: "policy",
        policyVersion: "policy-v1",
        decisionRule: "rule-1",
        createdAt: LATER,
      }),
    );

    const first = await service.listForRevision({ changeSetId: "cs-1", revisionId: "cs-1:r1" });
    expect(first.map(entry => entry.id)).toEqual(["review-1"]);
    const second = await service.listForRevision({ changeSetId: "cs-1", revisionId: "cs-1:r2" });
    expect(second.map(entry => entry.id)).toEqual(["review-2"]);
  });

  it("refuses to record a decision for a revision that does not exist", async () => {
    const { service } = await harness();

    await expect(service.recordReview(approvalInput({ revisionId: "cs-1:missing" }))).rejects.toBeInstanceOf(
      ReviewDecisionBindingError,
    );
    await expect(
      service.listForRevision({ changeSetId: "cs-1", revisionId: "cs-1:missing" }),
    ).rejects.toBeInstanceOf(ReviewDecisionBindingError);
  });

  it("stores the decision as an immutable event and retries idempotently", async () => {
    const { service } = await harness();

    const first = await service.recordReview(approvalInput());
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.approvalScope)).toBe(true);
    expect(Object.isFrozen(first.evidenceReferences)).toBe(true);
    // The enumeration dimension is not part of the decision.
    expect(Object.keys(first)).not.toContain("novelId");

    // A retry with a different clock is the same decision, not a conflict.
    const retry = await service.recordReview(approvalInput({ createdAt: LATER }));
    expect(retry.id).toBe(first.id);
    expect((await service.listForRevision({ changeSetId: "cs-1", revisionId: "cs-1:r1" })).length).toBe(1);
  });

  it("rejects a different decision stored under the same identity", async () => {
    const { service } = await harness();
    await service.recordReview(approvalInput());

    const conflict = await service
      .recordReview(approvalInput({ decision: "reject", reason: "文本与设定冲突。" }))
      .catch(error => error);
    expect(isCommitConflictError(conflict)).toBe(true);
    expect((await service.listForRevision({ changeSetId: "cs-1", revisionId: "cs-1:r1" }))[0]?.decision).toBe(
      "approve",
    );
  });

  it("stores decided events only: there is no pending decision state", async () => {
    const { service } = await harness();
    await service.recordReview(approvalInput());

    const stored = await service.listForRevision({ changeSetId: "cs-1", revisionId: "cs-1:r1" });
    expect(stored).toHaveLength(1);
    // `pending` is not a ReviewDecisionType: the only recordable values are
    // decisions. The service stores decision events, never an awaiting state.
    expect(["approve", "reject", "request_regeneration"]).toContain(stored[0]?.decision);
    expect(stored[0]?.decision).toBe("approve");
  });

  it("does not answer with a decision recorded for another workspace", async () => {
    const persistence = createInMemoryChangeSetPersistence();
    const changeSetRevisions = createChangeSetRevisionService({
      changeSets: persistence.changeSets,
    });
    const candidates = new InMemoryRevisionedRepository<Candidate>();
    await candidates.save(candidateFixture("candidate-other", "novel-2"));
    await changeSetRevisions.adoptCandidate({
      candidate: candidateFixture("candidate-other", "novel-2"),
      changeSetId: "cs-other",
      revisionId: "cs-other:r1",
      createdAt: AT,
    });
    await changeSetRevisions.adoptCandidate({
      candidate: candidateFixture("candidate-1", "novel-1"),
      changeSetId: "cs-1",
      revisionId: "cs-1:r1",
      createdAt: AT,
    });

    const service = createReviewDecisionService({
      reviews: createInMemoryReviewDecisionStore(),
      changeSets: persistence.changeSets,
    });
    await service.recordReview(
      approvalInput({ reviewDecisionId: "review-other", changeSetId: "cs-other", revisionId: "cs-other:r1" }),
    );

    expect(await service.listForRevision({ changeSetId: "cs-1", revisionId: "cs-1:r1" })).toHaveLength(0);
    expect(
      await service.listForRevision({ changeSetId: "cs-other", revisionId: "cs-other:r1" }),
    ).toHaveLength(1);
  });

  it("never answers with a decision recorded in another Change Set that reuses the revision id", async () => {
    const persistence = createInMemoryChangeSetPersistence();
    const changeSetRevisions = createChangeSetRevisionService({
      changeSets: persistence.changeSets,
    });
    const candidates = new InMemoryRevisionedRepository<Candidate>();
    await candidates.save(candidateFixture());
    // The same revision id string in two different Change Sets.
    await changeSetRevisions.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId: "cs-1",
      revisionId: "shared:r1",
      createdAt: AT,
    });
    await changeSetRevisions.adoptCandidate({
      candidate: candidateFixture(),
      changeSetId: "cs-2",
      revisionId: "shared:r1",
      createdAt: AT,
    });

    const service = createReviewDecisionService({
      reviews: createInMemoryReviewDecisionStore(),
      changeSets: persistence.changeSets,
    });
    await service.recordReview(
      approvalInput({ reviewDecisionId: "review-cs-2", changeSetId: "cs-2", revisionId: "shared:r1" }),
    );

    expect(
      await service.listForRevision({ changeSetId: "cs-1", revisionId: "shared:r1" }),
    ).toHaveLength(0);
    expect(
      await service.listForRevision({ changeSetId: "cs-2", revisionId: "shared:r1" }),
    ).toHaveLength(1);
  });
});
