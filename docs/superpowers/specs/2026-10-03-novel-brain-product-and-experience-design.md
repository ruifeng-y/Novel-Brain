# Novel Brain Product & Experience Design Baseline

## Status

```yaml
Design Status:
  Design Baseline: Accepted
  Product / Experience Architecture: Confirmed
  Cross-cutting Semantics: Confirmed
  Aggregate / Reference / Projection Boundaries: Confirmed
  Entity-level Detailed Schema: Pending
  Known Clarifications: 5 recorded (see Section 4.2)

Document:
  Date: 2026-10-03
  Scope: Product, experience, consistency, runtime, and evidence architecture
  Predecessor: docs/superpowers/specs/2026-10-02-novel-brain-design.md (Core Engine)
  Successor: Entity Brainstorming -> Final Design Spec Revision -> writing-plans
```

This document consolidates the confirmed product and experience design for Novel Brain. It is the stable context baseline for the next phase of entity-level brainstorming.

It deliberately does **not** lock:

- final database fields
- aggregate internal fields
- table structures
- API DTOs
- indexes
- ORM models
- concrete implementation classes
- UI visual design
- MVP or phase slicing

Those belong to later phases. This document locks semantics, boundaries, relationships, responsibilities, and interaction principles.

---

## 1. Product Principles

### 1.1 Positioning

Novel Brain is an AI-native long-form novel creation and production system.

It serves both mature novelists and people with no formal writing experience who begin from a single idea. It is not an AI editor, not an AI writing copilot, and not an AI agent console. It is the system that carries a story from Idea to Long-form Novel.

### 1.2 Two User Types, One Product

Novel Brain serves two user types with one product:

- Mature authors who already have worldbuilding, characters, plot, outline, or manuscript.
- New authors who may have only a one-sentence idea.

They share the same Workspace, the same Narrative Object model, and the same Proposal / Adoption / Validation / Commit pipeline. They differ only in:

- initial Narrative State source
- initial Focus
- AI Assistance Level
- existing assets

There is no separate beginner product and professional product.

### 1.3 AI Is a Co-Creator, Not the Authority

AI is a creation collaborator and production executor. It is not the narrative authority.

```text
AI Proposal
-> Candidate
-> Validation
-> Approval / Policy
-> NarrativeCommit
-> Canonical Narrative State
```

AI output never writes directly to Canonical Narrative State.

### 1.4 Author Sovereignty

The author always holds final decision authority. The author may accept, edit, reject, branch, merge, defer, skip, or create directly.

AI Recommendation is never Workflow Enforcement.

### 1.5 Canonical Safety Floor

Autonomy, cost pressure, convenience, or UI shortcuts may never weaken:

- Domain Invariant
- Mandatory Validation
- Required Approval
- Optimistic Concurrency Control
- Commit Safety

### 1.6 Dynamic Comprehensive Creation Space

The product is not Manuscript-first, not AI-first, and not Narrative-State-first. The current working space is determined by:

```text
Author Goal
+ Creation Stage
+ Narrative State
+ AI Assistance
+ Production State
```

### 1.7 From Reactive Assistance to Active Narrative Awareness

The core leap from a small-scale AI writing tool to a million-word system is not more pages. It is the shift from:

```text
Reactive: author asks -> AI responds
```

to:

```text
Active: system observes -> detects -> recalls -> explains
        -> author decides -> system revalidates
```

### 1.8 Single-Author Domain

Multi-author collaboration is not part of the current core domain. Teams, organizations, real-time co-editing, presence, CRDT, and OT are excluded. Multi-user web infrastructure exists because multiple authors each use the platform independently.

### 1.9 No Second Narrative Truth

Every projection, view, summary, health report, recall signal, and audit chain is derived. None may become a second source of narrative truth.

---

## 2. Confirmed Architecture and Experience Decisions

### 2.1 Product and Creation Model

#### 2.1.1 Dynamic Comprehensive Creation Space

The product metaphor is a dynamic comprehensive creation space, not a fixed editor, not a fixed AI console, and not a fixed narrative-state UI.

```text
Author Goal
+ Creation Stage
+ Narrative State
+ AI Assistance
+ Production State
-> Current Working Space
```

The same story may present a different working space at different stages:

- Idea stage: Idea, brainstorm, story builder.
- Worldbuilding stage: world, rules, characters, relationships.
- Plot stage: plot, outline, foreshadowing, threads.
- Writing stage: manuscript, chapter, scene editor, AI writing.
- Revision stage: scene or chapter, candidates, diff, validation.
- Consistency investigation: impact analysis, dependency, affected objects, repair proposals.

This is a set of examples, not a linear pipeline.

#### 2.1.2 Story Foundation v1

Story Foundation is a creation entry point and aggregation view, not a one-time wizard, not a giant story draft aggregate, and not a completion gate.

When the author provides only a one-sentence idea, Novel Brain immediately produces a five-dimensional narrative skeleton rather than requiring a long questionnaire and rather than deciding the whole novel.

```text
Story Foundation v1
1. Story Concept
2. Core Conflict
3. World Direction
4. Protagonist Direction
5. Main Plot / Story Engine
```

Each dimension is a Narrative Proposal and is independently editable, branchable, comparable, partially adoptable, rejectable, skippable, and regenerable.

Optional, collapsed-by-default suggestions may include:

```text
Potential Themes
Potential Plot Threads
Potential Foreshadowing
Possible Ending Directions
Potential Relationships
Long-form Direction
```

Story Foundation v1 must not produce, by default:

```text
complete character roster
complete world encyclopedia
detailed power system
complete timeline
complete outline
Arc / Chapter / Scene plan
manuscript text
```

Long-form viability is a hidden design constraint applied while generating Core Conflict and Main Plot / Story Engine, not a module the author must complete.

Story Foundation must preserve undecided space and distinguish:

```text
Already Decided
AI Suggested
Author Preference
Open Question
Undecided
```

#### 2.1.3 Adaptive Navigation

After Story Foundation, the creation model is adaptive navigation, not a fixed pipeline.

```text
Current Narrative State
+ Author Current Goal
+ Open Questions
+ Dependencies
+ Conflicts
+ Readiness
-> AI Suggested Next Focus
-> Author Chooses Freely
-> Narrative Evolution
-> New Recommendations
```

Constraints:

- Recommendation is never workflow enforcement.
- Every recommendation must explain What, Why, Affected Areas, and Expected Benefit.
- Maturity is expressed as Readiness for a task, not as a completion percentage.
- The author may jump, skip, go back, and redesign.
- The creation process is a continuously evolving narrative graph, not a one-way pipeline.

#### 2.1.4 Adaptive Proposal Workshop

Adaptive Proposal Workshop is the general AI co-creation interaction model for Character, World, Plot, Outline, Foreshadowing, Relationship, Story Revision, and Consistency Repair. It is not a new-author wizard.

```text
Frame
-> Explore
-> Deepen
-> Refine
-> Adoption
```

Frame clarifies the decision context:

```text
What
Why
Impact
Current State
Open Questions
Dependencies
Options
```

Explore selects multi-direction exploration or single-solution deepening based on openness and author intent. It supports whole-proposal, section-level, and question-level exploration.

Deepen produces a partially adoptable Proposal. Refine supports edit, compare, branch, merge, explain, challenge, impact simulation, and alternative proposals.

Both AI-driven entry and author-driven entry are valid.

#### 2.1.5 Typed Adoption Model

Typed Adoption is the unified mechanism from Proposal to Narrative State. It replaces per-object adoption workflows.

```text
Narrative Proposal
-> Adoption Decision
-> Adoption Target
-> Proposed Change
-> Target-specific Validation / Approval
-> NarrativeCommit
-> Target Domain State
```

Adoption Target Type:

```text
Canonical Fact
Plan
Structure
Manuscript Change
StoryState Change
```

Key rules:

- Manuscript and StoryState are separate target types.
- Plan and Structure are separate: Plan is future intent, Structure is current organization.
- Validation Requirement binds to the Adoption Target, not to the whole Proposal.
- One Proposal may produce one to many Adoption Targets, each with its own scope, dependency set, validation policy, approval requirement, and provenance.
- Adoption and Commit remain separate.
- Partial Adoption is a first-class capability.
- A Proposal does not have to end in Canon.

#### 2.1.6 Narrative State Bootstrap

Narrative State Bootstrap is the unified abstraction for three entry types:

```text
From Idea          -> AI Generation  -> Story Foundation
From Existing Text -> AI Extraction  -> Derived / Proposal
From Blank         -> Author-driven  -> Empty Narrative State
```

Bootstrap is initial state construction, not a mandatory setup workflow. It may be incremental, partial, re-run, object-scoped, chapter-scoped, or question-scoped.

Rules:

- Author-provided manuscript is author-owned source and may be committed as Canonical Manuscript with `Source = Author` provenance.
- AI extraction from existing text is Derived or Proposal by default and is never automatically Canon.
- Unreviewed extraction may be used as Derived Context only when Generation Policy permits, and must be labeled non-authoritative with extraction version and confidence.
- Bootstrap never bypasses Adoption / Validation / Commit.
- Readiness is advisory, not a workflow gate.
- AI Assistance Level is a configurable policy and is not bound to user type.
- Unified product abstraction does not require an identical internal pipeline; further bootstrap sources may be added without changing the Workspace, Narrative Object model, Adoption, Validation, or Commit.

### 2.2 Workspace and Information Architecture

#### 2.2.1 Workspace Model

```text
Novel Workspace
├── Workspace Shell (stable)
├── Working Surface (Focus-driven)
├── Contextual Panels (derived)
└── Attention Layer (non-blocking)
```

```text
Shell = Stable
Working Surface = Dynamic
Contextual Panels = Dynamic
Attention Layer = Non-blocking
```

Focus is the core Workspace state:

```text
Focus
├── Object
├── Mode
└── Task (optional)
```

```text
Working Surface   = render(Focus, Narrative State)
Contextual Panels = derive(Focus, Narrative State, Dependencies)
AI Assistance     = adapt(Focus, Mode, Task)
```

Every dynamic decision must be explainable: why this surface, why this panel, why AI Assistance is active, why these candidates or findings appear.

Context preservation uses:

```text
Focus Stack       = Session Navigation History
Breadcrumb Trail  = Navigation Path Projection
Pinned Context    = Workspace Preference
Derived Context   = Rebuilt from Focus + Narrative State
```

Rules:

- Focus Stack is navigation history, not domain hierarchy.
- Breadcrumb is not domain ownership, dependency, or narrative structure.
- View Context is derived and rebuildable, never a second truth.
- View Context and Generation Context are different: View Context is dynamic, Generation Context is immutable, versioned, and attempt-scoped.
- Pinned Context is a Workspace preference and never directly changes Narrative State, Dependency, or Generation Context.
- Focus change never discards the previous Focus, resets Pinned Context, or forces a workflow step.

#### 2.2.2 Web Workspace Information Architecture

Persistent Navigation is a set of Navigation Lenses, not a module list:

```text
Structure   Arc -> Chapter -> Scene
Semantic    characters / rules / threads / foreshadowing / facts
Temporal    timeline / story position
Thread      plot threads and foreshadowing lines
Impact      impact and dependency relations
Process     long-running processes and tasks
```

```text
Lens   = Observation Dimension
Focus  = Observation Target
Mode   = Work Semantics
Panels = Derived Context
```

Rules:

- Any navigation entry resolves a target and changes Focus; navigation is not page switching.
- Lens change preserves Focus and Pinned Context; if the Focus cannot be represented in the new Lens, resolve the nearest valid containing or related Focus instead of returning home.
- Universal Command / Search is a first-class capability and does not require going through a Lens. Lens Navigation browses, Universal Search locates, Command acts.
- At million-word scale, Universal Search and Jump are the primary high-speed location path, not an auxiliary feature.
- Semantic Zoom (Novel -> Arc -> Chapter -> Scene -> Target Span) is a Working Surface capability and preserves Lens, Pinned Context, and session state.
- Object Entry Contract: any entry point opening the same object converges on the same Object + Resolved Mode + Context + Policy, rather than one UI per entry path.

First-version Object Entry Contract:

| Object | Default Mode | Main Surface | Default Panels |
| --- | --- | --- | --- |
| Novel | Explore | overview, health, current state | Attention / Recent / Health |
| Story Foundation | Design | five-dimensional skeleton, proposals | Proposals / Open Questions |
| World / Character / Plot | Design | object content, proposals | Dependencies / Related Objects / Open Questions |
| Arc / Chapter | Design | structure, plan | Scenes / Threads / Foreshadowing |
| Scene | Write | manuscript editor | Context / Candidates / Validation / Dependencies |
| Candidate | Review | compare, diff | Evidence / Impact / Validation |
| Commit | Review | commit detail, change | Provenance / Impact / Audit |
| Analysis | Analyze | impact, consistency report | Affected Objects / Findings / Repair Proposals |

Object and Mode compatibility is policy-governed; not every object supports every mode.

Each Focus has exactly one primary Working Surface. Mode is a first-class dimension of the surface: the same Scene in Write mode is an editor, in Analyze mode is a dependency and impact view.

Process Center is independent of Focus-driven panels:

```text
Process Center
├── Run Plan
├── Task Queue
├── Progress
├── Checkpoints
├── Failures / Retry
├── Usage / Cost
├── Policy Decisions
└── Human Checkpoints
```

A Process may emit a Focus transition (for example, a checkpoint requiring review focuses a Candidate), but a Process is not itself a Candidate, Scene, or Chapter surface.

#### 2.2.3 Narrative State Product Presentation

Narrative State is presented by author question, not by domain record type.

```text
Author Question
-> Narrative Object
-> Contextual Presentation
-> Underlying Domain Records
```

Each Narrative Object view uses four semantic layers:

```text
Identity / Canon    confirmed facts and definitions
Plan                future intent, not yet Canon
State               position-aware state at a story position
Derived             summaries, inference, AI suggestions, memory, analysis results
```

```text
Plan ≠ Canon
Derived ≠ Canon
Current State ≠ Global Canon
```

Position Scrubber is the core product entry for StoryState. The author can move along story position and see character state, world state, relationship state, knowledge state, and plot state at that position. Past state, current story position, and future planned state must remain distinguishable.

Domain records do not become first-class pages. There is no StateRecord page, no Memory page, no CanonicalFact page, and no KnowledgeState page. Records map into Narrative Objects:

| Domain Record | Author-facing form |
| --- | --- |
| CanonicalFact(character_profile) | Character canon layer |
| CanonicalFact(world_rule) | World rule layer |
| CanonicalFact(plot_decision) | Plot thread decided layer |
| StateRecord(character_state) | Character state layer (position-aware) |
| StateRecord(world_state) | World current situation layer |
| StateRecord(timeline_record) | Timeline event point |
| StateRecord(relationship_state) | Relationship matrix (position-aware) |
| StateRecord(knowledge_state) | Knowledge matrix (who knows what, when) |
| StateRecord(unresolved_thread) | Unresolved list, thread state |
| StateRecord(plot_progress) | Plot thread progress |
| Foreshadowing Plan | Foreshadowing line: setup point to payoff point |
| Memory Projection | AI summary, retrieval basis (read-only derived) |
| Dependency Edge | Trace / Locate result, on demand |
| Proposal | Proposal panel |
| Impact Result | Impact report |
| Validation Finding | Validation finding |
| Commit | Version history |

Three edit semantics:

```text
Author Edit      -> Change Set -> required validation -> NarrativeCommit
AI Proposal      -> Typed Adoption -> target-specific validation -> approval -> NarrativeCommit
Derived          -> read-only, never directly editable
```

Light UX is not weak domain safety. Author Edit may feel like edit then apply, but still passes OCC, domain invariant, required validation, required approval, and NarrativeCommit.

Provenance must be visible in the Narrative Object experience: Author, AI, Author-edited AI, Merged from multiple Proposals, System-derived. This maps to Section-level Provenance.

Trace and Locate are common capabilities on major Narrative Objects, backed by Dependency Registry, Impact Query, and Narrative Structure, and expanded on demand rather than showing a full dependency graph by default.

Open Questions is a Novel-level attention projection, not a new domain truth. It distinguishes Unresolved Decision, Pending Work, Validation Issue, Potential Risk, and AI Recommendation. Each item can resolve to Source Object, Source Evidence, and Focus.

Six core Narrative Object views:

```text
Character       Identity/Canon, State, Relationships, Knowledge, Appearances, Growth, Trace
World           Rules, Factions/Geography, Current State, Affected Objects, Trace
Plot Thread     Canonical Decisions, Plan, Progress, Related Foreshadowing, Open Questions, Trace
Foreshadowing   Setup, Payoff, Plan, Status, Related Thread, Trace
Timeline        Event Sequence, Story Position, Temporal Conflicts, Trace
Novel           Narrative State Summary, Open Questions, Consistency/Health, Active Threads, Timeline Overview, Attention, Recent Activity
```

Narrative State is not shown all at once; relevance is determined by Narrative Object, Focus, Mode, Position, and Author Goal.

#### 2.2.4 Layered Transparency

```text
Default    Narrative Context Summary
Evidence   Source / Reason / Version / Effect
Advanced   Routing / Attempt / Usage / Retrieval / Dependency / Policy
```

Generation Context, Impact Evidence, and Validation Evidence must remain separate:

```text
Generation Context  -> what the AI used to generate
Impact Evidence     -> what the change may affect
Validation Evidence -> why the candidate passed or failed
```

All transparency layers derive from the same immutable Evidence Snapshot. Default UI must not recompute context, Evidence UI must not re-retrieve memory, and Advanced UI must not re-run impact analysis.

Excluded Context may be shown as What and Why Excluded, without dumping all filtered objects by default.

Candidate comparison dimensions:

```text
Text Diff
Narrative State Impact
Consistency Findings
Context Difference
Risk
```

### 2.3 Long-form Experience

#### 2.3.1 Active Narrative Layer

Long-form experience does not modify the Core Domain or the Workspace shell. It adds a cross-domain Active Narrative Layer built from existing capabilities:

```text
Narrative State
+ Dependency Registry
+ Impact Analysis
+ Validation
+ Memory / Retrieval
+ Process / Scheduling
```

```text
Observe -> Detect -> Classify -> Prioritize -> Surface -> Explain
-> Author Action -> Re-check
```

The Active Narrative Layer is not a new Narrative Truth and not a new Aggregate. It must not introduce a NovelHealth aggregate or a second Active Narrative State.

#### 2.3.2 Recall versus Search

```text
Search = author knows what to find
Recall = system notices what may matter
```

Recall is triggered by current Focus, change, or task, combined with historical narrative evidence and dependency or semantic relations, and surfaces into the Attention Layer with evidence and explanation.

Recall is non-mandatory. The author may open, inspect evidence, run validation, ignore, dismiss, snooze, ask why, or confirm as a Dependency. Recall is never a workflow controller.

#### 2.3.3 Thread and Foreshadowing Ledger

The Ledger is a Narrative Object view, not a new Ledger domain.

```text
Plot Thread     Active / Dormant / Resolved / Abandoned
Foreshadowing   Setup / Planned Payoff / Paid Off / Overdue / Abandoned
```

Surfaced items include:

```text
Setup without Payoff
Payoff without Setup
Long-dormant Thread
Long-unadvanced Thread
Repeated Setup
Potential Abandonment Risk
```

#### 2.3.4 Narrative Health

Health is a Novel-level attention and analysis projection, not a single score and not Canon. It must not present a completion percentage.

```text
Narrative Health
├── Consistency Findings
├── Thread Risks
├── Timeline Conflicts
├── Knowledge Contradictions
├── Unresolved Decisions
├── Validation Findings
├── Potential Risks
└── Recent Changes Requiring Attention
```

Each finding answers What, Why, Evidence, Scope, Severity, and Suggested Action.

Health must not imply absolute global safety. Product may offer Global Consistency Awareness while implementation remains incremental, bounded, dependency-driven, and policy-controlled. Scan state records Last Scan, Scan Policy Version, Covered Scope, Covered Frontier, Known Unscanned Scope, and Staleness, so that "no findings" means "no known findings within the covered analysis scope".

#### 2.3.5 Scheduled and Background Consistency Scan

Scheduled scans belong to the Process Center; their results flow into Narrative Health and the Attention Layer.

Scans use changes since the last scan, the affected frontier, and relevant dependencies, rather than re-scanning the whole novel.

```text
Commit -> Impact Frontier -> enqueue scan -> Validation / Consistency Analysis
-> Findings -> Health Projection -> Attention
```

#### 2.3.6 Coarse-to-fine State Snapshot

```text
Arc-level Snapshot -> Chapter-level State -> Scene-level State -> Fine-grained State
```

Purpose is fast location, navigation, summary, and comparison, not loading the entire novel state at once. Snapshots are Derived Projections, not Canon.

#### 2.3.7 Story-time versus Narrative-time

```text
Story Time     = order in which events actually occur
Narrative Time = order in which the reader encounters them
```

The Timeline product must not equate chapter order with story event order, so that flashback, flash-forward, parallel plot, and non-linear reveal are supported.

#### 2.3.8 Cost Estimation for Large Operations

Before Batch Generation, Large Extraction, Large Consistency Scan, Wide Impact Analysis, or Memory Rebuild, the product provides Estimated Usage, Estimated Cost, Estimated Duration, Scope, and Policy Limits. Author-led mode confirms or adjusts; Autonomous mode lets Policy decide.

Cost control remains in Model Policy, Model Resolver, and Orchestrator, not in the Domain.

#### 2.3.9 Scale Tiers

```text
T1 < 100K        Structure Navigation + Basic Consistency + Local Recall
T2 100K-500K     Arc-level Navigation + Thread/Foreshadowing Ledger
                 + Contextual Recall + Incremental Health Scan
T3 > 500K        Active Recall + Narrative Health + Background Scan
                 + Bounded Impact + Position-aware State
                 + Knowledge Tracking + Cost-aware Large Operations
```

