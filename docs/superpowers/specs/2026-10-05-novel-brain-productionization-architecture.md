# Novel Brain Productionization Architecture Baseline

## Status

```yaml
Design Status: FROZEN
Product Design: LOCKED
Entity Design: CLOSED
Core Engine Baseline: FROZEN
Next Architecture: FROZEN
Productionization Architecture: FROZEN
Architecture Conflicts: NONE
Document Date: 2026-10-05
Scope: Production boundaries, dependencies, and implementation readiness
```

This document translates the frozen Novel Brain architecture into productionization boundaries. It does not implement code, define DTO fields, design database columns, or reopen Domain/Product design.

## 1. Repository Baseline

Verified against `feature/novel-brain-core-engine-reconciliation` at `85db773`.

```text
Global typecheck: PASS
System verification: 186 files / 1422 tests PASS
Working Tree: clean
```

| Area | Architecture | Implementation | Tests | Production Surface | Status |
| --- | --- | --- | --- | --- | --- |
| Change / Change Set / Revision | Frozen | Implemented | Verified | Domain/Application available | Complete |
| GenerationTask / Candidate | Frozen | Implemented | Verified | Application available | Complete |
| ValidationRun / ReviewDecision / NarrativeCommit | Frozen | Implemented | Verified | Application available | Complete |
| Commit Gate / Atomic Commit | Frozen | Implemented | Verified | Application available | Complete |
| Execution Attempt | Frozen | Implemented | Verified | Application available | Complete |
| Narrative Proposal / Typed Adoption | Frozen | Implemented | Verified | Application available | Complete |
| Dependency Registry / Impact Analysis | Frozen | Implemented and hardened | Verified | Read models available | Complete |
| Story Foundation | Frozen | Entry/workflow/adoption implemented | Verified | Workspace UI absent | Partial production surface |
| Production Run | Frozen | Plan/lifecycle/checkpoint/recovery/audit implemented | Verified | Operational runtime integration incomplete | Partial production surface |
| Recall | Frozen | Observation/detection/attention implemented | Verified | Presentation/operational tuning incomplete | Partial production surface |
| Persistence | Boundary defined | Generic InMemory/Prisma persistence implemented | Verified | Full production schema/migration strategy absent | Partial |
| API | Boundary defined | Fastify application routes implemented | Verified | Final production DTO/API contract absent | Partial |
| Runtime | Boundary defined | Deterministic adapter implemented | Verified | Real provider/runtime operations absent | Partial |
| Workspace | Contract defined | Application/query contract implemented | Verified | UI absent | Partial |
| Security | Boundary defined | Basic author ownership checks only | Limited | AuthN/AuthZ/isolation/secrets absent | Missing production surface |
| Observability | Boundary defined | Audit/events available | Limited | Logging/metrics/tracing/health incomplete | Partial |
| Deployment | Not implemented | PostgreSQL compose only | Limited | Application/worker/migration topology absent | Missing production surface |

Current Prisma persistence exposes generic `CurrentObject`, `RevisionRecord`, and `DomainEvent` records. Current deployment provides PostgreSQL only.

## 2. Productionization Principles

```text
Canonical State
+ Versioned Snapshot
+ Append-only Event / Audit
+ Rebuildable Projection
```

```text
Domain owns truth
Application orchestrates commands and queries
Persistence stores truth and evidence
Projection derives views
Runtime schedules work
Workspace presents state
Recall observes and surfaces
```

Forbidden:

```text
Everything = Event Sourcing
Production Run = second Novel Engine
Recall = workflow controller
Workspace = new Domain
API = Domain Model
Database schema drives Domain design
```

## 3. Clarified Boundaries

### Canonical Transaction vs Projection Transaction

```text
Canonical State Mutation
+ NarrativeCommit
+ Required Event/Audit Evidence
+ Idempotency Reservation
= Atomic Transaction
```

Projection updates are derived consequences. They may update synchronously or asynchronously and must be replayable/rebuildable. A projection failure must not leave a canonical commit semantically uncertain.

### Recall Task Authority

```text
Recall != Create Task

Recall
-> Proposed Action / Action Request
-> Production Run Policy
-> Task creation decision
```

