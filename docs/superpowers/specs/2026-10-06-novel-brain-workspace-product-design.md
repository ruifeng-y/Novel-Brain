# Novel Brain Workspace Product / UI-UX Architecture Spec

## Status

```yaml
Design Status:
  Workspace Product Principles:        Confirmed
  Workspace Shell / Focus / Lens:      Confirmed
  Object Entry Contract:               Confirmed
  Seven Surface Mapping:               Confirmed
  Pending Semantics Closure:           CLOSED by Section 18
  Application Capability Dependencies: Confirmed (capability level only)
  Pixel / Component / Motion Design:   Deferred
  DTO Fields / API Parameters:         Deferred
  Database Fields:                     Deferred

Document:
  Date: 2026-10-06
  Scope: Product information architecture, interaction model, and capability dependencies
  Predecessor: docs/superpowers/specs/2026-10-03-novel-brain-product-and-experience-design.md
  Predecessor: docs/superpowers/specs/2026-10-05-novel-brain-productionization-architecture.md
  Successor: Workspace / Product Activation Implementation Roadmap (writing-plans)
```

This document completes the product and interface layer that two earlier frozen documents explicitly
deferred. It does not reopen Domain, Entity Design, Frozen Core, or the Productionization
Architecture. It defines how a finished Domain + Core Engine + Productionization is carried by a real
creation Workspace.

Deliberately not defined here: pixel layout, component inventory, motion, keyboard maps, DTO fields,
API parameters, database fields, provider integration, retrieval infrastructure.

---

## 1. Workspace Product Principles

### 1.1 One Workspace, Two Author Types

The mature author and the author who begins from one sentence share one Workspace, one Narrative
Object model, and one Proposal / Adoption / Validation / Commit pipeline. They differ only in initial
Narrative State source, initial Focus, AI Assistance Level, and existing assets. There is no separate
beginner product and no separate professional product.

### 1.2 The Author Holds Authority

AI output is never narrative authority. The author may accept, edit, reject, branch, merge, defer,
skip, or create directly. No interface affordance, convenience flow, or autonomy setting may weaken
the Canonical Safety Floor: Domain Invariant, Mandatory Validation, Required Approval, Optimistic
Concurrency Control, Commit Safety.

### 1.3 Navigation Resolves Focus; It Does Not Switch Pages

Every navigation entry resolves a target and produces a Focus. There is no legal navigation outcome
called go home. A traditional page switcher is not an acceptable implementation of this model.

### 1.4 The Workspace Is Not a Domain Aggregate

The Workspace presents, resolves, and explains. It owns no Narrative Truth, no Revision semantics, no
Validation / Approval / Commit authority, and no Run lifecycle truth.

### 1.5 Two Contexts, Never One

```text
View Context        derived, dynamic, rebuildable, session-scoped
Generation Context  immutable, versioned, attempt-scoped
```

The Workspace may display a Generation Context. It may never store one as its own state, and it may
never mutate one.

### 1.6 Everything Dynamic Must Be Explainable

For every dynamic decision the interface can answer: why this surface, why this panel, why this
candidate, why this attention item, why this AI assistance is active. Explainability is a product
requirement, not a debugging aid.

### 1.7 Active Awareness Without Workflow Control

The system observes, detects, prioritizes, surfaces, and explains. It never drives the author, never
blocks work through the attention layer, and never converts a recommendation into a mandatory step.

### 1.8 Derived Is Never a Second Truth

Summaries, health, open questions, attention items, memory, diffs, and impact are derived and
rebuildable. Any surface that shows derived data must make its staleness or degraded state visible.

### 1.9 Canonical Safety Is Visible

Where an action will mutate canonical state, the interface shows what will be committed, through which
target, with which validation and approval status, before the action is taken.

---

## 2. Workspace Shell

### 2.1 Regions

```text
Workspace Shell
  Identity Bar        workspace identity: novel, author, autonomy policy summary
  Lens Rail           persistent navigation lenses
  Focus Bar           breadcrumb trail, focus stack access, pinned context
  Working Surface     exactly one primary surface for the current Focus
  Context Panels      derived panels for the current Focus
  Attention Layer     non-blocking overlay
  Process Center      independently addressed surface
```

```text
Shell        = stable
Surface      = determined by Focus
Panels       = derived
Attention    = non-blocking
Process      = independent
```

