# Novel Brain Next Architecture Design Baseline

## Status

```yaml
Design Status: FROZEN
Architecture Conflicts: NONE
Product Design: LOCKED
Entity Design: CLOSED
Core Engine Reconciliation: COMPLETE
Core Engine Baseline: FROZEN
Next Architecture: FROZEN
Document Date: 2026-10-04
Scope: Production Run, Story Foundation, Recall, and their relationship to the Frozen Core
```

This document defines high-level product semantics, system boundaries, ownership, lifecycle, and cross-system flow. It does not define database schemas, field-level models, DTOs, API shapes, indexes, algorithms, prompts, providers, or pixel-level UI details.

## 1. Current Frozen Baseline

The following semantics remain frozen and must not be redesigned by Production Run, Story Foundation, or Recall:

```text
Change Set                 = Aggregate Root
Change                     = Internal Entity
Change Set Revision        = Immutable Revision Snapshot
Revision History           = Linear
Target Address             = Target Type + Object Identity + Optional Sub-address

ValidationRun              = Change Set Revision + Frozen Validation Plan Version
ReviewDecision             = Change Set Revision + Approval Scope
NarrativeCommit            = Change Set Revision

GenerationTask             = Definition + Lifecycle
Candidate                  = Source / Context
Commit Gate                = Current commit eligibility evaluation
NarrativeCommit            = Atomic narrative transition
```

Candidate never becomes the formal Validation, Approval, or Commit target. Change Set Revision remains the shared semantic subject for those three flows.

## 2. Architecture Principles

1. Production Run, Story Foundation, and Recall share architectural principles, evidence/provenance contracts, and cross-system boundaries.
2. They do not share a mandatory state model, aggregate, or lifecycle.
3. All narrative mutation flows through the Shared Novel Engine and the existing Proposal / Adoption / Change Set / Validation / Approval / Commit path.
4. Orchestration state, design-entry state, and derived awareness state remain separate from Narrative Truth.
5. Human authority and policy authority remain explicit and auditable.
6. Evidence is referenced and explained; evidence never silently becomes an inherited verdict.
7. New capabilities reuse the Frozen Core rather than introducing parallel domain systems.

## 3. Production Run

### Purpose

Production Run is the execution and orchestration layer for long-running production work. It converts an author goal into an auditable, pausable, recoverable execution process.

Production Run is not a second Novel Engine.

### Boundary

Production Run owns orchestration concerns:

```text
Run Plan
Production Run
Task / Attempt scheduling
Checkpoint
Pause / Resume / Cancel
Failure / Recovery
Budget / Policy enforcement
Human coordination
```

Production Run does not own:

```text
Narrative Truth
Candidate history
Validation semantics
Approval semantics
Commit semantics
Story Foundation design decisions
Recall narrative observations
```

### Lifecycle

```text
Draft
-> Planned
-> Approved
-> Running
   -> Paused
   -> Waiting for Human
   -> Completed
   -> Failed
   -> Cancelled
```

Supported coordination actions include pause, resume, retry, fallback, skip task, abort run, and human intervention.

### Run Plan

A Run Plan is an execution baseline. An approved Run Plan Revision is immutable. Changing the plan requires a new revision and re-approval; an approved plan must never be silently mutated while a run continues.

A Run references one approved Run Plan Revision and projects its execution state from the work performed under that baseline.

### Execution Flow

```text
Run Plan
-> Production Run
-> GenerationTask
-> Attempt
-> Candidate
-> Change Set
-> Change Set Revision
-> Validation
-> Approval
-> Commit Gate
-> NarrativeCommit
-> Checkpoint / Continue
```

Retry creates a new Attempt for the same Task. Fallback creates a new routing decision and Attempt. Run-level rollback is forward compensation through new NarrativeCommit activity; historical commits are not deleted.

### Checkpoint

Checkpoint is a run-level coordination point, not a Narrative Aggregate.

```text
Trigger
-> Pause / Inspect
-> Explain evidence and impact
-> Human or policy decision
-> Resume / Retry / Fallback / Abort
```

Checkpoint causes may include schedule, risk, budget, uncertainty, or failure. A checkpoint records orchestration evidence and the decision taken. If narrative acceptance is required, the system creates or consumes the normal ReviewDecision flow rather than treating the checkpoint decision as approval.

### Budget and Policy

Run, Task, and Attempt budgets constrain execution. Thresholds may pause the run, create a checkpoint, ask the author, or abort the run. Budget pressure must never skip validation, approval, or Commit Gate.

