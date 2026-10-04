# Novel Brain Next Architecture Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the frozen Production Run, Story Foundation, and Recall architecture in dependency order without reopening the Frozen Core.

**Architecture:** Build missing shared prerequisites first, then implement Story Foundation and Production Run as independent orchestration/design layers over the Shared Novel Engine, followed by Recall as derived intelligence. Cross-system integration and hardening occur only after capability contracts are independently verified.

**Tech Stack:** TypeScript, Node.js 22, Vitest, Fastify, Prisma/PostgreSQL, existing InMemory repositories and transaction adapters.

**Spec:** `docs/superpowers/specs/2026-10-04-novel-brain-next-architecture-design.md`

## Global Constraints

- Product Design remains `LOCKED`; Entity Design remains `CLOSED`.
- Core Engine Reconciliation remains `COMPLETE`; Core Engine Baseline remains `FROZEN`.
- Do not redesign Change Set, Change, Change Set Revision, Target Address, ValidationRun binding, ReviewDecision binding, NarrativeCommit binding, Commit Gate, Atomic Commit, Idempotency, or Candidate semantics.
- Candidate remains `Source / Context`; Change Set Revision remains the Validation, Approval, and Commit subject.
- Production Run is an Execution / Orchestration Layer, not Narrative Truth and not a second Novel Engine.
- Story Foundation is a Creation Entry / Narrative Design Surface. Narrative Proposal remains an independent design-decision artifact.
- Recall is Derived Intelligence / Attention Layer support, not Narrative Truth, Workflow Controller, or Autonomous Commit.
- Checkpoint decisions are run coordination decisions, never substitutes for Narrative ReviewDecision.
- Recall suggestions are never direct domain commands.
- Validation Pass, Approval, cached evidence, and Commit Gate remain separate concepts.
- Database schema, DTO/API shape, UI details, algorithms, prompts, providers, and advanced validators remain deferred unless a task explicitly proves they are implementation prerequisites.
- Architecture Contradiction: `NONE`.

---

## 0. Current Repository Baseline

Verification date: 2026-10-04.

| Area | Architecture | Implementation | Tests | Current Verification | Planning Status |
| --- | --- | --- | --- | --- | --- |
| Change / Change Set / Revision | Defined and frozen | Implemented | Unit tests present | `27 files / 257 tests PASS` | Complete |
| GenerationTask / Candidate | Defined and frozen | Implemented | Unit and integration tests present | Global suite PASS | Complete |
| ValidationRun / ReviewDecision / NarrativeCommit | Bound and frozen | Implemented | Domain and application tests present | Global suite PASS | Complete |
| Commit Gate / Atomic Commit / Idempotency | Defined and frozen | Implemented | Concurrency, transaction, replay/idempotency tests present | Global suite PASS | Complete |
| InMemory persistence/transaction path | Existing implementation | Implemented | Application and concurrency tests present | Global suite PASS | Reusable |
| Prisma persistence | Partial shared implementation | Core persistence exists | Postgres round-trip tests present | Test suite PASS when enabled | Extend per capability |
| Runtime Adapter | Architecture input exists | Deterministic adapter implemented | Runtime tests present | Global suite PASS | Reusable |
| Narrative Proposal | Defined | Not implemented | No capability tests | Not implemented | Required prerequisite |
| Adoption Decision | Defined | Not implemented | No capability tests | Not implemented | Required prerequisite |
| Execution Attempt | Referenced by frozen product architecture | Not implemented as a dedicated model | No capability tests | Not implemented | Required prerequisite |
| Dependency Registry / Impact Analysis | Architecture input exists | Not implemented as dedicated capability contracts | No capability tests | Not implemented | Required prerequisite for Recall and risk-aware Run |
| Story Foundation | Frozen architecture | Not implemented | Not implemented | Not implemented | New capability |
| Production Run / Run Plan / Checkpoint | Frozen architecture | Not implemented | Not implemented | Not implemented | New capability |
| Recall / Attention projection | Frozen architecture | Not implemented | Not implemented | Not implemented | New capability |

Current baseline commands:

```bash
npm run typecheck
npm test -- --run
```

Expected current result: typecheck PASS; `27 files / 257 tests` PASS.

---

## 1. Implementation Dependency Graph