### 2.2 Shell Rules

- The Identity Bar is always present and always shows which Novel and which Author the session acts as.
- The Lens Rail is persistent navigation. It is not a module list and it is not a tab bar.
- The Focus Bar shows where the author is, not what the author owns. A breadcrumb is a navigation path
  projection and never a dependency or ownership claim.
- The Working Surface occupies the primary region and is never split between two objects of equal rank.
- Context Panels never outrank the Working Surface; they collapse before the surface does.
- The Attention Layer never reorders, occludes, or gates the Working Surface.
- The Process Center is reachable without abandoning the current Focus, and returning from it restores
  the previous Focus exactly.

### 2.3 What the Shell Must Never Become

```text
Not a page navigator       (Foundation Page / Run Page / Recall Page / Scene Page)
Not a module dashboard     (counters and cards with no Focus)
Not a wizard               (no forced linear steps)
Not a hierarchy tree owner (structure is narrative, not UI ownership)
```

---

## 3. Focus / Lens / Mode

### 3.1 Focus

```text
Focus = Object + Mode + (Task?)
```

- Object is a resolvable narrative reference, not an aggregate instance.
- Mode is the work semantics applied to that Object.
- Task is an optional scoped intent. A Task never creates a workflow obligation.

A Focus is the only thing that selects the Working Surface. There is exactly one Focus at a time.

### 3.2 Mode

```text
Explore   understand, navigate, survey, compare at object level
Design    shape intent, explore directions, author proposals
Write     produce and edit manuscript content
Review    judge a proposed change, its evidence, and commit eligibility
Analyze   inspect dependencies, impact, consistency, findings
```

Mode is a first-class dimension of the surface: the same Scene under Write is an editor, under Analyze
is a dependency and impact view. Object and Mode compatibility is policy-governed; not every object
supports every mode. When a requested Mode is incompatible, resolution yields the nearest valid Mode
rather than an error page.

### 3.3 Lens

```text
Structure   Arc -> Chapter -> Scene -> Target Span
Semantic    characters / rules / threads / foreshadowing / facts
Temporal    timeline and story position
Thread      plot threads and foreshadowing lines
Impact      impact and dependency relations
Process     long-running runs, tasks, checkpoints
```

Lens is a session-level property. It answers which dimension the author is browsing in, not what the
author is working on.

```text
Object  = the target
Mode    = how the author works on the target
Lens    = which dimension the author observes and browses in
```

Lens rules:

- A Lens change preserves Focus, Mode, and Pinned Context.
- If the current Focus cannot be represented under the new Lens, resolution yields the nearest valid
  containing or related Focus; it never returns the author to a home view.
- A Lens changes which relations the Context Panels foreground and which tree the Lens Rail expands.
- A Lens never changes Narrative State and never mutates a Generation Context.
- The default Lens for a resolved Focus comes from the Object Entry Contract.

### 3.4 Task

A Task is a scoped intent attached to a Focus, for example rewriting one target span or resolving one
open question. A Task may adapt AI assistance level. A Task never becomes a mandatory step, and
abandoning a Task never loses the Focus.

### 3.5 Pinned Context

```text
Pinned Context = a set of author-pinned references
```

Pinned Context survives navigation, informs derivation, and is a Workspace preference. It never
directly changes Narrative State, Dependency facts, or a Generation Context.

---

## 4. Navigation Model

### 4.1 Resolution, Not Switching

```text
navigate(target)
  -> resolveFocus(target, policy)
  -> { Object, Mode }
  -> push or replace on the Focus Stack
  -> Working Surface renders surfaceFor(Object, Mode)
  -> Context Panels derive from (Object, Mode, Lens, State, Dependencies)
```

### 4.2 Focus Stack

The Focus Stack is session navigation history, not a domain hierarchy.

- Push versus replace is a policy: lateral movement within the same parent replaces; drilling into a
  contained object pushes.
- Back returns to the previous Focus with its Mode, Lens, zoom, and pinned context intact.
- The Focus Stack is bounded and is a session artifact. It is not canonical and it is not shared.

### 4.3 The Three Verbs

```text
Lens     browse   expands a navigation dimension
Search   locate   finds a target and resolves a Focus
Command  act      invokes an action on the current Focus or on a named target
```

Rules:

- Universal Search is first-class and does not require passing through a Lens.
- At million-word scale, Search and Jump are the primary high-speed location path, not an auxiliary
  feature.
- Command may act without changing Focus. If it changes Focus, that change is pushed like any other
  navigation.
- The three verbs are visually and behaviorally distinct.

### 4.4 Semantic Zoom

```text
Novel -> Arc -> Chapter -> Scene -> Target Span
```

Semantic Zoom changes the granularity at which the same focused subtree is rendered. It preserves Lens,
Mode, Pinned Context, and session state. Zoom is a display state stored per Focus in the session;
returning to a Focus restores its zoom. Zoom is not navigation and does not push the Focus Stack.

### 4.5 Context Preservation

```text
Focus Stack      session navigation history
Breadcrumb       navigation path projection
Pinned Context   workspace preference
Derived Context  rebuilt from Focus + Narrative State + Dependencies
```

A Focus change never discards the previous Focus, never resets Pinned Context, and never forces a
workflow step.

---

## 5. Object Entry Contract

Any entry point that opens the same object converges on the same Object + resolved Mode + Context +
Policy. There is never one interface per entry path.

| Object | Default Mode | Primary Working Surface | Default Panels | Default Lens |
| --- | --- | --- | --- | --- |
| Novel | Explore | overview, health, current state | Attention / Recent / Health | Structure |
| Story Foundation | Design | five-direction skeleton, proposals | Proposals / Open Questions | Semantic |
| World / Character / Plot | Design | object content, proposals | Dependencies / Related Objects / Open Questions | Semantic |
| Arc / Chapter | Design | structure, plan | Scenes / Threads / Foreshadowing | Structure |
| Scene | Write | manuscript editor | Context / Candidates / Validation / Dependencies | Structure |
| Candidate | Review | compare, diff | Evidence / Impact / Validation | Impact |
| Commit | Review | commit detail, change | Provenance / Impact / Audit | Impact |
| Analysis | Analyze | impact, consistency report | Affected Objects / Findings / Repair Proposals | Impact |
| Target Span | Write or Review | span editor or span provenance | Context / Candidates / Validation | Structure |
| Proposal | Design | proposal workbench | Open Questions / Provenance / Adoption Preview | Semantic |
| Change Set Revision | Review | revision content, diff | Validation / Approval / Impact / Gate | Impact |
| Process | Explore | Process Center | Run Plan / Progress / Checkpoints / Failures | Process |

Contract rules:

- Resolution is deterministic for the same object, policy, and state.
- A resolved Focus carries exactly one primary surface.
- Deeper objects never invent a new navigation paradigm; they reuse the shell, Focus Bar, and panels.
- A Proposal is an independent design artifact, reachable without becoming Canon and without entering a
  commit flow.

---

## 6. Working Surface

### 6.1 Definition

```text
Working Surface = render(Focus, Narrative State, Derived Projections)
surfaceFor(Object, Mode) -> exactly one surface kind
```

The Working Surface is a function, not a composable layout canvas. Two objects of equal rank are never
shown as co-primary.

### 6.2 Surface Rules

- The surface renders the focused object plus its Mode-appropriate actions.
- Canonical-mutating actions are presented as actions on a proposal, a revision, or a commit, never as
  a direct edit of canonical text.
- Every surface that shows derived content marks its staleness or degraded state.
- Every surface states, on demand, why it is the current surface.

### 6.3 Seven Surface Mapping