### Relationship with Core Engine

Production Run orchestrates existing objects and calls existing application capabilities. It does not create autonomous versions of GenerationTask, Candidate, ValidationRun, ReviewDecision, or NarrativeCommit.

## 4. Story Foundation

### Purpose

Story Foundation is the creation-entry and narrative-design surface for turning an idea, existing material, or blank start into an explorable design space.

```text
Story Foundation = Creation Entry / Narrative Design Surface
Narrative Proposal = Independent Design Decision Artifact
```

### Boundary

Story Foundation organizes exploration around five directions:

```text
Story Concept
Core Conflict
World Direction
Protagonist Direction
Main Plot / Story Engine
```

It may present optional collapsed suggestions, but it does not produce a mandatory complete roster, encyclopedia, power system, timeline, chapter plan, or manuscript.

Story Foundation is not:

```text
a one-time Wizard
Canon
a Manuscript
a mandatory completion gate
a giant story draft aggregate
```

### Entry

All three entry modes remain valid:

```text
Idea           -> AI generation       -> Story Foundation
Existing Text  -> AI extraction       -> Derived / Proposal
Blank          -> author-driven work  -> Empty Narrative State
```

A mature author may skip Foundation and enter Workspace directly. Foundation may be revisited incrementally, partially rerun, scoped to one dimension or question, branched, compared, or skipped.

### Proposal Flow

```text
Frame
-> Explore
-> Deepen
-> Refine
-> Typed Adoption
```

Foundation preserves undecided space and distinguishes already decided content, AI suggestions, author preference, open questions, and undecided areas.

Narrative Proposal remains independently editable, branchable, comparable, partially adoptable, rejectable, skippable, and regenerable. Proposal refinement does not mutate Narrative State.

### Workspace Relationship

Foundation is an entry mode and Focus-driven work surface within the shared Workspace. Its output enters the Workspace through Typed Adoption and the Frozen Core flow:

```text
Narrative Proposal
-> Adoption Decision
-> Adoption Target
-> Proposed Change
-> Change Set
-> Change Set Revision
-> Validation / Approval
-> NarrativeCommit
-> Target Domain State
```

Content becomes Plan, Canon, Manuscript, or StoryState only through the corresponding Adoption Target and normal commit process.

## 5. Recall

### Purpose

Recall is a long-form active-awareness and derived-intelligence layer.

```text
Search  = Author asks
Recall  = System notices
```

Recall helps the author recover relevant history, dependencies, unresolved concerns, and possible inconsistencies without requiring the author to remember or search for them explicitly.

### Boundary

Recall is:

```text
Derived Intelligence
Attention Layer support
evidence-backed recommendation
non-mandatory assistance
```

Recall is not:

```text
Narrative Truth
a Workflow Controller
Autonomous Commit
a second Narrative State
a NovelHealth aggregate
```

### Detection and Surface Model

```text
Observe
-> Detect
-> Classify
-> Prioritize
-> Surface
-> Explain
-> Author Action
-> Re-check
```

Recall may observe current Focus, narrative changes, Dependency Registry, Impact Analysis, Validation findings, Open Questions, historical evidence, thread or foreshadowing state, and Production Run or Checkpoint events.

Surface output must include the reason for attention and supporting evidence. The author may open it, inspect evidence, run validation, dismiss it, snooze it, ask why, ignore it, or confirm it as a Dependency.

### Disturbance Control

Recall remains non-blocking and relevance-driven. Prioritization, deduplication, cooldown, scope, and explanation prevent repeated or low-value interruption. Recall does not force a workflow transition.

### Workspace Relationship

Recall surfaces into the Workspace Attention Layer while the author works. It augments Focus and contextual panels but does not replace the Working Surface or become a new narrative authority.

### Production Run Relationship

Recall may observe Run and Checkpoint activity and surface relevant risk, omission, or uncertainty. By default it does not create Tasks automatically.

If an Autonomy Policy explicitly permits automation, Recall may produce a proposed action or proposed GenerationTask request. Such a request still passes through Production Run policy and the normal Task / Candidate / Change Set flow. Recall never directly mutates Narrative State or commits.

## 6. Cross-System Architecture

```text
                              Novel Brain
                                   |
          +------------------------+------------------------+
          |                        |                        |
   Story Foundation          Shared Novel Engine      Production Run
          |                        |                        |
   Proposal / Design          Narrative State           Run Plan
   Intent / Exploration       Candidate                  Run
                              Change Set                 Checkpoint
                              Validation                 Execution
                              Approval                   Recovery
                              Commit
          |                        |                        |
          +------------------------+------------------------+
                                   |
                                Recall
                                   |
                        Observe / Detect / Surface
```