```text
Frozen Core
├── Change / Change Set / Revision                   [implemented]
├── GenerationTask / Candidate                       [implemented]
├── ValidationRun / ReviewDecision / NarrativeCommit [implemented]
└── Commit Gate / Atomic Commit / Idempotency        [implemented]

Missing Shared Prerequisites
├── Narrative Proposal + Adoption Decision
│     └── required by Story Foundation and typed design adoption
├── Execution Attempt
│     └── required by Production Run execution/audit chain
└── Dependency Registry + Impact Analysis contracts
      ├── required by Recall observation
      └── required by Production Run risk/checkpoint decisions

Capability Layers
├── Story Foundation
│     ├── depends on Narrative Proposal + Adoption Decision
│     ├── depends on Shared Novel Engine commit path
│     └── produces design intent and adopted Changes
├── Production Run
│     ├── depends on Execution Attempt
│     ├── depends on GenerationTask / Candidate / Change Set / Validation / Approval / Commit
│     ├── depends on Dependency/Impact facts for risk checkpoints
│     └── produces orchestration state, checkpoints, run evidence
└── Recall
      ├── depends on read-only narrative/event/dependency/impact sources
      ├── depends on Production Run events for run-aware recall
      └── produces derived observations and Attention projections

Cross-System Completion
├── Story Foundation ↔ Shared Novel Engine
├── Production Run ↔ Shared Novel Engine
├── Recall ↔ Shared Novel Engine
├── Recall ↔ Production Run
└── All capabilities ↔ Workspace contracts
```

Dependency ordering rule: shared missing prerequisites precede capability implementation; capability implementations precede cross-system integration; integration precedes hardening and system-level verification.

---

## 2. Architecture to Implementation Mapping

| Architecture Concept | Implementation Responsibility | Primary Verification |
| --- | --- | --- |
| Story Foundation entry and proposal flow | Foundation application workflow over Narrative Proposal | Domain, workflow integration, partial-adoption tests |
| Typed Adoption | Adoption Decision to Change Set translation | Contract and commit integration tests |
| Production Run orchestration | Run Plan, Run lifecycle, task/attempt scheduling | Lifecycle, persistence, concurrency tests |
| Checkpoint coordination | Run-local pause/inspect/decide/resume state | Lifecycle and separation-from-ReviewDecision tests |
| Recall observation | Read-only source adapters and detection pipeline | Projection and contract tests |
| Recall attention | Derived item, evidence, explanation, author disposition | Attention projection and re-check tests |
| Shared evidence/provenance | Stable identity/version/hash references across capabilities | Cross-system contract tests |
| Persistence | Per-capability repositories and transaction boundaries | InMemory and PostgreSQL persistence tests |
| Workspace integration | Application/query contracts, not pixel-level UI | HTTP/application integration tests |

---

## 3. Overall Phase Roadmap

### Phase 0 — Baseline Verification and Roadmap Guardrails

**Purpose:** Prove the starting repository is the frozen baseline before adding new capabilities.

**Dependencies:** Existing repository and frozen specs.

**Why Now:** Prevents new tasks from silently depending on stale reports or incomplete tests.

**Scope:**
- Verify global typecheck/tests.
- Inventory implemented, partial, and missing capabilities.
- Record acceptance greps for Frozen Core.
- Confirm deferred scope remains unchanged.

**Implementation Tasks:**
- [ ] **Task 0.1: Baseline Verification Report**
  - Why: Establish a reproducible starting point.
  - Depends on: Current Git HEAD and repository files.
  - Changes: Verification scripts/report only; no production semantics.
  - Verify: `npm run typecheck`, `npm test -- --run`, acceptance greps.
  - Unblocks: All implementation phases.

**Verification:** Repository status and test counts match this roadmap.

**Exit Criteria:** Baseline verified; no Architecture Contradiction.

**Unblocks:** Phase 1.

### Phase 1 — Shared Implementation Foundations

**Purpose:** Establish reusable persistence, event, and verification boundaries for the three new capabilities without redesigning the Frozen Core.

**Dependencies:** Phase 0.

**Why Now:** Story Foundation, Production Run, and Recall all need consistent persistence, evidence references, and read-only observation boundaries.

**Scope:**
- Extend existing repository/transaction patterns for new capability state.
- Define read-only event/projection source contracts.
- Create repeatable integration and replay verification harnesses.
- Preserve the existing InMemory and Prisma parity strategy.

**Implementation Tasks:**
- [ ] **Task 1.1: Capability Persistence Port Patterns**
  - Why: New Run, Proposal, Adoption, Dependency, and Recall state must use one persistence/transaction discipline.
  - Depends on: Existing `Repository`, `RevisionedRepository`, Prisma repositories, and `InMemoryCommitTransaction`.
  - Changes: Capability-specific repository ports and InMemory/Prisma adapters; no Frozen Core semantic changes.
  - Verify: Persistence round-trip, transaction rollback, CAS/uniqueness, and InMemory/PostgreSQL parity tests.
  - Unblocks: Tasks 2.1–2.4 and all capability persistence.
  - Parallelizable: No; shared foundation.

