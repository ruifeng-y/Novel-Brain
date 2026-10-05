# Novel Brain Runtime Productionization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the frozen boundaries actually run: put canonical truth in PostgreSQL, secure the request surface with a real provider, and close the Run / Recall product-surface dead ends so an author can create a run and act on recall from the UI.

**Architecture:** Reuse every frozen contract. The only new persistence code is the Prisma implementation of the existing commit transaction plus a Prisma composition root; no Domain, DTO, or API semantic changes. Security is injected as an existing `HttpBoundaryPipeline`; Run approval and Recall attention reuse existing application services and existing Application contract ids.

**Tech Stack:** TypeScript, Node.js (native type stripping), Fastify, Prisma + PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-novel-brain-productionization-architecture.md`

## Global Constraints

- Product Design = LOCKED. Entity Design = CLOSED. Productionization Architecture = FROZEN.
- Change Set = Aggregate Root; Change Set Revision = Immutable Revision Snapshot; Revision History = Linear.
- Production Run is orchestration only and never owns Narrative Truth.
- Recall is derived read-only attention: no Narrative Truth mutation, no direct Task creation, no commit.
- Story Foundation never auto-commits.
- No dual-bound legacy semantics, no silent adapters, no temporary fallback state, and no second source of truth.
- A runtime composition root either uses canonical persistence end to end or stays in-memory; never mix the two.
- Provider-specific model vendors, prompt frameworks, Recall scoring/vector retrieval, cost tuning, and advanced validator catalogs remain deferred.
- TDD per task: RED, verify failure, implement, verify pass.
- Each task gets at most one fix round.
- Review checks original Acceptance only; P2/P3 findings are deferred.
- `npm run verify:system -- --task <profile>` must pass before commit; reports under `.superpowers/` are never staged.

---

## File Structure

```text
src/app/
  prismaCommitTransaction.ts     Prisma implementation of the frozen commit transaction
  prismaComposition.ts           Prisma-backed engine dependencies + server
  recallAttentionSource.ts       Composes recall observation loads into attention items

src/platform/
  productionSecurityProvider.ts  Environment-driven AuthN/AuthZ/isolation/rate/secret provider

src/app/productSurfaceCommandService.ts   adds approveRunPlan; reads recall attention projection
src/http/routes.ts                        adds run-plan approval route
public/app.js                             Run view: plan + approve + start; Recall: dispositions
scripts/productionProcessComposition.ts   switches the application process to the Prisma root

tests/integration/
  prismaCommitTransaction.test.ts
  prismaEngineComposition.test.ts
tests/platform/
  taskR7ProductionSecurityProvider.test.ts
tests/app/
  taskR8RunCreationChain.test.ts
  taskR9RecallAttentionSource.test.ts
tests/http/
  taskR8RunCreationApiSurface.test.ts
  taskR9RecallDispositionApiSurface.test.ts
tests/public/
  taskR8R9WorkspaceUiCompletion.test.ts
tests/support/
  taskR7R9RuntimeProductionizationVerificationTaskManifest.test.ts
