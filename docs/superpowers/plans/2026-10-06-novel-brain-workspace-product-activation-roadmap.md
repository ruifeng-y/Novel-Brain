# Novel Brain Workspace / Product Activation Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the frozen Workspace Product Spec into a working creation workspace: Focus-based navigation, a real Structure and Scene surface, the Candidate-to-Commit spine with a visible gate, and the projections the shell needs.

**Architecture:** Each wave delivers a working vertical slice across the whole stack. Frontend, Application query/command surface, missing projections, and API contracts move together inside one wave. There is no separate backend phase: a capability is added in the wave whose interface needs it, and no surface ships against invented data.

**Tech Stack:** TypeScript, Node.js (native type stripping), Fastify, Prisma + PostgreSQL, Vitest, browser-native ES modules with no build step.

**Spec:** `docs/superpowers/specs/2026-10-06-novel-brain-workspace-product-design.md` (FROZEN, commit ff0d856)

## Global Constraints

- Frozen and not reopened by any wave: Domain, Entity Design, Frozen Core, Productionization Architecture, and the Workspace Product Spec.
- Workspace is not a Domain Aggregate. View Context and Generation Context stay separate. Derived is never a second truth.
- Canonical State changes only through Validation, Approval where required, and Commit. A Candidate is never the Validation, Approval, or Commit target.
- Commit Gate evaluation belongs to a Change Set Revision. No code path commits a Candidate.
- Recall cannot commit, mutate Narrative Truth, or control workflow. A checkpoint is not a ReviewDecision.
- Every interface capability projects existing canonical or derived state. No surface may invent narrative truth to look complete.
- Derived surfaces must expose a degraded state rather than showing empty or success.
- TDD per task: RED, verify failure, implement, verify pass.
- One fix round per task. Review checks the task's original Acceptance only.
- Reports under `.superpowers/` are never staged.
- No pixel-level design, component inventory, motion, keyboard map, DTO field list, or database field design in this roadmap. Those belong to per-wave implementation detail.

---

## 1. How This Roadmap Is Structured

This is a roadmap, not a single monolithic plan. It defines:

```text
Waves            ordered, dependency-driven slices
Per wave         deliverable, spec sections implemented, acceptance, gates, exit criteria
W1               fully task-detailed in this document
W2 .. W5         wave-level definition here; their tasks are written by writing-plans
                 when the wave is dispatched, against the codebase as it then exists
```

Why W2..W5 are not task-detailed now: their tasks depend on the shape W1 lands, and writing
file-level steps against a codebase that W1 will change would produce a plan that is wrong on arrival.
The wave contract, dependency, and acceptance are fixed here so sequencing cannot drift.

---

## 2. Wave Dependency Table

| Wave | Name | Depends On | Delivers | Spec Sections |
| --- | --- | --- | --- | --- |
| W1 | Workspace Frame and Object Resolution | — | structural navigation query, Arc/Chapter persistence, object entry resolution, Focus/Lens model, shell rendering from a real Focus | §1–§6, §17 (structure + object entry rows) |
| W2 | Structure and Scene Read Surface | W1 | scene browsing and opening, manuscript revision read, target span resolution, Write-mode read surface | §4.4, §10.1–§10.3 |
| W3 | Manuscript Change to Commit Spine | W2 | manuscript change request, candidate, adoption, change set revision, validation and five-gate presentation, commit review | §11, §17 (candidate/validation/impact/gate rows) |
| W4 | Story Foundation and Narrative State | W3 | foundation projection and surface, narrative state by position, four layers, position scrubber | §12, §13, §18.2, §18.3 (partial) |
| W5 | Process Center and Recall Completion | W4 | full Process Center, remaining recall observation sources, aggregate attention layer | §8, §9, §14, §18.1, §18.3 |

```text
W1 -> W2 -> W3 -> W4 -> W5
```

The chain is strict: each wave's surfaces read capabilities the previous wave created. W4 and W5 are
sequenced after W3 because both surface change-set-derived state, and W3 is what makes that state
reachable.

---

## 3. Decision Points That Must Settle Before W1 Dispatch

### 3.1 Arc and Chapter Persistence

Verified fact: `src/manuscript/domain/arc.ts` and `chapter.ts` define `Arc` and `Chapter` with
factories (`createArc`, `createChapter`, `reorderArcChapters`, `reorderChapterScenes`), but neither is
persisted: `ApiDependencies` exposes only `novels` and `scenes`, with no repository, no composition
entry, and no route. Scenes carry a `chapterId` string, and nothing owns chapters or arcs.

