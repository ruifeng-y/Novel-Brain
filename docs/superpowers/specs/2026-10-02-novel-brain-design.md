# Novel Brain Product and Architecture Design

## Status

- Date: 2026-10-02
- Phase: Product discovery, requirements, domain modeling, and architecture design
- Decision status: Direction approved; written specification pending author review

This document defines the complete product direction and architecture for Novel Brain. It intentionally does not define an MVP, implementation plan, database schema, or technology stack.

## Product Definition

Novel Brain is an AI-native long-form fiction creation system for a single author.

It is not a prompt-based text generator. Its central object is a durable, versioned **Narrative State** that records the canonical story, its structure, its evolving facts, and the process by which content was generated, validated, reviewed, and committed.

The author is the final creative authority. AI participates as a long-term co-creator that plans, analyzes, generates, rewrites, validates, and maintains context. AI output never directly changes canonical state.

Novel Brain is:

- A long-form narrative production system.
- A structured story-state workspace.
- A candidate-based generation and review environment.
- A consistency and memory system for stories that grow to hundreds of thousands or millions of words.
- A single-author creative control system.

Novel Brain is not:

- A generic chat writing assistant.
- A collaborative multi-author editor.
- A publishing platform.
- A model-specific wrapper.
- A system that relies on stuffing an entire novel into one model context.

## Core Problem

Long-form authors face a state-management problem before they face a text-generation problem. Characters change over hundreds of chapters, world rules accumulate, plot promises persist, character knowledge evolves, timelines drift, local edits can break distant facts, and fluent AI output can contradict the story.

The core problem is:

> How can one author and AI safely maintain, generate, validate, review, commit, and evolve a complex long-form narrative state?

## Target Users

The primary user is a Chinese long-form fiction author who writes or intends to write tens of thousands to more than one million words.

The user may have only a premise, a complete worldview and outline, an unfinished manuscript, or an active serialized work. The author does not need to arrive with a complete outline.

The author needs to:

- Maintain worldview, characters, plot, chapters, scenes, and current story facts.
- Generate or rewrite at multiple narrative levels.
- Compare candidates and select or modify one.
- Restrict AI changes to a precise target span.
- Understand what context the AI used.
- Detect contradictions before accepting output.
- Approve state transitions deliberately.
- Trace why a scene, fact, or setting exists.
- Recover from a bad generation or edit.
- Continue working as the story grows beyond any model context window.

## Product Modes

### Human-AI Co-Creation Mode

This is the primary mode. The author drives creative intent and decisions, while AI helps with planning, analysis, generation, rewriting, validation, and memory management.

```text
Author Intent
→ Narrative State
→ Generation Task
→ Context Assembly
→ AI Agent
→ Candidate
→ Validation
→ Author Review
→ Commit
→ Narrative State Evolution
```

The author can work at the novel, arc, chapter, scene, or target-span level.

AI may participate in story planning, outline refinement, world and character analysis, chapter or scene generation, continuation, expansion, rewrite, polish, local regeneration, multi-candidate generation, consistency checking, memory preparation, and candidate review support.

AI never directly modifies canonical state. Its output is always a candidate or analysis artifact until the author or an approved policy commits it.

### Autonomous Long-Form Generation Mode

Autonomous mode is the long-term second mode, not a separate product architecture. It uses the same narrative state, task system, generation pipeline, validation system, memory system, and commit boundary.

```text
Planner
→ Task Scheduler
→ Context Assembly
→ Agent / Model
→ Generation
→ Candidate
→ Validation
→ Review / Policy
→ Commit or Human Checkpoint
→ State Update
→ Next Task
```

The difference between modes is autonomy level, not architecture:

- Co-creation mode is human-driven.
- Autonomous mode is policy-driven and AI-driven.

Autonomous mode must support autonomy levels, approval policies, long-running execution, pause and resume, retry, failure recovery, rollback, and human checkpoints for high-risk changes.

## Capability Map

### Core Capabilities

These capabilities are essential to Novel Brain's domain and architecture:

```text
Novel management
Narrative state management
Canon management
Character management
World management
Plot and outline management
Chapter and scene management
Long-form writing
AI generation
Local regeneration
Candidate management
Validation
Review and approval
Commit
Versioning
Provenance
Event and audit
Projection
Memory and retrieval
Context assembly
Consistency checking
Recovery and rollback
Agent, model, and runtime abstraction
```

### Supporting Capabilities

These capabilities support the product but are not part of the core narrative domain:

```text
Account and authentication
Billing and usage
Model provider configuration
Cost tracking
Import and export
Search interface
Editor interface
Prompt templates
Style profiles
Notifications
Backups
```

Supporting capabilities must not dictate the narrative domain model.

### Future or Out-of-Scope Capabilities

These are not part of the current core product design:

```text
Multi-author collaboration
Teams and organizations
Editor or reviewer workflow
Real-time co-editing
CRDT or OT synchronization
Presence
Team chat
Publishing marketplace
Community features
```

Multi-user web infrastructure is still required because multiple authors can each use the platform independently. However, collaboration between users on one novel is not a current domain requirement.

## Bounded Contexts

### Narrative State Context

Owns author-approved story facts and their structure.

Concepts:

- Novel
- Canon
- Character profile
- World rule
- Plot decision
- Story state
- Character state
- World state
- Timeline
- Relationship state
- Knowledge state
- Plot progress

This context defines what is true in the story, not how a model generates it.

This context owns narrative-state projections such as character, world, plot, timeline, relationship, knowledge, and story-state views.

### Manuscript Context

Owns committed narrative structure and text.

Concepts:

- Arc
- Chapter
- Scene
- Target span
- Canonical text
- Scene revision
- Arc and chapter structural revisions
- Structural ordering

This context represents the author-approved manuscript. It does not own generation tasks or candidate text.

This context owns manuscript projections such as reading views and manuscript structure views.

### AI Production Context

Owns the process of turning author intent into validated candidates and commits.

Concepts:

- Generation task
- Agent role
- Model policy
- Model resolver
- Runtime
- Context request
- Candidate
- Validation run
- Review decision
- Approval policy
- NarrativeCommit

This context coordinates generation but does not own canonical narrative truth.

This context owns production projections such as task, candidate, validation, review, and commit dashboards.

### Memory and Retrieval Context

Owns derived long-form memory and retrieval projections.

Concepts:

- Scene summary
- Chapter summary
- Arc summary
- Character memory index
- World memory index
- Timeline index
- Relationship index
- Keyword index
- Semantic index
- Context assembly result

This context is optimized for retrieval and context construction. Its data is derived and rebuildable.

This context owns memory projections and retrieval indexes. It does not own the projections of other contexts.

### State Safety Context

Owns cross-cutting state-safety semantics and infrastructure contracts.

Concepts:

- Version
- Revision
- Optimistic concurrency check
- Event
- Audit record
- Provenance
- Recovery point
- Rollback

This context protects the integrity of canonical state, but it does not own the domain meaning of events or the read models of other contexts.

State Safety owns:

- Version and revision semantics
- Optimistic concurrency contracts
- Append-only event persistence infrastructure
- Audit record infrastructure
- Recovery and rollback mechanisms

State Safety does not own:

- Domain event contracts, which are defined by the context that produces the event
- Manuscript projections
- Narrative-state projections
- Memory and retrieval projections

Each bounded context owns its own projections. The Memory and Retrieval Context owns memory and retrieval projections; the Manuscript Context owns manuscript reading and structure views; the Narrative State Context owns character, world, plot, and story-state views.

### Platform Context

Supports users, providers, billing, and operational concerns.

Concepts:

- Account
- Authentication
- Model credentials
- Usage
- Cost
- System settings

Platform context must not leak into the core narrative domain.

## Domain Model

### Author

The human account that owns one or more novels.

The author is the final decision-maker for:

- Creative intent
- Canon
- Plot decisions
- Manuscript text
- Candidate selection
- Commit approval where required
- Rollback decisions

The author is not a collaboration participant inside the narrative domain. The platform may have many authors, but each novel has one author.

### Novel

A long-form narrative project owned by one author.

A novel owns:

- Canon
- Story state
- Manuscript structure
- Memory projections
- Generation history
- Version history

Novel is a root identity for narrative state. It is not a single database table and not one aggregate containing every object. The novel root coordinates separate state aggregates.

### Canon

Canon is author-approved narrative truth.

Canon is not an aggregate boundary. It is a logical layer inside the Narrative State Context that classifies committed narrative facts as author-approved truth.

Examples include:

- A character's core identity and established profile
- A world rule
- A magic, cultivation, or technology rule
- An approved plot decision
- A stable style constraint
- An approved event that permanently changed the story

Canon is deliberate, versioned, traceable, and changeable only through an explicit transition.

Canon is not:

- A draft idea
- An unapproved outline item
- A generated summary
- Temporary context
- Automatically extracted model output

There may be character canon, world canon, plot canon, and style canon. All share the property of author-approved truth.

Each canonical fact is versioned at the object level. A character profile, world rule, plot decision, or style constraint can be an independent aggregate root when it has independent lifecycle and local invariants. If a group of facts must change atomically to preserve a local invariant, those facts may share a narrower aggregate. Canon itself must not force an entire novel into one consistency boundary.

### Character

A character has two related but distinct state forms.

**Character profile** belongs to canon:

```text
Identity
Core traits
Background
Capabilities
Stable preferences
Canonical relationships
```

**Character state** belongs to story state:

```text
Physical condition
Location
Possessions
Knowledge
Current goals
Emotional state
Relationship status at a narrative point
Unresolved obligations
```

Example:

```text
Profile: Lin Chuan is a disciplined sword cultivator from the Northern Sect.
State:   At the end of chapter 312, Lin Chuan's left arm is injured, he knows the identity of the saboteur, and he has separated from his sect.
```

The profile changes through canon updates. The state changes through story-state updates.

### World

World also has profile and state forms.

**World canon** includes stable rules:

- Geography
- Cultures
- Power systems
- Technology constraints
- Economic rules
- Historical facts

**World state** includes current conditions:

- Political situation
- Season and time
- Active conflicts
- Public knowledge
- Damaged or changed locations
- Temporary restrictions

### Plot and Outline

Plot is modeled in three layers:

1. **Plan:** what the author intends to write.
2. **Committed story fact:** what has become canonical.
3. **Progress state:** where the story currently stands.

Outline objects include story goals, arc plans, chapter plans, scene plans, and beat plans.

An outline is a planning artifact, not automatically canon. The author can approve an outline item into canon when it represents an irreversible or protected story decision.

Plot state includes resolved threads, unresolved threads, active promises, pending conflicts, character motivations, and narrative arcs in progress.

### StoryState

StoryState is the dynamic state of the story at a defined narrative position.

It answers:

- Where is each relevant character?
- What does each character know?
- What relationships exist now?
- What conflicts are active?
- What promises remain unresolved?
- What has changed since the previous scene?
- What facts must be preserved by the next generation task?

StoryState contains character state, world state, timeline state, relationship state, knowledge state, plot progress, and unresolved threads.

StoryState is not a full dump of every fact in the novel. It is a structured, position-aware representation supported by retrieval for less-active facts.

StoryState is also not an aggregate boundary. It is a domain concept describing position-aware canonical state. Its records are grouped by subject and narrative position, not held inside one giant state container.

Character state, world state, timeline records, relationship state, knowledge state, plot progress, and unresolved threads have different lifecycles and consistency requirements. They should become separate state aggregates or independent state records where no invariant requires them to change together. Cross-record consistency is enforced by the commit transition, not by loading all story state into one aggregate.

### Manuscript Structure

The manuscript structure is:

```text
Novel
└── Arc
    └── Chapter
        └── Scene
            └── Target Span
```

An **Arc** groups chapters by narrative movement.

A **Chapter** is a publishing and reading unit.

A **Scene** is the primary narrative and generation unit.

A **Target Span** is a precise region inside a scene used for local rewriting.

Manuscript is not a single aggregate. It is the domain concept and bounded context for the committed narrative structure and text.

Arc, chapter, and scene have separate consistency boundaries:

- An **Arc** owns arc metadata and chapter ordering, not chapter or scene content.
- A **Chapter** owns chapter metadata and scene ordering, not scene content.
- A **Scene** owns committed scene text, span anchors, and scene revisions.

Changing scene text should touch only the scene aggregate and the commit transition. It should not load or lock the entire manuscript.

### Target Span

A target span identifies what a generation task may modify.

It must include:

- Scene identity
- Span anchor
- Base version
- Source content hash
- Generation goal
- Must-change constraints
- Must-preserve constraints

The span is not merely a character range. A stable anchor and source hash are required to detect whether the author changed the text after the task started.

### Memory

Memory is derived narrative knowledge used for long-form context assembly.

Memory types include:

- Scene summaries
- Chapter summaries
- Arc summaries
- Character fact records
- World fact records
- Timeline records
- Relationship records
- Knowledge records
- Keyword indexes
- Semantic indexes

Memory is rebuildable, refreshable, possibly stale, and retrieval-oriented. It is never the sole source of truth.

### Generation Task

A generation task represents a request to transform narrative state through AI.

A task includes:

- Novel identity
- Target object or span
- Operation type
- Author intent
- Base version
- Context specification
- Constraints
- Required agent role
- Required validation
- Lifecycle state
- Result references

Operation types include story planning, outline refinement, chapter generation, scene generation, continuation, expansion, rewrite, polish, local regeneration, multi-candidate generation, and consistency analysis.

The task is a process aggregate. It does not directly own canonical state.

GenerationTask owns task intent, target reference, base version set, context specification, constraints, execution policy, and lifecycle status. It records candidate identities but does not own candidate content, validation history, review history, or commit history.

The task aggregate stays bounded to one production request. It can remain open while candidates are compared, but it must not accumulate every historical candidate, validation run, review decision, and commit record as internal entities.

### Candidate

A candidate is an AI-generated or author-modified possible result.

A candidate records:

- Parent task
- Target
- Base version
- Source hash
- Model and agent provenance
- Context specification
- Generated content or proposed structured changes
- Validation results
- Author edits
- Selection state
- Rejection reason

Multiple candidates can exist for one task. Selecting a candidate does not automatically commit it.

Candidate is a separate aggregate root. It owns one proposed result and its current lifecycle, including generated content, proposed structured changes, author edits, selection state, and the immutable base version set used for stale detection.

Validation runs, review decisions, and commit records reference the candidate. They are durable process evidence, but they are not owned by GenerationTask. This keeps task coordination separate from candidate history.

### Validation

Validation is an independent evaluation of a candidate.

Validation checks may include:

- Content validation
- Structure validation
- Style validation
- Character consistency
- World consistency
- Plot consistency
- Timeline consistency
- Relationship consistency
- Knowledge consistency
- Target span preservation
- Prohibited change validation

Each check produces a status, finding, severity, confidence, evidence, input version, and candidate version.

Validation results are persisted as quality evidence and audit history.

### Approval

Approval is the decision gate that allows a candidate or author edit to become canonical.

Approval can be:

- Explicit human approval
- Policy-based approval for low-risk autonomous actions
- Conditional approval requiring later review
- Rejection
- Request for regeneration

The default co-creation policy requires author approval. Autonomous mode can relax this only within explicit policies.

### Commit