```

---

### Task 1: Prisma Commit Transaction

**Files:**
- Create: `src/app/prismaCommitTransaction.ts`
- Test: `tests/integration/prismaCommitTransaction.test.ts`

**Interfaces:**
- Consumes: `CommitChangeSetRevisionTransaction`, `CommitChangeSetRevisionTransactionWork`, `CommitChangeSetRevisionRepositories`, `CommitChangeSetRevisionEventStore` from `src/safety/application/commitChangeSetRevision.ts`; `PrismaClient`; `PrismaPersistenceTransaction`; `PrismaRepository` / `PrismaRevisionedRepository` / `PrismaEventStore` from `src/shared/infrastructure/prismaRepositories.ts`.
- Produces:

```ts
export function createPrismaCommitTransaction(
  prisma: PrismaClient,
): CommitChangeSetRevisionTransaction;
```

Behavior contract (must hold inside one `run()`):
1. `repositories.scenes.saveSceneIfCurrent(expectedRevisionId, scene)` performs compare-and-set on the current scene revision and rejects a stale expectation without writing.
2. Same compare-and-set semantics for `canonicalFacts` and `stateRecords`.
3. `narrativeCommits.saveNarrativeCommitIfAbsent` and `saveNarrativeCommitIfCurrent(expectedStatus, commit)` follow the frozen commit state machine; a conflicting status is rejected.
4. `eventStore.appendEventsIfAbsent(events)` reserves every `eventId` atomically and rejects on any duplicate, reserving nothing.
5. Any throw inside `operation` leaves no partial canonical write, no narrative commit, and no event; the transaction rolls back.

- [ ] **Step 1: Write the failing stale-revision test**

```ts
it("rejects a scene compare-and-set against a stale revision without writing", async () => {
  const transaction = createPrismaCommitTransaction(prisma);
  await seedScene(prisma, { id: "scene-1", revisionId: "scene-1:r2" });

  await expect(
    transaction.run(async work => {
      await work.repositories.scenes.saveSceneIfCurrent("scene-1:r1", updatedScene("scene-1"));
    }),
  ).rejects.toThrow();

  expect(await currentSceneRevisionId(prisma, "scene-1")).toBe("scene-1:r2");
});
```

- [ ] **Step 2: Write the failing atomicity test**

```ts
it("rolls back canonical writes when event append fails on a duplicate eventId", async () => {
  const transaction = createPrismaCommitTransaction(prisma);
  await seedScene(prisma, { id: "scene-2", revisionId: "scene-2:r1" });
  await seedEvent(prisma, { eventId: "event-dup" });

  await expect(
    transaction.run(async work => {
      await work.repositories.scenes.saveSceneIfCurrent("scene-2:r1", updatedScene("scene-2"));
      await work.eventStore.appendEventsIfAbsent([domainEvent("event-dup")]);
    }),
  ).rejects.toThrow();

  expect(await currentSceneRevisionId(prisma, "scene-2")).toBe("scene-2:r1");
});
```

- [ ] **Step 3: Run the tests to verify RED**

Run: `$env:DATABASE_URL='postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public'; npm run test:integration -- --run tests/integration/prismaCommitTransaction.test.ts`

Expected: FAIL because `src/app/prismaCommitTransaction.ts` does not exist.

- [ ] **Step 4: Implement the Prisma commit transaction**

Implement `createPrismaCommitTransaction` on top of `PrismaPersistenceTransaction<CommitChangeSetRevisionTransactionWork>` so every read and write inside `operation` uses the same transaction client. Map the existing Prisma repository classes onto the frozen commit ports; do not add new port methods. Reject a stale compare-and-set by comparing the persisted current revision before writing, and reject duplicate event ids before inserting any event.

- [ ] **Step 5: Run the tests to verify GREEN**

Run: `$env:DATABASE_URL='postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public'; npm run test:integration -- --run tests/integration/prismaCommitTransaction.test.ts`

Expected: PASS.

- [ ] **Step 6: Verify no regressions**

Run: `npm run typecheck && npm test -- --run`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/prismaCommitTransaction.ts tests/integration/prismaCommitTransaction.test.ts
git commit -m "feat: 实现 Prisma 提交事务"
```

---

### Task 2: Prisma Runtime Composition Root

**Files:**
- Create: `src/app/prismaComposition.ts`
- Modify: `scripts/productionProcessComposition.ts`
- Test: `tests/integration/prismaEngineComposition.test.ts`

**Interfaces:**
- Consumes: `ApiDependencies` from `src/http/routes.ts`; Task 1 `createPrismaCommitTransaction`; `createPrismaNarrativeProposalPersistence`, `createPrismaRunOrchestrationPersistence`, `createPrismaAttentionDispositionPersistence`; `createPrismaProductionPersistenceEnvironment`; `PrismaRepository` / `PrismaRevisionedRepository` / `PrismaEventStore`; `createNovelBrainServer`.
- Produces:

```ts
export function createPrismaEngineDependencies(
  prisma: PrismaClient,
): ApiDependencies;

export function createPrismaEngineServer(prisma: PrismaClient): ReturnType<typeof createNovelBrainServer>;
```

- [ ] **Step 1: Write the failing durability test**

```ts
it("persists a foundation proposal across a fresh composition root", async () => {
  const first = createPrismaEngineServer(prisma);
  await first.inject({
    method: "POST",
    url: "/foundation/entries",
    headers: { "x-author-id": "author-1", "x-workspace-id": "novel-1" },
    payload: {
      entryId: "entry-durable",
      novelId: "novel-1",
      proposalId: "proposal-durable",
      mode: "idea",
      idea: "A city remembers every promise it breaks.",
      generation: {
        taskId: "task-durable",
        agentRole: "planner",
        modelPolicy: { provider: "deterministic", model: "foundation-reference", maxOutputTokens: 512 },
        basedOnVersionSet: { novel: { aggregateType: "Novel", objectId: "novel-1", revisionId: "rev-1" } },
      },
    },
  });

  const second = createPrismaEngineServer(prisma);
  const workspace = await second.inject({ method: "GET", url: "/workspace/novel-1" });

  expect(workspace.statusCode).toBe(200);
  expect(workspace.body).toContain("proposal-durable");
});
```