The Structure lens is `Novel -> Arc -> Chapter -> Scene`. Two options:

```text
Option A (recommended)  persist Arc and Chapter as first-class revisioned aggregates and build the
                        real three-level tree. Cost: composition, persistence, ordering, and query
                        work in W1. Benefit: the tree matches the frozen product design, and
                        ordering/containment has one owner.
Option B                ship Novel -> Scene with chapters grouped from scene.chapterId strings and
                        no Arc level. Cost: lower now. Benefit: none structurally; it bakes a
                        structural lie into navigation and makes Arc a later migration of live data.
```

Recommendation: Option A. The domain types already exist, so this is wiring a frozen concept into the
composition rather than designing anything new. A Chapter-only tree would violate "structure is
narrative, not UI ownership" and would have to be re-done.

W1 below is written for Option A. If Option B is chosen, Task 1.1 and Task 1.2 shrink and the roadmap
must be amended before dispatch.

### 3.2 Browser Module Structure

The current interface is one large `public/app.js` with no build step. W1 introduces native ES modules
under `public/workspace/`, served as static assets, keeping the no-build-step constraint. The legacy
`public/app.js` views are replaced wave by wave, not in one cut: W1 adds the new shell alongside, W2
replaces the Scene surface, and the final legacy view is deleted when nothing references it.

### 3.3 Chapter Membership Authority

Verified fact: containment is encoded twice today. `Scene` carries `chapterId`, and `Chapter` carries
`sceneIds` (with `reorderChapterScenes`). `Arc` likewise carries `chapterIds`, while `Chapter` carries
`arcId`. Two encodings of one relation are two potential truths.

Recommended authority rule:

```text
Arc.chapterIds   holds chapter ordering;  Chapter.arcId is the membership pointer and must agree
Chapter.sceneIds holds scene ordering;    Scene.chapterId is the membership pointer and must agree
```

The structural query validates agreement and reports a **degraded** structure when a pointer and its
container disagree. It never silently repairs, and it never renders a guess. A write that changes
membership updates the pointer and the container ordering together; a mismatch that survives is a
defect, not a state to paper over.

Rationale: ordering must live with the container, because that is where the author manipulates it;
the pointer must exist because a Scene and a Chapter are separate aggregates and a Scene must be
addressable on its own.

---

## 4. W1 — Workspace Frame and Object Resolution

**Deliverable:** a workspace that renders from a real Focus, where navigation resolves objects instead
of switching pages, and where the object entry contract decides default Mode, surface, panels, and Lens.

**Implements:** Spec §1–§7 and §16, plus the structural navigation and object resolution rows of §17.
W1 establishes the Context Panel host and its derivation contract; individual panel content is added by
the wave that owns the data behind it.

**Exit criteria:** a running app where the author resolves a Novel, an Arc, a Chapter, a Scene, the
Story Foundation, a Process, and a Candidate, and each resolves to its contract-defined surface and
panels with the correct default Lens and Mode; the Structure tree shows Novel -> Arc -> Chapter -> Scene
from persisted structure; a header-vs-target mismatch and a pointer/container mismatch are both
visible as rejections or degraded states rather than silent success.

### Task 1.1: Persist Arc and Chapter

**Files:**
- Modify: `src/http/routes.ts` (add `arcs: Repository<Arc>` and `chapters: Repository<Chapter>` to `ApiDependencies`)
- Modify: `src/app/composition.ts`
- Modify: `src/app/prismaComposition.ts`
- Create: `src/manuscript/application/structureReconciliation.ts`
- Test: `tests/app/taskW1ArcChapterComposition.test.ts`
- Test: `tests/integration/arcChapterPersistencePrisma.test.ts`

**Interfaces:**
- Consumes: `Arc`, `Chapter`, `createArc`, `createChapter`, `reorderArcChapters`, `reorderChapterScenes` from `src/manuscript/domain/`; `Repository` from `src/shared/application/repository.ts`; `capabilityPersistencePayloadCodec`.
- Produces:

```ts
// src/manuscript/application/structureReconciliation.ts
export interface StructureReconciliationIssue {
  readonly kind:
    | "arc_missing"
    | "chapter_missing"
    | "chapter_pointer_mismatch"
    | "scene_pointer_mismatch";
  readonly objectId: string;
  readonly detail: string;
}

export function reconcileStructure(input: {
  readonly arcs: readonly Arc[];
  readonly chapters: readonly Chapter[];
  readonly scenes: readonly Scene[];
}): {
  readonly issues: readonly StructureReconciliationIssue[];
  readonly degraded: boolean;
};
```

`Arc` and `Chapter` are **not** revisioned: they expose `updatedAt` and are stored through
`Repository<T>` with aggregate types `"Arc"` and `"Chapter"`, matching the frozen `VersionReference`
aggregate naming already used for `Novel`, `GenerationTask`, and `Candidate`.

The tests below use local fixture helpers (`arcWith`, `chapterWith`, `sceneWith`). Each is a thin
constructor over the existing factories (`createArc`, `createChapter`, `commitSceneText` +
`createScene`) with overridable defaults; they live in the test file and are not production surface.

- [ ] **Step 1: Write the failing reconciliation test**

```ts
it("reports a degraded structure when a scene points at a chapter that does not contain it", () => {
  const result = reconcileStructure({
    arcs: [arcWith({ id: "arc-1", chapterIds: ["chapter-1"] })],
    chapters: [chapterWith({ id: "chapter-1", arcId: "arc-1", sceneIds: ["scene-2"] })],
    scenes: [sceneWith({ id: "scene-1", chapterId: "chapter-1" })],
  });

  expect(result.degraded).toBe(true);
  expect(result.issues.map(issue => issue.kind)).toEqual(["scene_pointer_mismatch"]);
});

it("reports a clean structure when pointers and containers agree", () => {
  const result = reconcileStructure({
    arcs: [arcWith({ id: "arc-1", chapterIds: ["chapter-1"] })],
    chapters: [chapterWith({ id: "chapter-1", arcId: "arc-1", sceneIds: ["scene-1"] })],
    scenes: [sceneWith({ id: "scene-1", chapterId: "chapter-1" })],
  });

  expect(result.degraded).toBe(false);
  expect(result.issues).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npx vitest run tests/app/taskW1ArcChapterComposition.test.ts`

Expected: FAIL because `src/manuscript/application/structureReconciliation.ts` does not exist.

- [ ] **Step 3: Implement reconciliation and composition wiring**

Add the two repositories to `ApiDependencies` and to both composition roots, using aggregate types
`"Arc"` and `"Chapter"` and the same payload codec the other capability repositories use. Implement
`reconcileStructure` exactly as specified: it reports issues and a degraded flag and mutates nothing.

- [ ] **Step 4: Write the failing durability test**

```ts
it("reads an arc and a chapter written through a fresh composition root", async () => {
  const writer = createPrismaEngineDependencies(new PrismaClient());
  await writer.arcs.save(createArc({ id: "arc-w1", novelId: "novel-w1", title: "Arc", createdAt: new Date("2026-10-06T00:00:00.000Z") }));
  await writer.chapters.save(createChapter({ id: "chapter-w1", novelId: "novel-w1", arcId: "arc-w1", title: "Chapter", createdAt: new Date("2026-10-06T00:00:00.000Z") }));

  const reader = createPrismaEngineDependencies(new PrismaClient());
  expect(await reader.arcs.findById("arc-w1")).toBeDefined();
  expect((await reader.chapters.findById("chapter-w1"))?.arcId).toBe("arc-w1");
});
```

- [ ] **Step 5: Run the tests to verify GREEN**

Run:

```bash
npx vitest run tests/app/taskW1ArcChapterComposition.test.ts
$env:DATABASE_URL='postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public'; npm run test:integration -- --run tests/integration/arcChapterPersistencePrisma.test.ts
```

Expected: PASS.

- [ ] **Step 6: Verify no regressions and commit**

```bash
npm run typecheck && npm test -- --run
git add src/http/routes.ts src/app/composition.ts src/app/prismaComposition.ts src/manuscript/application/structureReconciliation.ts tests/app/taskW1ArcChapterComposition.test.ts tests/integration/arcChapterPersistencePrisma.test.ts
git commit -m "feat: 接入 Arc 与 Chapter 持久化"
```

### Task 1.2: Structural Navigation Query and Structure Commands