| # | Subdomain | Entry | Default Focus | Default Mode | Primary Working Surface | Context Panels | Available Actions | Attention Behavior | Navigation Relationship |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Workspace Shell + Navigation | Identity Bar, Lens Rail | last session Focus, else Novel | per object | none (frame) | none | Lens switch, Search, Command, Pin, Focus stack | overlay only | defines resolution for all others |
| 2 | Structure / Scene Write | Structure Lens | Novel, Arc, Chapter, or Scene | Write on Scene | manuscript editor | Context / Candidates / Validation / Dependencies | edit span, create candidate, request generation, open analysis | scene-local findings surface as badges | zoom in to Span, zoom out to Chapter |
| 3 | Proposal / Adoption / Validation / Commit | Proposal or Candidate entry | Candidate or Change Set Revision | Review | compare and diff | Evidence / Impact / Validation / Gate | adopt, edit, reject, regenerate, revalidate, commit | gate blockers appear as attention items | commit opens the Commit object; commit detail is never replaced by the candidate surface |
| 4 | Story Foundation | Identity Bar, Semantic Lens | Story Foundation | Design | five-direction skeleton + proposals | Proposals / Open Questions | choose entry mode, create proposal, explore, adopt partially | open questions surface non-blocking | proposal opens into subdomain 3 |
| 5 | Process Center | Process Lens or Identity Bar | Process | Explore | Process Center | Run Plan / Progress / Checkpoints / Failures / Usage | plan, approve plan, start, pause, resume, cancel, retry, decide checkpoint | failures and human checkpoints surface as attention items | a checkpoint may emit a Focus transition into subdomain 3 |
| 6 | Narrative State | Temporal Lens, Position Scrubber | Novel or Story Position | Explore or Analyze | state at position | Canon / Plan / State / Derived layers | navigate position, pin object, open owning object | stale or conflicting state surfaces as attention | aligning a state to a Scene moves Focus, never rewrites state |
| 7 | Recall / Attention | Attention Layer, Novel overview | Novel | Explore | attention digest and item detail | Evidence / Source Object / Re-check | inspect, dismiss, snooze, confirm, ignore, why | is the attention layer | opening an item resolves a Focus; disposition never navigates |

---

## 7. Context Panels

### 7.1 Derivation

```text
Context Panels = derive(Object, Mode, Lens, Narrative State, Dependencies)
```

Each panel declares its derivation source and can answer why it is present. Panels are ordered by the
resolved Lens, then by relevance to the current Task.

### 7.2 Panel Classes

```text
Provenance    where this content came from
Evidence      what supports a claim, a finding, or a candidate
Impact        what this change touches, at frontier and affected-object summary level
Dependencies  declared and inferred relations
Validation    mandatory / recommended / advisory findings
Candidates    pending proposals relevant to the focused object
Open Questions unresolved decisions, pending work, validation issues, risks, recommendations
Related       adjacent narrative objects reachable in one step
History       revision and audit trail for the focused object
```

### 7.3 Panel Rules

- Panels derive. They never own truth and never become an editing surface for canonical content.
- A panel may be collapsed, hidden, or re-ordered by author preference; that preference is session
  state.
- Full frontier and dependency detail is an advanced diagnostic expansion, not the default.
- A panel that cannot compute its data shows a degraded state, never an empty false success.

---

## 8. Attention Layer

### 8.1 Form

The Attention Layer is a non-blocking overlay:

```text
default    digest and badge, no layout intrusion
expanded   author-initiated side layer or sheet
per item   explanation, evidence, source object, actions
```

### 8.2 Non-Interference Rules

- It never changes Focus, never blocks an action, never gates a commit, and never reorders the Working
  Surface.
- Opening an item is an author navigation action that resolves a Focus.
- Recording a disposition changes attention state only. It never mutates narrative truth, never creates
  a task directly, and never commits.
- Every item is explainable and evidence-backed, and cites its source object and its projection.
- Items are suppressible: dismiss, snooze, ignore, confirm, inspect, ask why.

### 8.3 Relationship to the Pipeline

```text
Recall -> Proposed Action / Action Request -> Production Run Policy -> Task creation decision
```

Recall never directly creates a Task and never executes a Commit.

---

## 9. Process Center

### 9.1 Independence

The Process Center is reached by Process identity and is independent of Focus-driven panels. A Process
is not a Candidate, a Scene, or a Chapter surface.

### 9.2 Contents

```text
Run Plan            plan revision and its approval state
Task Queue          pending, running, blocked, done
Progress            step and attempt level
Checkpoints         run-level coordination points awaiting a decision
Failures / Retry    failure evidence and retry lineage
Usage / Cost        derived operational measures
Policy Decisions    autonomy policy outcomes applied to this run
Human Checkpoints   points where the author must decide
```

### 9.3 Boundaries

```text
Run State       != Narrative State
Checkpoint      != Narrative ReviewDecision
Run completion  != Narrative Commit
```

A Process may emit a Focus transition, for example a human checkpoint that focuses the Candidate under
review. That transition is navigation only; the narrative decision is still made through Validation,
Approval, and Commit.

### 9.4 Presentation

- Run status, step status, attempts, and failures are derived projections over run history.
- The interface never shows run state as narrative canon and never renders it inside a manuscript
  surface as narrative content.