Commit is the only operation that changes canonical narrative state. It is a canonical state transition, not a simple write to one object.

A commit:

1. Verifies the base version is current.
2. Verifies required validations satisfy policy.
3. Verifies approval requirements.
4. Verifies local invariants in each affected aggregate.
5. Verifies cross-aggregate narrative consistency.
6. Applies one coherent canonical state transition.
7. Creates new canonical revisions.
8. Records provenance.
9. Emits domain events.
10. Defines derived state update obligations.

Author edits also pass through a commit boundary, even when no model is involved.

The commit transition is represented as a **NarrativeCommit** process aggregate. It records the affected canonical objects, their base versions, validation evidence, approval decision, provenance, and resulting revisions. It does not own the canonical objects themselves.

At the domain level, a NarrativeCommit is one coherent transition. It may affect one aggregate or several aggregates, such as a scene, character state, and world rule. The choice of an application transaction, process manager, outbox, or recovery workflow is an infrastructure decision, not part of this domain model.

The Novel root does not coordinate every cross-aggregate commit. It provides novel identity and novel-level policy. NarrativeCommit coordinates the affected aggregates for one transition.

### Version

Version is the identity reference to a specific immutable revision.

### Revision

Revision is the immutable canonical content or state record identified by a version.

For example, a scene version identifies one committed scene revision, while a character-state version identifies one position-aware character state revision.

### Snapshot

Snapshot is a coherent recorded set of object versions used for a specific purpose.

A context snapshot records the versions used to assemble a generation context. A commit snapshot records the base versions used by a NarrativeCommit. A narrative position snapshot can record the state versions visible at a story position for reading or validation.

Snapshots are evidence and derived views, not replacement sources of truth. The authoritative state remains the individual committed canonical revisions.

### Version Ownership

Versioned canonical objects include:

- Arc structural revisions
- Chapter structural revisions
- Scene text revisions
- Character profile revisions
- World rule revisions
- Plot decision revisions
- Style constraint revisions
- Character state revisions
- World state revisions
- Relationship state revisions
- Knowledge state revisions
- Timeline record revisions
- Unresolved thread revisions

Candidate has candidate revisions for its own content and author edits. GenerationTask has process lifecycle revisions for concurrency control, but those are not canonical narrative versions.

Novel does not have a global version used for stale detection. A global version would make unrelated local edits invalidate unrelated tasks.

### Based-on Version Set Semantics

`basedOnVersionSet` is not a single global novel version. It is a map of the target object version and every relevant dependency version used by the task.

For a local scene rewrite it includes at least:

- Scene version
- Target span source hash
- Relevant character profile versions
- Relevant world rule versions
- Relevant story-state versions
- Relevant plot decision versions

This allows precise stale detection. A task becomes stale only when an object it actually depended on changes.

Source content hash is not a version. It is an integrity fingerprint for a target span and is used together with the scene version.

Versions support candidate comparison, stale candidate detection, rebase decisions, local rollback, audit, and reproducibility.

### Event

An event records a meaningful state transition.

Examples:

```text
NOVEL_CREATED
CANON_CHANGED
CHAPTER_CREATED
SCENE_COMMITTED
CHARACTER_STATE_CHANGED
PLOT_STATE_CHANGED
MEMORY_PROJECTION_REBUILT
CANDIDATE_REJECTED
ROLLBACK_PERFORMED
```

Events provide audit and recovery capability. They do not require the entire system to use full event sourcing.

Event ownership is separated from event infrastructure:

- The producing domain context defines the event contract and domain meaning.
- The producing context emits the event as part of a canonical transition or process decision.
- State Safety provides event identity, ordering, append-only persistence, audit, and recovery infrastructure.
- Consuming contexts own their projections and rebuild rules.
- Memory and Retrieval consumes relevant events to rebuild memory projections.
- Manuscript consumes manuscript events to rebuild reading and structure projections.
- Narrative State consumes state events to rebuild character, world, plot, timeline, and story-state views.

State Safety must not become the owner of all domain event semantics.

### Projection

A projection is a derived read model.

Examples include a reading view, character timeline, world rule view, memory index, search index, and dashboard summary.

Projections can be rebuilt. They are never the authoritative source of narrative truth.

Projection ownership follows the owning context:

- Manuscript Context owns reading views and manuscript structure views.
- Narrative State Context owns character, world, plot, timeline, relationship, knowledge, and story-state views.
- Memory and Retrieval Context owns summaries, retrieval indexes, and semantic indexes.
- AI Production Context owns task, candidate, validation, and review dashboards.
- Platform Context owns account, usage, and cost projections.

State Safety owns projection safety semantics such as version consistency, rebuild checkpoints, and recovery records. It does not own the content of another context's projection.

### Provenance

Provenance records why a piece of state exists.

It may record author intent, task identity, candidate identity, model and runtime metadata, context specification, validation result, approval decision, base version, and commit identity.

Provenance supports trust, debugging, reproducibility, and rollback.

## Aggregate Boundaries

### Aggregate Selection Rule

An aggregate boundary is selected from local invariants and required transactional consistency, not from conceptual hierarchy or database relationships.

An aggregate is not required merely because concepts are related. A concept such as Canon, StoryState, or Manuscript can be a domain concept or logical layer while its records form smaller aggregates.

