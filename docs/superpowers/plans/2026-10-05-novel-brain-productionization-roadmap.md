# Novel Brain Productionization Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the frozen Novel Brain architecture into a deployable, recoverable, observable product without reopening Product or Domain design.

**Architecture:** First map frozen Domain contracts to production persistence and transaction boundaries, then expose Application/API and Runtime boundaries, followed by Workspace and security/operational surfaces. Deployment and final acceptance occur only after the production boundaries are independently verified.

**Tech Stack:** TypeScript, Node.js 22, Vitest, Fastify, Prisma/PostgreSQL, existing InMemory/Prisma repositories and verification harness.

**Spec:** `docs/superpowers/specs/2026-10-05-novel-brain-productionization-architecture.md`

## Global Constraints

- Product Design remains `LOCKED`; Entity Design remains `CLOSED`.
- Core Engine and Next Architecture remain `FROZEN`.
- Do not redesign Change Set, Change Set Revision, ValidationRun, ReviewDecision, NarrativeCommit, Commit Gate, Candidate, GenerationTask, Execution Attempt, Proposal, Adoption, Dependency, Impact, Run, or Recall semantics.
- Canonical State mutation, NarrativeCommit, required event/audit evidence, and idempotency reservation form the authoritative transaction.
- Projection updates are derived consequences and must be replayable/rebuildable; they are not part of canonical transaction success.
- Recall emits proposed actions only; it never creates Tasks or mutates domain state.
- Security isolation is platform scope and must not introduce Tenant/Organization/Collaboration into the Novel Domain.
- Database schema must follow Domain contracts and consistency requirements; it must not drive Domain design.
- DTO fields, API parameters, UI pixel details, Recall algorithms, prompts, providers, advanced validators, and cost optimization remain deferred until a task proves they are prerequisites.
- Architecture Contradiction: `NONE`.

---

## 0. Current Baseline

```text
Core Engine and Next Architecture = FROZEN
Phase 0-7 engineering roadmap      = COMPLETE
T2.3-H impact integrity            = COMPLETE
Global verification                = 186 files / 1422 tests PASS
Working Tree                       = clean
```

Production surface status:

```text
Domain/Application                  implemented and verified
Generic InMemory/Prisma persistence implemented and verified
Fastify application routes          implemented and integration-oriented
Deterministic runtime               implemented
Workspace contract                  implemented
Workspace UI                        not implemented
Production security                 not implemented
Production observability            partial
Deployment topology                 PostgreSQL-only compose
```

---

## 1. Implementation Dependency Graph

```text
Frozen Domain Contracts
└── Production Persistence Boundary
    ├── Canonical mapping / transaction contracts
    ├── PostgreSQL mapping / migrations
    └── Recovery / replay contracts
        ├── Application command/query/process boundaries
        ├── Production API boundary
        └── Runtime production adapters
            ├── Security boundary
            ├── Observability boundary
            ├── Workspace / Story Foundation / Recall surfaces
            └── Deployment topology
                └── Full Production Acceptance
```

Dependency rule: consistency and persistence boundaries precede API/runtime; security and observability follow command/process boundaries but precede deployment; UI may run in parallel after query contracts exist.

---

## 2. Architecture to Implementation Mapping

| Architecture boundary | Implementation responsibility | Primary verification |
| --- | --- | --- |
| Canonical persistence | Map frozen domain state, snapshots, events, reservations | Persistence and transaction contracts |
| Projection persistence | Replayable/rebuildable read models | Replay/recovery tests |
| Application boundary | Command/query/process services without Domain leakage | Application contract tests |
| API boundary | Validation, authorization hooks, idempotency, process exposure | HTTP contract tests |
| Runtime boundary | Scheduler/worker adapters over Production Run | Runtime integration tests |
| Workspace boundary | Application/query surfaces for Focus and Attention | Workspace contract tests |
| Security boundary | AuthN/AuthZ/isolation/secrets/abuse controls | Security contract tests |
| Observability boundary | Logs, metrics, traces, health, audit correlation | Operational contract tests |
| Deployment | App/worker/migration/config topology | Deployment smoke tests |

---

## 3. Overall Phase Roadmap

### Phase P0 — Production Baseline and Contract Lock

**Purpose:** Prove implementation starts from the frozen architecture and current verified repository.

**Dependencies:** Productionization Architecture, repository, current verification harness.