At T3 the key capability is that the author does not need to remember the whole novel; the system carries the cognitive burden of continuous checking and reminding.

### 2.4 Candidate Review

#### 2.4.1 Candidate Review Surface

Candidate Review answers which changes should be adopted and what Narrative State semantics they carry, not merely which AI text is better.

```text
Candidate
-> Review
-> Adoption Decision
-> Change Set
-> Validation
-> Approval if required
-> NarrativeCommit
```

```text
Focus: Candidate
Mode: Review

Candidate Set
├── Working Surface: Compare / Diff, Edit, Adoption
├── Contextual Panels: Generation Provenance, Impact Evidence, Validation Evidence
└── Action Bar: Adopt, Edit, Reject, Regenerate
```

Commit is not a plain candidate edit action. It belongs to Adoption -> Change Set -> Validation -> Approval -> Commit. A shortcut such as Adopt & Commit may exist, but Adoption and Commit remain separate stages internally.

#### 2.4.2 Compare

```text
Candidate A vs Pinned Base Version
Candidate B vs Pinned Base Version
Candidate A vs Candidate B
```

Pinned Base Version is the Candidate basedOnVersionSet. Comparison must not only use Current Canon, because Current Canon may have drifted since the candidate was created. When Current Canon differs from the candidate base, show Current Canon Drift so the author can distinguish what the candidate changed from what changed afterward.

#### 2.4.3 Section-level Edit

```text
Candidate Edit -> New Candidate Revision -> Author Edit Provenance
```

Editing produces no new Execution Attempt. AI-generated, Author-edited, and Merged content remain distinguishable.

#### 2.4.4 Adoption and Change Set

```text
Candidate ≠ Change Set
Candidate  = working artifact
Change Set = the author's intended semantic submission
```

Partial Adoption is first-class:

```text
Change 1 -> Adopt
Change 2 -> Edit -> Adopt
Change 3 -> Reject
```

The resulting Change Set becomes the Validation Target. Validation must run against the resulting Change Set, not the original Candidate, because accepting text changes while rejecting state changes can alter overall semantics.

#### 2.4.5 Validation Presentation

```text
Validation Plan
├── Mandatory
├── Recommended
└── Advisory
```

Each finding exposes What, Why, Evidence, Scope, Severity, Suggested Action, and Affected Object. The author may inspect, edit the candidate, change adoption, or revalidate.

A Recommended check that proves a Mandatory risk upgrades to Mandatory and blocks commit.

#### 2.4.6 Impact Presentation

Default shows Direct, Indirect, and Potential with Frontier and Affected Objects as a summary. On demand, expand to Object, Relation, Evidence, and Propagation Path. Full frontier and dependency detail belongs to advanced diagnostics.

#### 2.4.7 Commit Gate

Before commit, the product shows what will be committed, which Typed Target, which Change Set, Mandatory Validation status, Required Approval status, OCC status, and target-specific invariant status.

```text
Blocks commit:
  Mandatory Validation FAILED
  Required Approval missing
  Optimistic Version Conflict
  Target-specific Invariant violated

Does not block by default:
  Advisory finding
  Potential risk
  Optional validation not run
  Author-deferred non-blocking issue
```

#### 2.4.8 Retry, Re-run, and Edit Semantics

```text
Retry  -> same GenerationTask, new Execution Attempt  -> "same request again"
Re-run -> new GenerationTask                          -> "new generation request"
Edit   -> new Candidate Revision, no new Attempt
```

These three must be visibly distinct in the product.

#### 2.4.9 Reject as a First-class Result

```text
Reject Candidate
-> Review Decision
-> Rejection Reason
-> Audit Evidence
-> Candidate retained
-> No Canon Mutation
```

Partial adoption decisions (Adopt / Edit / Reject / Pending) must also retain decision evidence. Reject must never silently delete.

### 2.5 Autonomous Mode

#### 2.5.1 Core Principle

```text
Autonomous Mode = same Novel Engine + different Decision Authority
```

```text
Co-Creation  -> Human executes Decision Gate
Autonomous   -> Autonomy Policy executes Decision Gate, human intervenes at Checkpoints
```

Autonomous Mode is not a second execution system. There is no AutonomousTask, AutonomousCandidate, or AutonomousCommit. All of GenerationTask, ExecutionAttempt, Candidate, ImpactAnalysis, Validation, ReviewDecision, and NarrativeCommit are reused.

#### 2.5.2 Scoped Autonomy Policy

There is no global Autonomous on/off switch. Autonomy is scoped by Operation Type, Novel Region, and Task, using Author-led / AI-assisted / AI-guided / Semi-autonomous / Autonomous.

The same author may simultaneously run Scene Writing as Author-led, Outline Planning as AI-guided, and Consistency Scan as Autonomous.

#### 2.5.3 Plan, Approve, Execute

```text
Phase 1: Plan
Author Goal -> AI Proposed Run Plan -> Author Review / Adjust -> Plan Approved

Phase 2: Execute
Approved Plan -> Task Queue -> Execution Loop -> Checkpoints
```

The governing principle is that autonomy applies to execution, not to creative intent.

An Approved Run Plan Revision is an immutable execution baseline. Changing it requires a new Plan Revision and re-approval. An approved plan must never be silently mutated and then continue executing.

#### 2.5.4 Execution Loop

```text
Task
-> Routing Decision
-> Execution Attempt
-> Candidate
-> Impact Analysis
-> Validation Plan
-> Validation
-> Decision Gate
-> Commit / Checkpoint / Retry
-> Next Task
```

#### 2.5.5 Decision Gate

Inputs: Validation Outcome, Risk Classification, Impact Scope / Frontier, Reversibility, Autonomy Policy.

Outputs: Auto Commit, AI Review then Auto Commit, Human Approval, Abort Task.

An autonomous decision is a policy-constrained decision, not free AI discretion.

```text
Evidence + Validation + Risk + Impact + Reversibility + Policy
-> ReviewDecision
```

ReviewDecision records `decidedBy = policy | human` and retains Policy Version, Decision Rule, Evidence References, and Decision Reason, so the product can answer why auto-commit happened, which policy applied, what validation showed, and why no human checkpoint occurred.

#### 2.5.6 Checkpoints

```text
Scheduled Checkpoint     every N chapters or N tasks
Risk Checkpoint          high-risk change
Budget Checkpoint        cost threshold
Uncertainty Checkpoint   Validation NEEDS_REVIEW or low confidence
Failure Checkpoint       unrecoverable failure
```

Each checkpoint supports Pause, Inspect, Decide, Resume, and Abort. Waiting for Human is a formal Run Lifecycle state.

#### 2.5.7 Run Lifecycle

```text
Draft -> Planned -> Approved -> Running
                                  ├── Paused
                                  ├── Waiting for Human
                                  ├── Completed
                                  ├── Failed
                                  └── Cancelled
```

Supported: Pause, Resume, Retry, Fallback, Skip Task, Abort Run, Human Intervention.

```text
Retry    -> same Task + new Attempt
Fallback -> new Routing Decision + new Attempt
```

#### 2.5.8 Run-level Rollback

Run-level Rollback is a forward compensation, not a database restore. Original commits are not deleted; a rollback request produces a compensating Narrative Commit.

It may only process commits produced by that run which remain safely reversible, considering commit provenance, current state, OCC, dependency, and subsequent changes. It must not unconditionally restore the world when later author commits exist.

#### 2.5.9 Cost Policy

```text
Run Budget
Task Budget
Attempt Budget
```

Threshold actions: Pause, Checkpoint, Ask Author, Abort.

Cost exceeding budget must never cause skipping validation, skipping approval, or direct commit.

```text
Model Policy   -> budget constraint
Resolver       -> cost-aware selection
Runtime        -> actual usage / cost
Orchestrator   -> threshold action
```

#### 2.5.10 Audit

After a run, the product must answer what happened, which tasks executed, which attempts occurred, which models were selected and why, which candidates were produced, which findings occurred, which decisions were policy-driven versus human-driven, which commits were produced, which failures, retries, and fallbacks occurred, and how much it cost.

All of this is projected from the Generation Audit Chain, ReviewDecision, and NarrativeCommit. No second audit system is created.

#### 2.5.11 Autonomy and Human Control

```text
Autonomous ≠ Human absent
Autonomous ≠ Narrative Authority
```

The human defines and approves intent, sets policy, handles checkpoints, can pause or abort, and can review or roll back. Policy executes decisions inside approved boundaries.

Graduated autonomy is the recommended product experience: start author-led, gradually open low-risk operations, and keep high-risk operations behind human checkpoints. There is no single button that grants full narrative authority.

### 2.6 Consistency and Dependency

#### 2.6.1 Hybrid Impact Analysis Model

```text
Explicit Narrative Dependency Registry
+ Dynamic Impact Query
+ AI Inferred Risk
```

Authority order:

```text
Explicit Dependency   authoritative long-term relation
Dynamic Impact        real-time derived result
AI Suggested Risk     suggestion / risk signal only
```

AI inference is never a canonical dependency.

Dependency and Impact Result are separate:

```text
Dependency    = why A relates to B
Impact Result = whether this change causes B to need re-checking
```

```text
Change -> Changed Objects -> Changed Facts / State
-> Explicit Dependencies + Dynamic Impact Queries + AI Inferred Risks
-> Affected Narrative Objects -> Impact Classification
-> Validation Scope -> Consistency Validation -> Findings -> Repair Proposals
```

Impact Analysis targets Narrative Objects and State Records first; chapters are one user-visible manifestation, not the primary analysis unit.

#### 2.6.2 Source-specific Dependency Lifecycle

Dependency lifecycle is determined by origin, not by one universal state machine.

```text
Structural       -> Derived / Recomputed (automatic, no author confirmation)
Commit-derived   -> Produced / Active (from canonical commit)
Explicit         -> Proposed / Confirmed / Active / Revalidated / Superseded / Retired
AI Suggested     -> Suggested / Confirmed / Rejected (not a dependency until confirmed)
Dynamic Impact   -> analysis result only, never enters the registry
```

Version change is a revalidation trigger, not automatic invalidation:

```text
Revision Changed -> Evidence Potentially Outdated -> Revalidate
-> Active / Superseded / Retired
```

#### 2.6.3 Dependency Family and Relation Type

Two axes, not one flat enum.

```text
Dependency Family   Structural / Participation / Temporal / Causal /
                    Knowledge / Relationship / Narrative / Constraint

Relation Type       contains / belongsTo / precedes / appearsIn / appliesTo /
                    causes / informs / knows / dependsOn / supports /
                    contradicts / setsUp / paysOff / resolves / affects
```

Relations are directed and have inverse definitions, for example contains and belongsTo, precedes and follows, setsUp and isSetupFor, paysOff and isPayoffFor.

Family supports coarse aggregation for impact queries, validation, UI grouping, and analytics. Relation Type carries precise semantics. causes, supports, and affects must not be collapsed into one vague relation.

Narrative Relationship and Dependency Edge are distinct: a narrative relationship describes the story; a dependency edge describes why one object change may require another object to be re-evaluated. Not every narrative relationship becomes a dependency edge.

