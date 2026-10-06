# W3 — Manuscript Change to Commit Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An edit becomes a Candidate; the author adopts it into a persisted Change Set Revision, runs Validation against that revision, records Approval, sees each of the five Commit Gate conditions independently, and commits. Candidate Review and Commit Review are distinct surfaces, and no code path commits a Candidate.

**Architecture:** The spine is currently an embedded precondition chain inside the commit route: the route builds the Change Set Revision in memory, calls `validateCandidate` with a client-supplied `validationId`, synthesises ReviewDecisions from a client-supplied template, and commits. W3 makes the revision addressable, promotes Validation and Approval into reachable stages whose artefacts the commit references, and replaces the client-supplied template with artefact references (the approved boundary option B).

**Tech Stack:** TypeScript, Node.js, Fastify, Prisma + PostgreSQL, Vitest, browser-native ES modules.

**Spec:** `docs/superpowers/specs/2026-10-06-novel-brain-workspace-product-design.md` (FROZEN, ff0d856)
**Roadmap:** `docs/superpowers/plans/2026-10-06-novel-brain-workspace-product-activation-roadmap.md` (W3 section)

## Global Constraints

All Global Constraints of the roadmap apply. In addition for W3:

- Change Set remains the Aggregate Root. Change Set Revision remains an Immutable Revision Snapshot. Revision history remains Linear. Change identity remains stable across revisions inside a Change Set.
- A Candidate is never the Validation, Approval, or Commit target. Validation and Approval bind to the Change Set Revision.
- `evaluateCommitGate` is the single gate evaluation. The gate query and the commit must both call it; neither may reimplement gate logic.
- Canonical state changes only through `commitChangeSetRevision`. W3 adds no second canonical write path.
- No client-supplied review template and no client-supplied `validationId`: the commit references real artefacts by id.
- Chinese copy; the existing state set; no pixel-level design.

## Facts verified before planning

```text
evaluateCommitGate(input: CommitGateInput): CommitGateResult        exists, single evaluation
validateCandidate({ validationId, changeSetRevisionId, planVersionId,
                    candidate, scene?, mustPreserve, createdAt })    already revision-bound
diffChangeSets(...)                                                 exists in the domain
commitChangeSetRevision(input)                                      exists
planVersionId                                                       a string; no ValidationPlan aggregate
```

Test snippets in this plan use local fixture helpers (`candidateFixture()`, `dependencies()`,
`validationInput()`, `approvalInput()`, `gateInput()`, `blockedPayload()`). Each builds domain objects
through the existing factories (`createCandidate`, `createInitialChangeSetRevision`, `createValidationRun`,
`createReviewDecision`, `createVersionSet`) and in-memory repositories. They live in the test file and are
not production surface.

Two consequences shape this wave:

```text
1. Change Set Revisions are NOT persisted. The commit route constructs one in memory. Nothing can bind
   to a revision today, yet Validation, Approval and the Gate all bind to one. Task 3.1 is therefore the
   foundation of this wave, not a convenience.
2. ValidationRuns are persisted only inside the commit transaction, so validation cannot today happen
   before a commit. Task 3.2 makes validation a pre-commit, readable stage.
```

---

## Task 3.1: Change Set Persistence and Adoption

**Files:**
- Create: `src/production/application/changeSetPersistence.ts`
- Create: `src/app/changeSetRevisionService.ts`
- Create: `src/app/changeSetDiffQuery.ts`
- Modify: `src/http/routes.ts`, `src/app/composition.ts`, `src/app/prismaComposition.ts`, `src/application/commandQueryBoundary.ts`
- Test: `tests/app/taskW3ChangeSetRevisionService.test.ts`
- Test: `tests/app/taskW3ChangeSetDiffQuery.test.ts`
- Test: `tests/http/taskW3AdoptionApi.test.ts`

**Interfaces:**
- Consumes: the Change Set domain (`createInitialChangeSetRevision`, `replaceChangeSetChanges`, `createChangeSetRevision`), `diffChangeSets`, the in-memory and Prisma revisioned repository patterns already used for `NarrativeProposal`.
- Produces:

```ts
export interface ChangeSetPersistence {
  readonly transaction: PersistenceTransaction<ChangeSetWork>;
  readonly changeSets: RevisionedRepository<ChangeSet>;   // revision payload = the Change Set Revision snapshot
}

export function createInMemoryChangeSetPersistence(): ChangeSetPersistence;
export function createPrismaChangeSetPersistence(prisma: PrismaClient): ChangeSetPersistence;

// src/app/changeSetRevisionService.ts
export function createChangeSetRevisionService(dependencies: {
  readonly changeSets: RevisionedRepository<ChangeSet>;
}): {
  adoptCandidate(input: {
    readonly candidate: Candidate;
    readonly changeSetId: string;
    readonly revisionId: string;
    readonly parentRevision?: ChangeSetRevision;
    readonly createdAt: Date;
  }): Promise<ChangeSetRevision>;
  getRevision(input: { readonly changeSetId: string; readonly revisionId: string }): Promise<ChangeSetRevision | undefined>;
  getCurrentRevision(input: { readonly changeSetId: string }): Promise<ChangeSetRevision | undefined>;
};

// src/app/changeSetDiffQuery.ts
export function createChangeSetDiffQuery(dependencies: { readonly changeSets: RevisionedRepository<ChangeSet> }): {
  diffRevisions(input: {
    readonly changeSetId: string;
    readonly fromRevisionId: string;
    readonly toRevisionId: string;
  }): Promise<readonly ChangeDiffEntry[] | undefined>;
};
```

**The core modelling decision of this task:** a Change Set is a revisioned aggregate whose stored revision payload IS the Change Set Revision snapshot, so `revisionId` addresses exactly what Validation, Approval and the Gate need. Confirm the domain shapes line up while implementing; if the Change Set aggregate root carries fields the revision snapshot does not, persist them in the snapshot rather than inventing a second store, and say so in the report.

Contracts: `commit.command.create-change-set-revision` (adoption) and `commit.query.change-set-revision-diff`.

- [ ] **Step 1: Write the failing adoption test**

```ts
it("adopts a candidate into a persisted change set revision that can be read back", async () => {
  const service = createChangeSetRevisionService(dependencies());
  const revision = await service.adoptCandidate({
    candidate: candidateFixture(),
    changeSetId: "cs-1",
    revisionId: "cs-1:r1",
    createdAt: new Date("2026-10-06T00:00:00.000Z"),
  });

  expect(revision.revisionId).toBe("cs-1:r1");
  expect(revision.changes).toHaveLength(1);
  expect((await service.getRevision({ changeSetId: "cs-1", revisionId: "cs-1:r1" }))?.changes).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify RED**, then implement (Step 3): persistence in both roots, the service, the diff query, and two routes.

- [ ] **Step 4: Write the failing durability + diff tests**

```ts
it("reads a revision through a fresh Prisma composition root", async () => { /* writer root then reader root */ });
it("diffs two revisions of one change set", async () => {
  const entries = await query.diffRevisions({ changeSetId: "cs-1", fromRevisionId: "cs-1:r1", toRevisionId: "cs-1:r2" });
  expect(entries?.map(entry => entry.action)).toContain("modified");
});
```

- [ ] **Step 5: Verify GREEN, `npm run typecheck && npm test -- --run`, integration, commit**

```bash
git commit -m "feat: 建立变更集持久化与采纳"
```

---

## Task 3.2: Validation as a Reachable Stage

**Files:**
- Create: `src/app/validationRunService.ts`
- Modify: `src/production/application/validateCandidate.ts` (only if its signature needs a revision-first entry; do not change its semantics)
- Modify: `src/http/routes.ts`, `src/application/commandQueryBoundary.ts`, composition roots
- Test: `tests/app/taskW3ValidationRunService.test.ts`
- Test: `tests/http/taskW3ValidationApi.test.ts`

**Interfaces:**
- Consumes: `validateCandidate`, `createValidationRun`, the persisted Change Set Revision from Task 3.1.
- Produces:

```ts
export function createValidationRunService(dependencies: {
  readonly changeSets: RevisionedRepository<ChangeSet>;
  readonly validations: UniqueCreatePort<ValidationRun>;   // run persistence, independent of any commit
  readonly scenes: RevisionedRepository<Scene>;
  readonly candidates: RevisionedRepository<Candidate>;
}): {
  runValidation(input: {
    readonly changeSetId: string;
    readonly revisionId: string;
    readonly validationId: string;
    readonly planVersionId: string;
    readonly candidateId: string;
    readonly mustPreserve: readonly string[];
    readonly createdAt: Date;
  }): Promise<ValidationRun>;
  getValidation(input: { readonly validationId: string }): Promise<ValidationRun | undefined>;
};
```

Binding rule: the run records the Change Set Revision it validated and the frozen `planVersionId`. A run for one revision is never returned for another. The run is persisted **before** any commit, so validation is a stage the author performs and can inspect.

Contracts: `validation.command.run-validation` and `validation.query.validation-run`.

- [ ] **Step 1: Write the failing test**

```ts
it("runs validation against a revision and reads the run back with its findings", async () => {
  const run = await service.runValidation(validationInput());
  expect(run.changeSetRevisionId).toBe("cs-1:r1");
  expect(run.planVersionId).toBe("plan-v1");
  expect((await service.getValidation({ validationId: run.validationId }))?.findings.length).toBeGreaterThan(0);
});