Recall never directly creates a Task, mutates Narrative Truth, or executes a Commit.

### Security Isolation vs Novel Domain

Platform security may own users, accounts, workspace ownership, authorization, and resource isolation. Tenant, organization, membership, and collaboration concepts must not be introduced into the Novel Domain by this productionization phase.

## 4. Persistence Boundary

### Source of Truth

```text
Canonical Domain State   = authoritative
Versioned Snapshot       = recovery and audit baseline
Event / Audit Log        = append-only evidence
Projection               = rebuildable derived state
```

Must be persisted:

```text
Canonical aggregates and revisions
Execution attempts
Run plans and run state
Checkpoint decisions
Adoption decisions
Audit/event records
Idempotency and uniqueness reservations
```

May be rebuilt:

```text
Workspace projections
Recall attention projections
Run audit summaries
Dependency/Impact read models
Memory/context projections
```

### Transaction Boundary

```text
Application command
-> Domain validation
-> Persistence transaction
   -> Canonical state mutation
   -> NarrativeCommit transition
   -> Required event/audit evidence
   -> Idempotency reservation
-> Projection update or rebuild trigger
```

Projection updates do not participate in the authoritative success criterion. They must be replayable and recoverable.

Recovery mechanisms remain distinct:

```text
Snapshot recovery
Event replay
Projection rebuild
Forward compensation
```

Production mapping must follow:

```text
Frozen Domain Contracts
-> Consistency/transaction requirements
-> Persistence mapping
-> PostgreSQL schema
-> Migration/recovery/replay
```

Database design must not redefine Domain semantics.

## 5. Application / API Boundary

### Commands

```text
Create/revise Proposal
Adopt Proposal content
Create/approve Run Plan
Start/pause/resume/cancel Run
Retry/fallback Attempt
Record Checkpoint decision
Record Recall disposition
Request proposed action
```

### Queries

```text
Workspace Focus
Proposal comparison
Run status/audit
Recall Attention
Dependency/Impact view
Validation/Approval evidence
```

### Long-running Processes

```text
Generation
Validation
Production Run
Impact Analysis
Projection rebuild
Recovery/replay
```

The API layer owns request validation, authorization, idempotency, command/query dispatch, and process-result exposure. It does not directly mutate Narrative Truth, bypass Application Services, or duplicate Domain Models.

## 6. Runtime Boundary

Production Run owns orchestration only:

```text
Task scheduling
Execution
Retry/fallback
Timeout/cancellation
Pause/resume
Checkpoint
Failure/recovery
Budget/policy
Human intervention
```

```text
Run State != Narrative State
Production Run -> Shared Novel Engine
```

Production Run does not own a second Candidate, Validation, Approval, or Commit system.

## 7. Workspace Boundary

Workspace owns:

```text
Focus-driven presentation
Proposal/Run/Recall navigation
Attention presentation
Author interaction
```

Workspace does not own Narrative Truth, Revision semantics, Validation/Approval/Commit authority, or Run lifecycle truth.

```text
Workspace contract = implemented
Workspace UI = not implemented
```

## 8. Story Foundation Boundary

Story Foundation owns creation entry and design exploration:

```text
Idea entry
Existing Text extraction entry
Blank entry
Proposal exploration/refinement
Partial adoption preparation
```

It enters canonical state only through:

```text
Narrative Proposal
-> Typed Adoption
-> Change Set
-> Change Set Revision
-> Validation / Approval / Commit
```

Foundation is not Canon, a manuscript store, a mandatory wizard, or a bypass around Commit.

## 9. Production Run Boundary

Production surfaces required:

```text
Run Plan persistence
Run lifecycle persistence
Task/Attempt scheduling
Checkpoint evidence
Budget/policy
Recovery/replay
Audit projection
Forward compensation
```

All of these reuse the Frozen Core rather than introducing parallel execution semantics.

## 10. Recall Boundary

Recall owns:

```text
Observe -> Detect -> Classify -> Prioritize
-> Surface -> Explain -> Author Action -> Re-check
```

Recall does not own:

```text
Narrative mutation
Workflow authority
Autonomous commit
Direct task creation
```

A proposed action is a request into normal Production Run policy, not a domain command.