#### 2.6.4 Three-layer Separation

```text
Layer 1  Persistent Dependency Edge      long-term relation fact
Layer 2  Impact Analysis Result          this change judgment
Layer 3  AI Risk Suggestion              AI inference awaiting review
```

```text
Relationship != Analysis Result != AI Inference
```

Persistent Dependency Edge envelope:

```text
Edge ID
Source Object / Target Object
Dependency Family / Relation Type
Canonical Direction / Inverse Relation
Source Kind (Structural / Commit-derived / Explicit)
Lifecycle State
Version Evidence
Provenance
Last Confirmed / Last Revalidated
```

Impact Score, Impact Level, Affected Objects, Validation Scope, Current Risk, Traversal Depth, and Propagation Result are not stored on the edge; they belong to the Impact Analysis Result.

No universal Weight / Strength / Confidence is defined for all edges, because contains, causes, knows, supports, and precedes are not comparable on one scale. AI Confidence belongs only to AI Risk Suggestion and AI-origin evidence.

#### 2.6.5 Relation Policy Matrix

Commit only automatically produces relations that a Structured Change Set can deterministically prove.

| Structured Change | Source | Target | Family + Relation | Persist |
| --- | --- | --- | --- | --- |
| Arc chapter order change | Arc | Chapter | Structural + contains | yes, structural |
| Chapter scene order change | Chapter | Scene | Structural + contains | yes, structural |
| Scene character state change | Scene | Character State | Causal + updates | yes |
| Scene world state change | Scene | World State | Causal + updates | yes |
| Scene knowledge change | Scene | Knowledge State | Knowledge + informs | yes |
| Knowledge belongs to character | Character | Knowledge State | Knowledge + knows | yes, if subject is explicit |
| Scene relationship change | Scene | Relationship State | Causal + updates | yes |
| Scene timeline change | Scene | Timeline Record | Temporal + updates | yes |
| Scene advances plot thread | Scene | Plot Thread | Narrative + advances | yes |
| Scene resolves plot thread | Scene | Plot Thread | Narrative + resolves | yes |
| Scene establishes foreshadowing setup | Scene | Foreshadowing Plan | Narrative + setsUp | yes |
| Scene fulfills foreshadowing payoff | Scene | Foreshadowing Plan | Narrative + paysOff | yes |
| Character profile revision | Character Revision | related state / scenes | none | no bulk edges; revalidation only |
| World rule revision | World Rule Revision | related characters / scenes | none | no bulk edges; revalidation only |
| Canon fact revision | Canon Revision | other objects | none | no bulk semantic edges; revision evidence only |
| Text-only change | Scene | mentioned objects | none | no automatic semantic edges |
| Explicit author declaration | chosen source | chosen target | declared family + relation | yes, Explicit |

Execution model:

```text
Structured Change -> Relation Policy -> Source/Target Resolution
-> Family / Relation Type -> Deterministic Relation Candidate
-> Validation -> Persist Commit-derived Edge
```

If a relation cannot be directly proven from the Structured Change Set, do not persist it. Route it to Dynamic Impact, Validation Evidence, or AI Suggested Risk.

Multiple structured changes in one commit may produce multiple edges, but each must independently be deterministic, stable, explainable, and useful for future impact analysis. One important commit does not justify bulk semantic edge creation.

#### 2.6.6 Impact Classification and Frontier Propagation

Impact evidence class and propagation distance are separate.

```text
Direct    impact directly proven by this change
Indirect  impact reached through confirmed or explainable relations
Potential impact with insufficient evidence to establish a definite relation
```

```text
Frontier 0  changed objects
Frontier 1  immediate direct relations
Frontier 2+ propagated impact
```

Frontier is propagation distance, not risk level and not evidence strength. Direct / Indirect / Potential must not be hard-bound to specific hop numbers.

Potential impact does not automatically expand Mandatory Validation Scope. It may enter Recommended Validation unless an AI risk is confirmed as a dependency or a Validation Policy explicitly requires checking it.

Propagation is bounded by:

```text
Change Scope
+ Relation Policy
+ Family Policy
+ Horizon Policy
+ Visited Set
+ Risk / Cost Policy
```

Stopping condition: stop when continued propagation produces no new affected object, no new affected state dimension, and no new validation requirement.

Mandatory and Optional propagation are separate. A discovered high risk does not allow other Mandatory checks to be skipped.

```text
Product Scope        = Global Narrative Consistency
Implementation Scope = Bounded Impact Frontier
```

#### 2.6.7 Validation Policy, Validation Plan, and Commit Gate

```text
Change -> Change Classification -> Impact Analysis -> Impact Evidence
-> Validation Policy -> Validation Plan -> Validation Execution -> Commit Gate
```

```text
Validation Plan
├── Mandatory
├── Recommended
└── Advisory
```

Impact Evidence is only an input; it does not directly determine validation level. There is no hard binding of Direct = Mandatory, Indirect = Optional, Potential = Ignore.

```text
Impact Evidence
+ Change Type
+ Relation Policy
+ Target-specific Validation Policy
+ Author / Autonomy Policy
+ Domain Safety Floor
-> Validation Plan
```

Mandatory is defined by whether a violation could break correctness the system must maintain, not by impact class alone. Typical Mandatory cases include canonical fact change affecting canonical state, character state change affecting knowledge/timeline/relationship invariants, scene structure change affecting chapter/arc invariants, plot thread or foreshadowing structured state change, target span must-preserve violation, and stale basedOnVersionSet.

Mandatory Scope must execute completely; discovering high risks does not permit skipping other mandatory checks.

Indirect impact is not inherently optional. Its level is determined by relation semantics, target semantics, and validation policy.

Potential impact and AI risk default to Advisory, and the author may run recommended validation, ignore, ask AI to expand, review evidence, or confirm as dependency.

Author and Autonomy Policy may decide whether Recommended checks run automatically, whether Advisory items are shown, whether non-blocking checks may be deferred, whether autonomous mode expands validation, human confirmation thresholds, and validation depth and cost limits. They may not override the Domain Safety Floor.

Validation Plan entries carry Target, Validation Rule, Reason, Evidence Source, Priority, Blocking, Required/Optional, Policy Version, and Propagation Frontier, so validation is explainable, auditable, replayable, and comparable across policy versions.

Validation Scope and Analysis / Scan Scope are distinct: a wide scan may produce a narrower Mandatory set.

High-impact change triggers a wider Impact Analysis, not unconditional global validation. Global Analysis is not global Mandatory Validation.

```text
Blocks commit:
  Mandatory Validation FAILED
  Required Approval missing
  Optimistic Version Conflict
  Target-specific Invariant violated
```

A Recommended check that proves a new Mandatory risk must be escalated into Mandatory and block commit.

### 2.7 AI Runtime and Evidence

#### 2.7.1 Provider-neutral Runtime

```text
GenerationTask
-> Evidence Snapshot / Context Package
-> Agent Role
-> Model Policy
-> Model Resolver
-> Provider Adapter
-> Runtime Execution
-> Runtime Result
-> Candidate
-> Validation
-> Adoption / Approval
-> NarrativeCommit
```

The Domain Layer depends only on Agent Role, Model Policy, and the Runtime Contract. It never depends on a Provider SDK.

Runtime responsibilities:

```text
Request / Response Normalization
Streaming
Timeout
Retry
Fallback
Cancellation
Usage / Cost
Provider Error Normalization
Execution State
Model Provenance
Runtime Execution Provenance
```

Runtime is not responsible for Narrative State, Canon, StoryState, Context Scope, Dependency, Validation, Approval, or NarrativeCommit.

Context Assembly is not a Runtime responsibility. Context Selection belongs to the Narrative Context Assembly layer, which produces an Evidence Snapshot and a Context Package that Runtime only executes.

Provider events are normalized into Novel Brain Runtime Events:

```text
Started
Delta
StructuredOutputDelta
Usage
Completed
Failed
Cancelled
```

#### 2.7.2 Provider Strategy

```text
Provider Topology        Multi-Provider from Day 1
Provider Integration     incremental
```

A first release with a single provider proves the architecture but does not prove cross-provider fallback readiness. Cross-provider fallback requires two independent providers plus resolver policy.

Provider and model selection criteria group into:

```text
Model Capability       Chinese long-form quality, structured output, long context, tool/reasoning
Runtime Capability     streaming, timeout/retry, cancellation, error semantics
Operational Capability request ID, usage, model version, error detail, observability
Economic Capability    cost, latency, throughput
```

Provider Adapter maps Provider API to the Novel Brain Runtime Contract and must not turn provider-specific output directly into Narrative State, Candidate, Canon, or StoryState.

#### 2.7.3 Agent Role, Model Policy, and Model Resolver

```text
Agent Role     -> who is acting
Model Policy   -> required capabilities and constraints
Model Resolver -> selects Provider and Model
```

Agent Role does not bind a specific model. Policy describes required capabilities (Chinese long-form quality, structured output, streaming, tool calling, context capacity, reasoning depth) and constraints (cost budget, latency target, allowed/blocked providers, output contract, safety requirements).

Resolver input includes Agent Role, Task Type, Task Characteristics, Context Size, Output Contract, Quality Requirement, Cost Constraint, Latency Requirement, and Provider/Model Availability. Task Characteristics should be produced structurally upstream rather than guessed from a prompt.

The same role may use different models for different tasks. Business code must not contain role-to-model or task-to-model branching.

Author model preference enters the Resolver as a Routing Constraint, not as a direct Runtime call. If the requested model violates a hard requirement, the product reports the reason rather than silently substituting.

#### 2.7.4 Routing Decision

Resolver output is a Routing Decision, not just a model ID:

```text
Agent Role
Task Type
Policy Version
Selected Provider / Selected Model
Capability Match
Routing Reason
Candidate Models
Rejected Candidates / Rejection Reasons
Availability Decision
Fallback Relationship
Applied Cost / Latency Constraints
```

Routing Rejection and Runtime Failure are distinct. Routing rejection belongs to the Routing Decision (cost exceeded, capability mismatch, provider blocked, unsupported output contract). Runtime failure belongs to Runtime Execution Failure (timeout, rate limit, provider error, network failure). Only Runtime Failure can produce a fallback routing decision.

Per-attempt routing is supported. Once an Execution Attempt begins, its Selected Provider and Selected Model are frozen; a model change requires a new Attempt and a new Routing Decision. Streaming must never silently switch model.

#### 2.7.5 Execution Attempt

```text
One external model execution = one immutable Execution Attempt
Any retry, fallback, or re-routing produces a new Execution Attempt
Partial Stream never materializes directly into a Candidate
```

```text
GenerationTask
├── Attempt A-1
├── Attempt A-2
└── Attempt A-3
```

Each Attempt records Attempt ID, Routing Decision, Provider, Selected Model, Execution State, start and end, Usage, Cost, Failure Evidence, Retry Reason, and Cancellation State.

Streaming is a process of an Attempt, not a Candidate. Partial stream may be previewed, cached, or discarded, but cannot become a Candidate.

Candidate materialization requires:

```text
Provider Stream Completed
-> Runtime Normalization
-> Output Contract Check
-> Complete Runtime Result
-> Materialization
-> Candidate
```

Fallback re-enters Model Policy and Model Resolver. Retry creates a new Attempt even with the same model. Failed Attempts are never deleted and never produce a Candidate.

Cost layering:

```text
Model Policy   -> budget and limits
Resolver       -> cost-aware model selection
Runtime        -> actual usage / cost
Orchestrator   -> continue / retry / fallback / stop / ask-author
```

Cost Policy affects AI execution only and can never lower Mandatory Validation, Required Approval, OCC, Domain Invariant, or Commit Safety.

#### 2.7.6 Candidate Evidence Snapshot

```text
Evidence Snapshot = Immutable Manifest
!= Narrative State Copy
!= Full Context Copy
!= Full Novel Snapshot
```

Tier A: inline immutable evidence

```text
basedOnVersionSet
Author Instruction
Task Constraints / mustChange / mustPreserve
Agent Role
Output Contract
Prompt Template ID + Version + Variables
Model Policy Version
Routing Decision Reference
Selected Model Identity
Determinism-relevant Runtime Parameters
Output Contract Check Result
Key Content Hashes
```

Tier B: content-addressed references

```text
Context Package Manifest
├── Source Object ID
├── Source Revision ID
├── Content Hash
├── Selection Reason
├── Dependency Family / Relation
└── Inclusion Level

Memory Projection Revision
Rendered Prompt Blob Reference
Bounded Excerpt
```

Tier C: runtime and execution metadata, split into determinism-relevant parameters and observability-only metadata:

```text
Determinism-relevant  temperature, top_p, max_tokens, seed, response format,
                      tool configuration, reasoning configuration
Observability-only    latency, request duration, provider network metadata,
                      Attempt History, Usage, Cost, Request IDs, Errors
```

Replayability is defined precisely:

```text
Replayable   can rebuild the exact inputs and execution configuration
Re-runnable  can re-execute with those inputs to produce a new Candidate
Auditable    can explain why generation happened without re-executing
```

Byte-identical regeneration is not promised. Replayability Status is Replayable, Auditable, or Incomplete. If a required blob has been reclaimed, the product must not claim Replayable; it must state Auditable at minimum.

Manifest is retained long-term with commit history. Heavy blobs may be reclaimed by policy while retaining hash, source identity, revision identity, selection reason, bounded excerpt, and provenance metadata. Reclaiming blobs affects replayability but must not destroy auditability.

Section-level Provenance is first-class. Each section, field, or segment can be traced through Generation Attempt, Source Evidence, Author Edit Revision, Merge Source, and Current Revision.

#### 2.7.7 Prompt, Context, Model, and Routing Provenance

Minimal trustworthy unit: Identity + Version + Hash.

```text
Identity  which object
Version   which immutable definition or revision
Hash      what content was actually materialized
```

This is the minimum semantic for a provenance subject, not a mechanical requirement that every field repeat all three; the exact shape depends on the provenance type.

Hashes are computed from canonical serialization so that field order and whitespace do not create false differences. Hash mismatch means different materialized content.

Prompt Provenance records Prompt Template ID and Version, Prompt Variables, Message Roles, Message Ordering, Rendered Prompt Reference and Hash, Output Contract Reference and Version, and Prompt Build Policy Version. Template and Rendered Prompt are distinct; templates are never mutated in place.

Context Provenance records Context Assembly Policy Version, Context Package Hash, Included Entries, Important Exclusions, and Budget / Truncation. It proves what the AI saw and why, without inlining context content.

Model Provenance records Model Policy ID and Version, Selected Model Identity, Provider Identity, Model Version or Snapshot, Capability Assumptions Used, and Determinism-relevant Parameters. Model Policy and Selected Model are distinct, and requested alias and actual served version are distinct. When a provider does not expose the served version, `modelVersion = unknown` is recorded and the product must not claim full execution reproducibility; auditability is retained.

Routing Provenance records Routing Decision ID, Resolver Version, Routing Policy Version, Agent Role, Task Type, Candidate Models, Rejected Candidates, Rejection Reasons, Availability Decision, Fallback Relationship, Applied Cost / Latency Constraints, and Routing Reason. It answers why this model was selected and does not explain candidate content or validation outcome.

Unified version semantics:

```text
Definition Version       the definition in effect at the time
Materialized Hash        hash of the actual materialized content
Evidence Version         the object revision supporting the evidence
Provenance Schema Version version of the provenance structure itself
```

Three hard rules:

```text
1. Never reference mutable current state; pin versions.
2. Definition change produces a new Version.
3. Hash mismatch means different materialized input.
```

Not persisted by default: full provider request or response payloads, hidden reasoning chains, protocol details irrelevant to audit, and mutable current policy references. Provider error payloads belong to Runtime Error Evidence.

#### 2.7.8 Generation Audit Chain and Materialization

Generation Audit Chain is a logical read model, not an aggregate and not a container inside GenerationTask. This keeps consistency with the confirmed rule that GenerationTask is not the owner of candidate, validation, or commit history.

```text
GenerationTask
├── Immutable Task Definition
└── Lifecycle State / Revision
```

The task does not physically contain attempts, materializations, routing decisions, candidates, validation runs, or commits. It holds lightweight references at most, and growing id arrays should be avoided as domain state in favor of query indexes.

```text
Generation Audit Chain
= Projection over
  GenerationTask
  + ExecutionAttempt[]
  + RoutingDecision[]
  + ContextPackage / PromptManifest
  + Materialization[]
  + CandidateEvidenceSnapshot[]
```

The chain is rebuildable. Deleting the projection and rebuilding it must not destroy historical fact. This does not require full event sourcing; independent persistent records plus domain events and references plus a read projection are sufficient.

Materialization is a first-class immutable boundary record:

```text
Materialization ID
GenerationTask ID
Attempt ID
Candidate ID
Evidence Snapshot Reference
Output / Candidate Hash
Materialization Schema Version
```

Default: one Completed Attempt with Output Contract Pass produces one Materialization and one Candidate. N-best output contracts may later allow one Attempt to produce N Materializations, but this must not be the default.

Task Definition is immutable. A genuinely new creative intent creates a new GenerationTask rather than mutating an existing one.

```text
Retry   -> same GenerationTask, new Attempt
Re-run  -> new GenerationTask
```

Cost uses Attempt-level and Task-level records, plus Candidate Direct Cost equal to the successful Attempt cost. Failed Attempt costs are not allocated per candidate.

Error Evidence is first-class: failed and cancelled Attempts are retained, normalized, redacted, bounded, and truncated before persistence.

#### 2.7.9 Aggregate, Reference, Immutable, and Projection Boundaries

| Entity | Role | Ownership | Immutability |
| --- | --- | --- | --- |
| GenerationTask | Process Aggregate Root | self | definition immutable; lifecycle revisioned |
| ExecutionAttempt | Atomic execution record aggregate | self | terminal state immutable |
| RoutingDecision | Decision record | self | immutable |
| ContextPackage / PromptManifest | Content-addressed artifact | self | immutable |
| Materialization | Generation boundary record | self | immutable |
| CandidateEvidenceSnapshot | Candidate-side manifest | Candidate | immutable |
| ImpactAnalysisResult | Analysis record | self | immutable |
| ValidationRun | Validation evidence | self | immutable |
| ReviewDecision | Approval evidence | self | immutable |
| NarrativeCommit | Transition process aggregate | self | terminal state immutable |

Cross-aggregate references use Identity + Version + Hash only. Direct navigation into another aggregate's internal entities is forbidden, as is copying another aggregate's content. Candidate -> Materialization -> ExecutionAttempt is a reference chain, not object containment.

```text
Append-only / Immutable
  ExecutionAttempt, RoutingDecision, Materialization, EvidenceSnapshot,
  ImpactAnalysisResult, ValidationRun, ReviewDecision, NarrativeCommit terminal record

Revisioned Mutable
  Candidate Content, Candidate Lifecycle

Projection
  Task Execution State, Audit Chain, UI Summary, Narrative Health, Open Questions, Recall
```

Forbidden: mutating terminal Attempts, Materializations, or Routing Decisions; deleting failed or cancelled Attempts; recomputing historical generation for UI display.

---

## 3. Cross-cutting Semantic Boundaries

These boundaries were confirmed repeatedly and must not be reopened by later entity or schema design.

```text
Proposal          != Canon
Adoption          != Commit
Candidate         != Change Set
Impact            != Validation Scope
Impact Result     != Dependency
AI Inference      != Canonical Dependency
GenerationTask    != Audit Owner
Audit Chain       != Aggregate
View Context      != Generation Context
Autonomous        != Second Engine
AI                != Narrative Authority
Manuscript        != StoryState
Plan              != Canon
Structure         != Plan
Memory            != Source of Truth
Derived           != Canon
Current State     != Global Canon
Recall            != Search
Recall            != Workflow Controller
Health            != Single Score
Health            != Canon
Focus Stack       != Domain Hierarchy
Navigation        != Page Switching
AI Recommendation != Workflow Controller
Autonomous        != Human absent
Autonomy Level ↑  != Safety Floor ↓
```

Additional invariants:

- Canonical Narrative Representation consists of committed manuscript text plus committed narrative facts. Committed text is canonical state, not a derived projection.
- Aggregate boundaries follow local invariants and transactional consistency, never database relationships, object hierarchy, or API shape.
- Commit only automatically produces relations that a Structured Change Set can deterministically prove.
- Dependency lifecycle is determined by origin; there is no single universal dependency state machine.
- Validation level is derived by policy from impact evidence; it is never hard-bound to impact class.
- Cost policy, autonomy policy, and UI convenience may never weaken the Canonical Safety Floor.

---

## 4. Unresolved Entity Design

The following areas have confirmed semantics but pending detailed entity structure. They are recorded explicitly so that the next brainstorming round knows what is settled and what remains open.

```text
Narrative Proposal
  Status: CLOSED by Section 5.1
  (independent Aggregate Root; three orthogonal dimensions; revision model;
   branch / merge lineage; section disposition; section provenance; open questions)

Adoption Decision / Change Set
  Status: CLOSED by Sections 5.2 - 5.4
  (Adoption Decision immutable event; Change Set Aggregate Root; Change entity;
   immutable revision; diff; triggers; inheritance)

Conflict / Resolution / Rebase / Validation / Approval / Commit Gate
  Status: CLOSED by Sections 5.5 - 5.8
  (conflict records; resolution strategies; lineage; rebase modes;
   validation plan and run; commit gate; approval requirement and gate)

Production Run / Run Plan / Checkpoint
  Process semantics:    confirmed (Plan -> Approve -> Execute; Checkpoint as formal state)
  Run lifecycle:        confirmed
  Detailed entity
  boundaries:           pending

Story Foundation Projection
  Aggregation view
  semantics:            confirmed (entry point and aggregation view, not an aggregate)
  Projection shape:     pending

Open Questions / Narrative Health / Recall
  Proposal-local Open Questions: CLOSED by Section 5.1.6
  Active Narrative
  Layer semantics:      confirmed (projection, non-blocking, explainable)
  Projection schema
  and query semantics:  pending

Entity / Aggregate Boundary Review
  Status: CLOSED
  4 decided reconciliation items, recorded in Section 5.9
```