- [ ] **Task 1.2: Read-only Observation and Evidence Source Contracts**
  - Why: Recall and Run risk/checkpoint logic must consume stable evidence references without mutating narrative truth.
  - Depends on: Existing DomainEvent, MemoryProjection, ValidationRun, ReviewDecision, NarrativeCommit, and version references.
  - Changes: Typed read-only source interfaces and contract fixtures.
  - Verify: Contract tests prove source identity/version/evidence references and no write side effects.
  - Unblocks: Dependency/Impact work, Recall, Run checkpoint evidence.
  - Parallelizable: With Task 1.1 after repository interface decisions are stable.

- [ ] **Task 1.3: Cross-capability Verification Harness**
  - Why: Capability completion requires domain, integration, transaction, concurrency, recovery, and replay gates.
  - Depends on: Existing Vitest configurations and InMemory/Prisma test setup.
  - Changes: Reusable fixture builders and verification command conventions.
  - Verify: Harness runs existing core tests and representative new capability smoke tests.
  - Unblocks: Every later task's verification gate.
  - Parallelizable: With Tasks 1.1 and 1.2.

**Verification:** Domain Verification, Integration Verification, and System Verification commands are documented and executable.

**Exit Criteria:** New capability work can persist state, reference evidence, and verify behavior through shared gates.

**Unblocks:** Phase 2.

### Phase 2 — Shared Engine Completion / Missing Core Dependencies

**Purpose:** Implement the missing frozen concepts required by Story Foundation and Production Run before either capability begins.

**Dependencies:** Phase 1.

**Why Now:** These are shared prerequisites, not feature slices. Implementing capabilities first would create adapters around absent semantics.

**Scope:**
- Execution Attempt as execution evidence attached to GenerationTask.
- Narrative Proposal and Adoption Decision as independent design/adoption artifacts.
- Dependency Registry and Impact Analysis contracts sufficient for risk and Recall observation.

**Implementation Tasks:**
- [ ] **Task 2.1: Execution Attempt Lifecycle and Evidence**
  - Why: Production Run must schedule and audit attempts without inventing a second task/candidate system.
  - Depends on: GenerationTask, Candidate, RuntimeAdapter, Task 1.1, Task 1.2.
  - Changes: Execution Attempt domain/persistence/application support and audit references.
  - Verify: Domain lifecycle, retry/fallback identity, persistence, replay, and non-duplication tests.
  - Unblocks: Production Run scheduling and audit projection.
  - Parallelizable: With Tasks 2.2 and 2.3.

- [ ] **Task 2.2: Narrative Proposal and Typed Adoption Decision**
  - Why: Story Foundation requires Proposal exploration and partial adoption without mutating Canon directly.
  - Depends on: Existing Change/ChangeSet/Validation/Approval/Commit path, Task 1.1, Task 1.2.
  - Changes: Proposal and Adoption Decision domain/persistence/application contracts.
  - Verify: Proposal immutability/branching semantics, partial adoption, target mapping, and commit-boundary tests.
  - Unblocks: Story Foundation proposal flow.
  - Parallelizable: With Tasks 2.1 and 2.3.

- [ ] **Task 2.3: Dependency Registry and Impact Analysis Contracts**
  - Why: Recall and risk-aware Run checkpoints need dependency/impact facts without a second narrative state.
  - Depends on: Change Set Revision, VersionSet, Validation evidence, Task 1.2.
  - Changes: Read-model contracts and minimal application query services; no new Narrative Truth.
  - Verify: Dependency identity, impact frontier, stale evidence, and read-only contract tests.
  - Unblocks: Recall detection and Production Run risk checkpoints.
  - Parallelizable: With Tasks 2.1 and 2.2.