### Novel Aggregate

**Novel** is an aggregate root for one author's long-form project identity.

It owns:

- Novel identity
- Novel-level metadata
- Novel-level style and autonomy policy
- Top-level structural ordering policy

It does not own:

- Every canonical fact
- Every scene
- Every state record
- Every task, candidate, validation, review, or commit record
- Cross-aggregate commit compatibility

The Novel aggregate establishes identity and policy. NarrativeCommit coordinates a specific cross-aggregate transition.

### Canon Boundary

**Canon** is a logical layer of author-approved truth, not an aggregate.

Canonical fact aggregates are selected by their own invariants:

- Character profile
- World rule
- Plot decision
- Style constraint

These can be independent aggregate roots. A narrower grouping is allowed only when a local invariant requires those facts to change atomically. Changing one character profile must not lock or version the entire Canon layer.

Invariant: a canonical fact changes only through an approved commit and produces a new object-level revision.

### StoryState Boundary

**StoryState** is a domain concept for position-aware canonical state, not an aggregate.

Position-aware state aggregates and records are selected by subject and narrative position:

- Character state
- World state record
- Timeline record
- Relationship state
- Knowledge state
- Unresolved thread
- Plot progress record

These records do not need to change together merely because they describe the same narrative position. Cross-record consistency is enforced by NarrativeCommit.

Invariant: each state record is bound to a canonical narrative position and changes only through commit.

### Manuscript Boundary

**Manuscript** is a domain concept and bounded context, not a single aggregate.

Manuscript aggregates are:

- **Arc:** owns arc metadata and chapter ordering; does not own chapter or scene content.
- **Chapter:** owns chapter metadata and scene ordering; does not own scene content.
- **Scene:** owns committed scene text, stable span anchors, scene revisions, and source hashes.

Target span is a value object inside a scene revision, not an aggregate.

Invariant: manuscript text is committed text; candidate text never belongs to a manuscript aggregate.

### AI Production Boundaries

**GenerationTask** is an aggregate root for one production request. It owns task intent, target reference, base version set, context specification, execution policy, constraints, lifecycle state, and candidate references. It does not own candidate content or historical evidence.

**Candidate** is an aggregate root for one proposed result. It owns generated content or structured change proposals, author edits, base version set, selection state, and candidate revisions.

**ValidationRun** is an immutable evidence aggregate referencing a candidate revision. It owns validation findings, severity, confidence, evidence, and outcome.

**ReviewDecision** is an immutable evidence aggregate referencing a candidate revision and approval policy. It owns the author or policy decision and rejection reason.

**NarrativeCommit** is a process aggregate for one coherent canonical transition. It owns affected object identities, base version set, validation and approval references, provenance, resulting revisions, and commit status. It does not own the canonical objects themselves.

These boundaries prevent GenerationTask from accumulating all candidates, validation runs, review decisions, and commits while preserving durable process evidence.

### Event and Projection Boundaries

Events and projections are not narrative aggregates.

Events are append-only records. Their domain contracts belong to the producing context. State Safety provides persistence, ordering, audit, and recovery infrastructure.

Projections are derived read models owned by their bounded contexts and keyed by the relevant canonical revisions.

## Entity and Value Object Summary

### Entities

- Author
- Novel
- Arc
- Chapter
- Scene
- Character profile
- World rule
- Plot decision
- Style constraint
- Character state
- World state record
- Timeline record
- Relationship state
- Knowledge state
- Unresolved thread
- Plot progress record
- GenerationTask
- Candidate
- Validation run
- ReviewDecision
- NarrativeCommit
- Event record

Entities listed here are identity-bearing objects. Not every entity is an aggregate root. Aggregate roots are selected by local invariants as defined in the Aggregate Boundaries section.

### Domain Concepts That Are Not Entities

- Canon
- StoryState
- Manuscript
- Memory
- Projection
- Outline

These concepts classify, group, or derive information. They do not automatically receive identity or transactional boundaries.

### Value Objects

- Story position
- Span anchor
- Content hash
- Version reference
- Version set
- Revision reference
- Agent role
- Model policy
- Context specification
- Validation finding
- Provenance record
- Task intent
- Commit intent
- Derived state update obligation

Value objects are immutable and referenced by identity when they must be retained as evidence.

## Source of Truth

The canonical source of truth is the **Canonical Narrative Representation**: committed manuscript text together with committed narrative facts.

### Canonical Source of Truth

The canonical source of truth is:

- Committed manuscript text
- Committed canon
- Committed story state
- Committed structural arrangement
- Committed style constraints

Current canonical state can be stored as durable current-state records. An append-only event and audit log records how it evolved.

Committed manuscript text is canonical state, not a derived projection. Summaries, retrieval indexes, embeddings, reading views, and memory records are derived state.

### Derived State

Derived state includes:

- Summaries
- Retrieval indexes
- Semantic embeddings
- Search projections
- Dashboards
- Temporary context packages

Derived state can be lost or rebuilt without losing the story.

### Process History

Generation tasks, candidates, validations, approvals, and commits are process history. They are durable evidence, but candidate text is not canonical manuscript text.

### Not Source of Truth