Status rule:

> **Pending Design does not mean missing, and it does not authorize the implementation phase to supply its own definitions.**

These areas must be closed through Entity Brainstorming and an Entity / Aggregate Boundary Review before `writing-plans`.

### 4.1 Reconciliation with the Core Engine Implementation

Entity / Aggregate Boundary Review is CLOSED. Four reconciliation items were decided; full decision records, the migration chain, and the migration dependency order live in Section 5.9.

```text
1. GenerationTask candidateIds  -> remove from Aggregate State; derive by query
2. ValidationRun binding        -> Change Set Revision + Frozen Validation Plan Version
3. ReviewDecision binding       -> Change Set Revision + Approval Scope
4. NarrativeCommit binding      -> Change Set Revision
```

These are decided migration tasks, not reopened entity design. They must not weaken the confirmed rules that GenerationTask does not own candidate content, validation history, review history, or commit history, and that Validation, Approval, and Commit share the Change Set Revision as their semantic subject.

### 4.2 Known Clarifications for V2

Recorded during baseline acceptance. These are additive clarifications, not contradictions, and must be resolved in Entity Brainstorming or a later spec revision rather than by rewriting V1.

```text
C1. Workspace formula vs Focus model
    V1 Section 1.6 expresses the working space as a sum of Author Goal,
    Creation Stage, Narrative State, AI Assistance, and Production State.
    The later locked model is Workspace = f(Focus, Narrative State, Author Goal, Active Tasks).
    These are not competing models. Resolution direction:
      Author Goal / Creation Stage / Narrative State / Production State / AI Assistance
        -> Focus / Mode / Task Resolution
        -> Working Surface
    Focus is the direct control state; the others are upstream inputs.

C2. Evidence Snapshot must not duplicate the Audit Chain
    Tier C lists Attempt History, Usage, Cost, Request IDs, and Errors.
    This must not be read as copying the whole audit history into the Candidate.
    Candidate Evidence Snapshot references necessary Attempt / Routing evidence
    as immutable references or a compact evidence summary.
    Runtime Events, Retry History, and Fallback History remain owned by the
    Generation Audit Chain.

C3. Runtime Observability vs Platform Observability
    Section 5 defers deployment, observability, and billing.
    Runtime Execution Observability is already confirmed and belongs to the Runtime Contract:
      Attempt Usage, Provider Request ID, Latency, Runtime Error, Model Provenance.
    Only Platform / Infrastructure Observability is deferred.
    Deferring platform observability must not be read as permission to remove
    runtime execution observability from the Runtime Contract.

C4. GenerationTask candidate association
    Already recorded in 4.1 as pending reconciliation.
    Entity Brainstorming must first answer whether GenerationTask needs a candidate
    association at all, and if so whether it is domain state, a query index, or an
    association record. Field-level type discussion comes after that answer.

C5. Advanced validators vs Validation architecture
    Section 5 defers advanced consistency validators.
    The Validation architecture itself is already confirmed:
      Validation Policy, Validation Plan, Validation Run, Commit Gate,
      Mandatory / Recommended / Advisory.
    Deferred scope means which advanced validators exist and how their rule
    algorithms are implemented, not whether the validation mechanism is designed.
```

Baseline acceptance status:

```text
Design Baseline:                     ACCEPTED
Product / Experience Architecture:   CONFIRMED
Cross-cutting Semantics:             CONFIRMED
Aggregate / Reference / Projection
Boundaries:                          CONFIRMED
Entity-level Detailed Schema:        PENDING
Known Clarifications:                5 recorded (C1-C5)
```

---

## 5. Entity Design Baseline (Locked)

This section records entity-level decisions confirmed during Entity Brainstorming. It supplements Sections 1-3 and resolves part of Section 4.

Entity Brainstorming rules:

```text
May discuss:    Entity / Lifecycle / Ownership / References / Revision / Projection / Invariants
May not reopen: Sections 1-3 confirmed product semantics and boundaries
```

### 5.1 Narrative Proposal

Narrative Proposal is an independent Aggregate Root.

```text
Narrative Proposal (Aggregate Root)
├── Proposal Identity
├── Proposal Type
├── Scope
├── Sections[]
│   ├── Section Identity
│   ├── Content
│   ├── Section-local Provenance
│   └── Current Adoption Disposition
├── Proposal-local Open Questions[]
├── Lineage References (parent / merge sources)
└── Current Revision Pointer
```

Not owned by the Proposal Aggregate:

```text
Adoption Decision
Change Set
Generation Audit / Provenance
Branch Source Proposal (referenced only)
Merge Source Proposals (referenced only)
```

#### 5.1.1 Three Orthogonal Dimensions

```text
1. Proposal Artifact Lifecycle   Draft / Active / Closed
2. Adoption Path                 constrained by Proposal Type
3. Section Disposition           Pending / Adopted / Rejected / Deferred
```

Artifact lifecycle is common. Adoption path is per type. Section disposition is per section. They must not be collapsed into one state machine.

```text
Proposal Type     -> Allowed Adoption Paths
Adoption Decision -> selects the actual path
```

| Proposal Type | Adoption Path |
| --- | --- |
| Story Concept | Canonical Fact or Plan |
| Core Conflict | Canonical Fact or Plan |
| World Direction | Plan, then later World Rule Canon |
| Protagonist Direction | Plan, then later Character Canon |
| Main Plot / Story Engine | Plan |
| Character | Canonical Character Profile plus Plan |
| Relationship | Canonical Relationship or Plan |
| Plot Thread | Plan, then later Canonical Plot Decision |
| Foreshadowing | Foreshadowing Plan -> Setup Scene -> Payoff Scene -> Canonical Narrative Fact |
| Theme | Plan / Style Constraint |
| Long-form Direction | Plan |

`Closed` is a terminal artifact state. Continuing work from a Closed proposal requires a Branch into a new Proposal.

#### 5.1.2 Proposal Revision

```text
Proposal Revision = Immutable Full Snapshot
```

```text
Proposal Revision
├── Revision ID
├── Revision Number (monotonic)
├── Parent Revision
├── Sections Snapshot[]
├── Section Hashes[]
├── Proposal-local Open Questions Snapshot
├── Trigger
└── Provenance
```

Section Identity is stable across revisions; content, disposition, and provenance may change. Section removal is a revision change, not identity masking.

Revision Content Change triggers: content change, disposition change, open question state change, section add, section remove. Ordering and display metadata never produce a revision.

Retention: the Current Revision and any revision reachable from retained evidence (Adoption Decision, Change Set, Branch / Merge Lineage, Provenance / Audit) must be retained. Only unreferenced and unreachable revisions may become GC eligible.

#### 5.1.3 Branch and Merge

Branch and Merge create new Proposal Identities and never modify source proposals. Revision history within one Proposal is linear; Branch / Merge lineage is a Proposal-to-Proposal relationship.

Branch copies design state and preserves lineage but does not copy decision authority:

```text
Branched Section
Current Disposition = Pending
Source Disposition retained as lineage metadata only
```

Merge is symmetric: resolved sections start as Pending. A new Adoption Decision is required to mark them Adopted.

Lineage is held by the new Proposal; parent proposals do not maintain child arrays.

#### 5.1.4 Section Disposition and Adoption Invalidation

```text
Disposition: Pending / Adopted / Rejected / Deferred
```

`Edited then Adopted` is not a state; it is a Section Provenance fact.

```text
Adoption Decision scope = Proposal Identity + Proposal Revision + Section Identity
```

Only one automatic transition exists:

```text
Adopted + Content Change in a new Revision
-> Adoption Invalidation
-> Disposition = Pending
```

All other transitions require an explicit Adoption Decision. Rejected is never implicitly adopted. Only Adopted sections are eligible Change Sources, and Adopted does not mean committed. Proposal-level Adoption Summary is a derived projection.

#### 5.1.5 Section-level Provenance

Section-level Provenance is a shared semantic contract for Proposal Sections and Candidate Sections. Physical field shape may differ per host, but the semantics are shared.

```text
Section Provenance
├── Origin
│   ├── Origin Type (immutable)
│   └── Origin Reference(s) (version-pinned)
├── Edit Lineage (append-only)
├── Source / Evidence References (version-pinned)
└── Adoption Decision References (append-only)
```

Origin Type values: Author Created, AI Generated, Branched From, Merged From, Extracted From Text.

Rules: Origin Type is immutable; Edit Lineage and Adoption References are append-only; all external evidence is referenced by Identity + Version + Hash; provenance never inlines the Generation Audit Chain; provenance snapshots with each Proposal Revision; provenance is never rewritten to hide history.

#### 5.1.6 Proposal-local Open Questions

```text
Proposal-local Open Question
├── Question Identity
├── Question Text
├── Scope (Proposal-level or Section-level)
├── State: Open / Resolved / Dismissed
├── Resolution Reference (required when Resolved)
└── Provenance
```

`Dismissed` is not `Resolved`: Resolved means an answer exists; Dismissed means an answer is no longer required.

Any state change produces a new Proposal Revision. AI and system may produce Resolution Suggestions but must never set Resolved. Resolution Reference must be version-pinned.

Novel-level Open Questions is a reference-only projection and never a second truth.

### 5.2 Adoption Decision

Adoption Decision is an independent immutable decision event, outside the Proposal Aggregate.

```text
Adoption Decision
├── Decision Identity
├── Scope: Proposal Identity + Proposal Revision + Section Identity
├── Decision Type: Adopt / Reject / Defer / Reopen
├── Target Type: Canonical Fact / Plan / Structure / Manuscript / StoryState
├── Adopted Content (Adopt only)
│   ├── Content Reference
│   └── Content Hash
├── Actor: Author / Policy
├── Reason
└── Decided At
```

Rules:

- Immutable and append-only.
- Scope binds to one Proposal Revision and one Section.
- Adopt must carry the exact content reference and hash, because adoption applies to a specific revision content.
- One Adopt Decision produces exactly one Change.
- Reject, Defer, and Reopen produce no Change.
- Adoption Decision derives Current Adoption Disposition but is not owned by the Proposal.
- Adoption and Commit remain separate.

### 5.3 Change Set and Change

Change Set is an Aggregate Root.

```text
Change Set (Aggregate Root)
├── Change Set Identity
├── Novel Identity
├── Changes[]
├── Current Revision Pointer
├── Change Set Revision History
├── Lifecycle: Open / Closed
└── Closure Disposition: Committed / Abandoned / Superseded
```

Lifecycle answers whether the Change Set can still be worked on; Closure Disposition answers why it ended. They are separate fields, not one state machine.

Change is an entity inside the aggregate.

```text
Change
├── Change Identity (stable within a Change Set across revisions)
├── Source
│   ├── Source Type: Proposal Adoption / Candidate / Author Edit / ConflictResolution
│   └── Source Reference (Identity + Version + Hash)
├── Target Address
│   ├── Target Type
│   ├── Object Identity
│   └── Optional Sub-address
├── Payload
└── basedOnVersionSet
```