- [ ] **Task 2.3-H: Impact Persistence Integrity Hardening**
  - Why: Persisted Impact Results must not be accepted merely because they are internally self-consistent.
  - Depends on: Task 2.3, Task 1.1 persistence contracts, Task 1.2 observation/evidence contracts.
  - Changes: Integrity hardening at `recordImpactAnalysis()` and its directly related persistence boundary only.
  - Scope:
    - Recompute and validate Impact Result from the canonical readSet.
    - Validate frontier bucket membership.
    - Validate `frontier.boundary`.
    - Validate path `from/to` connectivity.
    - Validate `subject` and `maxDepth`.
    - Reject forged self-consistent results.
    - Preserve InMemory / Prisma parity.
    - Add replay / recovery regression tests.
  - Forbidden: redesign Dependency Model, redesign Impact Model, modify Frozen Core, expand Recall Domain, or reopen Architecture.
  - Verify: semantic recomputation, forged-result rejection, persistence integrity, replay/recovery, and cross-adapter parity.
  - Exit Criteria: `recordImpactAnalysis()` cannot persist a result whose frontier/path/boundary cannot be derived from its readSet.
  - Unblocks: production-grade Recall consumption and Production Run impact-based consumption.
  - Global blocking status: NOT a global roadmap blocker; tasks without direct Impact Persistence Integrity dependency may continue.
- [ ] **Task 2.4: Shared Prerequisite Integration Gate**
  - Why: Prove all missing prerequisites work together before capability layers begin.
  - Depends on: Tasks 2.1–2.3.
  - Changes: Cross-contract fixtures and integration tests only.
  - Verify: Attempt/Proposal/Adoption/Dependency data can coexist with the Frozen Core and survive persistence/replay.
  - Unblocks: Phases 3 and 4.

**Verification:** Domain, persistence, transaction, replay, and cross-contract tests pass.

**Exit Criteria:** Story Foundation and Production Run have complete shared prerequisites; no duplicate Frozen Core semantics.

**Unblocks:** Story Foundation and Production Run implementation.

### Phase 3 — Story Foundation

**Purpose:** Implement the creation-entry and narrative-design surface while preserving independent Proposal semantics.

**Dependencies:** Phase 2, especially Narrative Proposal and Adoption Decision.

**Why Now:** Story Foundation can now transform ideas/text/blank starts into proposals and use the existing typed adoption path.

**Scope:**
- Idea bootstrap.
- Existing-text extraction entry.
- Blank start.
- Proposal exploration/refinement workflow.
- Partial adoption and Workspace integration contracts.

**Implementation Tasks:**
- [ ] **Task 3.1: Foundation Entry Services**
  - Why: Normalize three entry modes without creating a mandatory wizard or new Narrative State.
  - Depends on: Task 2.2, runtime/generation adapters.
  - Changes: Entry application services and provenance-preserving proposal creation.
  - Verify: All three entry modes, skip/re-entry, provenance, and no automatic Canon mutation.
  - Unblocks: Proposal exploration.
  - Parallelizable: With Task 4.1 after Phase 2.

- [ ] **Task 3.2: Proposal Explore / Deepen / Refine Workflow**
  - Why: Support branchable, comparable, partially adoptable design work.
  - Depends on: Task 3.1 and Narrative Proposal model.
  - Changes: Workflow application services and query contracts.
  - Verify: Frame/Explore/Deepen/Refine transitions, branching, comparison, undecided/open-question preservation.
  - Unblocks: Partial adoption.

- [ ] **Task 3.3: Foundation Partial Adoption to Change Set**
  - Why: Convert selected Proposal content into normal Frozen Core changes without bypassing validation/approval/commit.
  - Depends on: Task 2.2, Task 3.2, existing ChangeSet and commit service.
  - Changes: Adoption mapping and application service.
  - Verify: Multiple adoption targets, partial adoption, Plan/Canon/Manuscript/StoryState target separation, commit integration.
  - Unblocks: Foundation-to-Workspace integration.

- [ ] **Task 3.4: Foundation Workspace Contract Integration**
  - Why: Expose Foundation as a Focus-driven surface and return adopted state to the shared Workspace.
  - Depends on: Task 3.3 and Task 1.2.
  - Changes: Application/query contracts; no pixel-level UI.
  - Verify: Workspace sees proposals, adopted changes, open questions, and evidence without Foundation owning Narrative Truth.
  - Unblocks: Phase 6 workspace integration.

**Verification:** Domain, workflow integration, partial-adoption, persistence, and regression tests.

**Exit Criteria:** All entry modes and proposal-to-adoption flows work through Frozen Core; Foundation is not Canon or a mandatory gate.

**Unblocks:** Cross-system integration and later Recall observations of Foundation activity.

### Phase 4 — Production Run

**Purpose:** Implement long-running execution orchestration over existing GenerationTask/Candidate/ChangeSet/Validation/Approval/Commit capabilities.

**Dependencies:** Phase 2, especially Execution Attempt and Dependency/Impact contracts.

**Why Now:** Run orchestration is safe only after attempt identity, risk facts, and core commit behavior are stable.