The following are not canonical sources:

- Chat transcript
- Model response
- Memory summary
- Embedding
- Retrieval result
- Outline draft
- Validation finding
- Projection row

They may inform the author or the system, but they cannot directly become truth without commit.

## Narrative State Architecture

The canonical narrative representation is formed from committed manuscript text and committed narrative facts. Its supporting layers are:

```text
Canonical Narrative Representation
├── Canonical Manuscript
└── Structured Story State
→ Derived Memory
→ Task-specific Context
```

### Canonical Layer

The canonical layer contains author-approved facts and committed text.

It is durable, versioned, auditable, protected by commit, and recoverable.

### Story State Layer

The story state layer records facts that are true at a narrative position.

It supports questions such as:

- What does this character know now?
- Where is this character now?
- What promises are active?
- What conflicts are unresolved?
- What world conditions currently apply?

Story state is updated through commits, not through model assertions.

### Memory Layer

The memory layer converts committed state and manuscript content into retrievable knowledge.

It supports fact lookup, chapter and scene summaries, semantic retrieval, timeline navigation, relationship traversal, and knowledge checks.

Memory changes asynchronously after commits and can be rebuilt.

### Context Layer

The context layer is task-specific and temporary.

A generation context may include:

- Global canon digest
- Current story state snapshot
- Relevant character records
- Relevant world rules
- Arc or chapter summary
- Recent scene window
- Target span
- Author instruction
- Must-preserve constraints
- Style constraints

Context is assembled for one task, retained as provenance if needed, and then discarded as an active working object.

## Generation System

### Generation Pipeline

```text
Author Intent
→ Task Creation
→ Context Assembly
→ Agent Role Selection
→ Model Policy Resolution
→ Runtime Execution
→ Candidate Creation
→ Validation
→ Review
→ Approval
→ Commit
→ Derived State Update
```

### Generation Task Lifecycle

Primary path:

```text
DRAFT
→ READY
→ RUNNING
→ COMPLETED
→ VALIDATED
→ AWAITING_REVIEW
→ APPROVED
→ COMMITTED
```

Alternative terminal states:

```text
FAILED
CANCELLED
STALE
REJECTED
EXPIRED
```

### Candidate Lifecycle

```text
GENERATED
→ VALIDATING
→ VALIDATED
→ UNDER_REVIEW
→ SELECTED
→ COMMITTED
```

Alternative states:

```text
FAILED
REJECTED
OUTDATED
ARCHIVED
```

A candidate becomes outdated if its base version no longer matches the current canonical version.

### Multi-Candidate Generation

One task may produce several candidates.

The author can:

- Compare candidates
- Select one
- Merge or edit one
- Reject all
- Request another generation
- Pin constraints from one candidate

Candidate comparison should expose differences, validation findings, preserved and changed regions, narrative state impact, and model and context provenance.

### Local Regeneration

Local regeneration modifies only a selected target span.

Required data:

```text
targetSpan
basedOnVersionSet
sourceContentHash
context
generationGoal
mustChange
mustPreserve
```

The system must reject or rebase a local candidate if the source text changed after generation.

### Context Assembly

Context assembly is a first-class system capability.

Its responsibilities are:

1. Select relevant canonical facts.
2. Select relevant story state.
3. Retrieve useful long-term memories.
4. Include the correct local text window.
5. Apply author constraints.
6. Respect context budget.
7. Record what was included and excluded.

Context assembly must not simply concatenate the entire manuscript.

## Validation System

Validation is independent from generation.

### Validation Pipeline

```text
Candidate
→ Content Validation
→ Structure Validation
→ Target Preservation Validation
→ Canon Validation
→ Story State Validation
→ Consistency Validation
→ Quality Review
→ Validation Summary
```

### Validation Outcomes

```text
PASS
FAIL
NEEDS_REVIEW
```

`NEEDS_REVIEW` is important because some narrative choices cannot be mechanically determined. They require author judgment.

### Evidence

Validation evidence should include:

- Validator identity
- Candidate identity
- Base version
- Finding description
- Severity
- Confidence
- Source evidence
- Affected canonical facts
- Suggested correction

This evidence supports trust and review rather than hiding AI uncertainty.

## Review, Approval, and Policy

### Default Co-Creation Policy

For co-creation mode:

```text
Candidate
→ Validation
→ Author Review
→ Commit
```

The author can:

- Accept a candidate
- Edit before commit
- Reject a candidate
- Request regeneration
- Change task constraints
- Ask for explanation

### Autonomous Policy

Autonomous mode uses policy instead of always requiring manual review.

Risk levels may be:

```text
Low Risk → Auto Commit
Medium Risk → AI Review → Auto Commit
High Risk → Human Approval
```

Examples:

- Low risk: minor polish that preserves the target span and passes validation.
- Medium risk: new scene text that affects character state.
- High risk: changes canon, kills a character, resolves a major plot thread, alters a world rule, or modifies a large span.

Policy controls:

- Which validations are mandatory
- Whether human review is required
- What changes are prohibited
- Cost and runtime limits
- Retry behavior
- Rollback behavior
- Stop conditions

## State Safety and Concurrency

Single-author operation still requires concurrency control because AI tasks and author edits can overlap.