**Why Now:** Prevents production work from silently changing Domain semantics or relying on stale reports.

**Scope:**
- Verify repository state and global tests.
- Lock canonical/projection transaction boundaries.
- Record productionization acceptance greps.

**Implementation Tasks:**
- [ ] **Task P0.1: Production Baseline Verification Report**
  - Why: Establish reproducible productionization starting point.
  - Depends on: Current repository and frozen specs.
  - Changes: Verification report only.
  - Verify: Typecheck, global tests, Frozen Core greps, current surface inventory.
  - Unblocks: All productionization phases.

**Exit Criteria:** Baseline verified; no Architecture Contradiction.

**Unblocks:** Phase P1.

### Phase P1 — Persistence and Recovery Boundaries

**Purpose:** Establish production persistence mapping and transaction/recovery contracts before exposing more product surfaces.

**Dependencies:** Phase P0.

**Why Now:** Generic persistence exists, but production schema, migration, and recovery boundaries remain incomplete.

**Scope:**
- Canonical state/snapshot/event/idempotency mapping.
- Projection rebuild boundaries.
- PostgreSQL mapping and migration strategy.
- Recovery/replay/forward compensation integration.

**Implementation Tasks:**
- [ ] **Task P1.1: Canonical Persistence Mapping Contract**
  - Why: Map frozen Domain contracts to persistence without schema-driven redesign.
  - Depends on: Frozen Domain contracts.
  - Changes: Mapping/consistency contracts and tests.
  - Verify: Canonical state, versioned snapshots, events, idempotency reservations.
  - Unblocks: PostgreSQL and recovery work.

- [ ] **Task P1.2: PostgreSQL Mapping and Migration Boundary**
  - Why: Make persisted capabilities production-addressable and migratable.
  - Depends on: Task P1.1.
  - Changes: Prisma mapping/migration boundary without field-level API redesign.
  - Verify: Migration, round-trip, compatibility, rollback/recovery tests.
  - Unblocks: API/runtime persistence.

- [ ] **Task P1.3: Projection Replay and Recovery Contracts**
  - Why: Keep projections derived and rebuildable after failures.
  - Depends on: Tasks P1.1–P1.2.
  - Changes: Replay/rebuild contracts and failure fixtures.
  - Verify: Projection rebuild, event replay, snapshot recovery, compensation.
  - Unblocks: Observability and production queries.

**Exit Criteria:** Canonical and projection persistence boundaries are explicit and verified.

**Unblocks:** Phase P2.

### Phase P2 — Application and API Boundaries

**Purpose:** Expose commands, queries, and long-running processes without coupling clients to Domain internals.

**Dependencies:** Phase P1.

**Why Now:** Runtime, Workspace, and Security require stable application boundaries.

**Scope:**
- Command/query/process contracts.
- Idempotency and authorization hooks.
- Application capability boundaries for Generation, Validation, Approval, Commit, Run, Recall, Foundation.
- API boundary without DTO field design.

**Implementation Tasks:**
- [ ] **Task P2.1: Command and Query Boundary Contracts**
  - Why: Separate mutations, reads, and process results.
  - Depends on: Phase P1.
  - Changes: Application contracts and tests.
  - Verify: Command/query separation and Domain decoupling.
  - Unblocks: API and Workspace.

- [ ] **Task P2.2: Long-running Process Boundary**
  - Why: Expose Generation/Validation/Run/Impact/Rebuild as process results.
  - Depends on: Task P2.1.
  - Changes: Process lifecycle contracts.
  - Verify: Async result exposure, cancellation, idempotency.
  - Unblocks: Runtime adapters.

- [ ] **Task P2.3: Production API Boundary**
  - Why: Add validation, authorization hooks, idempotency, and process-result exposure.
  - Depends on: Task P2.2.
  - Changes: API boundary contracts; no DTO field catalog.
  - Verify: HTTP command/query/process contract tests.
  - Unblocks: Security and Workspace.

**Exit Criteria:** Application/API responsibilities are explicit and do not expose Domain internals.

**Unblocks:** Phase P3.

### Phase P3 — Production Runtime

**Purpose:** Run Production Run orchestration reliably in a real process model.

**Dependencies:** Phase P2 and existing Production Run contracts.

**Why Now:** Scheduler/runtime adapters need production persistence and application boundaries.