### Ownership

| Capability | Owns | Does not own |
| --- | --- | --- |
| Story Foundation | Proposal exploration and design-entry workflow state | Narrative Truth, Canon, committed state |
| Shared Novel Engine | Narrative State, Change, Revision, evidence artifacts, Validation, Approval, Commit | Run scheduling, Recall presentation |
| Production Run | Run Plan execution, Run lifecycle, Task/Attempt coordination, Checkpoints, budget/policy action | Narrative Truth and decision semantics |
| Recall | Derived observation, prioritization, attention presentation and author disposition | Narrative Truth, workflow authority, autonomous commit |

### Dependency Direction

```text
Story Foundation -> Shared Novel Engine
Production Run   -> Shared Novel Engine
Shared Novel Engine -> Recall observations
Recall           -> Workspace Attention
Recall           -> optional proposed action for Production Run
```

Recall observes other capabilities and may suggest action. It does not become a command channel into the domain.

## 7. Frozen Core Integration

Production Run reuses:

```text
GenerationTask
Execution Attempt
Candidate
Change
Change Set
Change Set Revision
ValidationRun
ReviewDecision
Commit Gate
NarrativeCommit
```

Story Foundation reuses:

```text
Narrative Proposal
Adoption Decision
Change
Change Set
Change Set Revision
Validation / Approval / Commit
```

Recall consumes read-only projections and evidence references from:

```text
Narrative State
Dependency Registry
Impact Analysis
Validation
ReviewDecision
NarrativeCommit
Generation Audit Chain
Production Run / Checkpoint activity
```

No new capability introduces Candidate-bound Validation, Approval, or Commit semantics.

## 8. Evidence / Validation / Approval Boundary

```text
Validation       = rule satisfaction judgment
Evidence         = execution, source, version, and observation record
ReviewDecision   = acceptance / rejection / regeneration decision evidence
Approval State   = derived projection of requirements and applicable decisions
Commit Gate      = current commit eligibility
```

Mandatory consequences:

```text
Validation Pass       != Approval
Approval              != Validation
Cached Evidence       != inherited Verdict
Parent/old approval   != Child/new Revision approval
Checkpoint decision   != Narrative ReviewDecision
Recall recommendation != Domain mutation
```

Validation, Approval, and Commit Gate are re-evaluated for the current Change Set Revision and current state. Evidence is retained and referenced, not converted into permanent inherited success.

## 9. Deferred Items

The following remain deferred and must not be inferred as completed by this architecture baseline:

```text
Database schema, indexes, persistence mapping
DTO and API shape
Run Plan field-level schema
Checkpoint type and policy rule catalogs
Recall detection algorithms, scoring, vector retrieval
Prompt, provider, model routing, and cost-model details
UI layout and pixel-level design
Frozen Validation Plan assembly
Advanced validator catalog
Date global immutability
Production Run / Story Foundation / Recall detailed implementation schemas
```

Production Run, Story Foundation, and Recall pending implementation work does not reopen Entity Design or Core Engine Reconciliation.

## 10. Architecture Review Checklist

- Production Run responsibility, lifecycle, Run Plan relationship, and Checkpoint relationship are clear.
- Story Foundation responsibility, entry modes, Proposal Flow, and Workspace relationship are clear.
- Recall responsibility, observe-to-surface flow, Workspace relationship, and Production Run relationship are clear.
- The three capabilities have distinct ownership and do not share mandatory state models.
- Cross-system calls and observation directions are closed.
- Frozen Core integration is reuse-only.
- Evidence, Validation, Approval, and Commit boundaries remain separate.
- Deferred scope excludes field-level and implementation-detail recursion.
- No architecture conflict remains unresolved.

## 11. Frozen Status

```text
Product Design               = LOCKED
Entity Design                = CLOSED
Boundary Review              = CLOSED
Core Engine Reconciliation   = COMPLETE
Core Engine Baseline         = FROZEN
Next Architecture            = FROZEN
Architecture Conflicts       = NONE
```

The next stage is a dependency-driven implementation roadmap:

```text
Architecture
-> Dependencies
-> Implementation Order
-> Tasks
-> Verification
```

This document does not define a new MVP and does not authorize implementation before the corresponding writing plan is reviewed.