- Operational measures are derived and must show their as-of time.

---

## 10. Structure / Scene Write

### 10.1 Structural Navigation

```text
Novel -> Arc -> Chapter -> Scene -> Target Span
```

The author browses this structure through the Structure Lens. Structural navigation is a query and
resolution capability, not a rendering detail: listing the arcs, chapters, and scenes of a novel and
resolving a scene or span target are required application capabilities.

### 10.2 Scene Write Surface

Under Write mode the Scene Working Surface is a manuscript editor.

```text
primary   scene manuscript text, or a focused target span
panels    Context / Candidates / Validation / Dependencies
actions   edit text, select span, request generation, inspect candidate, open analysis
```

### 10.3 Target Span

A target span is addressed by scene revision plus stable anchor metadata plus content hash. Selecting a
span, resolving it after edits, and recognizing a drifted anchor are product-visible behaviors.

```text
resolvable  the span maps to the current scene revision
drifted     the anchor no longer matches the scene revision
missing     the anchor cannot be resolved
```

### 10.4 Editing Is Never a Direct Canonical Write

Author edits produce a new candidate revision, or a change inside the proposal and change flow.
Canonical manuscript text changes only through Validation, Approval where required, and Commit.

### 10.5 Required Capabilities (capability level only)

```text
structural navigation query    list Novel / Arc / Chapter / Scene
scene and manuscript read      open a scene and its current text revision
target span resolution query   resolve and validate a span against a scene revision
manuscript change request      produce a proposed change, not a canonical write
```

---

## 11. Candidate Review / Commit Review

### 11.1 Candidate Review Surface

Review mode answers which changes should be adopted and what narrative semantics they carry, not merely
which text reads better.

```text
primary   compare and diff
panels    Generation Provenance / Impact Evidence / Validation Evidence
actions   adopt, edit, reject, regenerate
```

### 11.2 Compare

```text
Candidate A vs Pinned Base Version
Candidate B vs Pinned Base Version
Candidate A vs Candidate B
```

The pinned base version is the candidate basedOnVersionSet. When current canon differs from the
candidate base, the interface shows Canon Drift so the author can distinguish what the candidate
changed from what changed afterwards.

### 11.3 Partial Adoption

Partial adoption is first-class: per-change adopt, edit-then-adopt, or reject. The resulting Change Set
becomes the validation target, because accepting text while rejecting state changes alters overall
semantics.

### 11.4 Validation Presentation

```text
Mandatory / Recommended / Advisory
per finding: What, Why, Evidence, Scope, Severity, Suggested Action, Affected Object
```

A recommended check that proves a mandatory risk upgrades to mandatory and blocks commit.

### 11.5 Commit Gate Presentation

Before commit the interface shows what will be committed, which typed target, which Change Set
Revision, mandatory validation status, required approval status, optimistic concurrency status, and
target-specific invariant status.

```text
Blocks commit:   mandatory validation failed, required approval missing,
                 optimistic version conflict, target invariant violated
Does not block:  advisory finding, potential risk, optional validation not run,
                 author-deferred non-blocking issue
```

### 11.6 Commit Review Surface

After commit, the Commit object is a Review-mode surface showing the committed change, provenance,
impact, and audit trail. Commit detail is never replaced by the candidate surface, and a candidate is
never presented as committed.

### 11.7 Retry / Re-run / Edit Are Visibly Distinct

```text
Retry   same GenerationTask, new Execution Attempt
Re-run  new GenerationTask
Edit    new Candidate Revision, no new Attempt
```

### 11.8 Reject Is First-Class

```text
Reject -> Review Decision -> Reason -> Audit Evidence -> Candidate retained -> no Canon mutation
```

Reject never silently deletes. Partial adoption decisions retain their evidence too.

---

## 12. Story Foundation

### 12.1 Entry

```text
Idea            the author begins from one sentence
Existing Text   the author brings existing material
Blank           the author starts from an empty narrative state
```

Story Foundation is a creation entry and a design surface. It is not a wizard, not Canon, not the
manuscript, and not a mandatory gate.

### 12.2 Surface

```text
primary   five-direction skeleton and proposals
panels    Proposals / Open Questions
actions   choose entry mode, create proposal, explore, deepen, refine, adopt partially
```