**Scope:**
- Worker/scheduler adapter boundaries.
- Timeout/cancellation/retry/fallback execution.
- Crash recovery and duplicate prevention.
- Budget/policy and human intervention integration.

**Implementation Tasks:**
- [ ] **Task P3.1: Scheduler and Worker Boundary**
  - Why: Execute tasks outside deterministic test runtime.
  - Depends on: Phase P2.
  - Changes: Runtime adapter contracts and tests.
  - Verify: Scheduling, timeout, cancellation, retry, fallback.
  - Unblocks: Production Run operations.

- [ ] **Task P3.2: Crash Recovery and Duplicate Prevention**
  - Why: Prevent half commits and duplicate attempts after restart.
  - Depends on: Task P3.1 and Phase P1 recovery.
  - Changes: Recovery integration contracts.
  - Verify: Restart, idempotency, replay, compensation.
  - Unblocks: Observability.

**Exit Criteria:** Production Run executes and recovers without owning Narrative Truth.

**Unblocks:** Phase P4.

### Phase P4 — Workspace and Product Surfaces

**Purpose:** Make the frozen capabilities usable through coherent application surfaces without creating a new Domain.

**Dependencies:** Phase P2; Runtime may continue in parallel.

**Why Now:** Application contracts are ready for product-facing integration.

**Scope:**
- Workspace Focus/query contracts.
- Story Foundation production surface.
- Production Run status/attention surface.
- Recall Attention surface.
- No pixel-level UI design in this roadmap.

**Implementation Tasks:**
- [ ] **Task P4.1: Workspace Query and Presentation Contract**
  - Why: Expose coherent Focus/Proposal/Run/Attention views.
  - Depends on: Phase P2.
  - Changes: Workspace application/query contracts.
  - Verify: Shared Narrative Truth ownership and view consistency.
  - Unblocks: Foundation/Run/Recall surfaces.

- [ ] **Task P4.2: Story Foundation Production Surface**
  - Why: Expose entry, proposal workflow, and adoption preparation.
  - Depends on: Task P4.1.
  - Changes: Foundation application surface contracts.
  - Verify: Entry modes, proposal flow, partial adoption visibility.
  - Unblocks: Product integration.

- [ ] **Task P4.3: Production Run and Recall Surfaces**
  - Why: Expose run status and evidence-backed attention.
  - Depends on: Task P4.1.
  - Changes: Run/Attention query contracts.
  - Verify: Non-authoritative Recall, Run state separation.
  - Unblocks: Cross-surface integration.

**Exit Criteria:** Workspace-facing contracts are coherent and Domain-free.

**Unblocks:** Phase P5.

### Phase P5 — Security and Observability

**Purpose:** Add platform responsibilities needed to operate the product safely.

**Dependencies:** Phase P2; Phase P4 may proceed in parallel.

**Why Now:** Production access and diagnosis cannot wait until deployment.

**Scope:**
- Authentication/authorization hooks.
- Resource isolation and secret boundaries.
- Rate limiting and abuse controls.
- Structured logging, metrics, tracing, health.
- Audit correlation.

**Implementation Tasks:**
- [ ] **Task P5.1: Security Boundary**
  - Why: Protect commands, queries, processes, and resources.
  - Depends on: Phase P2.
  - Changes: Platform security contracts and tests.
  - Verify: AuthN/AuthZ, isolation, secrets, rate limits.
  - Unblocks: Deployment.

- [ ] **Task P5.2: Observability Boundary**
  - Why: Make execution and failures diagnosable.
  - Depends on: Phase P2/P3.
  - Changes: Logging/metrics/tracing/health contracts.
  - Verify: Run/attempt/commit/Recall audit correlation.
  - Unblocks: Final acceptance.

**Exit Criteria:** Security and operational responsibilities have explicit owners.

**Unblocks:** Phase P6.

### Phase P6 — Deployment and Production Acceptance

**Purpose:** Package the verified system into a deployable, recoverable topology.

**Dependencies:** Phases P1–P5.

**Why Now:** All production boundaries are defined and tested.

**Scope:**
- Application/worker/migration/config topology.
- Environment and secret configuration boundaries.
- Deployment smoke tests.
- Full production acceptance.