**Scope:**
- Run Plan revisions and approval.
- Run lifecycle.
- Task/attempt scheduling.
- Checkpoints and human coordination.
- Retry/fallback/failure/recovery.
- Budget/policy thresholds.
- Run-level compensation.

**Implementation Tasks:**
- [ ] **Task 4.1: Run Plan Revision and Approval Baseline**
  - Why: A run must execute an immutable approved plan revision.
  - Depends on: Task 2.1, Task 2.3.
  - Changes: Run Plan domain/persistence/application contracts.
  - Verify: Revision immutability, re-approval, run-to-plan reference, and no silent mutation.
  - Unblocks: Run lifecycle.
  - Parallelizable: With Task 3.1 after Phase 2.

- [ ] **Task 4.2: Production Run Lifecycle and Scheduling**
  - Why: Coordinate Tasks and Attempts without creating a second Task/Candidate system.
  - Depends on: Task 4.1, Task 2.1.
  - Changes: Run lifecycle and scheduler application services.
  - Verify: Draft/Planned/Approved/Running/terminal states, pause/resume/cancel, task ordering, attempt identity.
  - Unblocks: Checkpoints and recovery.

- [ ] **Task 4.3: Checkpoint and Human Coordination**
  - Why: Preserve human/policy control without confusing checkpoint decisions with Narrative ReviewDecision.
  - Depends on: Task 4.2, Task 2.3.
  - Changes: Run-local checkpoint coordination and evidence projection.
  - Verify: Trigger categories, Pause/Inspect/Decide/Resume, decision separation, audit evidence.
  - Unblocks: Recovery and autonomous-policy integration.

- [ ] **Task 4.4: Retry, Fallback, Failure, and Recovery**
  - Why: Execution must recover without duplicating commits or rewriting history.
  - Depends on: Tasks 4.2–4.3 and Task 2.1.
  - Changes: Retry/fallback/recovery services.
  - Verify: Same-task retry creates new Attempt; fallback creates new routing/attempt; failed work leaves no half commit.
  - Unblocks: Run rollback.

- [ ] **Task 4.5: Budget, Policy, and Threshold Actions**
  - Why: Cost and policy must control execution but never bypass Validation/Approval/Commit Gate.
  - Depends on: Tasks 4.2–4.4 and existing ReviewDecision policy provenance.
  - Changes: Budget/policy evaluation and threshold actions.
  - Verify: Pause/checkpoint/ask/abort thresholds and non-bypass invariants.
  - Unblocks: Autonomous Run operation.

- [ ] **Task 4.6: Run Audit Projection and Forward Compensation**
  - Why: Answer what ran and safely compensate only reversible run-produced commits.
  - Depends on: Tasks 4.1–4.5 and NarrativeCommit provenance.
  - Changes: Run audit projection and run-scoped compensation service.
  - Verify: Audit completeness, replay, compensation eligibility, later-commit protection, idempotency.
  - Unblocks: System-level Production Run verification.

**Verification:** Lifecycle, persistence, transaction, concurrency, recovery, replay, and Frozen Core integration tests.

**Exit Criteria:** Production Run drives the existing core flow with complete lifecycle, checkpoint, recovery, budget, and audit behavior.

**Unblocks:** Recall run-aware observation and Phase 6 integration.

### Phase 5 — Recall

**Purpose:** Implement derived active awareness and Attention Layer support without becoming a workflow controller.

**Dependencies:** Phase 1 observation contracts; Phase 2 Dependency/Impact contracts; Phase 4 for run-aware observations.

**Why Now:** Recall quality depends on stable evidence sources and complete run/narrative signals.

**Scope:**
- Observation source adapters.
- Detection pipeline.
- Derived Recall Item.
- Evidence/explanation.
- Attention projection.
- Author disposition and re-check.
- Production Run observation and optional proposed action.

**Implementation Tasks:**
- [ ] **Task 5.1: Observation Source Adapters**
  - Why: Normalize narrative, dependency, impact, validation, memory, and run signals as read-only inputs.
  - Depends on: Task 1.2, Task 2.3, Task 4.6.
  - Changes: Read-only adapter/query services.
  - Verify: Source versions, evidence identity, staleness, and no mutation side effects.
  - Unblocks: Detection pipeline.

- [ ] **Task 5.2: Recall Detection and Prioritization Pipeline**
  - Why: Turn observations into candidate recall items without field-level algorithm design.
  - Depends on: Task 5.1.
  - Changes: Pluggable detection boundary and deterministic baseline pipeline.
  - Verify: Observe→Detect→Classify→Prioritize contract tests and deterministic replay.
  - Unblocks: Recall item explanation.

