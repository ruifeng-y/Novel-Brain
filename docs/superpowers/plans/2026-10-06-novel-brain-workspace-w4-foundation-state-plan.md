# W4 — Story Foundation and Narrative State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The author works Story Foundation as a design surface — entry mode, five-direction skeleton, proposals, partial adoption with retained disposition — and reads narrative state by position, where the four semantic layers (Canon / Plan / State / Derived) are shown separately and no derived value is ever presented as canon.

**Architecture:** W4 adds three read capabilities (foundation projection, narrative state by position, layer resolution) and one command path (partial adoption that records disposition and continues into W3's Change Set spine). It adds two surfaces. It does not add narrative truth: the projection is derived, the scrubber aligns to structure without rewriting state, and Canon changes only through W3's Validation → Approval → Commit.

**Tech Stack:** TypeScript, Node.js, Fastify, Prisma + PostgreSQL, Vitest, browser-native ES modules.

**Spec:** `docs/superpowers/specs/2026-10-06-novel-brain-workspace-product-design.md` (FROZEN, ff0d856) — §12, §13, §18.2, and the Proposal Open Questions half of §18.3.
**Roadmap:** `docs/superpowers/plans/2026-10-06-novel-brain-workspace-product-activation-roadmap.md` (W4 section)

## Global Constraints

All Global Constraints of the roadmap apply. In addition for W4:

- `Foundation != Canon`, `Foundation != Manuscript`, `Foundation != mandatory workflow step`. Entry is a creation entry, not a wizard; a direction may stay open indefinitely.
- `Plan != Canon`, `Derived != Canon`, `Current State != Global Canon`. The layer resolution reports the four layers separately and never merges them.
- The Position Scrubber aligns a state view to a Scene, Chapter, or Arc by position. Aligning **changes Focus**; it never rewrites state.
- Domain records never become first-class pages: no StateRecord page, no CanonicalFact page, no Memory page, no KnowledgeState page. Narrative state is presented by author question.
- Proposal Open Questions are owned by the Proposal. The projection **aggregates** them and never rewrites them.
- The Story Foundation Projection holds no Workspace Session state. Entry mode and entry provenance describe how a Novel's design started, not where a session is.
- Canonical state still changes only through `commitChangeSetRevision` (W3). W4 adds no canonical write path.
- Chinese copy; the existing state set; no page reload; W1–W3 behaviour must not regress.

## Facts verified before planning

```text
AdoptionDecision                   type = adopt | reject | defer | reopen, per AdoptionTarget
applyAdoptionDecisionToProposal()  exists: applies a decision to a proposal
createAdoptionChangeSetInputs()    exists: turns a decision into Change Set inputs
prepareFoundationAdoptionChangeSet() exists in foundationAdoptionService
proposalWorkflowService            openProposalWorkflow / apply / branch / compare exist
narrativeProposalPersistence       revisioned persistence for NarrativeProposal
StateRecord                        { type, subjectId, position: { sceneId, ordinal }, content,
                                     revisionId, commitId }   (position-aware)
CanonicalFact                      { type, content, revisionId, commitId }
foundationWorkspaceContract        existing foundation focus contract
W3                                 Change Set Revision is addressable; Validation / Approval /
                                   Gate / Commit / provenance all reachable
```

Two consequences shape this wave:

```text
1. Partial adoption is NOT a new domain concept: the decision vocabulary and the Change Set inputs
   already exist. W4 exposes them as a reachable command and records the disposition of the parts
   the author did not select. Inventing a second adoption model would be the defect.
2. Narrative state is already position-aware (StateRecord.position), but nothing reads it by
   position and nothing separates the four layers. W4 is therefore mostly read capability plus
   presentation, not new domain.
```

---

## Task 4.1: Story Foundation Projection Query

**Files:**
- Create: `src/app/foundationProjectionQuery.ts`
- Modify: `src/http/routes.ts`, `src/application/commandQueryBoundary.ts`, composition roots
- Test: `tests/app/taskW4FoundationProjectionQuery.test.ts`
- Test: `tests/http/taskW4FoundationProjectionApi.test.ts`

**Interfaces:**
- Consumes: `narrativeProposalPersistence`, `AdoptionDecision` records, the Change Set once adoption begins, `foundationWorkspaceContract`.
- Produces:

```ts
export interface FoundationDirectionState {
  readonly direction: string;                 // the five directions
  readonly proposalIds: readonly string[];
  // Implemented as `status`: the same four values, named so it is never
  // confused with narrative state.
  readonly status: "open" | "proposed" | "adopted" | "deferred";
}

export interface FoundationProjection {
  readonly novelId: string;
  readonly entryMode: "idea" | "existing_text" | "blank" | "none";
  readonly entryProvenance?: string;          // how the design started, not a session
  readonly directions: readonly FoundationDirectionState[];
  // Implemented as `proposalsByType`: a stage is not persisted state
  // (`ProposalWorkflowPosition` is supplied by the caller), so grouping by
  // stage would have to be invented. `proposalType` is the persisted fact.
  readonly proposalsByType: Readonly<Record<string, readonly string[]>>;
  readonly openQuestions: readonly {
    readonly proposalId: string;
    readonly questionId: string;
    readonly text: string;
    readonly state: string;
  }[];
  readonly adoptionReadiness: { readonly ready: boolean; readonly reason?: string };
}

export function createFoundationProjectionQuery(dependencies: {
  readonly proposals: /* revisioned proposal read port */;
  readonly adoptionDecisions: /* read port */;
}): {
  project(input: { readonly novelId: string }): Promise<FoundationProjection | undefined>;
};
```

Contract: `foundation.query.foundation-projection`.

- [ ] **Step 1: Write the failing test** — a Novel with two proposals, one direction adopted and one deferred, projects: entry mode and provenance, per-direction status, proposals grouped by type, the proposal's open questions **with their owning proposal id**, and adoption readiness.
- [ ] **Step 2 RED**, **Step 3 implement**, **Step 4 GREEN + typecheck + full + integration**, **Step 5 commit**

```bash
git commit -m "feat: 建立故事基础投影查询"
```

---

## Task 4.2: Partial Adoption With Retained Disposition

**Files:**
- Create: `src/app/foundationPartialAdoptionService.ts`
- Modify: `src/http/routes.ts`, `src/application/commandQueryBoundary.ts`, composition roots
- Test: `tests/app/taskW4PartialAdoption.test.ts`
- Test: `tests/http/taskW4PartialAdoptionApi.test.ts`

**Interfaces:**
- Consumes: `createAdoptionDecision`, `applyAdoptionDecisionToProposal`, `createAdoptionChangeSetInputs`, `prepareFoundationAdoptionChangeSet`, W3's adoption into a Change Set Revision.
- Produces: a command that adopts **a selected subset** of a proposal's targets and records `reject` / `defer` for the rest, then continues into the Change Set path.

```ts
export function createFoundationPartialAdoptionService(dependencies: { /* proposals, decisions, changeSets */ }): {
  adoptPart(input: {
    readonly novelId: string;
    readonly proposalId: string;
    readonly adoptedTargets: readonly AdoptionTarget[];
    readonly deferredTargets?: readonly AdoptionTarget[];
    readonly rejectedTargets?: readonly AdoptionTarget[];
    readonly changeSetId: string;
    readonly revisionId: string;
    readonly actorId: string;
    readonly createdAt: Date;
  }): Promise<{ readonly decision: AdoptionDecision; readonly revision: ChangeSetRevision }>;
};
```

Rules: every target of the proposal ends in exactly one disposition; unselected parts stay in the proposal with their disposition recorded (never silently dropped); the Change Set continues into W3's Validation → Approval → Gate → Commit. Foundation is not a mandatory gate: skipping this command is always allowed.

Contract: `foundation.command.adopt-proposal-part`.

- [ ] **Step 1: Write the failing test** — adopting two of five targets records three dispositions and produces a revision whose changes cover only the adopted targets; the proposal still lists the unselected parts with their disposition.
- [ ] **Step 2 RED**, **Step 3 implement**, **Step 4 GREEN + typecheck + full + integration**, **Step 5 commit**

```bash
git commit -m "feat: 支持提案的部分采纳与处置记录"
```

---

## Task 4.3: Narrative State by Position Query

**Files:**
- Create: `src/app/narrativeStateByPositionQuery.ts`
- Modify: `src/http/routes.ts`, `src/application/commandQueryBoundary.ts`, composition roots
- Test: `tests/app/taskW4NarrativeStateByPosition.test.ts`
- Test: `tests/http/taskW4NarrativeStateApi.test.ts`

**Interfaces:**
- Consumes: `StateRecord` revisions (position-aware), `CanonicalFact` revisions, the novel's structure.
- Produces:

```ts
export interface NarrativeStateAtPosition {
  readonly novelId: string;
  readonly position: { readonly sceneId: string; readonly ordinal: number };
  readonly character: readonly StateEntry[];
  readonly world: readonly StateEntry[];
  readonly relationship: readonly StateEntry[];
  readonly knowledge: readonly StateEntry[];
  readonly plot: readonly StateEntry[];
}

export function createNarrativeStateByPositionQuery(dependencies: {
  readonly stateRecords: /* revisioned read port */;
  readonly canonicalFacts: /* revisioned read port */;
}): {
  atPosition(input: { readonly novelId: string; readonly sceneId: string; readonly ordinal?: number }):
    Promise<NarrativeStateAtPosition | undefined>;
};
```

Rules: the answer is **position-aware** — past, current, and future-planned state stay distinguishable, so an entry carries whether it is at, before, or after the requested position. Nothing is inferred or summarised here: Derived is Task 4.4's separate layer.

Contract: `narrative.query.state-by-position`.

- [ ] **Step 1: Write the failing test** — three state records at different positions in one scene: asking at position 2 returns all three with their relation (before / at / after) and never merges them into one value.
- [ ] **Step 2 RED**, **Step 3 implement**, **Step 4 GREEN + typecheck + full + integration**, **Step 5 commit**

```bash
git commit -m "feat: 建立按位置读取叙事状态的查询"
```

---

## Task 4.4: Layer Resolution Query

**Files:**
- Create: `src/app/narrativeLayerResolutionQuery.ts`
- Modify: `src/http/routes.ts`, `src/application/commandQueryBoundary.ts`
- Test: `tests/app/taskW4LayerResolution.test.ts`
- Test: `tests/http/taskW4LayerResolutionApi.test.ts`

**Interfaces:**
- Consumes: canonical facts (Canon), plan-layer intent (Plan), state records at the position (State), derived material (Derived).
- Produces:

```ts
export interface NarrativeLayerResolution {
  readonly subject: { readonly kind: string; readonly objectId: string };
  readonly canon: readonly LayerEntry[];      // confirmed facts, canonical form
  readonly plan: readonly LayerEntry[];       // future intent, not yet Canon
  readonly state: readonly LayerEntry[];      // position-aware state
  readonly derived: readonly LayerEntry[];    // summaries, inference, suggestions, memory, analysis
  readonly derivedAsOf?: { readonly position: string; readonly stale: boolean };
}

export function createNarrativeLayerResolutionQuery(dependencies: { /* read ports */ }): {
  resolve(input: { readonly novelId: string; readonly subjectKind: string; readonly subjectId: string }):
    Promise<NarrativeLayerResolution | undefined>;
};
```

Rules: the four layers are separate arrays and are never merged; `derived` entries carry an as-of marker and a staleness indicator (Spec §13.6); a derived value is never placed in `canon`. `Plan != Canon`, `Derived != Canon`, `Current State != Global Canon`.

Contract: `narrative.query.layer-resolution`.

- [ ] **Step 1: Write the failing test** — a subject with one canonical fact, one plan-layer intent, one state record, and one derived summary resolves into four non-empty separate layers; the derived entry carries `asOf` and staleness; no derived value appears in `canon`.
- [ ] **Step 2 RED**, **Step 3 implement**, **Step 4 GREEN + typecheck + full + integration**, **Step 5 commit**

```bash
git commit -m "feat: 建立叙事层解析查询"
```

---

## Task 4.5: Story Foundation Surface

**Files:**
- Create: `public/workspace/foundationSurface.js`
- Modify: `public/workspace/shell.js`, `public/workspace/apiClient.js`, `public/workspace/workspace.css`, `src/http/server.ts`
- Test: `tests/public/taskW4FoundationSurface.test.ts`

**Interfaces:**

```js
// public/workspace/foundationSurface.js
export function renderFoundationSurface(root, view, handlers): void;
// entry mode, five-direction skeleton with per-direction state, proposal list by stage,
// proposal open questions, partial adoption selection, adoption readiness
```

Required behaviour: the surface renders the projection the server returned and decides nothing; the five directions are shown with their own state; open questions name their owning proposal; partial adoption lets the author select targets and shows the unselected parts with their disposition; **the surface is not a wizard** (no forced step order, no completion gate) and offers no canonical write.

- [ ] **Step 1: Write the failing tests** (surface renders the five directions; unselected parts visible with disposition; no canonical write control), **Step 2 RED**, **Step 3 implement**, **Step 4 GREEN**, **Step 5 commit**

```bash
git commit -m "feat: 建立故事基础界面"
```

---

## Task 4.6: Narrative State Surface and Position Scrubber

**Files:**
- Create: `public/workspace/narrativeStateSurface.js`
- Modify: `public/workspace/shell.js`, `public/workspace/apiClient.js`, `public/workspace/workspace.css`, `src/http/server.ts`
- Test: `tests/public/taskW4NarrativeStateSurface.test.ts`

**Interfaces:**

```js
// public/workspace/narrativeStateSurface.js
export function renderNarrativeStateSurface(root, view, handlers): void;
// the four layers separately, the as-of/staleness of Derived, and the Position Scrubber
```

Required behaviour: the scrubber moves along story position and re-asks the server; Canon, Plan, State, and Derived render as **four separate groups** and are never merged; a derived value is never styled or labelled as canon; aligning to a Scene / Chapter / Arc **changes Focus** and never rewrites state; past / current / future-planned remain distinguishable.

- [ ] **Step 1: Write the failing tests** (four separate groups; derived never labelled canon; alignment changes Focus), **Step 2 RED**, **Step 3 implement**, **Step 4 GREEN**, **Step 5 browser verification** of the W4 journey, **Step 6 commit**

```bash
git commit -m "feat: 建立叙事状态界面与位置滑块"
```

---

## Task 4.7: W4 Exit Evidence

**Files:**
- Modify: `scripts/verificationTaskManifest.ts`（W4 profile，若尚未存在）
- Test: `tests/public/taskW4ExitEvidence.test.ts`（`[task:W4] [cross-system]` / `[task:W4] [regression]`）

Required: a cross-system test that walks the W4 journey through the real HTTP surface, and a regression test that W1–W3 behaviour is intact (structure tree current-row highlight, scene surface, candidate surface without a commit control, commit gate five conditions).

- [ ] **Step 1–4**, **Step 5 commit**

```bash
git commit -m "test: 落地 W4 跨系统与回归证据"
```

---

## W4 Exit

```text
Focused tests green, npm run typecheck, npm test -- --run, verify:system --task W4 with EXIT CODE 0
Real-process smoke on the W4 journey: entry mode -> direction proposals -> partial adoption with
  retained disposition -> Change Set Revision -> W3 spine, and a position move that shows Canon, Plan,
  State, and Derived separately
Foundation safety: no wizard, no completion gate, no canonical write from any W4 surface
Layer safety: derived output is never placed in, or labelled as, canon
Scrubber safety: aligning to structure changes Focus and writes nothing
No second canonical write path
```

## Explicitly Not In W4

```text
Process Center, run plan, task queue, checkpoints, usage (W5)
Recall over all observation sources and cross-object attention aggregation (W5)
the Novel-level Open Questions and Concerns Projection and Narrative Health as Novel-level views
  (W4 exposes Proposal Open Questions only; the aggregation is §18.3's other half, W5)
Real AI provider integration; the deterministic runtime stays
Pixel-level design, motion, keyboard map
```