### Optimistic Concurrency

Every generation task and candidate records its base version and source hash.

At commit time, the system verifies:

- The target still exists
- The base version is current
- The source content hash matches
- No conflicting canonical change occurred
- The candidate can be applied safely

If verification fails, the system may:

- Reject the commit
- Mark the candidate stale
- Request rebase
- Request regeneration
- Ask the author to reconcile manually

### Commit Boundary

All canonical changes pass through commit:

```text
Author manual edit
→ Commit

AI candidate
→ Validation
→ Review / Policy
→ Commit

Rollback
→ Recovery operation
→ Commit or inverse state transition
```

### Events and Current State

The system should use:

```text
Durable current state
+ append-only event and audit log
+ version snapshots or versioned records
+ rebuildable projections
```

Full event sourcing is not mandatory. The architecture must justify which state requires event reconstruction and which state only requires audit history.

### Rollback and Recovery

Recovery operations include:

- Restore a scene version
- Restore a canon object version
- Restore a story-state snapshot
- Rebuild memory projections
- Retry a failed task
- Resume an interrupted autonomous run
- Revert a committed change

Rollback must itself be auditable and must keep derived projections consistent with canonical state.

## Long-Form Scaling

Novel Brain must support growth from a single scene to a chapter, multiple chapters, long form, 100K words, 500K words, and 1M+ words.

### Constraints

The architecture must not:

- Depend on one model context window
- Read the entire novel for every task
- Treat a summary as authoritative truth
- Let state updates grow without structure
- Require regenerating a whole chapter for a local edit
- Lose provenance when content grows
- Make validation optional because generation is long-running

### Hierarchical Context

Long-form context should be assembled hierarchically:

```text
Global canon digest
→ Current story state
→ Arc summary
→ Chapter summary
→ Scene context
→ Recent text window
→ Target span
→ Task constraints
```

### Retrieval Strategy

Retrieval should combine:

- Structured fact lookup
- Keyword search
- Semantic search
- Timeline navigation
- Character and relationship traversal
- Knowledge-state lookup

No single retrieval method is assumed to be sufficient for all long-form consistency problems.

### Incremental Update

After a commit, the system incrementally updates scene summaries, chapter summaries, character facts, world facts, timeline facts, relationship facts, knowledge facts, and search indexes.

Full rebuilds are possible, but normal operation should not require rebuilding the entire novel after every local edit.

## Agent, Model, and Runtime Abstraction

### Concepts

**Agent Role** defines a responsibility:

```text
Planner
Writer
Editor
Reviewer
Consistency Agent
Memory Agent
Research Agent
```

**Model Policy** defines selection and usage rules:

- Preferred models by role
- Cost limits
- Quality requirements
- Context requirements
- Fallback models
- Safety restrictions

**Model Resolver** maps policy to an available model provider.

**Runtime** executes the model or agent process.

### Design Rule

```text
Role ≠ Model ≠ Runtime
```

The narrative domain depends on roles, tasks, targets, and validation requirements. It must not depend on a specific provider or model name.

### Tool and Permission Boundary

Agents can receive tools for retrieval, canon lookup, story-state lookup, timeline lookup, candidate comparison, and validation.

Agent permissions must be scoped to the current task and novel. Agents must not receive unrestricted write access to canonical state.

## Architectural Overview

```text
Web Authoring Workspace
        ↓
Novel Engine
        ↓
Narrative State Core
        ↓
Generation / Validation / Commit Pipeline
        ↓
Memory / Retrieval / Context System
        ↓
Agent / Model Runtime Abstraction
        ↓
Context-owned Projections
        +
State Safety / Event / Recovery Layer
```

## Architectural Decisions

### ADR-001: Canonical narrative representation before generation output

**Decision:** The core domain is the canonical narrative representation formed by committed manuscript text and committed narrative facts, not generation output.

**Rationale:** Committed text is itself canonical state, not a derived projection. Generation output is candidate state until reviewed and committed. Long-form quality depends on the coherence of canonical text, narrative facts, versioning, context, and validation.

### ADR-002: Candidate and canonical isolation

**Decision:** AI output is never written directly to canonical state.

**Rationale:** The author must be able to compare, validate, reject, retry, and trace all proposed changes.

### ADR-003: Unified engine for both modes

**Decision:** Co-creation and autonomous generation share one engine.

**Rationale:** The modes differ in autonomy level and approval policy, not in their need for narrative state, tasks, candidates, validation, memory, and commit.

### ADR-004: Layered context, not whole-novel prompting

**Decision:** Generation uses task-specific context assembled from canonical state, story state, and retrieval.

**Rationale:** Long novels exceed practical context limits and require precision, consistency, and cost control.

### ADR-005: Memory is derived

**Decision:** Memory and indexes are rebuildable projections.

**Rationale:** Author-approved state and committed text remain authoritative; summaries and embeddings can be stale or regenerated.

### ADR-006: Independent validation

**Decision:** Validation is a separate pipeline from generation.

**Rationale:** A generator cannot reliably judge its own compliance. Validation must produce inspectable evidence for review.

### ADR-007: Version and provenance are core

**Decision:** Canonical objects, manuscript spans, candidates, and commits carry version and provenance.