it("does not answer with a run that validated a different revision", async () => {
  expect(await service.getValidation({ validationId: "run-for-other-revision" })).toBeUndefined();
});
```

- [ ] **Step 2 RED**, **Step 3 implement**, **Step 4 GREEN + typecheck + full + integration**, **Step 5 commit**

```bash
git commit -m "feat: 让校验成为可达阶段"
```

---

## Task 3.3: Approval as a Reachable Stage

**Files:**
- Create: `src/app/reviewDecisionService.ts`
- Modify: `src/http/routes.ts`, `src/application/commandQueryBoundary.ts`, composition roots
- Test: `tests/app/taskW3ReviewDecisionService.test.ts`
- Test: `tests/http/taskW3ApprovalApi.test.ts`

**Interfaces:**
- Consumes: `createReviewDecision`, `approvalScopeKey`, the persisted revision from Task 3.1.
- Produces:

```ts
export function createReviewDecisionService(dependencies: {
  readonly reviews: UniqueCreatePort<ReviewDecision>;
  readonly changeSets: RevisionedRepository<ChangeSet>;
}): {
  recordReview(input: {
    readonly reviewDecisionId: string;
    readonly changeSetId: string;
    readonly revisionId: string;
    readonly approvalScope: ApprovalScope;
    readonly decision: "approve" | "reject" | "request_regeneration";
    readonly decidedBy: "human" | "policy";
    readonly actorId: string;
    readonly reason: string;
    readonly evidenceReferences: readonly string[];
    readonly policyVersion?: string;
    readonly decisionRule?: string;
    readonly createdAt: Date;
  }): Promise<ReviewDecision>;
  listForRevision(input: {
    readonly changeSetId: string;
    readonly revisionId: string;
  }): Promise<readonly ReviewDecision[]>;
};
```

Rules: a ReviewDecision is an immutable Decision Event bound to the Change Set Revision and an Approval Scope. `Pending` is not a decision state and must not be stored as one. A decision recorded for one revision is never returned for another. Approvals are derived from decisions; the service stores decisions only.

Contracts: `approval.command.record-review-decision` and `approval.query.approval-evidence`.

- [ ] **Step 1: Write the failing test**

```ts
it("records a decision bound to a revision and reads it back for that revision only", async () => {
  const decision = await service.recordReview(approvalInput({ revisionId: "cs-1:r1" }));
  expect(decision.changeSetRevisionId).toBe("cs-1:r1");
  expect((await service.listForRevision({ changeSetId: "cs-1", revisionId: "cs-1:r1" })).length).toBe(1);
  expect((await service.listForRevision({ changeSetId: "cs-1", revisionId: "cs-1:r2" })).length).toBe(0);
});
```

- [ ] **Step 2 RED**, **Step 3 implement**, **Step 4 GREEN + typecheck + full + integration**, **Step 5 commit**

```bash
git commit -m "feat: 让批准成为可达阶段"
```

---

## Task 3.4: Commit Gate Evaluation Query

**Files:**
- Create: `src/app/commitGateQuery.ts`
- Modify: `src/http/routes.ts`, `src/application/commandQueryBoundary.ts`
- Test: `tests/app/taskW3CommitGateQuery.test.ts`
- Test: `tests/http/taskW3GateApi.test.ts`

**Interfaces:**
- Consumes: `evaluateCommitGate`, `CommitGateInput`, `CommitGateResult`, the persisted revision, its validation runs and its review decisions.
- Produces:

```ts
export interface CommitGatePresentation {
  readonly revisionValidity: { readonly ok: boolean; readonly reason?: string };
  readonly concurrency: { readonly ok: boolean; readonly reason?: string };
  readonly invariant: { readonly ok: boolean; readonly reason?: string };
  readonly validation: { readonly ok: boolean; readonly reason?: string };
  readonly approval: { readonly ok: boolean; readonly reason?: string };
  readonly allowed: boolean;
  readonly blockers: readonly CommitGateBlocker[];
  readonly requiredActions: readonly CommitGateRequiredAction[];
}