Invariants:

- Every Change has exactly one Source and exactly one Target Address.
- Target Type is part of the Target Address; a Sub-address is a semantically defined addressable range, not a plain string path.
- Change Set owns its Changes but does not own Source or Target aggregates.
- Within one Change Set Revision, the same Target cannot have multiple unresolved Changes.
- Multiple heterogeneous Change Sources may compose one Change Set.
- Change Set is not owned by Proposal, Candidate, or GenerationTask.

### 5.4 Change Set Revision

```text
Change Set Revision = Immutable Full Snapshot
```

```text
Change Set Revision
├── Revision Identity
├── Revision Number (monotonic)
├── Parent Revision
├── Trigger
├── Changes Snapshot[]
└── Per-Change basedOnVersionSet
```

Validation binds to a specific Change Set Revision, not to Change Set identity and not to a Candidate.

#### 5.4.1 Revision Content Change

```text
Revision Content Change
├── Change Added
├── Change Removed
├── Change Payload Changed
├── Change Target Address Changed
├── Change basedOnVersionSet Changed
└── Conflict Resolution resulting in Change Set content change
```

Not a Revision Content Change: Change ordering, display metadata, UI grouping, and derived status. Changes[] is semantically an unordered set.

#### 5.4.2 Diff

Diff is computed from stable Change Identity, not content matching.

```text
Unchanged = Payload + Target Address + basedOnVersionSet + Source all unchanged
Modified  = same Change Identity with any of the above changed
Added     = present in child, absent in parent
Removed   = present in parent, absent in child
```

A basedOnVersionSet change alone makes the Change Modified, even if the new base remains compatible.

Three concepts must not substitute for one another:

```text
Diff                -> exact revision content comparison
Stale               -> base version compatibility
Evidence Reuse      -> evidence compatibility
```

#### 5.4.3 Revision Triggers

```text
Revision Trigger
├── InitialAssembly
├── Edit
├── ConflictResolution
├── Rebase
└── Regenerate
```

Preconditions are checked against concrete status facts, never against Headline Status:

```text
ConflictResolution -> Parent.UnresolvedConflict = true
Rebase             -> Parent.Stale = true
Edit               -> Aggregate Lifecycle = Open and Parent not Committed
Regenerate         -> re-executable Source / Provenance exists
```

When conflict and stale coexist: ConflictResolution first, then Rebase.

Each Revision has exactly one Trigger. A ConflictResolution Trigger may reference 0..N Resolution records; each Resolution still corresponds to exactly one Conflict.

#### 5.4.4 Inheritance and Invalidation

A new Revision is a new immutable snapshot built from the parent snapshot, never a shared mutable instance.

```text
Inherited:
  Change content as starting point
  per-Change Source Reference
  per-Change Source Provenance
  Resolution Lineage (extended)

Not inherited:
  Submission Status
  Validation Status
  Approval Status
  Commit Status
```

Source identity and edit history stay separate: an edit appends to Provenance and does not overwrite the original Source.

Parent evidence may be referenced as historical evidence and must be marked as not applicable to the new Revision. Reference is not applicability.

Revision-level validation must be re-established for every new Revision. Evidence cache reuse is an optimization and never produces a pass verdict.

#### 5.4.5 Revision Projection

```text
Revision Projection
├── Headline Status
├── Conflict Status
├── Stale Status
├── Submission Status
├── Validation Status
├── Approval Status
└── Commit Status
```

Headline priority:

```text
Committed > Invalid > Stale > Approved > Validated / Failed > Submitted > Ready > Assembling
```

Headline Status is a workflow and UI projection, not immutable Revision content. Blocking facts are preserved independently: conflict and stale may coexist, and resolving one never discards the other. Validated may be overridden by Stale in the Headline while the historical validation evidence is retained.

Recovery always produces a new Revision: conflict resolution for Invalid, rebase for Stale, edit or regenerate for Failed. Old Revisions are never restored in place and never have their base versions rewritten.

### 5.5 Conflict, Resolution, and Lineage

#### 5.5.1 Conflict Record

```text
Conflict Record (immutable)
├── Conflict Identity
├── Detected Against Revision
├── Target Address
├── Conflicting Change References
├── Conflict Type
├── Detection Evidence / Rule Reference
└── Detected At
```

Conflict is a Revision-level invariant. An unresolved conflict makes the Revision Invalid: it must not enter Validation and must not be committed.

Conflict Resolution State is a derived projection. A Conflict is Resolved only when a Resolution adopted by that Revision ConflictResolution Trigger produced a valid Child Revision. Merely existing as a Resolution does not globally resolve a Conflict.

Interdependent is not Conflict. Two Changes may depend on each other and still coexist. Conflict means two or more Changes cannot simultaneously satisfy Target semantic rules, invariants, operation preconditions, or Change Set rules and therefore require explicit coordination.

#### 5.5.2 Resolution

```text
Resolution (immutable)
├── Resolution Identity
├── Conflict Reference (exactly one)
├── Against Revision
├── Strategy: Take A / Take B / Drop / Merge / Split
├── Affected Change References
├── Actor
├── Reason
└── Decided At
```

Strategy effects:

```text
Take A / Take B / Drop -> no new Change Identity
Merge                  -> one new Change derived from multiple sources
Split                  -> multiple new Changes derived from one source
```

Merge and Split result Changes use Source Type = ConflictResolution and Source Reference = Resolution, while Provenance records `Merged From [A, B]` or `Split From [A]`. A Change still has exactly one Source; multi-source relationships live only in Provenance / Resolution Lineage.

A ConflictResolution Trigger may reference multiple Resolutions, but each Resolution corresponds to exactly one Conflict.

#### 5.5.3 Lineage

Lineage direction is unified:

```text
Result -> Derived From -> Source
```

```text
Merge:  X Derived From A, B
Split:  X Derived From A, Y Derived From A
```

Take and Drop are Revision-level ConflictResolution and do not require Change-level lineage edges. The Diff reports `Removed = B`; the Resolution reports `Why = Take A` or `Why = Drop`.

Four responsibilities, kept separate:

```text
Revision Diff    -> What changed?
Conflict Record  -> What conflict was detected?
Resolution       -> Why / how was it resolved?
Change Lineage   -> Where did the resulting Change come from?
```

Lineage within one Change Set is a DAG. Merging two Change Sets creates a new Change Set Identity and is not a Revision merge inside one Change Set.

Removed Changes do not appear in the child Changes[] but must remain fully traceable through Diff + Trigger + Resolution + Lineage.

### 5.6 Rebase

Recovery operations and Revision Triggers are separate layers:

```text
Automatic Rebase -> Trigger = Rebase
Manual Rebase    -> Trigger = Rebase
Regenerate       -> Trigger = Regenerate
```

Regenerate is never a third Rebase semantics.

#### 5.6.1 Automatic Rebase

Automatic Rebase is conservative. `Safe` means every mandatory Safety Condition obtained sufficient evidence as required by policy; it is not an absolute guarantee.

```text
Auto-Rebase Safety Conditions
├── Target Address resolvable (object exists, sub-address resolvable)
├── No semantic ambiguity (unique deterministic replay)
├── Base compatibility determinable
├── No new Conflict introduced
└── Semantic Intent unchanged
```

If any condition cannot be confirmed, automatic execution is forbidden and the Change falls back to Manual Rebase.

The Auto-Rebase Decision is immutable evidence recording the conditions evaluated, their evidence, and the outcome.

#### 5.6.2 Manual Rebase

Manual Rebase may adapt Target, Anchor, Span, or Context Reference to a changed base, but must not change the Change Semantic Intent. If intent changes, the correct trigger is Edit or Regenerate.

The author Semantic Intent Assertion is recorded in Manual Rebase Coordination Evidence and is an author assertion, not a system-verified truth. It does not produce a semantic validation pass.

#### 5.6.3 Rebase Effects

```text
Automatic / Manual Rebase -> Change Identity preserved, Source preserved, basedOnVersionSet updated
Regenerate                -> new Change Identity, new Source, Provenance `Regenerated From [old Change]`
```

Rebase repairs stale but does not guarantee conflict-free. New conflicts follow the standard Conflict Record / Resolution flow. Rebase must not absorb ConflictResolution.

Rebase failure is recorded as a Rebase Outcome:

```text
Rebase Result
├── Rebased
├── Needs Author Action
└── Failed
```

`Needs Author Action` is an outcome, not a Revision Status.

```text
Rebase Operation (immutable)
├── Rebase Identity
├── Parent Revision Reference
├── Per-Change Outcomes[]
│   ├── Change Reference
│   ├── Mode: Automatic / Manual
│   ├── Old Base Version Set
│   ├── New Base Version Set
│   ├── Payload Change Reference
│   └── Outcome: Rebased / Needs Author Action / Failed
├── Evidence References[]
└── Actor
```

The Rebase Operation does not hold a reverse reference to the resulting Revision; the resulting Revision is the Revision whose Trigger references it. This avoids an unnecessary self-reference cycle in the evidence graph.

Rebase and Regenerate never inherit prior Submission, Validation, Approval, or Commit status.

### 5.7 Validation Plan and ValidationRun

#### 5.7.1 Validation Plan

```text
Validation Plan
├── Assembled (adjustable)
└── Frozen (immutable execution baseline)
```

Execution must use a Frozen Plan Version. Freezing pins Entries, Execution Mode, Rule Version, Policy Version, and Cache References. Changing a frozen plan requires a new Plan Version; a frozen version used for execution is never modified.

Assembly drafts do not each need an immutable identity; the immutable execution identity begins at the Frozen Version.

```text
Validation Plan
├── Plan Identity
├── Revision Reference
├── Plan Version
├── Entries[]
└── Lifecycle: Assembled / Frozen
```

#### 5.7.2 Entry Execution Modes

```text
Execution Mode
├── Full Re-execution
├── Cached Reuse
└── Not Applicable
```

Execution Mode and Verdict are separate dimensions. Not Applicable is an Execution Mode, not a fourth Verdict, and an N/A entry produces no verdict.

```text
Full Re-execution -> run the current rule on the current target
Cached Reuse      -> reuse eligible evidence / intermediate artifacts, still run the current rule, still produce a new verdict
Not Applicable    -> current Revision does not satisfy Rule Applicability; entry does not execute
```

Cached Reuse is never skip-validation and never inherits a pass. It reuses evidence; it does not reuse verdicts.

#### 5.7.3 Evidence Dependency Closure

```text
Dependency Closure
├── Change Reference + Revision
├── Target Object + Version
├── Base Version
├── Context Reference + Version
└── Rule-defined additional dependencies
```

```text
Closure Compatible -> Cache Eligible
Closure Changed    -> Full Re-execution
Closure Unknown    -> Full Re-execution
```

Unknown must never be treated as unchanged.

Revision-level and cross-change rules always re-execute when still applicable; their verdicts are never inherited from a parent revision. A removed Change does not automatically make a rule Not Applicable and may trigger new cross-change, dependency, or consistency checks.

#### 5.7.4 ValidationRun

