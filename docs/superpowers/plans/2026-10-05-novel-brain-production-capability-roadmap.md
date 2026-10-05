# Novel Brain Production Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the frozen production boundaries into a runnable application/worker system with production API and workspace surfaces, then verify a release-capable baseline.

**Architecture:** Keep Novel Domain and Frozen Core unchanged. Operational platform owns process lifecycle, configuration, deployment and observability; Application owns command/query orchestration; HTTP and browser UI consume Application contracts without becoming Domain models. Provider-specific AI implementation remains deferred; runtime integration uses the existing `RuntimeAdapter` boundary and deterministic reference adapter.

**Tech Stack:** TypeScript, Node.js, Fastify, Prisma, PostgreSQL, Vitest, plain HTML/CSS/browser TypeScript-compatible JavaScript.

**Spec:** `docs/superpowers/specs/2026-10-05-novel-brain-productionization-architecture.md`

## Global Constraints

- Product Design = LOCKED.
- Entity Design = CLOSED.
- Frozen Core entities and semantics do not change.
- Change Set remains the Aggregate Root.
- Change Set Revision remains an Immutable Revision Snapshot.
- Revision History remains Linear.
- Change identity remains stable across revisions inside a Change Set.
- Production Run remains orchestration only and never owns Narrative Truth.
- Story Foundation remains a creation/design surface, not Canon or a mandatory gate.
- Recall remains derived/read-only attention; it never mutates Narrative Truth, creates Tasks directly, or commits.
- Candidate is source/context/evidence, never a Validation or Approval target.
- ValidationRun binds Change Set Revision plus Frozen Validation Plan Version.
- ReviewDecision is an immutable Decision Event; Pending is not a ReviewDecision state.
- No dual-bound legacy semantics, silent adapters, or temporary fallback state.
- Provider-specific model vendors, prompt frameworks, vector retrieval, pixel-level design, cost tuning and advanced validator catalogs remain deferred.
- Each task uses TDD and receives at most one fix round.
- Review checks original Acceptance only; P2/P3 findings are deferred unless they block correctness or security.

---

## File Structure

```text
src/platform/
  productionConfiguration.ts       validated environment/configuration boundary
  productionProcessBootstrap.ts    application/worker lifecycle composition
  deploymentTopology.ts            existing operational lifecycle contract
  securityBoundary.ts              existing AuthN/AuthZ/rate/secret boundary
  observabilityBoundary.ts         existing logs/metrics/traces/health/audit boundary

src/http/
  httpBoundaryPipeline.ts          validation/auth/idempotency/rate pipeline
  productRequestSchemas.ts         HTTP-only request schemas
  productResponseSchemas.ts        HTTP-only response schemas
  routes.ts                        Fastify command/query/process routes
  server.ts                        server composition and static surface hosting

src/app/
  workspaceProductQueryService.ts  composed workspace read model
  productSurfaceCommandService.ts  Foundation/Run/Recall application commands

src/production/runtime/
  processWorkerAdapter.ts          RuntimeAdapter execution inside WorkerAdapter

public/
  index.html                       workspace application shell
  styles.css                       responsive visual system
  app.js                           browser interaction and API client

scripts/
  startApplication.ts              application process entry point
  startWorker.ts                   worker process entry point
  runMigrations.ts                 migration operation entry point

tests/platform/
  taskR1ProductionProcessBootstrap.test.ts
tests/http/
  taskR2HttpBoundaryPipeline.test.ts
  taskR3ProductApiSurface.test.ts
tests/app/
  taskR3WorkspaceProductQueryService.test.ts
  taskR4ProductSurfaceCommandService.test.ts
tests/public/
  taskR5WorkspaceUiContract.test.ts
tests/system/
  taskR6ProductionCapabilityAcceptance.test.ts
tests/support/
  taskR1R2RuntimeApiVerificationTaskManifest.test.ts
  taskR3R4ProductSurfaceVerificationTaskManifest.test.ts
  taskR5R6ReleaseVerificationTaskManifest.test.ts
```

---

### Task 1: Production Process and Runtime Integration

**Files:**
- Create: `src/platform/productionConfiguration.ts`
- Create: `src/platform/productionProcessBootstrap.ts`
- Create: `src/production/runtime/processWorkerAdapter.ts`
- Create: `scripts/startApplication.ts`
- Create: `scripts/startWorker.ts`
- Create: `scripts/runMigrations.ts`
- Test: `tests/platform/taskR1ProductionProcessBootstrap.test.ts`

