# W2 — Structure and Scene Read Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Structure lens browses the real persisted tree with semantic zoom, opening a Scene resolves the write surface and renders the current manuscript revision, and a selected target span reports honestly whether it is resolvable, drifted, or missing.

**Architecture:** Four tasks. Two add the application read capabilities the surface needs (scene read, target span resolution), two build the surface (Structure lens tree, Scene write-surface read). Frontend and capability move together; no task ships a surface against invented data.

**Tech Stack:** TypeScript, Node.js, Fastify, Prisma + PostgreSQL, Vitest, browser-native ES modules.

**Spec:** `docs/superpowers/specs/2026-10-06-novel-brain-workspace-product-design.md` (FROZEN, ff0d856)
**Roadmap:** `docs/superpowers/plans/2026-10-06-novel-brain-workspace-product-activation-roadmap.md` (W2 section)

## Global Constraints

All Global Constraints of the roadmap apply. In addition for W2:

- The Structure tree renders from `GET /novels/:novelId/structure` only. The client never assembles structure from an independent source and never invents a node for a dangling container entry.
- A structure that the query marks `degraded` renders as degraded with its issues; it is never shown as a healthy tree.
- Scene reading is read-only. W2 does not write manuscript text; editing arrives in W3 through the proposal/change/commit pipeline.
- Target span resolution is read-only and classifies failure. It never repairs an anchor, never rewrites scene text, and never silently reports a drifted span as resolvable.
- Every new route goes through `httpBoundaryPipeline.execute` and derives its authorization resource server-side from the path or body identity it acts on.
- No Domain, DTO, schema, or migration change. `resolveTargetSpan`, `Scene`, and `TargetSpan` are consumed as frozen.
- Chinese copy; existing state set (loading, empty, error, retry, disabled, success, degraded).

Test snippets in this plan use local fixture helpers (`dependencies()`, `matchingSpan()`,
`staleRevisionSpan()`, `unknownAnchorSpan()`). Each builds entities and persistence through the existing
factories (`createScene`, `commitSceneText`, `createVersionSet`) and in-memory repositories. They live in
the test file and are not production surface.

---

## Task 2.1: Scene Read and Manuscript Revision Read

**Files:**
- Create: `src/app/sceneReadQuery.ts`
- Modify: `src/application/commandQueryBoundary.ts` (two query contracts under the existing `manuscript` capability)
- Modify: `src/http/routes.ts`
- Test: `tests/app/taskW2SceneReadQuery.test.ts`
- Test: `tests/http/taskW2SceneReadApi.test.ts`

**Interfaces:**
- Consumes: `RevisionedRepository<Scene>`, `Scene`, `toSceneRevision`.
- Produces:

```ts
export interface SceneReadView {
  readonly sceneId: string;
  readonly novelId: string;
  readonly chapterId: string;
  readonly title: string;
  readonly revisionId: string;
  readonly text: string;
  readonly anchorIds: readonly string[];
}

export function createSceneReadQuery(dependencies: {
  readonly scenes: RevisionedRepository<Scene>;
}): {
  getScene(input: { readonly novelId: string; readonly sceneId: string }): Promise<SceneReadView | undefined>;
};
```

Contracts: `manuscript.query.scene`.

- [ ] **Step 1: Write the failing test**

```ts
it("returns the current scene revision text and anchor ids", async () => {
  const query = createSceneReadQuery(dependencies());
  const view = await query.getScene({ novelId: "novel-1", sceneId: "scene-1" });

  expect(view?.revisionId).toBe("scene-1:r2");
  expect(view?.text).toBe("第一段。第二段。");
  expect(view?.anchorIds).toEqual(["anchor-1"]);
});

it("does not return a scene that belongs to another novel", async () => {
  const query = createSceneReadQuery(dependencies());
  expect(await query.getScene({ novelId: "novel-2", sceneId: "scene-1" })).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/app/taskW2SceneReadQuery.test.ts` — expected FAIL, module missing.

- [ ] **Step 3: Implement the query and the route**

`GET /novels/:novelId/scenes/:sceneId` routes through the pipeline with contract `manuscript.query.scene`,
authorizes against `params.novelId`, returns 404 when the scene does not exist or belongs to another novel.
The route never returns a scene whose `novelId` differs from the path.

- [ ] **Step 4: Verify GREEN, run `npm run typecheck && npm test -- --run`, commit**

```bash
git commit -m "feat: 建立场景读取查询"
```

---

## Task 2.2: Target Span Resolution

**Files:**
- Create: `src/app/targetSpanResolutionQuery.ts`
- Modify: `src/application/commandQueryBoundary.ts`
- Modify: `src/http/routes.ts`
- Test: `tests/app/taskW2TargetSpanResolution.test.ts`
- Test: `tests/http/taskW2SpanResolutionApi.test.ts`

**Interfaces:**
- Consumes: `RevisionedRepository<Scene>`, `resolveTargetSpan`, `TargetSpan`, `hashContent`.
- Produces:

```ts
export type SpanResolutionState = "resolvable" | "drifted" | "missing";

export interface SpanResolutionView {
  readonly state: SpanResolutionState;
  readonly reason: string;
  readonly span?: { readonly start: number; readonly end: number; readonly text: string };
}

export function createTargetSpanResolutionQuery(dependencies: {
  readonly scenes: RevisionedRepository<Scene>;
}): {
  resolveSpan(input: {
    readonly novelId: string;
    readonly sceneId: string;
    readonly span: TargetSpan;
  }): Promise<SpanResolutionView>;
};
```