**Rationale:** Long-form production requires stale-change detection, comparison, rollback, audit, and reproducibility.

### ADR-008: Event log without mandatory full event sourcing

**Decision:** Use durable current state plus append-only events and audit records.

**Rationale:** Events are necessary for audit and recovery, but forcing every object into an event-sourced aggregate would add complexity without proven domain benefit.

### ADR-009: Policy-based autonomy

**Decision:** Autonomy is controlled by approval policy and risk classification.

**Rationale:** The same engine can support strict human control and limited autonomous operation without becoming two products.

### ADR-010: No collaboration domain

**Decision:** The current core domain excludes multi-author collaboration, team permissions, real-time co-editing, presence, CRDT, and OT.

**Rationale:** The core problem is one author plus AI maintaining narrative state. Collaboration can be added later as an external context if needed.

### ADR-011: Aggregates follow local invariants

**Decision:** Canon, StoryState, and Manuscript are domain concepts, not monolithic aggregates. Aggregate roots are selected from local invariants and required transactional consistency.

**Rationale:** A million-word novel must not lock or version an entire canon, story state, or manuscript because one character, fact, scene, or span changed.

### ADR-012: NarrativeCommit coordinates cross-aggregate transitions

**Decision:** NarrativeCommit is the process aggregate for one coherent canonical transition. It references affected objects and their base version sets, but does not own canonical objects.

**Rationale:** A candidate can affect a scene plus character, world, or plot state. Novel identity and novel policy are insufficient coordination boundaries for one transition.

### ADR-013: Events and projections are context-owned

**Decision:** Producing contexts define and emit domain events and own their projections. State Safety provides version, event persistence, audit, concurrency, recovery, and rollback infrastructure.

**Rationale:** Centralizing event and projection ownership in State Safety would erase domain ownership and make each context dependent on an infrastructure context.

### ADR-014: Based-on version sets, not global novel versions

**Decision:** Tasks and candidates record a based-on version set containing the target object version and relevant dependency versions.

**Rationale:** Precise dependency tracking prevents unrelated local edits from invalidating every active task while preserving optimistic concurrency for affected objects.

## Detailed Design Decisions

1. **Aggregate boundaries:** Novel, Arc, Chapter, Scene, canonical fact records, position-aware state records, GenerationTask, Candidate, ValidationRun, ReviewDecision, and NarrativeCommit are selected as aggregates by local invariants. Canon, StoryState, and Manuscript are domain concepts, not monolithic aggregates.
2. **Version semantics:** Version identifies an immutable revision; Revision is the immutable record; Snapshot is a coherent set of revisions. There is no global Novel version for stale detection.
3. **Outline-to-canon transition:** Outline items remain plans until the author explicitly approves them as canon through a commit.
4. **Required scene story state:** Participating characters, current location and time, relevant knowledge deltas, active relationships, and unresolved threads must be represented or explicitly marked not applicable.
5. **Stable target spans:** Spans use stable paragraph or block anchors plus source content hashes rather than unstable character offsets alone.
6. **Structured candidate changes:** A candidate can carry a text proposal, a structured state proposal, or both; NarrativeCommit applies them as one coherent canonical transition.
7. **Validation-to-review mapping:** Findings expose severity, evidence, affected facts, and suggested actions so the author can approve, edit, reject, or request regeneration.
8. **Event ownership:** Producing contexts define and emit domain events; State Safety provides append-only persistence, ordering, audit, and recovery infrastructure; consuming contexts own projection rebuild rules.
9. **Projection ownership:** Each bounded context owns its projections. Memory projections belong to Memory and Retrieval; manuscript views belong to Manuscript; narrative-state views belong to Narrative State.
10. **Commit semantics:** Commit causes a canonical state change, emits domain events, and defines derived state update obligations. Synchronous, asynchronous, queue, outbox, and retry mechanisms are infrastructure choices.
11. **Based-on version:** `basedOnVersionSet` references the target object version plus every relevant dependency version used by the task, not a global Novel version.
12. **Memory recovery:** Each memory refresh records its source revision set and completed units; failed refreshes resume from the last checkpoint rather than requiring a full rebuild.
13. **Autonomous pause and resume:** An autonomous run stores its plan, current task, base version sets, and completion checkpoint durably; resume rejects stale tasks and continues from the next valid task.

These decisions close the current design questions. Lower-level implementation choices remain outside this specification.

## Acceptance for This Design Phase

This specification is complete for the current phase when:

- Product positioning is clear.
- User and mode boundaries are clear.
- Core and non-core capabilities are separated.
- Bounded contexts are identified.
- Source of truth is defined.
- Narrative state layers are defined.
- Aggregate, entity, and value-object boundaries follow local invariants.
- Commit transition semantics and cross-aggregate consistency are defined.
- Version, revision, snapshot, and based-on version-set semantics are defined.
- Event and projection ownership is separated from State Safety infrastructure.
- Committed manuscript text is not treated as a derived projection.
- Generation, validation, approval, and commit are separated.
- Long-form scaling constraints are addressed.
- Agent, model, and runtime abstraction is defined.
- State safety and rollback requirements are defined.
- Collaboration is explicitly excluded from the current core domain.