- [ ] **Step 2: Write the failing single-truth-source test**

```ts
it("binds every canonical repository and the commit transaction to Prisma", () => {
  const dependencies = createPrismaEngineDependencies(prisma);

  expect(dependencies.commitTransaction.constructor.name).toBe("PrismaCommitTransaction");
  expect(dependencies.novels.constructor.name).toBe("PrismaRepository");
  expect(dependencies.product?.foundationPersistence).toBeDefined();
});
```

- [ ] **Step 3: Run the tests to verify RED**

Run: `$env:DATABASE_URL='postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public'; npm run test:integration -- --run tests/integration/prismaEngineComposition.test.ts`

Expected: FAIL because `src/app/prismaComposition.ts` does not exist.

- [ ] **Step 4: Implement the Prisma composition root**

Build `ApiDependencies` entirely from Prisma-backed repositories and Task 1's commit transaction, and construct the product surface dependencies from the Prisma persistence factories. The application process must use this root in `scripts/productionProcessComposition.ts` (replace the `createInMemoryEngineServer` import and the application controller body). Do not add an environment switch that keeps both roots alive; a deployment either uses the Prisma root or refuses to start.

- [ ] **Step 5: Run the tests to verify GREEN**

Run: `$env:DATABASE_URL='postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public'; npm run test:integration -- --run tests/integration/prismaEngineComposition.test.ts`

Expected: PASS.

- [ ] **Step 6: Verify no regressions**

Run: `npm run typecheck && npm test -- --run && $env:DATABASE_URL='postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public'; npm run test:integration -- --run`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/prismaComposition.ts scripts/productionProcessComposition.ts tests/integration/prismaEngineComposition.test.ts
git commit -m "feat: 建立 Prisma 运行时组合根"
```

---

### Task 3: Production Security Provider Injection

**Files:**
- Create: `src/platform/productionSecurityProvider.ts`
- Modify: `scripts/productionProcessComposition.ts`
- Test: `tests/platform/taskR7ProductionSecurityProvider.test.ts`
- Test: `tests/support/taskR7R9RuntimeProductionizationVerificationTaskManifest.test.ts`

**Interfaces:**
- Consumes: `createPlatformSecurityBoundary`, `PlatformSecurityBoundary`; `createHttpBoundaryPipeline`, `HttpBoundaryPipeline`; `createProductRequestValidators`; `ProductionConfiguration`.
- Produces:

```ts
export interface ProductionSecurityConfiguration {
  readonly principals: readonly {
    readonly token: string;
    readonly subjectId: string;
    readonly accountId: string;
    readonly workspaceIds: readonly string[];
    readonly roles: readonly string[];
  }[];
  readonly rateLimit: number;
  readonly secrets: Readonly<Record<string, string>>;
}

export function parseProductionSecurityConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): ProductionSecurityConfiguration;