**Interfaces:**
- Consumes: `DeploymentTopology`, `RuntimeAdapter`, `SchedulerWorkerBoundary`, Prisma persistence environment.
- Produces:

```ts
export interface ProductionConfiguration {
  readonly databaseUrl: string;
  readonly applicationPort: number;
  readonly publicOrigin: string;
  readonly workerConcurrency: number;
  readonly logLevel: "error" | "warn" | "info" | "debug";
}

export function parseProductionConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): ProductionConfiguration;

export interface ProductionProcessBootstrap {
  readonly topology: DeploymentTopology;
  start(): Promise<void>;
  stop(signal?: "SIGTERM"): Promise<void>;
}

export function createProductionProcessBootstrap(options: {
  configuration: ProductionConfiguration;
  application: DeploymentProcessController;
  worker: DeploymentProcessController;
  migrations: readonly DeploymentMigration[];
  migrationOperation: DeploymentMigrationOperation;
  healthProbe: DeploymentHealthProbe;
}): ProductionProcessBootstrap;

export class ProcessWorkerAdapter implements WorkerAdapter {
  constructor(options: { runtime: RuntimeAdapter });
  execute(
    order: ScheduledWorkOrder,
    control: WorkerExecutionControl,
  ): Promise<WorkerExecutionResult>;
}
```

- [ ] **Step 1: Write the failing configuration test**

```ts
it("rejects missing and invalid production configuration", () => {
  expect(() => parseProductionConfiguration({})).toThrow("DATABASE_URL is required");
  expect(() =>
    parseProductionConfiguration({
      DATABASE_URL: "postgresql://localhost/app",
      APPLICATION_PORT: "0",
      PUBLIC_ORIGIN: "https://app.example",
      WORKER_CONCURRENCY: "2",
      LOG_LEVEL: "info",
    }),
  ).toThrow("APPLICATION_PORT must be between 1 and 65535");
});
```

- [ ] **Step 2: Write the failing process lifecycle test**

```ts
it("starts application and worker after migrations and stops in reverse order", async () => {
  const calls: string[] = [];
  const bootstrap = createProductionProcessBootstrap({
    configuration,
    application: { start: async () => calls.push("start:application"), stop: async () => calls.push("stop:application") },
    worker: { start: async () => calls.push("start:worker"), stop: async () => calls.push("stop:worker") },
    migrations: [{ id: "001" }],
    migrationOperation: {
      ensureApplied: async () => {
        calls.push("migration:001");
        return "applied";
      },
    },
    healthProbe: {
      liveness: async () => "healthy",
      readiness: async () => "healthy",
      checks: async () => ({ persistence: "healthy" }),
    },
  });

  await bootstrap.start();
  await bootstrap.stop();

  expect(calls).toEqual([
    "migration:001",
    "start:application",
    "start:worker",
    "stop:worker",
    "stop:application",
  ]);
});
```

- [ ] **Step 3: Write the failing worker execution test**

```ts
it("executes a runtime request and preserves its result", async () => {
  const adapter = new ProcessWorkerAdapter({ runtime: new DeterministicRuntime() });
  const order = {
    workId: "work-1",
    timeoutMs: 1000,
    run: {} as ProductionRun,
    attempt: {} as ExecutionAttempt,
    runtimeRequest: {
      taskId: "task-1",
      agentRole: "writer",
      modelPolicy: { provider: "deterministic", model: "reference", maxOutputTokens: 100 },
      basedOnVersionSet: {},
      context: {},
      requestedChange: {
        type: "text",
        sceneId: "scene-1",
        text: "Generated text",
      },
    },
  } as ScheduledWorkOrder;
  const result = await adapter.execute(order, { signal: new AbortController().signal });

  expect(result.status).toBe("succeeded");
  expect(result.status === "succeeded" && result.runtimeResult.taskId).toBe("task-1");
});
```

- [ ] **Step 4: Run focused tests to verify RED**

Run: `npx vitest run tests/platform/taskP61DeploymentTopology.test.ts tests/platform/taskR1ProductionProcessBootstrap.test.ts`

Expected: FAIL because `productionConfiguration`, `productionProcessBootstrap`, and `processWorkerAdapter` do not exist.