**Files:**
- Create: `src/app/structuralNavigationQuery.ts`
- Create: `src/app/structureCommandService.ts`
- Modify: `src/application/commandQueryBoundary.ts` (new `manuscript` capability with its query and command contracts)
- Modify: `src/http/routes.ts` (new read route plus the structural command routes)
- Test: `tests/app/taskW1StructuralNavigationQuery.test.ts`
- Test: `tests/app/taskW1StructureCommands.test.ts`
- Test: `tests/http/taskW1StructuralNavigationApi.test.ts`

**Interfaces:**
- Consumes: Task 1.1's `arcs` and `chapters` repositories; existing `scenes` repository; `reconcileStructure`.
- Produces:

```ts
export interface StructureNode {
  readonly objectId: string;
  readonly kind: "arc" | "chapter" | "scene";
  readonly title: string;
  readonly children: readonly StructureNode[];
}

export interface StructuralNavigationView {
  readonly novelId: string;
  readonly arcs: readonly StructureNode[];
  readonly orphanScenes: readonly StructureNode[];
  readonly degraded: boolean;
  readonly issues: readonly StructureReconciliationIssue[];
}

export function createStructuralNavigationQuery(dependencies: {
  readonly arcs: Repository<Arc>;
  readonly chapters: Repository<Chapter>;
  readonly scenes: RevisionedRepository<Scene>;
}): {
  getStructure(novelId: string): Promise<StructuralNavigationView>;
};

export function createStructureCommandService(dependencies: {
  readonly arcs: Repository<Arc>;
  readonly chapters: Repository<Chapter>;
}): {
  createArc(input: { readonly id: string; readonly novelId: string; readonly title: string; readonly createdAt: Date }): Promise<Arc>;
  createChapter(input: {
    readonly id: string;
    readonly novelId: string;
    readonly arcId: string;
    readonly title: string;
    readonly createdAt: Date;
  }): Promise<Chapter>;
  reorderArcChapters(input: { readonly arcId: string; readonly chapterIds: readonly string[]; readonly updatedAt: Date }): Promise<Arc>;
  reorderChapterScenes(input: { readonly chapterId: string; readonly sceneIds: readonly string[]; readonly updatedAt: Date }): Promise<Chapter>;
};
```

The tests below use local fixture helpers (`dependencies()`, `mismatchedDependencies()`) that assemble
in-memory `Repository` and `RevisionedRepository` instances over the fixtures from Task 1.1. They live
in the test file and are not production surface.

Boundary note: this adds an eighth Application capability, `manuscript`, with query contract
`manuscript.query.structural-navigation`. Existing capabilities are not overloaded, because structure
is not generation, validation, approval, commit, run, recall, or foundation. Extending the Application
boundary is expected work: the Productionization Architecture's gap register lists the final
command/query contracts as a missing production surface.

The same capability carries the command contracts `manuscript.command.create-arc`,
`manuscript.command.create-chapter`, and `manuscript.command.reorder-structure`, because a Structure
lens that can only read cannot reach W1's exit criteria on a fresh deployment.

`createChapter` must reject an `arcId` that does not exist or belongs to another novel, rather than
persisting a dangling membership pointer. Reordering writes through the existing `reorderArcChapters`
and `reorderChapterScenes` domain functions and does not re-implement ordering.

Explicit acceptance for the container direction, which Task 1.1's four issue kinds do not cover:

```text
Read   when getStructure walks container order and an id in Arc.chapterIds or Chapter.sceneIds has no
       corresponding entity, it must not silently drop the entry and must not fabricate a node;
       the structure is reported degraded and the dangling id is surfaced
Write  reorderArcChapters and reorderChapterScenes must reject an input id that does not exist or
       belongs to another novel; a dangling container id must never be persisted
```

Without both, W1's exit criterion "a pointer/container mismatch is visible as a rejection or a degraded
state" can pass silently on ghost entries.

- [ ] **Step 3b: Write the failing authoring test**

```ts
it("rejects a chapter whose arc does not exist", async () => {
  const service = createStructureCommandService(dependencies());
  await expect(
    service.createChapter({ id: "chapter-x", novelId: "novel-1", arcId: "arc-missing", title: "X", createdAt: new Date() }),
  ).rejects.toThrow();
});

it("creates an arc and a chapter and reads back the container order", async () => {
  const service = createStructureCommandService(dependencies());
  await service.createArc({ id: "arc-1", novelId: "novel-1", title: "第一幕", createdAt: new Date("2026-10-06T00:00:00.000Z") });
  await service.createChapter({ id: "chapter-1", novelId: "novel-1", arcId: "arc-1", title: "第一章", createdAt: new Date("2026-10-06T00:00:00.000Z") });
  const reordered = await service.reorderArcChapters({ arcId: "arc-1", chapterIds: ["chapter-1"], updatedAt: new Date("2026-10-06T00:00:01.000Z") });

  expect(reordered.chapterIds).toEqual(["chapter-1"]);
});
```