Classification maps the frozen domain outcomes, without swallowing them silently:

```text
resolveTargetSpan succeeds                      -> resolvable
anchor absent from scene.spanAnchors            -> missing      reason: anchor not found
anchor.revisionId !== scene.currentRevisionId   -> drifted      reason: revision moved
anchor text or hash disagrees with the scene    -> drifted      reason: anchor content moved
scene not found or belongs to another novel     -> missing      reason: scene not found
```

Contracts: `manuscript.query.target-span-resolution`. Transport note: the route is `POST` only because
the span descriptor carries text; the contract is a read-only query and the handler performs no write.

- [ ] **Step 1: Write the failing tests**

```ts
it("classifies a matching anchor as resolvable", async () => {
  const view = await query.resolveSpan({ novelId: "novel-1", sceneId: "scene-1", span: matchingSpan() });
  expect(view.state).toBe("resolvable");
  expect(view.span).toEqual({ start: 0, end: 3, text: "第一段" });
});

it("classifies an anchor whose revision moved as drifted, not resolvable", async () => {
  const view = await query.resolveSpan({ novelId: "novel-1", sceneId: "scene-1", span: staleRevisionSpan() });
  expect(view.state).toBe("drifted");
  expect(view.reason).toContain("revision");
});

it("classifies an unknown anchor as missing", async () => {
  const view = await query.resolveSpan({ novelId: "novel-1", sceneId: "scene-1", span: unknownAnchorSpan() });
  expect(view.state).toBe("missing");
});
```

- [ ] **Step 2: Run to verify RED**, then implement (Step 3).

- [ ] **Step 4: Verify GREEN, typecheck, full suite, commit**

```bash
git commit -m "feat: 建立目标片段解析查询"
```

---

## Task 2.3: Structure Lens Tree and Semantic Zoom

**Files:**
- Create: `public/workspace/structureLens.js`
- Modify: `public/workspace/shell.js`, `public/workspace/workspace.css`
- Test: `tests/public/taskW2StructureLens.test.ts`

**Interfaces:**
- Consumes: `GET /novels/:novelId/structure`; the session focus model from W1.
- Produces:

```js
// public/workspace/structureLens.js
export function renderStructureLens(root, view, handlers): void;   // view = StructuralNavigationView
export function zoomLevelFor(state, focusKey): string;             // novel | arc | chapter | scene | span
export function visibleNodes(view, level, focusKey): readonly Node[];
```

Behaviour:

- Renders arcs, chapters and scenes from the query in container order.
- Semantic zoom changes the rendered granularity of the same subtree and preserves lens, focus, pinned
  context and session state (Spec §4.4). Zoom does not push the focus stack.
- Selecting a node resolves a Focus (it is navigation, not page switching).
- `degraded` renders as degraded with the issues listed; a dangling container entry is never drawn as a
  node and never silently dropped from the issues.
- An empty structure renders the empty state, not an error.

- [ ] **Step 1: Write the failing test** (contract: module exports, degraded rendering, zoom does not
  change focus, no fabricated node), then **Step 2 RED**, **Step 3 implement**, **Step 4 GREEN**,
  **Step 5 browser verification** of: tree renders for `w1-demo`-style data, clicking a scene focuses it,
  zoom changes granularity without moving focus, a degraded tree shows its issues.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: 建立结构镜头树与语义缩放"
```

---

## Task 2.4: Scene Write-Surface Read and Span Selection

**Files:**
- Create: `public/workspace/sceneSurface.js`
- Modify: `public/workspace/shell.js`, `public/workspace/workspace.css`
- Test: `tests/public/taskW2SceneSurface.test.ts`

**Interfaces:**
- Consumes: `GET /novels/:novelId/scenes/:sceneId`; `POST /novels/:novelId/scenes/:sceneId/span-resolution`.
- Produces:

```js
// public/workspace/sceneSurface.js
export function renderSceneSurface(root, scene, selection, handlers): void;
export function spanDescriptorFromSelection(text, bounds): TargetSpanDescriptor | undefined;
```

Behaviour:

```text
scene found and has text      -> render the text read-only with its title and revision
scene found but text empty    -> empty state, not an error
scene missing or other novel  -> error state with retry
selection made in the text    -> resolve the span and show resolvable / drifted / missing with the reason
drifted or missing            -> visible warning; the surface never claims the span will apply
```

W2 renders read-only. There is no edit control, no candidate creation, and no commit affordance in this
task: those belong to W3.

- [ ] **Step 1: Write the failing test**, **Step 2 RED**, **Step 3 implement**, **Step 4 GREEN**,
  **Step 5 browser verification** of the acceptance journey, **Step 6 commit**

```bash
git commit -m "feat: 建立场景读取工作面与片段选择"
```

---

## W2 Exit

```text
Focused tests green, npm run typecheck, npm test -- --run, verify:system --task W2
Real-process smoke: seed a novel with arcs, chapters and scenes; from the running app reach a scene
  through the Structure lens, read its text, select a span and see its resolution state
Degraded honesty: a tree with a dangling container entry renders degraded with issues, not a clean tree
Legacy boundary: structure browsing exists only in the new Structure lens; the legacy views are not
  extended with structure browsing
No write path added: W2 adds no manuscript write and no commit affordance
```

## Explicitly Not In W2

```text
Manuscript editing, candidate creation, adoption, validation, approval, commit (W3)
Narrative state by position and the four layers (W4)
Process Center and Recall completion (W5)
Pixel-level design, motion, keyboard map
```