- [ ] **Step 5: Implement configuration and process bootstrap**

Implement `parseProductionConfiguration` with exact required keys:
- `DATABASE_URL`
- `APPLICATION_PORT`, integer 1..65535
- `PUBLIC_ORIGIN`, absolute `http` or `https` URL
- `WORKER_CONCURRENCY`, integer 1..64
- `LOG_LEVEL`, one of `error`, `warn`, `info`, `debug`

`createProductionProcessBootstrap.start()` must:
1. validate configuration through `DeploymentTopology.start`;
2. run migrations before process startup;
3. start `application`, then `worker`;
4. require readiness health before returning.

`stop()` must stop `worker`, then `application`, and preserve failure diagnostics.

- [ ] **Step 6: Implement process worker adapter**

`ProcessWorkerAdapter.execute()` must:
1. reject an already-aborted signal with `{ status: "cancelled", reason: "aborted before execution" }`;
2. call `runtime.execute` with the work order's request;
3. convert thrown errors to `{ status: "failed", error: { code: "runtime-error", message, retryable: false } }`;
4. return the exact `RuntimeResult` on success.

- [ ] **Step 7: Run focused tests to verify GREEN**

Run: `npx vitest run tests/platform/taskR1ProductionProcessBootstrap.test.ts`

Expected: PASS.

- [ ] **Step 8: Run typecheck and full tests**

Run: `npm run typecheck && npm test -- --run`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/platform/productionConfiguration.ts src/platform/productionProcessBootstrap.ts src/production/runtime/processWorkerAdapter.ts scripts/startApplication.ts scripts/startWorker.ts scripts/runMigrations.ts tests/platform/taskR1ProductionProcessBootstrap.test.ts
git commit -m "feat: 建立生产进程与运行时集成"
```

---

### Task 2: HTTP Boundary Pipeline and Production API Contracts

**Files:**
- Create: `src/http/httpBoundaryPipeline.ts`
- Create: `src/http/productRequestSchemas.ts`
- Create: `src/http/productResponseSchemas.ts`
- Modify: `src/http/server.ts`
- Modify: `scripts/verificationTaskManifest.ts`
- Test: `tests/http/taskR2HttpBoundaryPipeline.test.ts`
- Test: `tests/support/taskR1R2RuntimeApiVerificationTaskManifest.test.ts`

**Interfaces:**
- Consumes: `PlatformSecurityBoundary`, `PlatformObservabilityBoundary`, `apiBoundaryContracts`, Zod.
- Produces:

```ts
export interface HttpRequestPrincipal {
  readonly subjectId: string;
  readonly workspaceId: string;
}

export interface HttpBoundaryContext {
  readonly requestId: string;
  readonly principal: HttpRequestPrincipal;
  readonly resource: { readonly kind: string; readonly id: string };
  readonly correlation: ObservabilityCorrelation;
}

export interface HttpBoundaryPipeline {
  execute<TValue>(
    contractId: string,
    context: HttpBoundaryContext,
    input: unknown,
    handler: (validated: unknown) => Promise<TValue>,
  ): Promise<TValue>;
}