export function createCommitGateQuery(dependencies: {
  readonly changeSets: RevisionedRepository<ChangeSet>;
  readonly validations: RepositoryReadPort<ValidationRun>;
  readonly reviews: RepositoryReadPort<ReviewDecision>;
}): {
  evaluate(input: {
    readonly changeSetId: string;
    readonly revisionId: string;
    readonly currentRevisionFacts: CommitChangeSetRevisionCurrentRevisionFacts;
    readonly targetInvariantViolations: readonly CommitGateInvariantViolation[];
    readonly approvalRequirements: readonly CommitGateApprovalRequirementFact[];
  }): Promise<CommitGatePresentation | undefined>;
};
```

Rules: the five conditions are reported independently and never collapsed into one indicator. The five group the existing `CommitGateBlockerType` values — do not invent blocker types:

```text
Revision Validity  invalid_revision, stale_revision
Concurrency        occ_conflict
Invariant          invariant_violation
Validation         mandatory_validation_failed, mandatory_needs_review
Approval           missing_required_approval, review_rejected, review_blocked,
                   regeneration_requested
```

Contract: `commit.query.commit-gate`.

- [ ] **Step 1: Write the failing test**

```ts
it("reports the five conditions independently", async () => {
  const gate = await query.evaluate(gateInput({ withValidationFailure: true }));
  expect(gate?.validation.ok).toBe(false);
  expect(gate?.approval.ok).toBe(true);
  expect(gate?.allowed).toBe(false);
  expect(gate?.requiredActions).toContain("fix_validation");
});
```

- [ ] **Step 2 RED**, **Step 3 implement**, **Step 4 GREEN + typecheck + full**, **Step 5 commit**

```bash
git commit -m "feat: 建立提交门禁评估查询"
```

---

## Task 3.5: Commit Boundary Change and Provenance Read

**Files:**
- Modify: `src/http/routes.ts` (the commit route), `src/application/commandQueryBoundary.ts`
- Create: `src/app/commitProvenanceQuery.ts`
- Test: `tests/http/taskW3CommitBoundary.test.ts`
- Test: `tests/app/taskW3CommitProvenanceQuery.test.ts`

**Interfaces:**
- Consumes: `commitChangeSetRevision`, `evaluateCommitGate` (the same function Task 3.4 uses), the persisted revision, validation runs, review decisions.
- Produces the new commit request shape (boundary option B):

```ts
// POST /change-sets/:changeSetId/commit
{
  commitId: string;
  changeSetRevisionId: string;
  validationRunIds: readonly string[];      // real artefacts, no client-supplied validationId
  reviewDecisionIds: readonly string[];     // real artefacts, no client-supplied template
  currentRevisionFacts: { unresolvedConflict: boolean; stale: boolean;
                          unresolvedConflictEvidenceReferences?: readonly string[];
                          staleEvidenceReferences?: readonly string[] };
  targetInvariantViolations: readonly CommitGateInvariantViolation[];
  approvalRequirements: readonly CommitGateApprovalRequirementFact[];
}
```

Rules:

- The route no longer accepts `candidateId`, `candidateSource`, `validationId`, `planVersionId`,
  `mustPreserve`, `requiredApproval`, `approvalScopeRequirements`, or a `reviewDecision` template.
- The route re-evaluates the gate with `evaluateCommitGate` at commit time, because the current-state facts
  may have changed since the author previewed it. A blocked gate returns 409 with the same presentation the
  gate query returns.
- Every referenced artefact must exist and belong to the addressed revision; a mismatch is 409, never a
  silent substitution.
- `commitChangeSetRevision` remains the only canonical write.

Also produce a provenance read: `GET /novels/:novelId/commits/:commitId` returning the commit, its
revision reference, the validation runs and review decisions it referenced, and its audit events.
Contract: `commit.query.commit-provenance`.

- [ ] **Step 1: Write the failing tests**

```ts
it("commits a revision referencing real validation and approval artefacts", async () => { /* 201 */ });
it("rejects a commit that references an artefact from another revision", async () => { /* 409, no write */ });
it("rejects a commit whose gate is blocked and returns the five conditions", async () => {
  const response = await app.inject({ method: "POST", url: "/change-sets/cs-1/commit", payload: blockedPayload() });
  expect(response.statusCode).toBe(409);
  expect(response.json().gate.validation.ok).toBe(false);
});
it("no longer accepts a candidate id in the commit request", async () => { /* 400 */ });
```

- [ ] **Step 2 RED**, **Step 3 implement**, **Step 4 GREEN + typecheck + full + integration**, **Step 5 commit**

```bash
git commit -m "feat: 提交边界改为引用校验与批准产物"
```

---

## Task 3.6: Candidate Review and Commit Review Surfaces

**Files:**
- Create: `public/workspace/candidateReview.js`
- Create: `public/workspace/commitReview.js`
- Modify: `public/workspace/shell.js`, `public/workspace/apiClient.js`, `public/workspace/workspace.css`, `src/http/server.ts`
- Test: `tests/public/taskW3ReviewSurfaces.test.ts`

**Interfaces:**
- Consumes: the Task 3.1–3.5 endpoints, the shell's focus model, the resolution contract.
- Produces:

```js
// public/workspace/candidateReview.js
export function renderCandidateReview(root, view, handlers): void;   // compare, diff, evidence, impact, validation, adoption
// public/workspace/commitReview.js
export function renderCommitReview(root, view, handlers): void;      // five gates, commit action, provenance, audit
```

Required behaviour:

- Candidate Review is reachable from a `candidate` focus and offers adopt / edit / reject / regenerate.
  It has **no commit action**. A test must assert that no commit control exists in the candidate surface.
- Commit Review is reachable only from a `change-set-revision` focus. It renders the five gate conditions
  independently, each with its own status and reason, plus the required actions.
- The commit control is disabled while the gate is blocked and names the blocking conditions.
- After a commit, the provenance and audit of that commit are readable from the Commit surface.
- Read-only rendering for anything the author cannot yet change; no edit control in W3 beyond adoption
  actions already provided by the application layer.
- Chinese copy; existing state set; no page reload; the tree's current-row highlight and the structure
  lens behaviour from W2 must not regress.

- [ ] **Step 1: Write the failing tests** (candidate surface has no commit control; commit surface renders
  five conditions; commit disabled when blocked), **Step 2 RED**, **Step 3 implement**, **Step 4 GREEN**,
  **Step 5 browser verification** of the full journey, **Step 6 commit**

```bash
git commit -m "feat: 建立候选审阅与提交审阅界面"
```

---

## W3 Exit

```text
Focused tests green, npm run typecheck, npm test -- --run, verify:system --task W3 with EXIT CODE 0
Real-process smoke on the acceptance journey: candidate -> adoption -> revision -> validation -> approval
  -> gate (five conditions) -> commit -> provenance, from the running app
Candidate safety: no code path commits a Candidate; the commit route rejects a candidate id; the candidate
  surface exposes no commit control
Gate safety: the gate query and the commit share evaluateCommitGate; a blocked gate returns 409 with the
  five conditions and writes nothing
Revision binding: a validation run or review decision from another revision is rejected, never substituted
No second canonical write path
```

## Explicitly Not In W3

```text
Narrative state by position and the four layers (W4)
Process Center and Recall completion (W5)
Real AI provider integration; the deterministic runtime stays
Pixel-level design, motion, keyboard map
Multi-user approval routing and policy engines beyond the frozen approval requirement facts
```