export function createProductionHttpBoundaryPipeline(
  configuration: ProductionConfiguration,
  env: Readonly<Record<string, string | undefined>>,
): HttpBoundaryPipeline;
```

Behavior contract: rate limit is consumed before authentication; an unknown token is rejected; a principal may not act outside its workspace ids; a secret reference outside the permitted resource/key scope is rejected.

- [ ] **Step 1: Write the failing authentication-ordering test**

```ts
it("consumes the rate budget before rejecting an unknown token", async () => {
  const pipeline = createProductionHttpBoundaryPipeline(configuration, env);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await expect(
      pipeline.execute(
        "foundation.query.workspace-focus",
        boundaryContext({ subjectId: "unknown-token", workspaceId: "novel-1" }),
        { params: { novelId: "novel-1" } },
        async () => "never",
      ),
    ).rejects.toThrow();
  }
  expect(rateLimiterConsumeCount()).toBe(2);
});
```

- [ ] **Step 2: Write the failing isolation and secret tests**

```ts
it("rejects cross-workspace access and same-workspace cross-key secrets", async () => {
  const pipeline = createProductionHttpBoundaryPipeline(configuration, env);
  await expect(
    pipeline.execute(
      "foundation.query.workspace-focus",
      boundaryContext({ subjectId: "author-token", workspaceId: "novel-2" }),
      { params: { novelId: "novel-2" } },
      async () => "never",
    ),
  ).rejects.toThrow();

  const boundary = createProductionSecurityBoundary(env);
  const permit = await boundary.protect(secretAction("novel-1", "provider-a"));
  await expect(boundary.resolveSecret(permit, { key: "provider-b", workspaceId: "novel-1" })).rejects.toThrow();
});
```

- [ ] **Step 3: Run the tests to verify RED**

Run: `npx vitest run tests/platform/taskR7ProductionSecurityProvider.test.ts`

Expected: FAIL because `src/platform/productionSecurityProvider.ts` does not exist.

- [ ] **Step 4: Implement the provider and inject it**

Read principals, rate limit, and secret values from environment configuration, build a `PlatformSecurityBoundary` with real authentication/authorization/isolation/rate/secret hooks, and build the HTTP boundary pipeline with it. Wire the pipeline into the application process so the server no longer falls back to the development pipeline. Fail fast at startup when security configuration is missing.

- [ ] **Step 5: Run the tests to verify GREEN**

Run: `npx vitest run tests/platform/taskR7ProductionSecurityProvider.test.ts tests/support/taskR7R9RuntimeProductionizationVerificationTaskManifest.test.ts`

Expected: PASS.

- [ ] **Step 6: Verify no regressions**

Run: `npm run typecheck && npm test -- --run && npm run verify:system -- --task R7-R9`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/platform/productionSecurityProvider.ts scripts/productionProcessComposition.ts tests/platform/taskR7ProductionSecurityProvider.test.ts tests/support/taskR7R9RuntimeProductionizationVerificationTaskManifest.test.ts scripts/verificationTaskManifest.ts
git commit -m "feat: 注入生产安全边界"
```

---

### Task 4: Run Plan Approval and Run Creation Chain

**Files:**
- Modify: `src/app/productSurfaceCommandService.ts`
- Modify: `src/http/routes.ts`
- Modify: `public/app.js`
- Test: `tests/app/taskR8RunCreationChain.test.ts`
- Test: `tests/http/taskR8RunCreationApiSurface.test.ts`
- Test: `tests/public/taskR8R9WorkspaceUiCompletion.test.ts`

**Interfaces:**
- Consumes: `createRunPlanApproval`, `isValidRunPlanApproval` from `src/production/domain/runPlan.ts`; `saveRunPlanApproval`, `loadApprovedRunPlanRevision` from `src/production/application/runPlanService.ts`; existing Application contract id `run.command.approve-run-plan`.
- Produces:

```ts
export interface ApproveRunPlanCommand {
  readonly approvalId: string;
  readonly planRevisionId: string;
  readonly approvedBy: string;
  readonly approvedAt: Date;
  readonly evidenceReferences: readonly string[];
}

export interface RunRecallProductSurface {
  approveRunPlan(input: ApproveRunPlanCommand): Promise<RunPlanApproval>;
}
```

- [ ] **Step 1: Write the failing approval-then-start test**

```ts
it("approves a plan revision and then starts a run against it", async () => {
  const revision = await surface.createRunPlanRevision(runPlanInput());
  const approval = await surface.approveRunPlan({
    approvalId: "approval-1",
    planRevisionId: revision.id,
    approvedBy: "author-1",
    approvedAt: new Date("2026-10-05T00:00:00.000Z"),
    evidenceReferences: ["evidence-1"],
  });

  expect(isValidRunPlanApproval(approval)).toBe(true);

  const started = await surface.startRun({
    id: "run-1",
    novelId: revision.novelId,
    runPlanRevision: revision,
    createdAt: new Date("2026-10-05T00:00:01.000Z"),
  });

  expect(started.run.status).toBe("running");
});
```

- [ ] **Step 2: Write the failing unapproved-start test**

```ts
it("refuses to start a run for an unapproved plan revision", async () => {
  const revision = await surface.createRunPlanRevision(runPlanInput());
  await expect(
    surface.startRun({ id: "run-2", novelId: revision.novelId, runPlanRevision: revision, createdAt: new Date() }),
  ).rejects.toThrow();
});
```

- [ ] **Step 3: Write the failing UI test**