- [ ] **Task 5.3: Recall Item, Evidence, and Explanation Projection**
  - Why: Surface actionable awareness with source evidence and reason.
  - Depends on: Task 5.2.
  - Changes: Derived Recall Item projection and query contract.
  - Verify: Evidence references, explanation completeness, no Narrative Truth ownership.
  - Unblocks: Workspace Attention.

- [ ] **Task 5.4: Attention Disposition and Re-check**
  - Why: Let authors inspect, dismiss, snooze, confirm, or re-evaluate without workflow enforcement.
  - Depends on: Task 5.3.
  - Changes: Disposition application service and re-check behavior.
  - Verify: All author actions, re-check semantics, idempotency, non-blocking behavior.
  - Unblocks: Cross-system integration.

- [ ] **Task 5.5: Run-aware Recall and Optional Proposed Action**
  - Why: Observe checkpoints/run risk and optionally request policy-controlled action.
  - Depends on: Tasks 4.3–4.6, Task 5.4.
  - Changes: Run observation integration and proposed-action boundary.
  - Verify: Recall suggestion cannot mutate domain or auto-commit; proposed tasks enter normal Run policy.
  - Unblocks: Phase 6 Recall↔Run integration.

**Verification:** Projection, contract, deterministic replay, disposition, and non-authority tests.

**Exit Criteria:** Recall provides evidence-backed Attention items and re-check behavior without owning Narrative Truth or workflow control.

**Unblocks:** Cross-system integration and hardening.

### Phase 6 — Cross-system Integration

**Purpose:** Prove all capability boundaries and flows work together without semantic leakage.

**Dependencies:** Phases 3–5.

**Why Now:** Individual capability tests cannot prove cross-system ownership and command boundaries.

**Scope:** Separate integration tasks for every architecture relationship.

**Implementation Tasks:**
- [ ] **Task 6.1: Story Foundation ↔ Shared Novel Engine Integration**
  - Why: Verify Proposal independence and typed adoption behavior.
  - Depends on: Phase 3 and existing ChangeSet commit service.
  - Changes: Cross-system application fixtures and contracts.
  - Verify: Proposal remains independent; partial adoption becomes Change Set activity; no Canon mutation before commit.
  - Unblocks: Workspace integration.

- [ ] **Task 6.2: Production Run ↔ Shared Novel Engine Integration**
  - Why: Verify orchestration reuses the Frozen Core without a second execution system.
  - Depends on: Phase 4 and existing core services.
  - Changes: Cross-system run execution fixtures and contracts.
  - Verify: Run uses existing Task/Attempt/Candidate/ChangeSet/Validation/Approval/Commit; no second execution semantics.
  - Unblocks: Run-aware Recall.

- [ ] **Task 6.3: Recall ↔ Shared Novel Engine Integration**
  - Why: Verify Recall is read-only and evidence-backed.
  - Depends on: Phase 5 and Phase 2 evidence contracts.
  - Changes: Observation/projection integration tests.
  - Verify: Recall consumes read-only evidence/projections and cannot mutate Narrative Truth.
  - Unblocks: Workspace Attention.

- [ ] **Task 6.4: Recall ↔ Production Run Integration**
  - Why: Verify run-aware suggestions remain non-authoritative.
  - Depends on: Phase 4 and Task 5.5.
  - Changes: Run observation and proposed-action contract tests.
  - Verify: Recall suggestions do not auto-create tasks or commits; proposed actions pass through Run policy.
  - Unblocks: System hardening.

- [ ] **Task 6.5: Workspace Integration Contract**
  - Why: Keep product surfaces coherent without implementing pixel-level UI.
  - Depends on: Phases 3–5.
  - Changes: Application/query contracts for Focus, Proposal, Run, and Attention.
  - Verify: Foundation, Run, and Recall expose coherent contracts without owning shared Narrative Truth.
  - Unblocks: Phase 7.

**Verification:** Cross-system contract and end-to-end application tests.

**Exit Criteria:** All architecture arrows are implemented and authority boundaries are tested.

**Unblocks:** Hardening.

### Phase 7 — Hardening and System Verification

**Purpose:** Prove production-grade behavior across persistence, concurrency, recovery, replay, and observability.

**Dependencies:** Phase 6.

**Why Now:** System correctness cannot be inferred from unit tests or isolated capability tests.