- [ ] **Step 1: Write the failing query test**

```ts
it("assembles arcs, chapters, and scenes in container order", async () => {
  const query = createStructuralNavigationQuery(dependencies());
  const view = await query.getStructure("novel-1");

  expect(view.degraded).toBe(false);
  expect(view.arcs).toHaveLength(1);
  expect(view.arcs[0]!.children.map(chapter => chapter.objectId)).toEqual(["chapter-1"]);
  expect(view.arcs[0]!.children[0]!.children.map(scene => scene.objectId)).toEqual(["scene-1", "scene-2"]);
});

it("surfaces pointer mismatches as degraded instead of repairing them", async () => {
  const view = await createStructuralNavigationQuery(mismatchedDependencies()).getStructure("novel-1");

  expect(view.degraded).toBe(true);
  expect(view.issues[0]!.kind).toBe("scene_pointer_mismatch");
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npx vitest run tests/app/taskW1StructuralNavigationQuery.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the query**

Order comes from `Arc.chapterIds` and `Chapter.sceneIds`. A scene whose `chapterId` names a chapter that
does not list it is an issue, not a silent placement. A scene with no resolvable chapter is reported in
`orphanScenes` and is never dropped. `RevisionedRepository<Scene>` provides `listByNovel`.

- [ ] **Step 4: Write the failing HTTP contract test**

```ts
it("serves the structure through the boundary pipeline with the manuscript query contract", async () => {
  const { app, calls } = harness();
  const response = await app.inject({ method: "GET", url: "/novels/novel-1/structure", headers: { "x-author-id": "author-1" } });

  expect(response.statusCode).toBe(200);
  expect(calls).toEqual(["manuscript.query.structural-navigation"]);
});
```

- [ ] **Step 5: Add the route with server-derived workspace identity**

`GET /novels/:novelId/structure` routes through `httpBoundaryPipeline.execute` and derives its
authorization resource from `params.novelId`, exactly like the other novel-scoped read routes.

The command routes `POST /novels/:novelId/arcs`, `POST /novels/:novelId/chapters`, and
`POST /arcs/:arcId/chapter-order` / `POST /chapters/:chapterId/scene-order` follow the same rule. Every
one of them routes through the pipeline and derives its authorization resource from the novel id that
the command actually acts on, never from a client-supplied workspace header.

The structure authoring affordance in the interface is not part of W1: W1 makes the capability exist
and reachable over HTTP, and the Structure lens surface in W2 is what lets the author use it.

- [ ] **Step 6: Run the tests to verify GREEN, then verify no regressions and commit**

```bash
npx vitest run tests/app/taskW1StructuralNavigationQuery.test.ts tests/app/taskW1StructureCommands.test.ts tests/http/taskW1StructuralNavigationApi.test.ts
npm run typecheck && npm test -- --run
git add src/app/structuralNavigationQuery.ts src/app/structureCommandService.ts src/application/commandQueryBoundary.ts src/http/routes.ts tests/app/taskW1StructuralNavigationQuery.test.ts tests/app/taskW1StructureCommands.test.ts tests/http/taskW1StructuralNavigationApi.test.ts
git commit -m "feat: 建立结构导航查询与结构命令"
```

### Task 1.3: Object Entry Resolution and Focus Policy

**Files:**
- Create: `src/app/objectEntryContract.ts`
- Create: `src/app/focusResolution.ts`
- Test: `tests/app/taskW1ObjectEntryContract.test.ts`
- Test: `tests/app/taskW1FocusResolution.test.ts`

**Interfaces:**
- Produces:

```ts
export type WorkspaceObjectKind =
  | "novel" | "story-foundation" | "world-character-plot" | "arc" | "chapter" | "scene"
  | "target-span" | "proposal" | "candidate" | "change-set-revision" | "commit"
  | "analysis" | "process";