```ts
it("creates, approves, and starts a run from the Run view, and acts on recall items", () => {
  const source = publicFile("app.js");

  expect(source).toContain("/run-plans");
  expect(source).toContain("/approvals");
  expect(source).toContain('data-action="start-run"');
  expect(source).toContain('data-action="approve-run-plan"');
  expect(source).toContain('data-action="disposition"');
});
```

- [ ] **Step 4: Run the tests to verify RED**

Run: `npx vitest run tests/app/taskR8RunCreationChain.test.ts tests/http/taskR8RunCreationApiSurface.test.ts tests/public/taskR8R9WorkspaceUiCompletion.test.ts`

Expected: FAIL because the approval command, the route, and the Run-view actions do not exist.

- [ ] **Step 5: Implement the approval command and route**

Add `approveRunPlan` to the product surface using `createRunPlanApproval` + `saveRunPlanApproval`. Add `POST /run-plans/:planRevisionId/approvals` routing through `httpBoundaryPipeline.execute` with contract id `run.command.approve-run-plan`. Keep `startRun` requiring an approved plan revision; do not weaken that check.

- [ ] **Step 6: Implement the Run-view chain**

The Run view must let the author create a plan revision, approve it, and start the run, then show run status and allow pause/resume. Reuse the existing Chinese copy conventions and the existing loading/empty/error/retry/disabled/success states. No commit action anywhere in the view.

- [ ] **Step 7: Run the tests to verify GREEN**

Run: `npx vitest run tests/app/taskR8RunCreationChain.test.ts tests/http/taskR8RunCreationApiSurface.test.ts tests/public/taskR8R9WorkspaceUiCompletion.test.ts`

Expected: PASS.

- [ ] **Step 8: Verify no regressions**

Run: `npm run typecheck && npm test -- --run && npm run verify:system -- --task R7-R9`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/productSurfaceCommandService.ts src/http/routes.ts public/app.js tests/app/taskR8RunCreationChain.test.ts tests/http/taskR8RunCreationApiSurface.test.ts tests/public/taskR8R9WorkspaceUiCompletion.test.ts
git commit -m "feat: 打通 Run Plan 批准与生产运行创建"
```

---

### Task 5: Recall Attention Source and Disposition Surface

**Files:**
- Create: `src/app/recallAttentionSource.ts`
- Modify: `src/app/composition.ts`
- Modify: `src/app/prismaComposition.ts`
- Modify: `src/app/productSurfaceCommandService.ts`
- Modify: `public/app.js`
- Test: `tests/app/taskR9RecallAttentionSource.test.ts`
- Test: `tests/http/taskR9RecallDispositionApiSurface.test.ts`
- Test: `tests/public/taskR8R9WorkspaceUiCompletion.test.ts`

**Interfaces:**
- Consumes: `createNarrativeObservationAdapter`, `createDependencyObservationAdapter`, `createImpactObservationAdapter`, `createValidationObservationAdapter`, `createMemoryObservationAdapter`, `createRunSignalsObservationAdapter` from `src/recall/observation/sourceAdapters.ts`; `createNarrativeObservationLoad`, `createDependencyObservationLoad`, `createImpactObservationLoad`, `createValidationObservationLoad`, `createMemoryObservationLoad`, `createRunSignalsObservationLoad` from `src/recall/observation/domainSourceLoads.ts`; `detectRecallCandidates`, `classifyRecallCandidates`, `prioritizeRecallCandidates`, `baselineRecallDetector`, `baselineRecallClassifier`, `baselineRecallPrioritizer` and the `RecallSourceCollection` type from `src/recall/detection/recallPipeline.ts`; `projectRecallItems`, `queryRecallItems`, `RecallItem` from `src/recall/projection/recallItemProjection.ts`; `DependencyImpactPersistence` (its `relations` and `impactResults` ports are `UniqueCreatePort`, exposing `findById`, `listByNovel`, `saveIfAbsent`) from `src/dependency/application/dependencyImpactPersistence.ts`.
- Produces:

```ts
export interface RecallAttentionSource {
  getAttentionItems(input: { readonly novelId: string }): Promise<readonly RecallItem[]>;
}