**Scope:**
- PostgreSQL persistence parity.
- Transaction and concurrency stress.
- Failure/recovery/replay.
- Run compensation.
- Recall deduplication/disturbance control.
- Audit and observability projections.
- Full regression and acceptance checks.

**Implementation Tasks:**
- [ ] **Task 7.1: Persistence and Transaction Hardening**
  - Why: New capability state must survive real persistence and failure boundaries.
  - Depends on: All capability persistence tasks and Phase 6.
  - Changes: Persistence/transaction stress fixtures and adapter fixes.
  - Verify: InMemory/Prisma parity, CAS, uniqueness, rollback, and savepoint behavior.
  - Unblocks: Concurrency hardening.

- [ ] **Task 7.2: Concurrency and Idempotency Hardening**
  - Why: Concurrent Run, Commit, and Recall operations must preserve identity and avoid duplicates.
  - Depends on: Task 7.1.
  - Changes: Concurrency scenarios and deterministic reservation behavior.
  - Verify: Concurrent operations preserve unique identities and idempotent replay.
  - Unblocks: Recovery hardening.

- [ ] **Task 7.3: Recovery and Replay Hardening**
  - Why: Interrupted work must recover without half commits or duplicate evidence.
  - Depends on: Task 7.2.
  - Changes: Failure injection, replay, and compensation scenarios.
  - Verify: Interrupted Run, failed Attempt, compensation, and deterministic projection replay.
  - Unblocks: Observability hardening.

- [ ] **Task 7.4: Observability and Audit Hardening**
  - Why: The product must answer what ran, why, and what changed.
  - Depends on: Task 7.3.
  - Changes: Audit projection queries and evidence completeness tests.
  - Verify: Run, Attempt, Candidate, decision, commit, Recall, cost, and failure evidence are queryable.
  - Unblocks: Final acceptance.

- [ ] **Task 7.5: Full System Acceptance**
  - Why: Prove the complete architecture meets the frozen baseline and roadmap DoD.
  - Depends on: Tasks 7.1–7.4.
  - Changes: Acceptance verification only.
  - Verify: Global tests/typecheck, Frozen Core greps, cross-system contracts, deferred-scope audit.
  - Unblocks: Future product/engineering work.

**Verification:** System Verification only counts when domain, integration, persistence, transaction, concurrency, recovery, replay, and regression gates all pass.

**Exit Criteria:** Full architecture is implemented and verified; deferred scope remains deferred.

**Unblocks:** Future product/engineering work from a stable implementation baseline.

---

## 4. Phase Dependency Table

| Phase | Blocked by | Parallel opportunities | Unblocks |
| --- | --- | --- | --- |
| 0 Baseline Verification | None | None | Phase 1 |
| 1 Shared Foundations | Phase 0 | 1.1/1.2/1.3 after interface decisions | Phase 2 |
| 2 Shared Prerequisites | Phase 1 | 2.1/2.2/2.3 in parallel | Phases 3 and 4 |
| 3 Story Foundation | Phase 2, especially 2.2 | With Phase 4 after Phase 2 | Foundation integration |
| 4 Production Run | Phase 2, especially 2.1/2.3 | With Phase 3 after Phase 2 | Run-aware Recall |
| 5 Recall | Phase 1, 2.3, and Phase 4 for run awareness | Observation adapters can start after 2.3 | Cross-system Recall integration |
| 6 Cross-system Integration | Phases 3–5 | 6.1/6.2/6.3 can run independently after their capability pairs | Phase 7 |
| 7 Hardening | Phase 6 | 7.1/7.2/7.3 can be split by failure domain | Final DoD |

---

## 5. Detailed Task List

The phase task lists above are the implementation backlog. Each task is independently implementable and reviewable because it has:

- Why it exists.
- Dependencies.
- Changed capability boundary.
- Verification gate.
- Prerequisite it unlocks.

Task order is driven by dependency, not UI or feature priority.

---

## 6. Parallelizable Tasks

After Phase 2:

- Story Foundation entry/proposal tasks and Production Run plan/lifecycle tasks are parallelizable.
- Execution Attempt, Narrative Proposal/Adoption Decision, and Dependency/Impact prerequisite tasks are parallelizable within Phase 2.
- Recall observation adapters may start after shared observation and dependency contracts exist.
- Cross-system integration pairs may be implemented independently once both sides are complete.

Do not parallelize tasks that share mutable persistence migrations or transaction contracts without first stabilizing those interfaces in Phase 1.

---

## 7. Verification Strategy

### Domain Verification

