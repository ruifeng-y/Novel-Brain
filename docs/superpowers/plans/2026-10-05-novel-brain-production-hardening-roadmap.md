# Novel Brain Production Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two gaps that make a fresh deployment unusable and undiagnosable: the workspace UI cannot create the Novel and Scene a Run chain needs, and business/security rejections surface to clients as 500.

**Architecture:** Both tasks are wiring and error-mapping only. No new Domain, DTO, frozen contract semantics, schema, or migration. Task A adds UI actions over routes that already exist. Task B adds explicit HTTP status mapping for rejections that the frozen domains already signal.

**Tech Stack:** TypeScript, Node.js, Fastify, Vitest, plain HTML/CSS/JS.

**Spec:** `docs/superpowers/specs/2026-10-05-novel-brain-productionization-architecture.md`

## Global Constraints

- Product Design = LOCKED. Entity Design = CLOSED. Productionization Architecture = FROZEN.
- No dual-bound legacy semantics, no silent adapters, no second source of truth.
- Recall stays read-only; Story Foundation never auto-commits.
- Every product route keeps going through `httpBoundaryPipeline.execute`.
- TDD per task: RED, verify failure, implement, verify pass.
- Each task gets at most one fix round; review checks original Acceptance only.
- `.superpowers/` reports are never staged.

---

### Task A: Workspace Entry Bootstrap

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html` (only if a control needs markup)
- Test: `tests/public/taskHardeningWorkspaceEntryBootstrap.test.ts`

**Interfaces:**
- Consumes the existing routes `POST /novels` and `POST /novels/:novelId/scenes` with their existing contract ids (`foundation.command.create-blank-foundation`, `foundation.command.adopt-proposal-content`). No route, contract, or service change.
- Produces two UI actions: create Novel, create Scene.

Required behaviour:
1. Creating a Novel uses the context bar's Author id as `authorId`, then backfills `novelId` into the workspace context and persists it.
2. Creating a Scene uses the current `novelId` and the context bar's Author id, then backfills the returned scene id and the returned scene revision id into the Run view, so the Run chain can start from a blank deployment.
3. The Run view must take the scene revision from the Scene creation response instead of deriving `<sceneId>:rev-1`.
4. Chinese copy, existing six states, no page reload, no commit call, no task creation.

Verification: an HTTP-level test must prove the chain from blank state (create Novel -> create Scene -> the Run view's payload references the returned revision), and a public contract test must prove the UI exposes both actions.

---

### Task B: Rejection Error Surface

**Files:**
- Modify: `src/http/routes.ts` (global error handler and/or per-route mapping)
- Test: `tests/http/taskHardeningRejectionErrorSurface.test.ts`

Required behaviour: rejections that the frozen domains already signal must reach clients with a stable, non-5xx status:
1. Missing resource (unknown Novel/Scene/Run/Plan Revision) -> 404.
2. Business conflict or unmet precondition (unapproved plan revision, unresolved conflict, stale dependency) -> 409.
3. Authentication failure -> 401.
4. Authorization or resource-isolation failure -> 403.
5. Rate limit exceeded -> 429.
6. Malformed input continues to be 400; genuine unexpected failures stay 500.

Do not change Domain error types' semantics; map them at the HTTP boundary only. Do not weaken any existing status mapping (`ZodError` -> 400, commit conflict -> 409 must keep working).

---

### Task C: Workspace Isolation Integrity

**Why:** The boundary authorizes a resource identity the client supplies (`x-workspace-id`) while handlers act on the novel named in the path or body, so workspace isolation is bypassable.

**Verified defect (controller, real process):** with a principal scoped to `map-novel-1`, `POST /foundation/entries` carrying `x-workspace-id: map-novel-1` and body `novelId: map-other` returned 201 and wrote into `map-other`; `GET /workspace/map-other` with the same header returned 200 and that data.

**Root cause:** `routeWorkspaceId` in src/http/routes.ts prefers the client-supplied header, so the authorized resource and the acted-on resource are two different identities that are never cross-checked.

**Files:**
- Modify: `src/http/routes.ts`
- Test: `tests/http/taskHardeningWorkspaceIsolationIntegrity.test.ts`

**Required behaviour:**
1. The authorization resource is derived SERVER-SIDE from the same identity the route handler acts on: the path parameter for scoped routes, the request body for creation routes, and the loaded entity for routes addressed by run/attempt/task/candidate/proposal id.
2. `x-workspace-id` stops being authoritative. When present it is treated as a consistency assertion: if it disagrees with the server-derived identity the request is rejected with 403. When absent the request proceeds on the derived identity.
3. No handler may write to, or read, a novel outside the workspace that was authorized for that same request.
4. Static asset routes are unaffected (they never enter the pipeline).

**Verification:** regression tests must cover, for both a read path and a write path, that header-vs-path mismatch is rejected 403, that the correct/absent header is allowed, and that a principal cannot reach another workspace's data. The existing per-route contract-id and pipeline assertions must keep passing.