export type WorkspaceMode = "explore" | "design" | "write" | "review" | "analyze";
export type WorkspaceLens = "structure" | "semantic" | "temporal" | "thread" | "impact" | "process";

export const workspaceObjectKinds: readonly WorkspaceObjectKind[];

export interface ObjectEntryContract {
  readonly kind: WorkspaceObjectKind;
  readonly defaultMode: WorkspaceMode;
  readonly surfaceKind: string;
  readonly defaultPanels: readonly string[];
  readonly defaultLens: WorkspaceLens;
}

export function getObjectEntryContract(kind: WorkspaceObjectKind): ObjectEntryContract;

export type FocusResolution =
  | { readonly resolved: true; readonly kind: WorkspaceObjectKind; readonly mode: WorkspaceMode }
  | { readonly resolved: false; readonly reason: string };

export function resolveFocus(input: {
  readonly kind: WorkspaceObjectKind;
  readonly requestedMode?: WorkspaceMode;
}): FocusResolution;

export function modeIsCompatible(kind: WorkspaceObjectKind, mode: WorkspaceMode): boolean;
```

Contract rules: the table is data, not branching logic. An incompatible requested Mode resolves to the
object's default Mode rather than failing, per Spec §3.2. A kind with no contract is an unresolvable
target and returns `resolved: false` with a reason.

- [ ] **Step 1: Write the failing contract test**

```ts
it("resolves an incompatible mode to the object default instead of failing", () => {
  expect(resolveFocus({ kind: "scene", requestedMode: "review" })).toEqual({
    resolved: true,
    kind: "scene",
    mode: "write",
  });
});