### 12.3 Direction Model

```text
Story Concept / Core Conflict / World Direction / Protagonist Direction / Main Plot and Story Engine
```

Directions are design decisions held as proposals, not canonical facts. A direction may remain open
indefinitely.

### 12.4 Partial Adoption

The author may adopt part of a proposal. Unselected parts remain in the proposal with their disposition
recorded, and the adoption path continues into subdomain 3.

### 12.5 Boundaries

```text
Foundation != Canon
Foundation != Manuscript
Foundation != mandatory workflow step
Foundation adoption -> Change Set -> Validation -> Approval -> Commit
```

---

## 13. Narrative State

### 13.1 Presentation by Author Question

```text
Author Question -> Narrative Object -> Contextual Presentation -> Underlying Domain Records
```

Domain records never become first-class pages. There is no StateRecord page, no CanonicalFact page, no
Memory page, and no KnowledgeState page.

### 13.2 Four Semantic Layers

```text
Identity / Canon   confirmed facts and definitions
Plan               future intent, not yet Canon
State              position-aware state at a story position
Derived            summaries, inference, suggestions, memory, analysis
```

```text
Plan          != Canon
Derived       != Canon
Current State != Global Canon
```

### 13.3 Position Scrubber

The Position Scrubber is the core product entry for story state. The author moves along story position
and observes character, world, relationship, knowledge, and plot state at that position.

```text
past state / current story position / future planned state remain distinguishable
```

### 13.4 Alignment With Structure

State aligns to Scenes, Chapters, and Arcs by position. Aligning a state view to a Scene changes Focus.
It never rewrites state and never merges Plan into Canon.

### 13.5 Editability

```text
directly editable   Plan-layer intent, proposals, and design content
read-only           Canon facts in canonical form, Derived output, run and audit state
indirect only       Canon changes, which must pass Validation, Approval, and Commit
```

### 13.6 Required Capabilities (capability level only)

```text
narrative state by position query   character / world / relationship / knowledge / plot at a position
layer resolution query              separate Canon, Plan, State, and Derived for a focused object
staleness and degraded indicators   derived layers expose their as-of state
```

---

## 14. Recall

### 14.1 Pipeline

```text
Observe -> Detect -> Classify -> Prioritize -> Surface -> Explain -> Author Action -> Re-check
```

### 14.2 Required Properties

```text
Non-blocking      never interrupts or gates work
Explainable       every surfaced item states why
Suppressible      dismiss, snooze, ignore, confirm
Evidence-backed   every item cites its source and evidence
Derived           rebuildable, never a second truth
```

### 14.3 Prohibitions

```text
Recall -> Direct Commit              forbidden
Recall -> Direct Narrative Mutation  forbidden
Recall -> Workflow Controller        forbidden
```

### 14.4 Author Actions

```text
inspect / dismiss / snooze / confirm / ignore / ask why
confirm as Dependency integrates an item into declared Dependency facts
```

### 14.5 Surface

```text
attention layer   digest and non-blocking items
novel overview    attention summary as one block among others
object panels     object-scoped attention as a derived panel
```

### 14.6 Required Capabilities (capability level only)

```text
recall attention projection query   items for a novel with evidence and explanation
attention disposition command       record inspect / dismiss / snooze / confirm / ignore / why
recall source observation           dependency, impact, validation, review decision,
                                    narrative commit, run signals, narrative, memory
```

---

## 15. Responsive / Interaction Principles

### 15.1 Desktop-First, Not Desktop-Only

Long-form creation needs width, so the design targets desktop first. It must remain coherent, not
merely functional, at narrow widths and on small screens.

### 15.2 Region Behavior Under Narrowing

```text
wide     full shell: identity, lens rail, focus bar, surface, panels, attention
medium   lens rail collapses to an icon rail; panels become a collapsible drawer
narrow   one region at a time: surface primary, lens and panels become overlays
```

Rules:

- The Working Surface is the last region to lose space and the first to gain it.
- The Attention Layer never covers the surface's primary action.
- Text must fit inside its container at every supported width; nothing overlaps and nothing clips.
- Fixed-format elements keep stable dimensions so labels, badges, and states cannot shift layout.

### 15.3 Interaction Principles

- Controls use the affordance that matches their semantics: toggles for binary settings, segmented
  controls for modes, menus for option sets, and labelled icons for commands.