export function createRecallAttentionSource(
  dependencies: RecallAttentionSourceDependencies,
): RecallAttentionSource;
```

- [ ] **Step 1: Write the failing attention-source test**

```ts
it("derives recall attention items from observed domain sources", async () => {
  const relations = {
    findById: async () => undefined,
    listByNovel: async () => [dependencyRelationFixture("novel-1")],
    saveIfAbsent: async () => undefined,
  };
  const impactResults = {
    findById: async () => undefined,
    listByNovel: async () => [impactAnalysisFixture("novel-1")],
    saveIfAbsent: async () => undefined,
  };
  const source = createRecallAttentionSource({
    novelId: "novel-1",
    impactPersistence: {
      transaction: { run: async operation => operation({ relations, impactResults }) },
      relations,
      impactResults,
    },
  });

  const items = await source.getAttentionItems({ novelId: "novel-1" });

  expect(items.length).toBeGreaterThan(0);
  expect(items[0].novelId).toBe("novel-1");
  expect(items[0].explanation.evidenceReferences.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Write the failing disposition-surface test**

```ts
it("records a disposition against a real attention item and keeps Recall non-authoritative", async () => {
  const attention = await surface.getAttention({ novelId: "novel-1" });
  expect(attention.items.length).toBeGreaterThan(0);

  const record = await surface.disposeAttention({
    persistence: attentionPersistence,
    item: attention.items[0],
    action: "dismiss",
    actorId: "author-1",
    occurredAt: "2026-10-05T00:00:00.000Z",
  });

  expect(record.state).toBe("dismissed");
  expect(attention.authority.mayCommit).toBe(false);
});
```

- [ ] **Step 3: Run the tests to verify RED**

Run: `npx vitest run tests/app/taskR9RecallAttentionSource.test.ts tests/http/taskR9RecallDispositionApiSurface.test.ts`

Expected: FAIL because the attention source does not exist and the workspace query still returns an empty attention list.

- [ ] **Step 4: Implement the attention source**

Compose the frozen observation adapters and loads into the existing recall detection pipeline and projection, then feed the resulting items into `WorkspaceAttentionProjection`. Serve the same items from both composition roots. Do not add scoring, vector retrieval, or new detection rules.

- [ ] **Step 5: Implement the Recall view actions**

Expose the frozen author actions (inspect, dismiss, snooze, confirm, ignore, why) on real items through `POST /attention/:itemId/dispositions`, with the existing Chinese copy and the existing state set. The view must keep the read-only boundary messaging and must never call the commit endpoint or create a task.

- [ ] **Step 6: Run the tests to verify GREEN**

Run: `npx vitest run tests/app/taskR9RecallAttentionSource.test.ts tests/http/taskR9RecallDispositionApiSurface.test.ts tests/public/taskR8R9WorkspaceUiCompletion.test.ts`

Expected: PASS.

- [ ] **Step 7: Release verification**

Run:

```bash
npm run typecheck
npm test -- --run
npm run verify:system -- --task R7-R9
$env:DATABASE_URL='postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public'; npm run test:integration -- --run
git diff --check
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/recallAttentionSource.ts src/app/composition.ts src/app/prismaComposition.ts src/app/productSurfaceCommandService.ts public/app.js tests/app/taskR9RecallAttentionSource.test.ts tests/http/taskR9RecallDispositionApiSurface.test.ts tests/public/taskR8R9WorkspaceUiCompletion.test.ts
git commit -m "feat: 接通召回关注源与处置界面"
```

---

## Dependency Order

```text
Task 1 Prisma Commit Transaction
  -> Task 2 Prisma Runtime Composition Root
       -> Task 3 Production Security Injection
       -> Task 4 Run Plan Approval + Run Creation
       -> Task 5 Recall Attention Source + Disposition
```

Tasks 3, 4, and 5 are independent of each other; each may be dispatched as its own batch after Task 2 lands. Task 4 and Task 5 both touch `public/app.js` and must not run in parallel with each other.

## Completion Criteria

- The application process reads and writes canonical truth through PostgreSQL only; no in-memory root remains reachable in production.
- The HTTP surface rejects unknown tokens, cross-workspace access, and out-of-scope secrets, and consumes rate budget before authentication.
- An author can create a plan revision, approve it, start a run, and pause/resume it from the UI.
- Recall shows real attention items derived from frozen observation sources, and the author can record dispositions without any commit path.
- Global typecheck, unit/domain/integration/system verification, and integration tests pass.
- Working tree is clean and each batch has its own Chinese commit.

## Explicitly Not In This Plan

```text
Worker work source (scheduler -> worker consumer)
```

There is no claim/lease or outbox primitive over Production Run attempts, so wiring a real worker source requires first deciding pending-work ownership, claim semantics, lease expiry, and duplicate-prevention guarantees. That is a design decision, not a wiring change, and it stays out of this plan until that decision is made explicitly.