- Unit tests for lifecycle, invariants, identity, immutability, and state transitions.
- Property/edge tests for revision identity, proposal branching, attempt retry identity, and recall disposition.
- Frozen Core regression tests remain mandatory.

### Integration Verification

- Application service flows across Proposal→Adoption→ChangeSet→Commit.
- Run Plan→Run→Task→Attempt→Candidate→Commit flows.
- Recall source→detection→Attention→disposition→re-check flows.
- Workspace query/contract tests.

### Persistence Verification

- InMemory and PostgreSQL round trips.
- Revision/history retention.
- Unique identity and CAS behavior.
- Transaction rollback and savepoint behavior.

### System Verification

- Concurrent Run/Commit/Recall scenarios.
- Failure, retry, fallback, compensation, and replay.
- Audit completeness.
- Cross-system command/observation boundary tests.
- Full `npm run typecheck` and `npm test -- --run`.

No capability is complete on unit-test PASS alone.

---

## 8. Cross-system Integration Order

1. Story Foundation ↔ Shared Novel Engine.
2. Production Run ↔ Shared Novel Engine.
3. Recall ↔ Shared Novel Engine.
4. Recall ↔ Production Run.
5. All capabilities ↔ Workspace contracts.

Required boundary assertions:

```text
Recall suggestion       != direct domain command
Checkpoint decision     != Narrative ReviewDecision
Run control             != Narrative approval
Foundation proposal     != Canon mutation
```

---

## 9. Risk / Dependency Bottlenecks

1. Missing Narrative Proposal / Adoption Decision blocks Story Foundation.
2. Missing Execution Attempt blocks Production Run execution identity and audit.
3. Missing Dependency Registry / Impact Analysis contracts blocks Recall and risk-aware checkpoints.
4. Persistence/transaction parity is the main shared infrastructure risk.
5. Event/replay contracts can become a bottleneck if capability events are added ad hoc.
6. Recall can become noisy or authoritative unless Attention and disposition boundaries are tested.
7. Checkpoint and ReviewDecision separation can leak orchestration decisions into narrative approval.
8. Run compensation can corrupt later author work if reverse eligibility is not tested.
9. Deferred algorithm/UI/provider work can accidentally expand scope if promoted without a dependency proof.

---

## 10. Exit Criteria for Every Phase

Every phase exits only when:

- Its tasks have domain-level tests.
- Its integration boundaries have contract/integration tests.
- Persistence/transaction behavior is verified where applicable.
- Global typecheck and current full test suite remain green.
- No Frozen Core semantic is changed.
- Deferred items remain deferred.
- The next phase's prerequisites are explicitly available.

---

## 11. Overall Definition of Done

The roadmap is complete when:

- Story Foundation supports Idea, Existing Text, and Blank entry through Proposal and Typed Adoption.
- Production Run supports immutable Run Plans, lifecycle, scheduling, checkpoints, retry/fallback/recovery, budget/policy, human coordination, audit, and safe compensation.
- Recall supports observation, detection, prioritization, evidence-backed Attention, author disposition, and re-check without workflow authority.
- All capabilities integrate through the Shared Novel Engine and Workspace contracts.
- Persistence, transaction, concurrency, recovery, replay, and cross-system verification pass.
- Global typecheck and tests pass.
- Frozen Core acceptance greps remain clean.
- Deferred scope remains unchanged.

---

## 12. Explicitly Deferred Work

Do not include in the first roadmap execution unless a dependency proof promotes it:

```text
Full UI design and implementation
Database redesign beyond capability persistence requirements
All model providers and prompt frameworks
Recall scoring/vector algorithms
Complete advanced validator catalog
Detailed DTO/API schema design
Pixel-level Workspace work
Date global immutability
Production-scale cost optimization
```

---

## 13. Recommended First Implementation Task

**Task 1.1 — Capability Persistence Port Patterns**

This task is first because every missing shared prerequisite and every new capability requires persistence and transaction behavior before its domain semantics can be implemented and verified. It is a root dependency shared by Narrative Proposal, Adoption Decision, Execution Attempt, Dependency/Impact contracts, Story Foundation, Production Run, and Recall.

After Task 1.1 stabilizes those ports, Task 2.1 is the first domain prerequisite for Production Run. Task 2.2 and Task 2.3 may begin in parallel with Task 2.1, but none of them should start before the shared persistence boundary is established.

---

## 14. Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-04-novel-brain-next-architecture-implementation-roadmap.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with two-stage review.
2. **Inline Execution** — execute tasks in this session with checkpoints.

The first implementation task is `Task 2.1 — Execution Attempt Lifecycle and Evidence`.