- Destructive or canonical actions are never a single accidental click; they state their consequence.
- Every state-changing action is reversible or explicitly confirmed.
- A disabled control states its unmet precondition instead of failing silently when used.

---

## 16. Empty / Loading / Error / Disabled / Success States

### 16.1 State Set

Every surface and panel implements:

```text
loading    the request is in flight
empty      the request succeeded and there is genuinely nothing
error      the request failed, with a retry path
disabled   a precondition is unmet, with the precondition named
success    the request succeeded with content
degraded   derived data is stale, partial, or unavailable
```

### 16.2 Rules

- Empty is never used to represent failure, and failure is never shown as empty.
- Degraded is a first-class state for derived content: stale evidence, a missing projection, and an
  unresolvable fingerprint all surface as degraded rather than as empty or success.
- Errors distinguish author-correctable problems from system failures.
- Success states confirm what changed, not merely that something happened.
- A surface never reports success for a state that was only partially applied.

---

## 17. Application Capability Dependencies

This section establishes the dependency from interface intent to application capability. It does not
define DTO fields or API parameters.

```text
UI Intent -> Required Application Capability -> Required Query / Command -> Status Today
```

| UI Intent | Required Capability | Nature | Status Today |
| --- | --- | --- | --- |
| Structure lens tree | structural navigation query (Novel / Arc / Chapter / Scene) | query | missing |
| Enter a scene | scene read and manuscript revision read | query | partial, no listing or read surface |
| Select a target span | target span resolution query | query | missing |
| Write or rewrite manuscript | manuscript change request through proposal / change / commit | command | backend present, no product contract |
| Position scrubber | narrative state by position query | query | missing |
| Object entry resolution | object resolution plus default mode policy | query and policy | missing |
| Universal search | cross-object locate query | query | missing |
| Command palette | action availability plus command invocation | query and command | partial, commands defined but no availability surface |
| Candidate review | candidate and generation provenance query | query | missing |
| Compare and diff | change set revision diff query | query | domain present, no read surface |
| Validation presentation | validation run and findings query | query | missing |
| Impact presentation | dependency and impact read query | query | persisted, not exposed to the product |
| Commit gate presentation | commit eligibility evaluation query | query | present in domain |
| Commit review | commit, provenance, and audit query | query | partial, event listing exists |
| Foundation surface | foundation projection query plus proposal workflow commands | query and command | partial |
| Process Center | run, plan, approval, checkpoint, attempt, and usage queries | query | partial, run status only |
| Recall attention | recall attention projection query plus disposition command | query and command | partial, impact source only |
| Attention layer aggregation | cross-object attention aggregation | query | missing |
| Novel overview | novel-level summary projection | query | missing |
| Autonomy policy display | policy resolution for the current focus | query | missing |

Dependency rules:

- No interface capability may be implemented by inventing a new narrative truth. Every listed query
  projects existing canonical or derived state.
- Missing capabilities are prerequisites, not interface details. The implementation roadmap must
  interleave them with the interface work rather than deferring them to a later backend phase.
- Capability naming here is intentionally at capability level. DTO and parameter design belongs to the
  implementation roadmap.

---

## 18. Pending Semantics Closure

Three areas were recorded as pending by the Product and Experience Design baseline. They are closed
here to the level required to support product interaction and application contract planning. No
database fields, DTOs, or API parameters are defined.

### 18.1 Production Run / Run Plan / Checkpoint

```text
What it is
  Run Plan            the author's intended execution baseline for a Novel
  Run Plan Revision   an immutable revision of that baseline
  Run Plan Approval   the author's decision that a specific revision may be executed
  Run                 one execution instance of one approved Run Plan Revision
  Checkpoint          a run-level coordination point where execution pauses for a decision

Ownership
  owned by the Production Run context; it orchestrates and never owns Narrative Truth

Who reads it
  the Process Center, and any surface that needs execution status for context

Who modifies it
  run lifecycle commands: plan, approve plan, start, pause, resume, cancel, retry
  checkpoint decisions, made by the author or by declared run policy

How it is presented
  the Process Center run surface, plus non-blocking progress and failure attention items

What is derived
  progress, step and attempt status, cost and usage measures, failure summaries

Source of truth
  the current Run revision and its plan approval; narrative truth remains with the Novel engine

Explicit separations
  Checkpoint       != Narrative ReviewDecision
  Run completion   != Narrative Commit
  Run state        != Narrative State
  a checkpoint may emit a Focus transition, but the narrative decision still flows through
  Validation -> Approval -> Commit
```