```text
ValidationRun
├── Run Identity
├── Frozen Plan Version Reference
├── Revision Reference
├── Entry Results[]
├── Execution State: Running / Completed / Interrupted / Failed
└── Outcome (only when Completed)
```

```text
Entry Result
├── Entry Reference
├── Execution Mode Used
├── Entry Verdict: Pass / Fail / Needs Review
├── Finding[]
└── Evidence[]
```

Responsibilities are layered:

```text
Overall Outcome -> aggregate conclusion of the complete run
Entry Verdict   -> judgment of one rule
Finding         -> anomaly or phenomenon the rule observed
Evidence        -> support for the rule judgment
```

Evidence is evidence of rule execution and is not required to sit under a Finding. A Pass entry may have no Finding and still have Evidence; a Pass entry may also carry non-blocking Findings.

Interrupted and Failed runs may retain partial evidence and execution history but produce no final Outcome.

#### 5.7.5 Outcome Aggregation

```text
Fail         = any Applicable Mandatory Entry = Fail
Needs Review = no Mandatory Fail, and any Applicable Mandatory Entry = Needs Review
Pass         = all Applicable Mandatory Entries = Pass
```

Not Applicable entries neither fail nor pass. N/A must be justified by Rule Applicability Policy and cannot be mechanically derived from a removed target.

Needs Review is produced by Rule / Validation Policy definitions. Confidence is one possible input and cannot independently decide Needs Review.

Mandatory Fail blocks commit. Mandatory Needs Review enters the independent Approval / Decision gate. Recommended and Advisory never block by themselves.

Validation verdicts belong to the current ValidationRun and are never inherited from a parent revision or parent run.

### 5.8 Commit Gate, Approval, and ReviewDecision

Three independent evidence streams are never merged into one state machine:

```text
Validation
├── ValidationRun
├── Overall Outcome
└── Evidence

Approval
├── ReviewDecision
└── Evidence

Commit Blockers
├── OCC
├── Invariant
├── Revision Validity
├── Validation
└── Approval
```

#### 5.8.1 Commit Gate

```text
Commit Gate
├── Revision Validity Gate
├── Concurrency Gate
├── Invariant Gate
├── Validation Gate
└── Approval Gate
```

Evaluation order is orchestration only and is never blocker priority. All gates are fully evaluated and all blockers are reported at once; fail-fast is forbidden. Resolving one blocker must not reveal a second one that could have been reported earlier.

Commit Gate is re-evaluated against current state for every commit attempt:

```text
Current Revision
+ Current Canonical State
+ Current OCC Version
+ Current Validation Evidence
+ Current Approval Evidence
+ Current Commit Policy
-> Commit Gate Result
```

No permanently cached `Allowed` exists. A Revision that was validated and approved can still be blocked later if canonical state changed and the Revision became stale.

```text
Commit Gate Result
├── Allowed
└── Blocked
    ├── Blockers[]
    └── Required Actions[]
```

Blocker answers why commit is not allowed; Required Action answers how to unblock. They are separate concepts and Required Action is not a Blocker status enum.

Always blocking: Invalid or Stale Revision, OCC conflict, target-specific invariant violation, Mandatory Fail, missing required approval, and a rejected ReviewDecision. Recommended and Advisory findings do not block by themselves.

#### 5.8.2 Validation and Approval Separation

```text
Validation Verdict != Approval Decision
```

Validation judges whether rules are satisfied. Approval decides whether the change is accepted.

```text
Mandatory Fail         -> Validation Gate Block
Mandatory Needs Review -> Approval / Decision Gate
```

Needs Review must never be converted into a Validation Pass. It enters an independent ReviewDecision flow.

#### 5.8.3 ReviewDecision

ReviewDecision is an immutable decision event; Pending is not one of its states.

```text
ReviewDecision
├── Decision Identity
├── Decision: approve / reject / request_regeneration
├── Decided By: human / policy
├── Actor
├── Scope: Change Set Revision + Approval Scope
├── Reason
├── Evidence References
└── Decided At
```

`request_regeneration` keeps distinct semantics: the current proposal is not accepted and a new candidate or Change is requested. Its mapping into Approval State and Commit Required Action is defined by Approval Policy and Commit Gate, not assumed to equal reject.

Human and policy decisions share one record structure. `decidedBy` and decision provenance distinguish them. Policy decisions must reference Policy Version, Decision Rule, and Evidence Used, and must not bypass a requirement that explicitly demands human judgment.

#### 5.8.4 Approval State

Approval State is a derived projection:

```text
Approval State = f(Approval Requirement, Applicable ReviewDecisions)
```

```text
No decision + Approval Required     -> Pending
No decision + Approval Not Required -> Not Required
```

Superseded is a derived applicability projection and never mutates a historical decision. Only a later valid decision covering the same Approval Scope and Requirement supersedes an earlier one. Different scopes never overwrite each other; for example Canon Approval and Manuscript Approval are independent.

#### 5.8.5 Approval Requirement

```text
Approval Requirement = Policy Projection
```

```text
Approval Scope = Requirement Domain + Target Scope
Target Scope   = Target Type + Object Identity + Optional Sub-address
```

```text
Requirement Level: Not Required < Policy Approval < Human Approval
```

Within one Approval Scope, multiple applicable rules take the strictest requirement. Different scopes are evaluated independently and never aggregated with a global maximum.

```text
Base Policy
+ Risk Classification
+ Validation Review Requirement
+ Autonomy Adjustment
+ Workspace / Author Policy
+ Safety / Governance Floors
-> Final Approval Requirement
```

Risk Classification feeds Approval Requirement and must not form a cycle with it.

Mandatory Needs Review forms a Human Approval Floor. High Risk requires Human Approval. Autonomy may reduce requirements only for low-risk scopes within policy and may never breach the Safety Floor, the High-Risk Human requirement, or the Needs Review Human Floor. Autonomy is a policy input for low-risk governance, never a narrative authority override.

#### 5.8.6 Approval Gate

```text
Approval Scope Entry
├── Scope
├── Requirement
├── Applicable Decisions
└── Result: Satisfied / Pending / Blocked
```

Result derivation:

```text
Requirement = Not Required                        -> Satisfied
Required + no applicable valid Decision            -> Pending
Required + approve + Authority >= Requirement      -> Satisfied
Required + reject                                  -> Blocked
Required + request_regeneration                    -> Blocked, Required Action = Regenerate
```

Decision Authority must be at least the Requirement Level; a lower-authority decision cannot satisfy a higher requirement.

Aggregation:

```text
Blocked > Pending > Satisfied
```

All unsatisfied scopes are reported at once and each becomes a Commit Blocker with a Required Action. Approval Gate Result is a derived projection re-evaluated on each commit attempt and never permanently cached.

### 5.9 Core Engine Reconciliation Items

Entity / Aggregate Boundary Review is CLOSED. The following four items are decided migration tasks, not reopened entity design.

```text
1. GenerationTask candidate association
   Decision:  C — remove from Aggregate State, derive by query
   Existing:  GenerationTask owns candidateIds[]
   Target:    Candidate.taskId is the association fact;
              query Candidate.taskId -> Candidate[]
   Note:      addCandidateReference is legacy; completeGenerationTask keeps the
              "at least one candidate" process invariant as transient validation only
   Status:    DONE

2. ValidationRun binding
   Decision:  bind to Change Set Revision + Frozen Validation Plan Version
   Existing:  candidateId + candidateRevisionId
   Target:    changeSetRevisionId + planVersionId
   Note:      Candidate becomes optional Context / Evidence Reference
   Status:    DONE

3. ReviewDecision binding
   Decision:  bind to Change Set Revision + Approval Scope
   Existing:  candidateId + candidateRevisionId
   Target:    changeSetRevisionId + approvalScope
   Note:      Candidate remains Decision Evidence / Source Context only
   Status:    DONE

4. NarrativeCommit binding
   Decision:  bind to Change Set Revision
   Existing:  candidateId + candidateRevisionId + validationRunIds + reviewDecisionId
   Target:    changeSetRevisionId + validation and approval references
   Note:      Candidate is no longer the commit subject
   Status:    DONE
```

Migration chain:

```text
Legacy Path
Candidate -> ValidationRun -> ReviewDecision -> NarrativeCommit

Target Path
Candidate
-> Adoption / Change
-> Change Set
-> Change Set Revision
   ├── ValidationRun
   ├── ReviewDecision
   └── NarrativeCommit
```

```text
Candidate           = Source / Context
Change Set Revision = unified semantic subject for Validation / Approval / Commit
```

Migration dependency order:

```text
Change Set Aggregate
      |
      v
Change Set Revision
      |
      v
ValidationRun
ReviewDecision
NarrativeCommit
```

Change Set / Change Set Revision is the shared prerequisite for the three binding migrations. ValidationRun, ReviewDecision, and NarrativeCommit must not continue to maintain Candidate-bound semantics as their formal target.

Boundary Review conclusion:

```text
Entity Design Status:      CLOSED
Locked Baseline Conflicts: resolved by decision (4 items)
Writing-Plans Blockers:    NONE
Reconciliation Items:      COMPLETE
```

Reconciliation items are decided migration tasks. They do not reopen entity design.






## 6. Deferred and Out of Scope

Explicitly deferred to later phases:

```text
Database field lists
Aggregate internal fields
Table structures
API DTOs
Indexes
ORM models
Concrete implementation classes
UI visual design and component design
MVP and phase slicing
Deployment, observability, billing
Provider-specific SDK integration
Advanced consistency validators
Large-scale retrieval and embedding infrastructure
```

Explicitly out of current core scope:

```text
Multi-author collaboration
Teams and organizations
Real-time co-editing, CRDT, OT, presence
Publishing marketplace
```

---

## 7. Next Steps

```text
Design Spec (this document)
      |
      v
Entity Brainstorming
  [DONE]    Entity Brainstorming overall
  [DONE]    Narrative Proposal
  [DONE]    Adoption Decision
  [DONE]    Change Set / Change / Revision
  [DONE]    Conflict / Resolution / Lineage
  [DONE]    Rebase
  [DONE]    Validation Plan / ValidationRun
  [DONE]    Commit Gate / Approval / ReviewDecision
  [PENDING] Production Run / Run Plan / Checkpoint
  [PENDING] Story Foundation Projection
  [PENDING] Novel-level Open Questions / Health / Recall Projection
      |
      v
Entity / Aggregate Boundary Review
  [CLOSED]  4 decided reconciliation items (Section 5.9)
      |
      v
writing-plans
```

Status:

```text
Entity Design Status:      CLOSED
Locked Baseline Conflicts: resolved by decision (4 items)
Writing-Plans Blockers:    NONE
Reconciliation Items:      COMPLETE
```

The three PENDING areas above are not writing-plans blockers for the Co-Creation and Real AI Runtime scope. They stay pending until a plan needs them.

Writing Plan: `EXECUTED`. Core Engine Reconciliation: `COMPLETE`. Await the next product / engineering workflow from this frozen baseline.

This document is the stable context baseline. The confirmed decisions in Sections 1, 2, 3, and 5 are not open for re-litigation.