it("resolves every kind in the spec's object entry table", () => {
  for (const kind of workspaceObjectKinds) {
    const contract = getObjectEntryContract(kind);
    expect(contract.surfaceKind).toBeTruthy();
    expect(contract.defaultPanels.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run: `npx vitest run tests/app/taskW1ObjectEntryContract.test.ts tests/app/taskW1FocusResolution.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the contract table and resolution**

Encode the Spec §5 table verbatim, including `Process`, `Proposal`, `Change Set Revision`, and
`Target Span`. Do not add kinds the spec does not define.

- [ ] **Step 4: Verify GREEN, no regressions, commit**

```bash
npx vitest run tests/app/taskW1ObjectEntryContract.test.ts tests/app/taskW1FocusResolution.test.ts
npm run typecheck && npm test -- --run
git add src/app/objectEntryContract.ts src/app/focusResolution.ts tests/app/taskW1ObjectEntryContract.test.ts tests/app/taskW1FocusResolution.test.ts
git commit -m "feat: 建立对象入口契约与焦点解析"
```

### Task 1.4: Workspace Shell and Focus-Driven Rendering

**Files:**
- Create: `public/workspace/focusModel.js`
- Create: `public/workspace/shell.js`
- Create: `public/workspace/apiClient.js`
- Create: `public/workspace/workspace.css`
- Modify: `public/index.html`
- Modify: `src/http/server.ts` (serve the new module, script, and stylesheet as static assets)
- Modify: `src/http/routes.ts` (focus resolution endpoint from Task 1.3)
- Test: `tests/public/taskW1WorkspaceShell.test.ts`
- Test: `tests/http/taskW1FocusResolutionApi.test.ts`

**Interfaces:**
- Consumes: Task 1.2's `GET /novels/:novelId/structure`; Task 1.3's contract and resolution.
- Produces on the server:

```ts
// route: GET /workspace/resolution?kind=<WorkspaceObjectKind>&mode=<WorkspaceMode|absent>
// contract: workspace.query.focus-resolution
// response: FocusResolution plus surfaceKind, defaultPanels, defaultLens when resolved
```

Policy lives on the server only. The client calls resolution and renders the answer; it does not
duplicate the contract table, so there is exactly one source for default Mode, surface, panels, and Lens.

- Produces in the browser:

```js
// public/workspace/focusModel.js
export function createSessionState(): SessionState;
export function navigate(state, target): SessionState;      // push or replace per policy
export function goBack(state): SessionState;
export function setLens(state, lens): SessionState;         // preserves focus, mode, pinned
export function pin(state, reference): SessionState;
export function setZoom(state, focusId, level): SessionState;

// public/workspace/shell.js
export function renderShell(root, state, resolution): void;
```

- [ ] **Step 1: Write the failing shell contract test**

```ts
it("renders the shell regions from a resolved focus and never switches pages", async () => {
  const response = await app.inject({ method: "GET", url: "/" });
  const body = response.body;

  expect(body).toContain('data-region="identity-bar"');
  expect(body).toContain('data-region="lens-rail"');
  expect(body).toContain('data-region="focus-bar"');
  expect(body).toContain('data-region="working-surface"');
  expect(body).toContain('data-region="context-panels"');
  expect(body).toContain('data-region="attention-layer"');
  expect(body).toContain('<script type="module" src="/workspace/shell.js"></script>');
});

it("keeps focus and lens state separate in the client model", () => {
  const source = readFileSync("public/workspace/focusModel.js", "utf8");

  expect(source).toContain("setLens");
  expect(source).toMatch(/setLens[\s\S]*focus/);
  expect(source).toContain("push or replace");
  expect(source).not.toContain("location.reload");
  expect(source).not.toContain("location.href");
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run: `npx vitest run tests/public/taskW1WorkspaceShell.test.ts tests/http/taskW1FocusResolutionApi.test.ts`

Expected: FAIL because the modules and the resolution route do not exist.

- [ ] **Step 3: Implement the resolution route**

`GET /workspace/resolution` routes through `httpBoundaryPipeline.execute` with contract
`workspace.query.focus-resolution`. For a kind that is novel-scoped, the authorization resource is the
novel id supplied with the request; for kinds that are not novel-scoped the route requires the current
workspace from the identity bar and rejects when it is absent, rather than defaulting to a placeholder.

- [ ] **Step 4: Implement the client model and shell**

`navigate` follows the push/replace policy from Spec §4.2. `setLens` preserves focus, mode, and pinned
context, and when the current focus cannot be represented under the new lens it asks the server for the
nearest valid related focus instead of returning home. Zoom is display state stored per focus. The shell
renders the six regions and the working surface from the resolution response. All copy is Simplified
Chinese, consistent with the existing surface. No explanatory in-app text about features or shortcuts.

- [ ] **Step 5: Verify GREEN, then verify no regressions**

```bash
npx vitest run tests/public/taskW1WorkspaceShell.test.ts tests/http/taskW1FocusResolutionApi.test.ts
npm run typecheck && npm test -- --run
node --check public/workspace/shell.js
```

- [ ] **Step 6: Browser verification, then commit**

Start the app against PostgreSQL and confirm in the browser: the six regions render; navigating to a
scene resolves the write surface; changing the lens keeps the focus; back restores the previous focus
with its lens and zoom; the old views remain reachable during the transition.

```bash
git add public/workspace public/index.html src/http/server.ts src/http/routes.ts tests/public/taskW1WorkspaceShell.test.ts tests/http/taskW1FocusResolutionApi.test.ts
git commit -m "feat: 建立焦点驱动的工作区外壳"
```

---

## 5. Wave Definitions W2 .. W5

Each wave below states its contract. Its task-level plan is written by writing-plans at dispatch, against
the codebase as it then exists.

### W2 — Structure and Scene Read Surface

```text
Depends on    W1
Implements    Spec §4.4, §10.1–§10.3
Deliverable   the Structure lens browses the real tree with semantic zoom; opening a Scene resolves the
              write surface and renders the current manuscript revision; a target span can be selected
              and its resolution state (resolvable / drifted / missing) is visible
Capabilities  scene read and manuscript revision read; target span resolution query
Acceptance    from the running app an author reaches a scene from the tree, reads its current text, and
              selects a span whose state is shown honestly, including when the anchor has drifted
Exit          the legacy scene-less structure browsing is gone; the Structure lens is the only tree
```

### W3 — Manuscript Change to Commit Spine

```text
Depends on    W2
Implements    Spec §11 in full, plus the candidate, validation, impact, and gate rows of §17
Deliverable   an edit produces a candidate; the author reviews compare and diff, adopts partially or
              fully, and the resulting Change Set Revision is validated, approved where required, and
              committed with all five gate conditions visible independently; the Commit object is a
              separate surface from Candidate Review
Capabilities  candidate and generation provenance query; change set revision diff query; validation run
              and findings query; dependency and impact read query; commit eligibility query; commit,
              provenance, and audit query
Acceptance    an author completes Candidate -> Adoption -> Change Set -> Change Set Revision ->
              Validation -> Approval -> Commit Gate -> NarrativeCommit end to end, sees each of the five
              gates separately, and cannot reach a commit action from a Candidate focus
Exit          Candidate Review and Commit Review are distinct surfaces; no code path commits a Candidate
```

### W4 — Story Foundation and Narrative State

```text
Depends on    W3
Implements    Spec §12, §13, §18.2, and the Open Questions half of §18.3
Deliverable   the Story Foundation surface with entry mode, five-direction skeleton, proposals, partial
              adoption; narrative state by position with the four semantic layers and a position scrubber
              that aligns to structure without rewriting state
Capabilities  foundation projection query; narrative state by position query; layer resolution query
Acceptance    the author adopts part of a proposal and sees the unselected parts retained with their
              disposition; moving the scrubber shows Canon, Plan, State, and Derived separately, and no
              derived value is presented as canon
Exit          Foundation is not a wizard, not Canon, and not a mandatory gate
```

### W5 — Process Center and Recall Completion

```text
Depends on    W4
Implements    Spec §8, §9, §14, §18.1, and the remainder of §18.3
Deliverable   the full Process Center (run plan, task queue, progress, checkpoints, failures and retry,
              usage and cost, policy decisions, human checkpoints) and Recall over all observation
              sources with an aggregate non-blocking attention layer; a human checkpoint may emit a focus
              transition into W3's review surfaces but never decides narrative state
Capabilities  run, plan, approval, checkpoint, attempt, and usage queries; full recall source
              observation; cross-object attention aggregation; autonomy policy resolution query
Acceptance    run state is never rendered as narrative canon; a checkpoint is visibly not a
              ReviewDecision; every attention item is explainable, evidence-backed, and suppressible, and
              disposition changes only attention state
Exit          Run state, checkpoint, and recall authority separations are all visible in the product
```

---

## 6. Cross-Wave Verification Strategy

```text
Per task            focused tests, then npm run typecheck and npm test -- --run
Per wave            npm run verify:system with the wave's registered profile
                    integration tests against PostgreSQL for any persistence change
                    one real-process smoke on the wave's primary journey (not tests only)
Per wave exit       browser verification of the acceptance journey at desktop and narrow widths
                    Spec §15 region behavior and Spec §16 state set (loading, empty, error, retry,
                    disabled, success, degraded) verified for every surface the wave added
Frozen guards       a check that no wave adds a Canonical write path outside Validation/Approval/Commit,
                    and that Commit Gate evaluation is never reachable from a Candidate
```

Each wave registers a verification profile in `scripts/verificationTaskManifest.ts` covering the gates
its change actually touches. A wave is not complete until its real-process smoke passes, because the
recurring failure mode in this project has been tests passing against a permissive harness while the
production path failed.

---

## 7. Completion Criteria

```text
All five waves exit with their acceptance journeys passing in the running app
Structure, Scene Write, Candidate Review, Commit Review, Foundation, Narrative State, Process Center,
  and Recall are each reachable through Focus resolution rather than page switching
Every capability listed in Spec §17 is either implemented or explicitly deferred with a decision record
No Canonical State write exists outside Validation / Approval / Commit
No code path commits a Candidate
Derived surfaces expose degraded states; none reports success for partial data
Frozen Domain, Entity Design, Core Engine, Productionization Architecture, and the Workspace Product
  Spec are unchanged
Working tree clean, each wave committed with an independent Chinese commit message
```

---

## 8. Explicitly Not In This Roadmap

This section is the roadmap-level counterpart of Spec §19 (Explicitly Deferred Work).

```text
Pixel-level visual design, component inventory, design tokens, motion
Full keyboard map and shortcut set
DTO field lists and API parameter design beyond what a wave's task requires
Database field and index design beyond what a wave's persistence requires
Real AI provider integration (the deterministic runtime stays until a provider wave exists)
Worker work source, which still requires the pending-work claim/lease decision
Retrieval and embedding infrastructure, advanced validator catalog, cost optimization mechanics
Accessibility audit, multi-author and collaboration, publishing
```

The worker work source remains out of scope for the same reason as before: it needs a pending-work
ownership and lease decision that no frozen document has made. Recall in W5 covers observation and
attention; it does not authorize autonomous task creation.

Spec §20 (Architecture / UX Review Checklist) is enforced continuously rather than at the end: its
`PASS` items are restated in this roadmap's Global Constraints and are re-verified at every wave exit
through the frozen guards in Section 6.