### 18.2 Story Foundation Projection

```text
What it is
  an aggregation and presentation view of a Novel's creation entry state:
  entry session, five-direction skeleton, proposal set, open questions, adoption state

Ownership
  a projection derived by the Story Foundation context; it is not an aggregate

Who reads it
  the Story Foundation surface, the Novel overview, and Recall as one observation source

Who modifies it
  nobody modifies the projection. Changes go through foundation commands: create proposal,
  advance proposal, adopt. Those produce NarrativeProposal or AdoptionDecision revisions.

How it is presented
  a five-direction skeleton with per-direction proposal state, a proposal list by stage,
  open questions, and partial adoption visibility

What is derived
  skeleton completeness, proposal aggregation, open-question counts, adoption readiness

Source of truth
  NarrativeProposal revisions and AdoptionDecision records, and the Change Set once adoption begins

Explicit separations
  projection  != Proposal Aggregate
  Foundation  != Canon
  Foundation  != mandatory gate
```

### 18.3 Open Questions / Narrative Health / Recall

```text
What it is
  Open Questions    a Novel-level attention projection whose categories are:
                    unresolved decision, pending work, validation issue,
                    potential risk, AI recommendation
  Narrative Health  a derived indicator set describing consistency and completeness signals
  Recall            the pipeline observe -> detect -> classify -> prioritize -> surface ->
                    explain -> author action -> re-check over derived evidence

Ownership
  all three are derived; none owns narrative truth
  attention disposition state is owned by the Recall context and is derived-adjacent
  operational state, never narrative truth

Who reads it
  the Attention Layer, the Novel overview, and object-scoped default panels

Who modifies it
  no narrative content is modified by any of them
  the only writable surface is attention disposition: inspect, dismiss, snooze, confirm,
  ignore, ask why. That changes attention state only.

How it is presented
  a non-blocking attention layer, a novel overview block, and object-scoped panels
  every item carries explanation, evidence, source object, and staleness

What is derived
  all items, categories, priorities, explanations, health indicators, and question aggregations

Source of truth
  the underlying proposals, change set revisions, validation runs, review decisions, narrative
  commits, dependency relations, impact analyses, memory projections, and run signals

Explicit separations
  attention item    != narrative truth
  disposition       != narrative mutation
  health indicator  != canon status
  recall            != workflow controller
```

---

## 19. Explicitly Deferred Work

Deferred to implementation design or later phases:

```text
Pixel-level layout and visual design
Component inventory and design tokens
Motion and transition design
Full keyboard map and shortcut set
DTO fields and API parameter design
Database fields and indexes
Provider-specific AI integration
Retrieval and embedding infrastructure
Advanced validator catalog
Cost optimization mechanics
Accessibility audit and remediation
  (accessibility principles remain in scope; the formal audit does not)
Multi-author, teams, real-time co-editing, publishing
```

These remain deferred unless the dependency graph proves a boundary is a prerequisite for
implementation.

---

## 20. Architecture / UX Review Checklist

```text
Workspace is not a Domain Aggregate                        PASS
View Context separated from Generation Context             PASS
Navigation resolves Focus, never page switching            PASS
Exactly one primary Working Surface per Focus              PASS
Lens changes observation, not object or mode               PASS
Context Panels derived and explainable                     PASS
Attention Layer non-blocking and non-controlling           PASS
Process Center independent of Focus-driven panels          PASS
Run State separated from Narrative State                   PASS
Checkpoint separated from ReviewDecision                   PASS
Object Entry Contract deterministic                        PASS
Semantic Zoom preserves Lens / Pinned / session state      PASS
Canonical mutations visibly routed through the pipeline    PASS
Derived layers expose staleness and degraded state         PASS
No StateRecord / CanonicalFact / Memory / Knowledge pages  PASS
Recall cannot commit, mutate, or control workflow          PASS
Seven subdomains mapped into one model                     PASS
Pending semantics closed at interaction level              PASS
Capability dependencies established at capability level    PASS
No contradiction with Frozen Domain                        PASS
No contradiction with Productionization Architecture       PASS
```