## 11. Derived State / Projection / Memory

```text
Memory Projection       = rebuildable
Recall Projection       = derived
Run Audit Projection    = derived
Dependency/Impact View  = derived read model
Workspace View          = derived application view
```

None of these are Canonical State, Validation Verdict, Approval Decision, or Commit Authority.

## 12. Security and Operational Boundary

Platform security owns:

```text
Authentication
Authorization
User/account/workspace ownership
Resource isolation
Secret management
Rate limiting
Abuse protection
```

Operational platform owns:

```text
Structured logging
Metrics
Tracing
Health/readiness/liveness
Configuration management
Deployment topology
Migration operations
Failure diagnostics
```

Security isolation is not a Novel Domain collaboration model.

## 13. Cross-system Dependency Direction

```text
Workspace -> Application
Application -> Domain
Application -> Persistence
Production Run -> Shared Novel Engine
Story Foundation -> Shared Novel Engine
Recall -> read-only projections
Recall -> proposed action -> Production Run policy
Projection <- Events / Canonical State
Memory <- Narrative State / Evidence
```

Forbidden:

```text
Domain -> UI
Recall -> Domain mutation
Workspace -> direct repository writes
Projection -> Canonical Truth
Database schema -> Domain redesign
```

## 14. Productionization Dependency Map

| Capability | Required boundary | Dependency | Enables | Order |
| --- | --- | --- | --- | --- |
| Persistence/API boundary | Source of truth and transaction mapping | Frozen Domain contracts | Runtime/API/Deployment | Must come first |
| Security boundary | AuthN/AuthZ/isolation ownership | API/Application boundary | Production access | Parallel after API boundary |
| Runtime productionization | Scheduler/runtime adapters | Persistence + Run contracts | Background execution | Parallel with API after persistence |
| Workspace UI | Application/query contracts | API boundary | End-user product | Can run in parallel after contracts |
| Story Foundation UI | Workspace + Proposal APIs | Workspace boundary | Creation experience | Can run in parallel |
| Recall production view | Recall projection + evidence | Impact integrity + Workspace | Attention experience | Can run in parallel |
| Observability | Events/audit + runtime boundaries | Application/Runtime | Operations | Parallel after boundaries |
| Deployment | Persistence + API + Runtime + Security | All production boundaries | Release | Final |

## 15. Productionization Gap Register

| Capability | Missing production surface | Dependency | Risk |
| --- | --- | --- | --- |
| Persistence | Production schema/index/migration strategy | Domain consistency mapping | Recovery and query performance |
| API | Final command/query/process contracts | Application boundaries | Client coupling |
| Security | AuthN/AuthZ, isolation, secrets, rate limiting | API/platform boundary | Unauthorized access |
| Observability | Logging, metrics, tracing, health | Runtime/application events | Undiagnosable failures |
| Runtime | Real provider/worker integration | Persistence + runtime contracts | Cannot execute production work |
| Workspace | UI and interaction surfaces | API/query contracts | Product unusable |
| Deployment | App/worker/migration/config topology | All production boundaries | Cannot release |

## 16. Explicit Deferred Work

```text
Field-level database schema
DTO fields
API parameter details
Pixel-level UI design
Recall scoring/vector retrieval
Prompt framework
Provider-specific implementation
Advanced validator catalog
Cost optimization details
```

These remain deferred unless the dependency graph proves that an architecture boundary is a prerequisite for implementation.

## 17. Architecture Review Checklist

```text
Frozen Core unchanged                           PASS
Persistence source of truth clear              PASS
Transaction/recovery boundary clear            PASS
Application/Domain decoupled                   PASS
Production Run orchestration only              PASS
Story Foundation Proposal/Adoption boundary    PASS
Recall derived/read-only authority             PASS
Workspace not a new Domain                     PASS
Security/operational ownership clear           PASS
Cross-system direction clear                   PASS
Architecture Contradictions                    NONE
```

## 18. Frozen Status

```text
Productionization Architecture = FROZEN
Architecture Conflicts         = NONE
Next Step                      = writing-plans
```

The next artifact must be a dependency-driven Productionization Roadmap. It must not reopen Product or Domain design and must not begin with database-first, API-first, or UI-first implementation.