export function createHttpBoundaryPipeline(options: {
  security: PlatformSecurityBoundary;
  observability: PlatformObservabilityBoundary;
  validators: ReadonlyMap<string, ApiRequestValidator<unknown>>;
}): HttpBoundaryPipeline;
```

- [ ] **Step 1: Write the failing ordering test**

```ts
it("consumes rate budget before rejecting invalid authentication", async () => {
  const pipeline = createHttpBoundaryPipeline(options);

  await expect(
    pipeline.execute("api.query", invalidContext, {}, async () => "never"),
  ).rejects.toThrow();

  await expect(
    pipeline.execute("api.query", invalidContext, {}, async () => "never"),
  ).rejects.toThrow();

  expect(rateLimiter.consume).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Write the failing validation and replay test**

```ts
it("validates requests and returns replayed command results without duplicate execution", async () => {
  let executions = 0;

  const first = await pipeline.execute("api.command", context, input, async value => {
    executions += 1;
    return value;
  });
  const second = await pipeline.execute("api.command", context, input, async value => {
    executions += 1;
    return value;
  });

  expect(executions).toBe(1);
  expect(second).toEqual(first);
});
```

- [ ] **Step 3: Run focused tests to verify RED**

Run: `npx vitest run tests/http/taskR2HttpBoundaryPipeline.test.ts tests/support/taskR1R2RuntimeApiVerificationTaskManifest.test.ts`

Expected: FAIL because pipeline and `R1-R2` verification profile do not exist.

- [ ] **Step 4: Implement the pipeline**

Required order:

```text
request identity
-> rate limit
-> authentication
-> authorization
-> request validation
-> idempotency reservation
-> handler
-> structured audit
```

Do not permit invalid authentication or authorization to bypass rate limiting. Command replay must not call the handler twice.

- [ ] **Step 5: Add HTTP-only schemas**

`productRequestSchemas.ts` must export Zod schemas for every command/query/process contract id. `productResponseSchemas.ts` must export stable response envelope schemas:

```ts
export const commandResultSchema = z.object({
  channel: z.literal("command-result"),
  contractId: z.string(),
  value: z.unknown(),
  replayed: z.boolean(),
});
```

Schemas are transport contracts and must not restate Domain classes.

- [ ] **Step 6: Run focused tests to verify GREEN**

Run: `npx vitest run tests/http/taskR2HttpBoundaryPipeline.test.ts tests/support/taskR1R2RuntimeApiVerificationTaskManifest.test.ts`

Expected: PASS.

- [ ] **Step 7: Run full verification**

Run: `npm run typecheck && npm run verify:system -- --task R1-R2`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/http/httpBoundaryPipeline.ts src/http/productRequestSchemas.ts src/http/productResponseSchemas.ts src/http/server.ts scripts/verificationTaskManifest.ts tests/http/taskR2HttpBoundaryPipeline.test.ts tests/support/taskR1R2RuntimeApiVerificationTaskManifest.test.ts
git commit -m "feat: 建立生产请求管线与接口契约"
```

---

### Task 3: Workspace and Story Foundation Product Surface

**Files:**
- Create: `src/app/workspaceProductQueryService.ts`
- Create: `src/app/productSurfaceCommandService.ts`
- Modify: `src/http/routes.ts`
- Test: `tests/app/taskR3WorkspaceProductQueryService.test.ts`
- Test: `tests/app/taskR4ProductSurfaceCommandService.test.ts`
- Test: `tests/http/taskR3ProductApiSurface.test.ts`
- Test: `tests/support/taskR3R4ProductSurfaceVerificationTaskManifest.test.ts`

**Interfaces:**
- Consumes: `createWorkspaceIntegrationContract`, `FoundationEntryService`, `NarrativeProposalService`, `ProposalWorkflowService`, `FoundationAdoptionService`.
- Produces:

```ts
export interface WorkspaceProductQueryService {
  getWorkspaceView(input: WorkspaceIntegrationQueryInput): Promise<WorkspaceIntegrationView>;
}

export interface ProductSurfaceCommandService {
  createFoundationEntry(input: FoundationEntryInput): Promise<FoundationEntryResult>;
  advanceProposal(input: ApplyProposalWorkflowStepInput): Promise<ProposalWorkflowStepResult>;
  prepareAdoption(
    input: RecordFoundationAdoptionPreparationInput,
  ): Promise<FoundationAdoptionPreparation>;
}

export interface ProductSurfaceCommandDependencies {
  readonly foundationPersistence: NarrativeProposalPersistence;
  readonly runPersistence: RunOrchestrationPersistence;
  readonly attentionPersistence: AttentionDispositionPersistence;
}

export function createProductSurfaceCommandService(
  dependencies: ProductSurfaceCommandDependencies,
): ProductSurfaceCommandService;
```

- [ ] **Step 1: Write the failing coherent-identity test**

```ts
it("rejects workspace query fragments from different novels", async () => {
  await expect(
    service.getWorkspaceView({
      novelId: "novel-1",
      focus,
      run: runForNovel("novel-2"),
      attention: attentionForNovel("novel-1"),
    }),
  ).rejects.toThrow("Workspace contracts must share one Novel identity");
});
```

- [ ] **Step 2: Write the failing Foundation flow test**

```ts
it("creates an idea proposal and advances it without adopting automatically", async () => {
  const entry = await service.createFoundationEntry({ novelId: "novel-1", mode: "idea", idea: "A city remembers every promise." });
  const workflow = await service.advanceProposal({ novelId: "novel-1", proposalId: entry.proposalId, transition: "advance" });

  expect(entry.mode).toBe("idea");
  expect(workflow.stage).toBe("explore");
  expect(entry.automaticCommit).toBe(false);
});
```

- [ ] **Step 3: Run focused tests to verify RED**

Run: `npx vitest run tests/app/taskR3WorkspaceProductQueryService.test.ts tests/app/taskR4ProductSurfaceCommandService.test.ts tests/http/taskR3ProductApiSurface.test.ts`

Expected: FAIL because product services and routes do not exist.

- [ ] **Step 4: Implement application services**

Foundation entry must support exactly `idea`, `existing_text`, and `blank`. Proposal workflow must preserve independent proposal identity. Adoption preparation must stop before Validation, Approval and Commit unless the existing application commands explicitly continue the pipeline.

- [ ] **Step 5: Add HTTP routes**

Required endpoints:

```text
GET  /workspace/:novelId
POST /foundation/entries
POST /foundation/proposals/:proposalId/transitions
POST /foundation/proposals/:proposalId/adoption-preparations
```

Routes must call the HTTP boundary pipeline and return the response schemas from Task R2.

- [ ] **Step 6: Run focused tests to verify GREEN**

Run: `npx vitest run tests/app/taskR3WorkspaceProductQueryService.test.ts tests/app/taskR4ProductSurfaceCommandService.test.ts tests/http/taskR3ProductApiSurface.test.ts`

Expected: PASS.

- [ ] **Step 7: Run full verification**

Run: `npm run typecheck && npm run verify:system -- --task R3-R4`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/workspaceProductQueryService.ts src/app/productSurfaceCommandService.ts src/http/routes.ts tests/app/taskR3WorkspaceProductQueryService.test.ts tests/app/taskR4ProductSurfaceCommandService.test.ts tests/http/taskR3ProductApiSurface.test.ts tests/support/taskR3R4ProductSurfaceVerificationTaskManifest.test.ts scripts/verificationTaskManifest.ts
git commit -m "feat: 建立工作区与故事基础产品接口"
```

---

### Task 4: Production Run and Recall Product Surface

**Files:**
- Modify: `src/app/productSurfaceCommandService.ts`
- Modify: `src/http/routes.ts`
- Test: `tests/app/taskR4ProductSurfaceCommandService.test.ts`
- Test: `tests/http/taskR4RunRecallApiSurface.test.ts`
- Test: `tests/support/taskR3R4ProductSurfaceVerificationTaskManifest.test.ts`

**Interfaces:**
- Consumes: `RunPlanService`, `RunLifecycleService`, `AttentionDispositionService`, `runAwareRecall`.
- Produces:

```ts
export interface CreateRunPlanRevisionCommand {
  readonly id: string;
  readonly planId: string;
  readonly novelId: string;
  readonly revisionNumber: number;
  readonly parentRevisionId?: string;
  readonly goal: string;
  readonly steps: readonly RunPlanStep[];
  readonly createdAt: Date;
}

export interface CreateRunCommand {
  readonly id: string;
  readonly novelId: string;
  readonly runPlanRevision: RunPlanRevision;
  readonly createdAt: Date;
}

export interface RunTransitionCommand {
  readonly runId: string;
  readonly at: Date;
  readonly reason?: string;
}

export interface RunProductView {
  readonly run: ProductionRun;
  readonly stateBoundary: ProductionRunStateBoundary;
}

export interface AttentionProductView {
  readonly novelId: string;
  readonly items: readonly RecallItem[];
  readonly dispositions: readonly AttentionDispositionRecord[];
  readonly authority: RecallAuthorityBoundary;
  readonly truthOwner: WorkspaceTruthOwner;
}

export interface RunRecallProductSurface {
  createRunPlanRevision(input: CreateRunPlanRevisionCommand): Promise<RunPlanRevision>;
  startRun(input: CreateRunCommand): Promise<RunProductView>;
  pauseRun(input: RunTransitionCommand): Promise<RunProductView>;
  resumeRun(input: RunTransitionCommand): Promise<RunProductView>;
  getRunStatus(input: { runId: string }): Promise<RunProductView>;
  getAttention(input: { novelId: string }): Promise<AttentionProductView>;
  disposeAttention(
    input: AttentionDispositionServiceInput,
  ): Promise<AttentionDispositionRecord>;
}
```

- [ ] **Step 1: Write the failing authority test**

```ts
it("keeps Recall read-only and routes proposed action through Production Run policy", async () => {
  const attention = await surface.getAttention({ novelId: "novel-1" });

  expect(attention.authoritative).toBe(false);
  expect(attention.mayMutateNarrativeTruth).toBe(false);
  expect(attention.mayCreateTaskDirectly).toBe(false);
  expect(attention.proposedActionChannel).toBe("production-run-policy");
});
```

- [ ] **Step 2: Write the failing run lifecycle test**

```ts
it("starts, pauses, and resumes a run without changing Narrative Truth ownership", async () => {
  const started = await surface.startRun(startInput);

  expect(started.run.status).toBe("running");
  expect(started.stateBoundary.narrativeStateOwner).toBe("shared-novel-engine");
  expect(started.stateBoundary.ownsNarrativeTruth).toBe(false);
});
```

- [ ] **Step 3: Run focused tests to verify RED**

Run: `npx vitest run tests/app/taskR4ProductSurfaceCommandService.test.ts tests/http/taskR4RunRecallApiSurface.test.ts`

Expected: FAIL because Run/Recall product commands and routes are not exposed.

- [ ] **Step 4: Implement Run and Recall surfaces**

Required endpoints:

```text
POST /run-plans
POST /runs
POST /runs/:runId/pause
POST /runs/:runId/resume
GET  /runs/:runId/status
GET  /novels/:novelId/attention
POST /attention/:itemId/dispositions
```

Recall disposition changes only attention state. It must never create a GenerationTask or NarrativeCommit directly.

- [ ] **Step 5: Run focused tests to verify GREEN**

Run: `npx vitest run tests/app/taskR4ProductSurfaceCommandService.test.ts tests/http/taskR4RunRecallApiSurface.test.ts`

Expected: PASS.

- [ ] **Step 6: Run full verification**

Run: `npm run typecheck && npm run verify:system -- --task R3-R4`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/productSurfaceCommandService.ts src/http/routes.ts tests/app/taskR4ProductSurfaceCommandService.test.ts tests/http/taskR4RunRecallApiSurface.test.ts tests/support/taskR3R4ProductSurfaceVerificationTaskManifest.test.ts scripts/verificationTaskManifest.ts
git commit -m "feat: 建立生产运行与召回产品接口"
```

---

### Task 5: Workspace Browser Surface

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`
- Modify: `src/http/server.ts`
- Test: `tests/public/taskR5WorkspaceUiContract.test.ts`
- Test: `tests/support/taskR5R6ReleaseVerificationTaskManifest.test.ts`

**Interfaces:**
- Consumes: Task R3/R4 HTTP endpoints.
- Produces: a static workspace application hosted by Fastify at `/`.

- [ ] **Step 1: Write the failing UI contract test**

```ts
it("serves the workspace shell with Foundation, Run, Recall, and Overview views", async () => {
  const response = await app.inject({ method: "GET", url: "/" });

  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('data-view="overview"');
  expect(response.body).toContain('data-view="foundation"');
  expect(response.body).toContain('data-view="run"');
  expect(response.body).toContain('data-view="recall"');
});
```

- [ ] **Step 2: Write the failing interaction contract test**

```ts
it("uses the product API and exposes loading, empty, error, and retry states", async () => {
  const source = await readFile("public/app.js", "utf8");

  expect(source).toContain("/workspace/");
  expect(source).toContain("data-state=\"loading\"");
  expect(source).toContain("data-state=\"empty\"");
  expect(source).toContain("data-state=\"error\"");
  expect(source).toContain("data-action=\"retry\"");
});
```

- [ ] **Step 3: Run focused tests to verify RED**

Run: `npx vitest run tests/public/taskR5WorkspaceUiContract.test.ts`

Expected: FAIL because `public/` and static hosting do not exist.

- [ ] **Step 4: Implement the workspace shell**

Required UI behavior:
- Persistent left navigation for Overview, Foundation, Run, and Recall.
- Main content changes without full page reload.
- Desktop and mobile layouts must not overlap or overflow.
- Loading, empty, error, retry, disabled and success states are explicit.
- Buttons use familiar symbols or icon-plus-text commands.
- No visual element may imply that Recall can commit or mutate Narrative Truth.
- No auto-submitting or auto-committing behavior.

- [ ] **Step 5: Run focused tests to verify GREEN**

Run: `npx vitest run tests/public/taskR5WorkspaceUiContract.test.ts`

Expected: PASS.

- [ ] **Step 6: Run full verification**

Run: `npm run typecheck && npm test -- --run && npm run verify:system -- --task R5-R6`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/styles.css public/app.js src/http/server.ts tests/public/taskR5WorkspaceUiContract.test.ts tests/support/taskR5R6ReleaseVerificationTaskManifest.test.ts scripts/verificationTaskManifest.ts
git commit -m "feat: 建立工作区浏览器界面"
```

---

### Task 6: Production Capability Acceptance and Release Hardening

**Files:**
- Create: `tests/system/taskR6ProductionCapabilityAcceptance.test.ts`
- Modify: `scripts/verificationTaskManifest.ts`
- Test: `tests/support/taskR5R6ReleaseVerificationTaskManifest.test.ts`

**Interfaces:**
- Consumes: application server, worker adapter, migration operation, security, observability, deployment topology.
- Produces: release acceptance evidence only; no new Domain or product semantics.

- [ ] **Step 1: Write the failing end-to-end smoke test**

```ts
it("starts migration and processes, serves health and workspace, then shuts down cleanly", async () => {
  await deployment.start(configuration);

  const health = await app.inject({ method: "GET", url: "/health/ready" });
  const workspace = await app.inject({ method: "GET", url: "/workspace/novel-1" });

  await deployment.stop();

  expect(health.statusCode).toBe(200);
  expect(workspace.statusCode).toBe(200);
  expect(observation.events.map(event => event.kind)).toContain("health");
});
```

- [ ] **Step 2: Write the failing deferred-scope audit**

```ts
it("keeps provider, prompt, vector retrieval, cost, and advanced validator scope deferred", async () => {
  const deferredSource = await readFile(
    "docs/superpowers/specs/2026-10-05-novel-brain-productionization-architecture.md",
    "utf8",
  );

  expect(deferredSource).toContain("Provider-specific implementation");
  expect(deferredSource).toContain("Recall scoring/vector retrieval");
  expect(deferredSource).toContain("Prompt framework");
});
```

- [ ] **Step 3: Run focused tests to verify RED**

Run: `npx vitest run tests/system/taskR6ProductionCapabilityAcceptance.test.ts tests/support/taskR5R6ReleaseVerificationTaskManifest.test.ts`

Expected: FAIL because the integrated smoke test and `R5-R6` profile are incomplete.

- [ ] **Step 4: Implement acceptance verification only**

The smoke test must verify:
- migration before application/worker startup;
- liveness and readiness;
- HTTP product surface;
- security and observability ownership;
- reverse-order shutdown;
- restart/recovery behavior;
- cross-system authority boundaries;
- unchanged deferred scope.

- [ ] **Step 5: Run focused tests to verify GREEN**

Run: `npx vitest run tests/system/taskR6ProductionCapabilityAcceptance.test.ts tests/support/taskR5R6ReleaseVerificationTaskManifest.test.ts`

Expected: PASS.

- [ ] **Step 6: Run release verification**

Run:

```bash
npm run typecheck
npm test -- --run
npm run verify:system -- --task R5-R6
npm run test:integration -- --run
git diff --check
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/system/taskR6ProductionCapabilityAcceptance.test.ts tests/support/taskR5R6ReleaseVerificationTaskManifest.test.ts scripts/verificationTaskManifest.ts
git commit -m "test: 完成生产能力验收与发布加固"
```

---

## Dependency Order

```text
R1 Production Process / Runtime
-> R2 HTTP Boundary
-> R3 Workspace + Foundation Surface
-> R4 Run + Recall Surface
-> R5 Browser Surface
-> R6 Production Acceptance
```

Adjacent application-surface tasks may be combined into one execution batch only when their files do not conflict.

## Completion Criteria

- All tasks pass focused tests, typecheck and full tests.
- Application, worker and migration processes have executable entry points.
- HTTP requests pass rate, AuthN/AuthZ, validation and idempotency boundaries in the correct order.
- Workspace, Story Foundation, Production Run and Recall surfaces are callable without changing Frozen Core.
- Browser surface exposes the four product views with explicit operational states.
- Deferred scope remains deferred.
- Git history contains one independent Chinese commit per completed task batch.
- Working tree is clean after final push.