**Implementation Tasks:**
- [ ] **Task P6.1: Deployment Topology**
  - Why: Run application, worker, migration, and persistence coherently.
  - Depends on: Phase P5.
  - Changes: Deployment contracts and smoke tests.
  - Verify: Startup, health, migration, shutdown, recovery.
  - Unblocks: Release readiness.

- [ ] **Task P6.2: Full Production Acceptance**
  - Why: Prove the complete system meets the Productionization Architecture.
  - Depends on: Task P6.1.
  - Changes: Acceptance verification only.
  - Verify: Global tests/typecheck, security/ops boundaries, cross-system contracts, deferred-scope audit.
  - Unblocks: Future product/engineering work.

**Exit Criteria:** Productionization Architecture is implemented and verified; deferred scope remains deferred.

---

## 4. Phase Dependency Table

| Phase | Blocked by | Parallel opportunities | Unblocks |
| --- | --- | --- | --- |
| P0 Baseline | None | None | P1 |
| P1 Persistence | P0 | P1.1/P1.3 may overlap after contracts | P2 |
| P2 Application/API | P1 | P2.1/P2.2 may overlap | P3/P4 |
| P3 Runtime | P2 | P4 may run in parallel | P5 |
| P4 Workspace | P2 | P3/P5 may run in parallel | P6 |
| P5 Security/Observability | P2, P3 | P4 may run in parallel | P6 |
| P6 Deployment/Acceptance | P1-P5 | None | Future work |

---

## 5. Detailed Task Requirements

Every task must answer:

```text
Why it exists
Dependencies
Changed boundary
Verification gate
What it unblocks
```

Task boundaries are intentionally above field/DTO/database-column level.

---

## 6. Parallelizable Work

- P1.1 and P1.3 may overlap after persistence contracts stabilize.
- P2.1 and P2.2 may overlap.
- P3 runtime and P4 workspace may run in parallel after P2.
- P5 security and observability may run in parallel after API/runtime boundaries.
- P6 waits for all production boundaries.

---

## 7. Verification Strategy

### Domain Verification
- Frozen Core regression.
- Domain lifecycle and identity invariants.

### Integration Verification
- Application command/query/process boundaries.
- API boundary contracts.
- Runtime and workspace contracts.

### Persistence Verification
- PostgreSQL mapping/migration.
- Snapshot/event/idempotency behavior.
- Replay and recovery.

### System Verification
- Security/observability/deployment smoke tests.
- Global typecheck and tests.
- Cross-system authority boundaries.
- Deferred-scope audit.

---

## 8. Cross-system Integration Order

```text
Persistence -> Application/API -> Runtime
                                  -> Workspace
                                  -> Security/Observability
                                  -> Deployment
```

Required boundary assertions:

```text
Projection failure != canonical commit failure
Recall proposed action != direct Task creation
Workspace presentation != Narrative Truth ownership
Database schema != Domain redesign
```

---

## 9. Risk / Dependency Bottlenecks

1. Generic persistence to production mapping may distort frozen Domain semantics.
2. Projection replay may be incorrectly treated as canonical transaction work.
3. API boundaries may expose Domain internals.
4. Security isolation may leak into Novel Domain.
5. Runtime recovery may duplicate attempts or commits.
6. Observability may lag command/process boundaries.
7. Deployment may begin before migration/recovery contracts stabilize.

---

## 10. Overall Definition of Done

```text
Production persistence and recovery boundaries verified
Application/API boundaries verified
Runtime scheduling/recovery verified
Workspace/Foundation/Run/Recall surfaces verified
Security/operational boundaries verified
Deployment topology smoke-tested
Global typecheck/tests PASS
Deferred scope unchanged
No Architecture Contradiction
```

---

## 11. Explicitly Deferred Work

```text
Field-level database schema
DTO fields
API parameter details
Pixel-level UI
Recall scoring/vector retrieval
Prompt framework
Provider-specific implementation
Advanced validator catalog
Cost optimization details
```

---

## 12. Recommended First Implementation Task

**Task P0.1 — Production Baseline Verification Report**

It is first because productionization must prove the repository and frozen contracts before any persistence or API work.

After P0.1, **Task P1.1 — Canonical Persistence Mapping Contract** is the first implementation-bearing task.

---

## 13. Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-05-novel-brain-productionization-roadmap.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task with acceptance review and at most one fix round.
2. **Inline Execution** — execute tasks in this session with checkpoints.
