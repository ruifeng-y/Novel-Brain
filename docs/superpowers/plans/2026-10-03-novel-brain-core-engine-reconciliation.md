# Novel Brain Core Engine Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Core Engine from Candidate-bound Validation / Approval / Commit to a Change Set Revision-bound model, and remove `GenerationTask.candidateIds` from aggregate state.

**Architecture:** Introduce the Change Set aggregate (Change Set + Change + immutable Change Set Revision) as the unified semantic subject, then re-bind ValidationRun, ReviewDecision, and NarrativeCommit to the Change Set Revision. `Candidate` becomes a Change Source and context only.

**Tech Stack:** TypeScript, Node.js 22, Vitest, existing Novel Brain Core Engine (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-10-03-novel-brain-product-and-experience-design.md`

## 1. Goal and Scope

This plan implements exactly the four Core Engine reconciliation items recorded in Spec Section 5.9:

```text
1. GenerationTask.candidateIds        -> remove from Aggregate State; derive by query
2. ValidationRun binding              -> Change Set Revision + Frozen Validation Plan Version
3. ReviewDecision binding             -> Change Set Revision + Approval Scope
4. NarrativeCommit binding            -> Change Set Revision
```

It also implements the minimum Change Set foundation those bindings depend on.

Out of scope: Production Run, Story Foundation Projection, Novel-level Open Questions / Health / Recall Projection, UI, provider integrations, performance tuning, and any new Entity Brainstorming.

## 2. Locked Constraints

Copied from the Spec and binding for every task:

```text
Change Set = Aggregate Root
Change Set Revision = Immutable Revision Snapshot
Validation is Change Set Revision-specific
Approval is Change Set Revision-specific
NarrativeCommit is Change Set Revision-specific
Candidate = Source / Context, never the final Validation / Approval / Commit target
GenerationTask = Definition + Lifecycle, never a history container
Every Change has exactly one Source and exactly one Target Address
Target Address = Target Type + Object Identity + Optional Sub-address
ReviewDecision is an immutable decision event; Pending is not one of its states
Approval State is a derived projection
Commit Gate is an aggregate of five independent gates, never a single state machine
All commit blockers are reported at once; fail-fast is forbidden
Validation, Approval, and Commit Gate are separate; none may be merged
Cross-aggregate references use Identity + Version + Hash only
```

## 3. Current Architecture Baseline

Verified against Git HEAD `8c18513`:

```text
src/production/domain/generationTask.ts
  GenerationTask { id, novelId, operation, targetSceneId, intent,
                   basedOnVersionSet, candidateIds[], status, createdAt, updatedAt }
  addCandidateReference(task, candidateId) appends to candidateIds
  completeGenerationTask requires candidateIds to be a subset of stored ids

src/production/domain/validationRun.ts
  ValidationRun { id, candidateId, candidateRevisionId, validatorId,
                  outcome, findings[], createdAt }

src/production/domain/reviewDecision.ts
  ReviewDecision { id, candidateId, candidateRevisionId, decision,
                   decidedBy, actorId, reason?, createdAt }

src/safety/domain/narrativeCommit.ts
  NarrativeCommit { id, novelId, candidateId, candidateRevisionId,
                    validationRunIds[], reviewDecisionId, basedOnVersionSet,
                    resultingVersionSet?, status, failureReason?, createdAt, updatedAt }

src/production/domain/candidate.ts
  Candidate { id, taskId, novelId, change, basedOnVersionSet,
              currentRevisionId, status, rejectionReason?, createdAt, updatedAt }

src/production/application/validateCandidate.ts
  calls createValidationRun with candidateId / candidateRevisionId
  (legacy Candidate-bound ValidationRun caller; produces the basic validator run)
```

Legacy path currently in force:

```text
Candidate -> ValidationRun -> ReviewDecision -> NarrativeCommit
```

## 4. Target Architecture

```text
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
Change Set Revision = unified Validation / Approval / Commit subject
```

```text
Change Set (Aggregate Root)
├── id, novelId
├── changes: Change[]
├── currentRevisionId
├── lifecycle: open | closed
├── closureDisposition?: committed | abandoned | superseded
└── createdAt, updatedAt

Change Set Revision (immutable)
├── revisionId, changeSetId, novelId
├── revisionNumber (monotonic)
├── parentRevisionId
├── trigger
├── changes: Change[]   (full snapshot)
└── createdAt
```

## 5. Reconciliation Dependency Graph

```text
Phase 1  Change Set / Change / Revision foundation
              |
              v
Phase 2  GenerationTask.candidateIds removal   (independent of Phase 1)

Phase 3  ValidationRun binding        (requires Phase 1)
Phase 4  ReviewDecision binding       (requires Phase 1)
Phase 5  NarrativeCommit binding      (requires Phase 3 and Phase 4)
Phase 6  Commit Gate + application service + legacy removal
```

Change Set / Change Set Revision is the shared prerequisite. ValidationRun, ReviewDecision, and NarrativeCommit must not keep Candidate-bound semantics as their formal target once migrated.

## 6. File Structure

```text
src/production/domain/
  change.ts                          NEW  Change + Target Address
  changeSet.ts                       NEW  Change Set aggregate
  changeSetRevision.ts               NEW  immutable revision + trigger
  changeSetDiff.ts                   NEW  revision diff
  changeSetRevisionProjection.ts     NEW  headline status projection
  generationTask.ts                  MOD  remove candidateIds
  validationRun.ts                   MOD  re-bind to Change Set Revision
  reviewDecision.ts                  MOD  re-bind to Change Set Revision
  candidate.ts                       KEEP unchanged

src/production/application/
  validateCandidate.ts               MOD  re-bind its ValidationRun to Change Set Revision + frozen plan version

src/safety/domain/
  narrativeCommit.ts                 MOD  re-bind to Change Set Revision
  commitGate.ts                      NEW  five-gate evaluation

src/safety/application/
  commitChangeSetRevision.ts         NEW  new commit path
  commitCandidate.ts                 DEL  legacy path removed in final task

tests/production/
  change.test.ts                     NEW
  changeSet.test.ts                  NEW
  changeSetRevision.test.ts          NEW
  changeSetDiff.test.ts              NEW
  changeSetRevisionProjection.test.ts NEW
  generationTask.test.ts             MOD
  validationRun.test.ts              MOD
  reviewDecision.test.ts             MOD
  basicValidator.test.ts             MOD

tests/safety/
  narrativeCommit.test.ts            MOD
  commitGate.test.ts                 NEW

tests/app/
  coCreationLoop.test.ts             MOD
tests/http/
  api.test.ts                        MOD
```

## 7. Domain Model Changes

```text
ADD  Change                { id, sourceType, sourceReference, targetAddress, payload, basedOnVersionSet }
ADD  TargetAddress         { targetType, objectId, subAddress? }
ADD  ChangeSet             { id, novelId, changes[], currentRevisionId, lifecycle, closureDisposition?, timestamps }
ADD  ChangeSetRevision     { revisionId, changeSetId, novelId, revisionNumber, parentRevisionId, trigger, changes[], createdAt }
ADD  RevisionTrigger       { type, references[] }
ADD  RevisionProjection    { headline, conflict, stale, submission, validation, approval, commit }
ADD  CommitGateResult      { allowed, blockers[], requiredActions[] }

MOD  GenerationTask        remove candidateIds; completion takes transient candidateIds
MOD  ValidationRun         { id, changeSetRevisionId, planVersionId, validatorId, entryResults[], executionState, outcome?, createdAt }
MOD  ReviewDecision        { id, changeSetRevisionId, approvalScope, decision, decidedBy, actorId, reason?, policyVersion?, decisionRule?, evidenceReferences[], createdAt }
MOD  NarrativeCommit       { id, novelId, changeSetRevisionId, validationRunIds[], reviewDecisionIds[], basedOnVersionSet, resultingVersionSet?, status, failureReason?, timestamps }

KEEP Candidate             unchanged; it becomes a Change Source and context only
DEL  commitCandidate       legacy application path
```

## 8. Migration Strategy

```text
Phase 1  Add Change Set / Change / Revision foundation. No existing behaviour changes.
Phase 2  Remove GenerationTask.candidateIds. Independent of Phase 1.
Phase 3  Re-bind ValidationRun. Legacy fields removed in the same task so no dual semantics exist.
Phase 4  Re-bind ReviewDecision. Same single-step removal.
Phase 5  Re-bind NarrativeCommit. Same single-step removal.
Phase 6  Add commitChangeSetRevision, then delete commitCandidate and update the API and app tests.
```

Rules:

```text
- No task leaves both Candidate-bound and ChangeSetRevision-bound semantics as a formal target.
- No task keeps a legacy field "for compatibility".
- Candidate remains usable as a Change Source and as context evidence.
```

## 9. Test Migration Strategy

```text
Rewrite  tests/production/generationTask.test.ts   -> completion invariant via transient input
Rewrite  tests/production/validationRun.test.ts    -> Change Set Revision + plan version binding
Rewrite  tests/production/reviewDecision.test.ts   -> Change Set Revision + approval scope binding
Rewrite  tests/safety/narrativeCommit.test.ts      -> Change Set Revision binding
Rebind   tests/production/basicValidator.test.ts   -> basic validator produces a Change Set Revision-bound ValidationRun (12 existing cases kept, binding case added)
Update   tests/app/coCreationLoop.test.ts          -> build Change Set Revision before commit
Update   tests/http/api.test.ts                    -> commit endpoint commits a Change Set Revision
Keep     tests/production/candidate.test.ts        -> Candidate semantics unchanged
Keep     tests/manuscript/*, tests/narrative/*, tests/memory/*, tests/shared/*, tests/safety/events.test.ts, tests/safety/rollbackScene.test.ts
```

## 10. Regression Coverage

New or updated coverage must include:

```text
Change Set lifecycle: open -> closed with disposition; double close rejected
Change: exactly one Source and one Target Address; stable target key
Change Set Revision: monotonic numbering, parent linkage, immutability, full snapshot
Revision Diff: unchanged / modified / added / removed by stable Change Identity
Revision Trigger: preconditions evaluated against status facts, not headline status
Revision Projection: headline priority Committed > Invalid > Stale > Approved > Validated/Failed > Submitted > Ready > Assembling
GenerationTask: no candidateIds state; completion requires transient candidate input
ValidationRun: Change Set Revision binding; outcome only when Completed; interrupted keeps partial evidence
Legacy validator caller: validateCandidate binds its ValidationRun to Change Set Revision + frozen plan version; Candidate stays context only; existing target-span / required-phrase behaviour preserved
ReviewDecision: Change Set Revision + Approval Scope binding; policy decisions require policy version and rule
NarrativeCommit: Change Set Revision binding; rejects mismatched revision
Commit Gate: all five gates evaluated, all blockers reported, no fail-fast
OCC: stale base version produces a blocker
Invariant: target invariant violation produces a blocker
Idempotency: committing the same Change Set Revision twice is rejected
Legacy removal: no Candidate-bound validation, approval, or commit target remains
```

## 11. Verification and Acceptance Criteria

```text
1.  `npm test -- --run` passes with no failures.
2.  `npm run typecheck` passes.
3.  `rg -n "candidateRevisionId" src` returns no ValidationRun / ReviewDecision / NarrativeCommit usage.
4.  `rg -n "candidateIds" src/production/domain/generationTask.ts` returns no match.
5.  ValidationRun, ReviewDecision, and NarrativeCommit expose only Change Set Revision bindings.
6.  `commitCandidate` no longer exists; `commitChangeSetRevision` is the only commit application path.
7.  Candidate remains a Change Source: an adopted Candidate produces a Change inside a Change Set.
8.  No file contains both Candidate-bound and ChangeSetRevision-bound formal target fields.
9.  Commit Gate reports every blocker in one evaluation.
10. Spec Section 5.9 reconciliation items are all implemented.
```

## 12. Risks and Rollback

```text
Risk  HTTP and app tests are tightly coupled to commitCandidate.
Mitigation  Phase 6 updates them in the same task that deletes commitCandidate, so the suite never sits red across a commit boundary.

Risk  Removing candidateIds could silently drop the "task must produce at least one candidate" invariant.
Mitigation  completeGenerationTask keeps the invariant as a transient input check, with a regression test.

Risk  Change Set Revision could accidentally be treated as mutable.
Mitigation  Revisions are created only by explicit factory functions and are frozen; a test asserts mutation throws.

Risk  Two semantic systems could coexist during migration.
Mitigation  Each re-binding task removes the legacy fields in the same commit.

Risk  The legacy basic validator could keep producing a Candidate-bound ValidationRun.
Mitigation  Task 8 migrates src/production/application/validateCandidate.ts in the same commit as the ValidationRun re-binding, keeps the capability and its 12 tests, and adds a binding case; nothing is deleted.
```

Rollback: every task is a single commit; reverting the offending commit restores the previous green state. No database migration is involved in this plan.

## 13. Explicitly Deferred Items

```text
Production Run / Run Plan / Checkpoint
Story Foundation Projection
Novel-level Open Questions / Health / Recall Projection
Conflict Record persistence and Conflict Resolution strategies
Rebase Automatic / Manual / Regenerate execution
Frozen Validation Plan assembly and Cache eligibility evaluation
Approval Requirement policy computation and Approval Gate aggregation
Database schema, indexes, DTOs, API shape, UI projection details
```

These are locked in design but not required for the four reconciliation items. They must not be invented during implementation.

---

## 14. Tasks

### Task 1: Change and Target Address

**Files:**
- Create: `src/production/domain/change.ts`
- Test: `tests/production/change.test.ts`

**Interfaces:**
- Consumes: `DomainId` from `src/shared/domain/ids.ts`; `VersionSet` from `src/shared/domain/versioning.ts`.
- Produces: `ChangeSourceType`, `ChangeSourceReference`, `TargetType`, `TargetAddress`, `ChangePayload`, `Change`, `createChange`, `targetAddressKey`, `assertNoDuplicateTargets`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  assertNoDuplicateTargets,
  createChange,
  targetAddressKey,
} from "../../src/production/domain/change";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const sceneVersion = createVersionReference("Scene", "scene-1", "scene-rev-1");

function baseInput() {
  return {
    id: "change-1",
    sourceType: "proposal_adoption" as const,
    sourceReference: { identity: "proposal-1", version: "r3", hash: "hash-1" },
    targetAddress: { targetType: "manuscript" as const, objectId: "scene-1" },
    payload: { text: "New text" },
    basedOnVersionSet: createVersionSet({ scene: sceneVersion }),
  };
}

describe("Change", () => {
  it("creates a change with exactly one source and one target address", () => {
    const change = createChange(baseInput());
    expect(change.sourceType).toBe("proposal_adoption");
    expect(change.targetAddress.objectId).toBe("scene-1");
    expect(change.sourceReference.identity).toBe("proposal-1");
  });

  it("rejects a missing source reference or target address", () => {
    expect(() => createChange({ ...baseInput(), sourceReference: undefined as never })).toThrow(
      "sourceReference is required",
    );
    expect(() => createChange({ ...baseInput(), targetAddress: undefined as never })).toThrow(
      "targetAddress is required",
    );
    expect(() =>
      createChange({ ...baseInput(), targetAddress: { targetType: "manuscript", objectId: "" } }),
    ).toThrow("targetAddress.objectId is required");
  });

  it("rejects an empty basedOnVersionSet", () => {
    expect(() => createChange({ ...baseInput(), basedOnVersionSet: createVersionSet({}) })).toThrow(
      "basedOnVersionSet must contain at least one dependency",
    );
  });

  it("builds a stable target key from target type and object id", () => {
    expect(targetAddressKey(createChange(baseInput()).targetAddress)).toBe("manuscript:scene-1");
  });

  it("includes the sub-address in the target key when present", () => {
    const change = createChange({
      ...baseInput(),
      targetAddress: {
        targetType: "story_state",
        objectId: "scene-1",
        subAddress: "character_state:john",
      },
    });
    expect(targetAddressKey(change.targetAddress)).toBe("story_state:scene-1#character_state:john");
  });

  it("freezes the change so callers cannot mutate it", () => {
    const change = createChange(baseInput());
    expect(() => {
      (change as { id: string }).id = "mutated";
    }).toThrow();
  });

  it("rejects two changes that share a target address", () => {
    const first = createChange(baseInput());
    const second = createChange({ ...baseInput(), id: "change-2" });
    expect(() => assertNoDuplicateTargets([first, second])).toThrow(
      "Duplicate target address in change set revision: manuscript:scene-1",
    );
    expect(() => assertNoDuplicateTargets([first])).not.toThrow();
  });

  it("deep-freezes nested payload content", () => {
    const change = createChange({
      ...baseInput(),
      payload: { text: "New text", meta: { tags: ["a"] } },
    });
    const meta = change.payload.meta as { tags: string[] };
    expect(() => meta.tags.push("b")).toThrow();
  });

  it("rejects a target object id containing the sub-address separator", () => {
    expect(() =>
      createChange({
        ...baseInput(),
        targetAddress: { targetType: "manuscript", objectId: "scene-1#x" },
      }),
    ).toThrow("targetAddress.objectId must not contain '#'");
  });

  it("rejects a sub-address containing the separator", () => {
    expect(() =>
      createChange({
        ...baseInput(),
        targetAddress: { targetType: "story_state", objectId: "scene-1", subAddress: "a#b" },
      }),
    ).toThrow("targetAddress.subAddress must not contain '#'");
  });

  it("treats the same object id with different sub-addresses as distinct addresses", () => {
    const first = createChange({
      ...baseInput(),
      id: "change-a",
      targetAddress: {
        targetType: "story_state",
        objectId: "scene-1",
        subAddress: "character_state:john",
      },
    });
    const second = createChange({
      ...baseInput(),
      id: "change-b",
      targetAddress: {
        targetType: "story_state",
        objectId: "scene-1",
        subAddress: "character_state:mary",
      },
    });
    expect(() => assertNoDuplicateTargets([first, second])).not.toThrow();
  });

  it("rejects two changes that share a sub-address", () => {
    const first = createChange({
      ...baseInput(),
      id: "change-a",
      targetAddress: {
        targetType: "story_state",
        objectId: "scene-1",
        subAddress: "character_state:john",
      },
    });
    const second = createChange({
      ...baseInput(),
      id: "change-b",
      targetAddress: {
        targetType: "story_state",
        objectId: "scene-1",
        subAddress: "character_state:john",
      },
    });
    expect(() => assertNoDuplicateTargets([first, second])).toThrow(
      "Duplicate target address in change set revision: story_state:scene-1#character_state:john",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/production/change.test.ts`
Expected: FAIL because `src/production/domain/change.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
import { deepFreeze } from "../../shared/domain/immutable";
import type { DomainId } from "../../shared/domain/ids";
import type { VersionSet } from "../../shared/domain/versioning";

export type ChangeSourceType =
  | "proposal_adoption"
  | "candidate"
  | "author_edit"
  | "conflict_resolution";

export interface ChangeSourceReference {
  readonly identity: DomainId;
  readonly version: string;
  readonly hash: string;
}

export type TargetType =
  | "canonical_fact"
  | "plan"
  | "structure"
  | "manuscript"
  | "story_state";

export interface TargetAddress {
  readonly targetType: TargetType;
  readonly objectId: DomainId;
  readonly subAddress?: string;
}

export type ChangePayload = Readonly<Record<string, unknown>>;

export interface Change {
  readonly id: DomainId;
  readonly sourceType: ChangeSourceType;
  readonly sourceReference: ChangeSourceReference;
  readonly targetAddress: TargetAddress;
  readonly payload: ChangePayload;
  readonly basedOnVersionSet: VersionSet;
}

export function createChange(input: {
  id: DomainId;
  sourceType: ChangeSourceType;
  sourceReference: ChangeSourceReference;
  targetAddress: TargetAddress;
  payload: ChangePayload;
  basedOnVersionSet: VersionSet;
}): Change {
  if (!input.id) throw new Error("id is required");
  if (!input.sourceReference) throw new Error("sourceReference is required");
  if (!input.sourceReference.identity) throw new Error("sourceReference.identity is required");
  if (!input.sourceReference.version) throw new Error("sourceReference.version is required");
  if (!input.sourceReference.hash) throw new Error("sourceReference.hash is required");
  if (!input.targetAddress) throw new Error("targetAddress is required");
  if (!input.targetAddress.objectId) throw new Error("targetAddress.objectId is required");
  if (input.targetAddress.objectId.includes("#")) {
    throw new Error("targetAddress.objectId must not contain '#'");
  }
  if (input.targetAddress.subAddress?.includes("#")) {
    throw new Error("targetAddress.subAddress must not contain '#'");
  }
  if (Object.keys(input.basedOnVersionSet).length === 0) {
    throw new Error("basedOnVersionSet must contain at least one dependency");
  }

  return Object.freeze({
    id: input.id,
    sourceType: input.sourceType,
    sourceReference: deepFreeze({ ...input.sourceReference }),
    targetAddress: deepFreeze({ ...input.targetAddress }),
    payload: deepFreeze({ ...input.payload }),
    basedOnVersionSet: input.basedOnVersionSet,
  });
}

export function targetAddressKey(address: TargetAddress): string {
  const base = `${address.targetType}:${address.objectId}`;
  return address.subAddress ? `${base}#${address.subAddress}` : base;
}

export function assertNoDuplicateTargets(changes: readonly Change[]): void {
  const seen = new Set<string>();
  for (const change of changes) {
    const key = targetAddressKey(change.targetAddress);
    if (seen.has(key)) {
      throw new Error(`Duplicate target address in change set revision: ${key}`);
    }
    seen.add(key);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/production/change.test.ts`
Expected: PASS with 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/production/domain/change.ts tests/production/change.test.ts
git commit -m "feat: add change and target address"
```

### Task 2: Change Set Aggregate

**Files:**
- Create: `src/production/domain/changeSet.ts`
- Test: `tests/production/changeSet.test.ts`

**Interfaces:**
- Consumes: `DomainId`, `RevisionId`; `Change` from Task 1.
- Produces: `ChangeSetLifecycle`, `ChangeSetClosureDisposition`, `ChangeSet`, `createChangeSet`, `closeChangeSet`, `replaceChangeSetChanges`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  closeChangeSet,
  createChangeSet,
  replaceChangeSetChanges,
} from "../../src/production/domain/changeSet";
import { createChange } from "../../src/production/domain/change";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-03T00:00:00.000Z");
const later = new Date("2026-10-04T00:00:00.000Z");

function change(id: string) {
  return createChange({
    id,
    sourceType: "author_edit",
    sourceReference: { identity: "author-1", version: "r1", hash: `hash-${id}` },
    targetAddress: { targetType: "manuscript", objectId: "scene-1" },
    payload: { text: id },
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
    }),
  });
}

describe("ChangeSet aggregate", () => {
  it("creates an open change set with no changes and an initial revision", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    expect(changeSet).toMatchObject({
      id: "cs-1",
      novelId: "novel-1",
      changes: [],
      currentRevisionId: "cs-1-r1",
      lifecycle: "open",
    });
    expect(changeSet.closureDisposition).toBeUndefined();
  });

  it("requires id, novelId, and initialRevisionId", () => {
    expect(() =>
      createChangeSet({ id: "", novelId: "novel-1", initialRevisionId: "r1", createdAt: now }),
    ).toThrow("id is required");
    expect(() =>
      createChangeSet({ id: "cs-1", novelId: "", initialRevisionId: "r1", createdAt: now }),
    ).toThrow("novelId is required");
    expect(() =>
      createChangeSet({ id: "cs-1", novelId: "novel-1", initialRevisionId: "", createdAt: now }),
    ).toThrow("initialRevisionId is required");
  });

  it("rejects two unresolved changes on the same target", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    expect(() =>
      replaceChangeSetChanges({
        changeSet,
        changes: [change("change-1"), change("change-2")],
        revisionId: "cs-1-r2",
        updatedAt: later,
      }),
    ).toThrow("Duplicate target address in change set revision: manuscript:scene-1");
  });

  it("replaces changes as a new revision without mutating the original", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    const updated = replaceChangeSetChanges({
      changeSet,
      changes: [change("change-1")],
      revisionId: "cs-1-r2",
      updatedAt: later,
    });
    expect(changeSet.changes).toHaveLength(0);
    expect(updated.changes).toHaveLength(1);
    expect(updated.currentRevisionId).toBe("cs-1-r2");
  });

  it("closes with a disposition and refuses a second close", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    const closed = closeChangeSet({ changeSet, disposition: "committed", updatedAt: later });
    expect(closed.lifecycle).toBe("closed");
    expect(closed.closureDisposition).toBe("committed");
    expect(() =>
      closeChangeSet({ changeSet: closed, disposition: "abandoned", updatedAt: later }),
    ).toThrow("Change set is already closed");
  });

  it("refuses to modify a closed change set", () => {
    const changeSet = createChangeSet({
      id: "cs-1",
      novelId: "novel-1",
      initialRevisionId: "cs-1-r1",
      createdAt: now,
    });
    const closed = closeChangeSet({ changeSet, disposition: "abandoned", updatedAt: later });
    expect(() =>
      replaceChangeSetChanges({
        changeSet: closed,
        changes: [change("change-1")],
        revisionId: "cs-1-r2",
        updatedAt: later,
      }),
    ).toThrow("Closed change set cannot be modified");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/production/changeSet.test.ts`
Expected: FAIL because `src/production/domain/changeSet.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
import type { DomainId, RevisionId } from "../../shared/domain/ids";
import { assertNoDuplicateTargets, type Change } from "./change";

export type ChangeSetLifecycle = "open" | "closed";
export type ChangeSetClosureDisposition = "committed" | "abandoned" | "superseded";

export interface ChangeSet {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly changes: readonly Change[];
  readonly currentRevisionId: RevisionId;
  readonly lifecycle: ChangeSetLifecycle;
  readonly closureDisposition?: ChangeSetClosureDisposition;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function createChangeSet(input: {
  id: DomainId;
  novelId: DomainId;
  initialRevisionId: RevisionId;
  createdAt: Date;
}): ChangeSet {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.initialRevisionId) throw new Error("initialRevisionId is required");

  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    changes: Object.freeze([]),
    currentRevisionId: input.initialRevisionId,
    lifecycle: "open",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function replaceChangeSetChanges(input: {
  changeSet: ChangeSet;
  changes: readonly Change[];
  revisionId: RevisionId;
  updatedAt: Date;
}): ChangeSet {
  if (input.changeSet.lifecycle === "closed") {
    throw new Error("Closed change set cannot be modified");
  }
  if (!input.revisionId) throw new Error("revisionId is required");
  if (input.updatedAt < input.changeSet.updatedAt) {
    throw new Error("updatedAt cannot move backward");
  }
  assertNoDuplicateTargets(input.changes);

  return Object.freeze({
    ...input.changeSet,
    changes: Object.freeze([...input.changes]),
    currentRevisionId: input.revisionId,
    updatedAt: input.updatedAt,
  });
}

export function closeChangeSet(input: {
  changeSet: ChangeSet;
  disposition: ChangeSetClosureDisposition;
  updatedAt: Date;
}): ChangeSet {
  if (input.changeSet.lifecycle === "closed") {
    throw new Error("Change set is already closed");
  }
  if (input.updatedAt < input.changeSet.updatedAt) {
    throw new Error("updatedAt cannot move backward");
  }

  return Object.freeze({
    ...input.changeSet,
    lifecycle: "closed",
    closureDisposition: input.disposition,
    updatedAt: input.updatedAt,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/production/changeSet.test.ts`
Expected: PASS with 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/production/domain/changeSet.ts tests/production/changeSet.test.ts
git commit -m "feat: add change set aggregate"
```

### Task 3: Change Set Revision

**Files:**
- Create: `src/production/domain/changeSetRevision.ts`
- Test: `tests/production/changeSetRevision.test.ts`

**Interfaces:**
- Consumes: `DomainId`, `RevisionId`; `Change`, `assertNoDuplicateTargets` from Task 1.
- Produces: `RevisionTriggerType`, `RevisionTrigger`, `ChangeSetRevision`, `createInitialChangeSetRevision`, `createChangeSetRevision`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createChange } from "../../src/production/domain/change";
import {
  createChangeSetRevision,
  createInitialChangeSetRevision,
} from "../../src/production/domain/changeSetRevision";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-03T00:00:00.000Z");
const later = new Date("2026-10-04T00:00:00.000Z");

function change(id: string, objectId = "scene-1") {
  return createChange({
    id,
    sourceType: "author_edit",
    sourceReference: { identity: "author-1", version: "r1", hash: `hash-${id}` },
    targetAddress: { targetType: "manuscript", objectId },
    payload: { text: id },
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", objectId, "scene-rev-1"),
    }),
  });
}

function initial() {
  return createInitialChangeSetRevision({
    revisionId: "cs-1-r1",
    changeSetId: "cs-1",
    novelId: "novel-1",
    createdAt: now,
  });
}

describe("ChangeSetRevision", () => {
  it("creates the initial revision with number 1 and no parent", () => {
    const revision = initial();
    expect(revision).toMatchObject({
      revisionId: "cs-1-r1",
      changeSetId: "cs-1",
      revisionNumber: 1,
      changes: [],
    });
    expect(revision.trigger.type).toBe("initial_assembly");
    expect(revision.parentRevisionId).toBeUndefined();
  });

  it("increments the revision number and links to the parent", () => {
    const child = createChangeSetRevision({
      parent: initial(),
      revisionId: "cs-1-r2",
      trigger: { type: "edit", references: [] },
      changes: [change("change-1")],
      createdAt: later,
    });
    expect(child.revisionNumber).toBe(2);
    expect(child.parentRevisionId).toBe("cs-1-r1");
    expect(child.changes).toHaveLength(1);
  });

  it("rejects a duplicate target address inside one revision", () => {
    expect(() =>
      createChangeSetRevision({
        parent: initial(),
        revisionId: "cs-1-r2",
        trigger: { type: "edit", references: [] },
        changes: [change("change-1"), change("change-2")],
        createdAt: later,
      }),
    ).toThrow("Duplicate target address in change set revision: manuscript:scene-1");
  });

  it("is immutable", () => {
    expect(() => {
      (initial() as { revisionNumber: number }).revisionNumber = 99;
    }).toThrow();
  });

  it("requires identity fields", () => {
    expect(() =>
      createInitialChangeSetRevision({
        revisionId: "",
        changeSetId: "cs-1",
        novelId: "novel-1",
        createdAt: now,
      }),
    ).toThrow("revisionId is required");
    expect(() =>
      createInitialChangeSetRevision({
        revisionId: "cs-1-r1",
        changeSetId: "",
        novelId: "novel-1",
        createdAt: now,
      }),
    ).toThrow("changeSetId is required");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/production/changeSetRevision.test.ts`
Expected: FAIL because `src/production/domain/changeSetRevision.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
import type { DomainId, RevisionId } from "../../shared/domain/ids";
import { assertNoDuplicateTargets, type Change } from "./change";

export type RevisionTriggerType =
  | "initial_assembly"
  | "edit"
  | "conflict_resolution"
  | "rebase"
  | "regenerate";

export interface RevisionTrigger {
  readonly type: RevisionTriggerType;
  readonly references: readonly string[];
}

export interface ChangeSetRevision {
  readonly revisionId: RevisionId;
  readonly changeSetId: DomainId;
  readonly novelId: DomainId;
  readonly revisionNumber: number;
  readonly parentRevisionId?: RevisionId;
  readonly trigger: RevisionTrigger;
  readonly changes: readonly Change[];
  readonly createdAt: Date;
}

function freezeRevision(input: {
  revisionId: RevisionId;
  changeSetId: DomainId;
  novelId: DomainId;
  revisionNumber: number;
  parentRevisionId?: RevisionId;
  trigger: RevisionTrigger;
  changes: readonly Change[];
  createdAt: Date;
}): ChangeSetRevision {
  assertNoDuplicateTargets(input.changes);
  return Object.freeze({
    revisionId: input.revisionId,
    changeSetId: input.changeSetId,
    novelId: input.novelId,
    revisionNumber: input.revisionNumber,
    parentRevisionId: input.parentRevisionId,
    trigger: Object.freeze({
      type: input.trigger.type,
      references: Object.freeze([...input.trigger.references]),
    }),
    changes: Object.freeze([...input.changes]),
    createdAt: input.createdAt,
  });
}

export function createInitialChangeSetRevision(input: {
  revisionId: RevisionId;
  changeSetId: DomainId;
  novelId: DomainId;
  createdAt: Date;
}): ChangeSetRevision {
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.changeSetId) throw new Error("changeSetId is required");
  if (!input.novelId) throw new Error("novelId is required");

  return freezeRevision({
    revisionId: input.revisionId,
    changeSetId: input.changeSetId,
    novelId: input.novelId,
    revisionNumber: 1,
    trigger: { type: "initial_assembly", references: [] },
    changes: [],
    createdAt: input.createdAt,
  });
}

export function createChangeSetRevision(input: {
  parent: ChangeSetRevision;
  revisionId: RevisionId;
  trigger: RevisionTrigger;
  changes: readonly Change[];
  createdAt: Date;
}): ChangeSetRevision {
  if (!input.revisionId) throw new Error("revisionId is required");

  return freezeRevision({
    revisionId: input.revisionId,
    changeSetId: input.parent.changeSetId,
    novelId: input.parent.novelId,
    revisionNumber: input.parent.revisionNumber + 1,
    parentRevisionId: input.parent.revisionId,
    trigger: input.trigger,
    changes: input.changes,
    createdAt: input.createdAt,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/production/changeSetRevision.test.ts`
Expected: PASS with 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/production/domain/changeSetRevision.ts tests/production/changeSetRevision.test.ts
git commit -m "feat: add immutable change set revision"
```

### Task 4: Revision Diff

**Files:**
- Create: `src/production/domain/changeSetDiff.ts`
- Test: `tests/production/changeSetDiff.test.ts`

**Interfaces:**
- Consumes: `Change`, `targetAddressKey` from Task 1.
- Produces: `ChangeDiffAction`, `ChangeDiffEntry`, `diffChangeSets`, `isRevisionContentChange`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createChange } from "../../src/production/domain/change";
import {
  diffChangeSets,
  isRevisionContentChange,
} from "../../src/production/domain/changeSetDiff";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

function change(input: {
  id: string;
  objectId?: string;
  text?: string;
  revisionId?: string;
}) {
  const objectId = input.objectId ?? "scene-1";
  return createChange({
    id: input.id,
    sourceType: "author_edit",
    sourceReference: { identity: "author-1", version: "r1", hash: `hash-${input.id}` },
    targetAddress: { targetType: "manuscript", objectId },
    payload: { text: input.text ?? input.id },
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", objectId, input.revisionId ?? "scene-rev-1"),
    }),
  });
}

describe("changeSetDiff", () => {
  it("classifies unchanged, modified, and added changes", () => {
    const parent = [change({ id: "change-1" }), change({ id: "change-2", objectId: "scene-2" })];
    const child = [
      change({ id: "change-1" }),
      change({ id: "change-2", objectId: "scene-2", text: "changed" }),
      change({ id: "change-3", objectId: "scene-3" }),
    ];

    const diff = diffChangeSets(parent, child);
    expect(diff.find(entry => entry.changeId === "change-1")?.action).toBe("unchanged");
    expect(diff.find(entry => entry.changeId === "change-2")?.action).toBe("modified");
    expect(diff.find(entry => entry.changeId === "change-3")?.action).toBe("added");
  });

  it("reports removed changes", () => {
    expect(diffChangeSets([change({ id: "change-1" })], [])).toEqual([
      { changeId: "change-1", action: "removed" },
    ]);
  });

  it("treats a basedOnVersionSet change as modified", () => {
    const parent = [change({ id: "change-1" })];
    const child = [change({ id: "change-1", revisionId: "scene-rev-2" })];
    expect(diffChangeSets(parent, child)).toEqual([{ changeId: "change-1", action: "modified" }]);
  });

  it("detects whether a revision contains any content change", () => {
    const parent = [change({ id: "change-1" })];
    expect(isRevisionContentChange(parent, [change({ id: "change-1" })])).toBe(false);
    expect(isRevisionContentChange(parent, [])).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/production/changeSetDiff.test.ts`
Expected: FAIL because `src/production/domain/changeSetDiff.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
import type { DomainId } from "../../shared/domain/ids";
import { targetAddressKey, type Change } from "./change";

export type ChangeDiffAction = "unchanged" | "modified" | "added" | "removed";

export interface ChangeDiffEntry {
  readonly changeId: DomainId;
  readonly action: ChangeDiffAction;
}

function fingerprint(change: Change): string {
  const versionEntries = Object.entries(change.basedOnVersionSet)
    .map(([key, reference]) => [
      key,
      reference.aggregateType,
      reference.objectId,
      reference.revisionId,
    ])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));

  return JSON.stringify({
    sourceType: change.sourceType,
    sourceReference: change.sourceReference,
    target: targetAddressKey(change.targetAddress),
    payload: change.payload,
    versionEntries,
  });
}

export function diffChangeSets(
  parent: readonly Change[],
  child: readonly Change[],
): readonly ChangeDiffEntry[] {
  const parentById = new Map(parent.map(change => [change.id, change]));
  const childById = new Map(child.map(change => [change.id, change]));
  const entries: ChangeDiffEntry[] = [];

  for (const [id, childChange] of childById) {
    const parentChange = parentById.get(id);
    if (!parentChange) {
      entries.push(Object.freeze({ changeId: id, action: "added" }));
      continue;
    }
    entries.push(
      Object.freeze({
        changeId: id,
        action: fingerprint(parentChange) === fingerprint(childChange) ? "unchanged" : "modified",
      }),
    );
  }

  for (const id of parentById.keys()) {
    if (!childById.has(id)) {
      entries.push(Object.freeze({ changeId: id, action: "removed" }));
    }
  }

  return Object.freeze(entries);
}

export function isRevisionContentChange(
  parent: readonly Change[],
  child: readonly Change[],
): boolean {
  return diffChangeSets(parent, child).some(entry => entry.action !== "unchanged");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/production/changeSetDiff.test.ts`
Expected: PASS with 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/production/domain/changeSetDiff.ts tests/production/changeSetDiff.test.ts
git commit -m "feat: add change set revision diff"
```

### Task 5: Revision Trigger Preconditions

**Files:**
- Create: `src/production/domain/revisionTriggerPolicy.ts`
- Test: `tests/production/revisionTriggerPolicy.test.ts`

**Interfaces:**
- Consumes: `RevisionTrigger`, `RevisionTriggerType` from Task 3; `ChangeSetLifecycle` from Task 2.
- Produces: `TriggerStatusFacts`, `assertTriggerPreconditions`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  assertTriggerPreconditions,
  type TriggerStatusFacts,
} from "../../src/production/domain/revisionTriggerPolicy";

function facts(overrides: Partial<TriggerStatusFacts> = {}): TriggerStatusFacts {
  return {
    changeSetLifecycle: "open",
    parentCommitted: false,
    unresolvedConflict: false,
    stale: false,
    hasReExecutableSource: false,
    ...overrides,
  };
}

describe("revision trigger preconditions", () => {
  it("always allows initial assembly", () => {
    expect(() =>
      assertTriggerPreconditions({ type: "initial_assembly", references: [] }, facts()),
    ).not.toThrow();
  });

  it("allows edit only on an open change set with a non-committed parent", () => {
    expect(() =>
      assertTriggerPreconditions({ type: "edit", references: [] }, facts()),
    ).not.toThrow();
    expect(() =>
      assertTriggerPreconditions(
        { type: "edit", references: [] },
        facts({ changeSetLifecycle: "closed" }),
      ),
    ).toThrow("Edit requires an open change set");
    expect(() =>
      assertTriggerPreconditions(
        { type: "edit", references: [] },
        facts({ parentCommitted: true }),
      ),
    ).toThrow("Edit requires a parent revision that is not committed");
  });

  it("requires an unresolved conflict for conflict resolution", () => {
    expect(() =>
      assertTriggerPreconditions({ type: "conflict_resolution", references: ["c-1"] }, facts()),
    ).toThrow("Conflict resolution requires an unresolved conflict");
    expect(() =>
      assertTriggerPreconditions(
        { type: "conflict_resolution", references: ["c-1"] },
        facts({ unresolvedConflict: true }),
      ),
    ).not.toThrow();
  });

  it("requires staleness for rebase", () => {
    expect(() =>
      assertTriggerPreconditions({ type: "rebase", references: [] }, facts()),
    ).toThrow("Rebase requires a stale revision");
    expect(() =>
      assertTriggerPreconditions({ type: "rebase", references: [] }, facts({ stale: true })),
    ).not.toThrow();
  });

  it("requires a re-executable source for regenerate", () => {
    expect(() =>
      assertTriggerPreconditions({ type: "regenerate", references: [] }, facts()),
    ).toThrow("Regenerate requires a re-executable source");
    expect(() =>
      assertTriggerPreconditions(
        { type: "regenerate", references: [] },
        facts({ hasReExecutableSource: true }),
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/production/revisionTriggerPolicy.test.ts`
Expected: FAIL because `src/production/domain/revisionTriggerPolicy.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
import type { ChangeSetLifecycle } from "./changeSet";
import type { RevisionTrigger } from "./changeSetRevision";

export interface TriggerStatusFacts {
  readonly changeSetLifecycle: ChangeSetLifecycle;
  readonly parentCommitted: boolean;
  readonly unresolvedConflict: boolean;
  readonly stale: boolean;
  readonly hasReExecutableSource: boolean;
}

export function assertTriggerPreconditions(
  trigger: RevisionTrigger,
  facts: TriggerStatusFacts,
): void {
  switch (trigger.type) {
    case "initial_assembly":
      return;
    case "edit":
      if (facts.changeSetLifecycle !== "open") {
        throw new Error("Edit requires an open change set");
      }
      if (facts.parentCommitted) {
        throw new Error("Edit requires a parent revision that is not committed");
      }
      return;
    case "conflict_resolution":
      if (!facts.unresolvedConflict) {
        throw new Error("Conflict resolution requires an unresolved conflict");
      }
      return;
    case "rebase":
      if (!facts.stale) {
        throw new Error("Rebase requires a stale revision");
      }
      return;
    case "regenerate":
      if (!facts.hasReExecutableSource) {
        throw new Error("Regenerate requires a re-executable source");
      }
      return;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/production/revisionTriggerPolicy.test.ts`
Expected: PASS with 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/production/domain/revisionTriggerPolicy.ts tests/production/revisionTriggerPolicy.test.ts
git commit -m "feat: add revision trigger preconditions"
```

### Task 6: Revision Status Projection

**Files:**
- Create: `src/production/domain/changeSetRevisionProjection.ts`
- Test: `tests/production/changeSetRevisionProjection.test.ts`

**Interfaces:**
- Produces: `RevisionProjectionFacts`, `RevisionHeadlineStatus`, `RevisionProjection`, `projectRevision`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  projectRevision,
  type RevisionProjectionFacts,
} from "../../src/production/domain/changeSetRevisionProjection";

function facts(overrides: Partial<RevisionProjectionFacts> = {}): RevisionProjectionFacts {
  return {
    committed: false,
    unresolvedConflict: false,
    stale: false,
    approved: false,
    submitted: false,
    hasChanges: false,
    ...overrides,
  };
}

describe("revision status projection", () => {
  it("reports assembling for an empty, unsubmitted revision", () => {
    expect(projectRevision(facts()).headline).toBe("assembling");
  });

  it("reports ready once the revision has changes", () => {
    expect(projectRevision(facts({ hasChanges: true })).headline).toBe("ready");
  });

  it("reports submitted before validation", () => {
    expect(projectRevision(facts({ hasChanges: true, submitted: true })).headline).toBe("submitted");
  });

  it("maps validation outcomes to validated, failed, or needs_review", () => {
    expect(projectRevision(facts({ submitted: true, validationOutcome: "pass" })).headline).toBe(
      "validated",
    );
    expect(projectRevision(facts({ submitted: true, validationOutcome: "fail" })).headline).toBe(
      "failed",
    );
    expect(
      projectRevision(facts({ submitted: true, validationOutcome: "needs_review" })).headline,
    ).toBe("needs_review");
  });

  it("prioritises committed over invalid, stale, and approved", () => {
    expect(
      projectRevision(
        facts({ committed: true, unresolvedConflict: true, stale: true, approved: true }),
      ).headline,
    ).toBe("committed");
    expect(
      projectRevision(facts({ unresolvedConflict: true, stale: true, approved: true })).headline,
    ).toBe("invalid");
    expect(projectRevision(facts({ stale: true, approved: true })).headline).toBe("stale");
    expect(projectRevision(facts({ approved: true, validationOutcome: "pass" })).headline).toBe(
      "approved",
    );
  });

  it("keeps blocking facts visible alongside the headline", () => {
    const projection = projectRevision(
      facts({ unresolvedConflict: true, stale: true, validationOutcome: "pass", approved: true }),
    );
    expect(projection.headline).toBe("invalid");
    expect(projection.unresolvedConflict).toBe(true);
    expect(projection.stale).toBe(true);
    expect(projection.validationOutcome).toBe("pass");
    expect(projection.approved).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/production/changeSetRevisionProjection.test.ts`
Expected: FAIL because `src/production/domain/changeSetRevisionProjection.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
export type ValidationOutcome = "pass" | "fail" | "needs_review";

export type RevisionHeadlineStatus =
  | "committed"
  | "invalid"
  | "stale"
  | "approved"
  | "validated"
  | "failed"
  | "needs_review"
  | "submitted"
  | "ready"
  | "assembling";

export interface RevisionProjectionFacts {
  readonly committed: boolean;
  readonly unresolvedConflict: boolean;
  readonly stale: boolean;
  readonly approved: boolean;
  readonly submitted: boolean;
  readonly hasChanges: boolean;
  readonly validationOutcome?: ValidationOutcome;
}

export interface RevisionProjection {
  readonly headline: RevisionHeadlineStatus;
  readonly committed: boolean;
  readonly unresolvedConflict: boolean;
  readonly stale: boolean;
  readonly approved: boolean;
  readonly submitted: boolean;
  readonly validationOutcome?: ValidationOutcome;
}

function resolveHeadline(facts: RevisionProjectionFacts): RevisionHeadlineStatus {
  if (facts.committed) return "committed";
  if (facts.unresolvedConflict) return "invalid";
  if (facts.stale) return "stale";
  if (facts.approved) return "approved";
  if (facts.validationOutcome === "fail") return "failed";
  if (facts.validationOutcome === "needs_review") return "needs_review";
  if (facts.validationOutcome === "pass") return "validated";
  if (facts.submitted) return "submitted";
  if (facts.hasChanges) return "ready";
  return "assembling";
}

export function projectRevision(facts: RevisionProjectionFacts): RevisionProjection {
  return Object.freeze({
    headline: resolveHeadline(facts),
    committed: facts.committed,
    unresolvedConflict: facts.unresolvedConflict,
    stale: facts.stale,
    approved: facts.approved,
    submitted: facts.submitted,
    validationOutcome: facts.validationOutcome,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/production/changeSetRevisionProjection.test.ts`
Expected: PASS with 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/production/domain/changeSetRevisionProjection.ts tests/production/changeSetRevisionProjection.test.ts
git commit -m "feat: add revision status projection"
```

### Task 7: Remove GenerationTask.candidateIds

**Files:**
- Modify: `src/production/domain/generationTask.ts`
- Modify: `src/http/routes.ts`
- Modify: `tests/production/generationTask.test.ts`

**Interfaces:**
- Consumes: `DomainId`, `VersionSet`.
- Produces: `GenerationTask` without `candidateIds`; `completeGenerationTask` taking transient `candidateIds`.
- Removes: `addCandidateReference`.

- [ ] **Step 1: Rewrite the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  cancelGenerationTask,
  completeGenerationTask,
  createGenerationTask,
  markGenerationTaskStale,
  startGenerationTask,
} from "../../src/production/domain/generationTask";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-03T00:00:00.000Z");
const sceneVersion = createVersionReference("Scene", "scene-1", "scene-rev-1");

function task() {
  return createGenerationTask({
    id: "task-1",
    novelId: "novel-1",
    operation: "rewrite",
    targetSceneId: "scene-1",
    intent: "Rewrite the second paragraph with more tension.",
    basedOnVersionSet: createVersionSet({ scene: sceneVersion }),
    createdAt: now,
  });
}

describe("GenerationTask", () => {
  it("stores definition and lifecycle without a candidate id collection", () => {
    const created = task();
    expect(created.status).toBe("draft");
    expect(Object.prototype.hasOwnProperty.call(created, "candidateIds")).toBe(false);
  });

  it("requires a based-on version set that includes the target scene", () => {
    expect(() =>
      createGenerationTask({
        id: "task-1",
        novelId: "novel-1",
        operation: "rewrite",
        targetSceneId: "scene-1",
        intent: "Rewrite.",
        basedOnVersionSet: createVersionSet({}),
        createdAt: now,
      }),
    ).toThrow("basedOnVersionSet must contain the target scene version");
  });

  it("completes only with at least one transient candidate id", () => {
    const running = startGenerationTask(task(), now);
    expect(() =>
      completeGenerationTask({ task: running, candidateIds: [], updatedAt: now }),
    ).toThrow("GenerationTask requires at least one candidate to complete");
    const completed = completeGenerationTask({
      task: running,
      candidateIds: ["candidate-1"],
      updatedAt: now,
    });
    expect(completed.status).toBe("completed");
    expect(Object.prototype.hasOwnProperty.call(completed, "candidateIds")).toBe(false);
  });

  it("rejects starting a terminal task", () => {
    const stale = markGenerationTaskStale(task(), now);
    expect(() => startGenerationTask(stale, now)).toThrow("Only a draft or ready task can start");
  });

  it("cancels a non-terminal task", () => {
    expect(cancelGenerationTask(task(), now).status).toBe("cancelled");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/production/generationTask.test.ts`
Expected: FAIL because `GenerationTask` still exposes `candidateIds` and `addCandidateReference`.

- [ ] **Step 3: Modify the domain model**

In `src/production/domain/generationTask.ts`:

1. Delete the `candidateIds` field from the `GenerationTask` interface.
2. Delete `candidateIds: Object.freeze([])` from `createGenerationTask`.
3. Delete the whole `addCandidateReference` function.
4. Replace `completeGenerationTask` with the version below.

```ts
export function completeGenerationTask(input: {
  task: GenerationTask;
  candidateIds: readonly DomainId[];
  updatedAt: Date;
}): GenerationTask {
  if (input.candidateIds.length === 0) {
    throw new Error("GenerationTask requires at least one candidate to complete");
  }
  if (input.task.status !== "running") throw new Error("Only a running task can complete");
  if (input.updatedAt < input.task.updatedAt) throw new Error("updatedAt cannot move backward");

  return Object.freeze({
    ...input.task,
    status: "completed",
    updatedAt: input.updatedAt,
  });
}
```

The completion invariant is preserved as a transient check; the candidate association is now derived from `Candidate.taskId`.

- [ ] **Step 4: Update the HTTP route**

In `src/http/routes.ts`:

1. Remove `addCandidateReference` from the `generationTask` import.
2. Replace `const updatedTask = addCandidateReference(startedTask, candidate.id);` with `const updatedTask = startedTask;`.

The route still saves the task and the candidate; the association is derived from `Candidate.taskId`.

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
npm test -- --run tests/production/generationTask.test.ts
npm test -- --run tests/http/api.test.ts
npm run typecheck
```

Expected: PASS. `api.test.ts` may need its task assertions adjusted if they referenced `candidateIds`; remove any such assertion rather than restoring the field.

- [ ] **Step 6: Commit**

```bash
git add src/production/domain/generationTask.ts src/http/routes.ts tests/production/generationTask.test.ts tests/http/api.test.ts
git commit -m "refactor: remove generation task candidate id state"
```

### Task 8: Re-bind ValidationRun to Change Set Revision

**Files:**
- Modify: `src/production/domain/validationRun.ts`
- Modify: `tests/production/validationRun.test.ts`
- Modify: `src/production/application/validateCandidate.ts`
- Modify: `tests/production/basicValidator.test.ts`

**Interfaces:**
- Consumes: `DomainId`, `RevisionId`.
- Produces: `ValidationExecutionMode`, `ValidationVerdict`, `ValidationExecutionState`, `ValidationEvidence`, `ValidationFinding`, `ValidationEntryResult`, `ValidationRun`, `createValidationRun`, `summarizeValidationOutcome`.
- Migrates: `validateCandidate` binds its `ValidationRun` to `changeSetRevisionId` + `planVersionId`. `Candidate` stays Source / Context only and is no longer a Validation Target. The existing basic target-span / required-phrase validation capability and all 12 validator tests are preserved.

- [ ] **Step 1: Rewrite the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  createValidationRun,
  summarizeValidationOutcome,
} from "../../src/production/domain/validationRun";

const now = new Date("2026-10-03T00:00:00.000Z");

function entry(overrides: Record<string, unknown> = {}) {
  return {
    entryReference: "rule:target-span-preserved",
    executionMode: "full_reexecution" as const,
    verdict: "pass" as const,
    findings: [],
    evidence: [
      {
        id: "evidence-1",
        type: "revision-comparison",
        sourceReference: { identity: "scene-1", version: "scene-rev-1", hash: "hash-1" },
        observation: "Observed revision equals expected revision.",
      },
    ],
    ...overrides,
  };
}

describe("ValidationRun", () => {
  it("binds to a change set revision and a frozen plan version", () => {
    const run = createValidationRun({
      id: "validation-1",
      changeSetRevisionId: "cs-1-r3",
      planVersionId: "cs-1-r3-plan-1",
      validatorId: "target-span-validator",
      entryResults: [entry()],
      executionState: "completed",
      outcome: "pass",
      createdAt: now,
    });
    expect(run.changeSetRevisionId).toBe("cs-1-r3");
    expect(run.planVersionId).toBe("cs-1-r3-plan-1");
    expect(Object.prototype.hasOwnProperty.call(run, "candidateId")).toBe(false);
  });

  it("rejects a missing change set revision or plan version", () => {
    expect(() =>
      createValidationRun({
        id: "validation-1",
        changeSetRevisionId: "",
        planVersionId: "plan-1",
        validatorId: "validator",
        entryResults: [],
        executionState: "completed",
        outcome: "pass",
        createdAt: now,
      }),
    ).toThrow("changeSetRevisionId is required");
    expect(() =>
      createValidationRun({
        id: "validation-1",
        changeSetRevisionId: "cs-1-r3",
        planVersionId: "",
        validatorId: "validator",
        entryResults: [],
        executionState: "completed",
        outcome: "pass",
        createdAt: now,
      }),
    ).toThrow("planVersionId is required");
  });

  it("allows a not-applicable entry to carry no verdict", () => {
    const run = createValidationRun({
      id: "validation-1",
      changeSetRevisionId: "cs-1-r3",
      planVersionId: "plan-1",
      validatorId: "validator",
      entryResults: [entry({ executionMode: "not_applicable", verdict: undefined })],
      executionState: "completed",
      outcome: "pass",
      createdAt: now,
    });
    expect(run.entryResults[0]?.verdict).toBeUndefined();
  });

  it("rejects a verdict on a not-applicable entry", () => {
    expect(() =>
      createValidationRun({
        id: "validation-1",
        changeSetRevisionId: "cs-1-r3",
        planVersionId: "plan-1",
        validatorId: "validator",
        entryResults: [entry({ executionMode: "not_applicable" })],
        executionState: "completed",
        outcome: "pass",
        createdAt: now,
      }),
    ).toThrow("A not-applicable entry cannot carry a verdict");
  });

  it("produces an outcome only when completed", () => {
    expect(() =>
      createValidationRun({
        id: "validation-1",
        changeSetRevisionId: "cs-1-r3",
        planVersionId: "plan-1",
        validatorId: "validator",
        entryResults: [entry()],
        executionState: "interrupted",
        outcome: "pass",
        createdAt: now,
      }),
    ).toThrow("Outcome is only available for a completed run");
  });

  it("allows an interrupted run to keep partial evidence without an outcome", () => {
    const run = createValidationRun({
      id: "validation-1",
      changeSetRevisionId: "cs-1-r3",
      planVersionId: "plan-1",
      validatorId: "validator",
      entryResults: [entry()],
      executionState: "interrupted",
      createdAt: now,
    });
    expect(run.outcome).toBeUndefined();
    expect(run.entryResults).toHaveLength(1);
  });

  it("summarises the most severe outcome", () => {
    expect(summarizeValidationOutcome(["pass", "pass"])).toBe("pass");
    expect(summarizeValidationOutcome(["pass", "needs_review"])).toBe("needs_review");
    expect(summarizeValidationOutcome(["needs_review", "fail"])).toBe("fail");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/production/validationRun.test.ts`
Expected: FAIL because `ValidationRun` is still Candidate-bound.

- [ ] **Step 3: Replace the implementation**

```ts
import type { DomainId, RevisionId } from "../../shared/domain/ids";

export type ValidationExecutionMode = "full_reexecution" | "cached_reuse" | "not_applicable";
export type ValidationVerdict = "pass" | "fail" | "needs_review";
export type ValidationOutcome = "pass" | "fail" | "needs_review";
export type ValidationExecutionState = "running" | "completed" | "interrupted" | "failed";
export type ValidationSeverity = "info" | "warning" | "error";

export interface EvidenceSourceReference {
  readonly identity: DomainId;
  readonly version: string;
  readonly hash: string;
}

export interface ValidationEvidence {
  readonly id: string;
  readonly type: string;
  readonly sourceReference: EvidenceSourceReference;
  readonly observation: string;
}

export interface ValidationFinding {
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly confidence: number;
  readonly message: string;
  readonly evidence: readonly ValidationEvidence[];
}

export interface ValidationEntryResult {
  readonly entryReference: string;
  readonly executionMode: ValidationExecutionMode;
  readonly verdict?: ValidationVerdict;
  readonly findings: readonly ValidationFinding[];
  readonly evidence: readonly ValidationEvidence[];
}

export interface ValidationRun {
  readonly id: DomainId;
  readonly changeSetRevisionId: RevisionId;
  readonly planVersionId: string;
  readonly validatorId: string;
  readonly entryResults: readonly ValidationEntryResult[];
  readonly executionState: ValidationExecutionState;
  readonly outcome?: ValidationOutcome;
  readonly createdAt: Date;
}

function freezeEvidence(evidence: ValidationEvidence): ValidationEvidence {
  return Object.freeze({
    id: evidence.id,
    type: evidence.type,
    sourceReference: Object.freeze({ ...evidence.sourceReference }),
    observation: evidence.observation,
  });
}

function freezeEntry(entry: ValidationEntryResult): ValidationEntryResult {
  if (entry.executionMode === "not_applicable" && entry.verdict !== undefined) {
    throw new Error("A not-applicable entry cannot carry a verdict");
  }
  if (entry.executionMode !== "not_applicable" && entry.verdict === undefined) {
    throw new Error("An executed entry requires a verdict");
  }
  for (const finding of entry.findings) {
    if (!finding.code.trim()) throw new Error("finding.code is required");
    if (finding.confidence < 0 || finding.confidence > 1) {
      throw new Error("finding.confidence must be between 0 and 1");
    }
  }
  return Object.freeze({
    entryReference: entry.entryReference,
    executionMode: entry.executionMode,
    verdict: entry.verdict,
    findings: Object.freeze(
      entry.findings.map(finding =>
        Object.freeze({
          ...finding,
          evidence: Object.freeze(finding.evidence.map(freezeEvidence)),
        }),
      ),
    ),
    evidence: Object.freeze(entry.evidence.map(freezeEvidence)),
  });
}

export function createValidationRun(input: {
  id: DomainId;
  changeSetRevisionId: RevisionId;
  planVersionId: string;
  validatorId: string;
  entryResults: readonly ValidationEntryResult[];
  executionState: ValidationExecutionState;
  outcome?: ValidationOutcome;
  createdAt: Date;
}): ValidationRun {
  if (!input.id) throw new Error("id is required");
  if (!input.changeSetRevisionId) throw new Error("changeSetRevisionId is required");
  if (!input.planVersionId) throw new Error("planVersionId is required");
  if (!input.validatorId.trim()) throw new Error("validatorId is required");
  if (input.executionState !== "completed" && input.outcome !== undefined) {
    throw new Error("Outcome is only available for a completed run");
  }
  if (input.executionState === "completed" && input.outcome === undefined) {
    throw new Error("A completed run requires an outcome");
  }

  return Object.freeze({
    id: input.id,
    changeSetRevisionId: input.changeSetRevisionId,
    planVersionId: input.planVersionId,
    validatorId: input.validatorId.trim(),
    entryResults: Object.freeze(input.entryResults.map(freezeEntry)),
    executionState: input.executionState,
    outcome: input.outcome,
    createdAt: input.createdAt,
  });
}

export function summarizeValidationOutcome(
  outcomes: readonly ValidationOutcome[],
): ValidationOutcome {
  if (outcomes.length === 0) throw new Error("At least one validation outcome is required");
  if (outcomes.includes("fail")) return "fail";
  if (outcomes.includes("needs_review")) return "needs_review";
  return "pass";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/production/validationRun.test.ts`
Expected: PASS with 7 tests.

- [ ] **Step 5: Migrate the legacy Candidate-bound validator caller**

`src/production/application/validateCandidate.ts` still calls `createValidationRun` with `candidateId` / `candidateRevisionId`, and builds `ValidationFinding.evidence` as a raw record. This is the last Candidate-bound `ValidationRun` producer. Migrate it so the produced run binds to the Change Set Revision and the frozen plan version. Keep every existing validation behaviour: target-span checks, required-phrase checks, duplicate-target checks, structured-target checks.

Replace the whole file with:

```ts
import type { Candidate, CandidateAtomicChange } from "../domain/candidate";
import type { Scene } from "../../manuscript/domain/scene";
import {
  replaceTargetSpan,
  resolveTargetSpan,
} from "../../manuscript/domain/targetSpan";
import { hashContent } from "../../shared/domain/contentHash";
import type { RevisionId } from "../../shared/domain/ids";
import {
  createValidationRun,
  type ValidationEvidence,
  type ValidationEntryResult,
  type ValidationFinding,
  type ValidationOutcome,
} from "../domain/validationRun";

export interface ValidationRequest {
  readonly validationId: string;
  readonly changeSetRevisionId: RevisionId;
  readonly planVersionId: string;
  readonly candidate: Candidate;
  readonly scene?: Scene;
  readonly mustPreserve: readonly string[];
  readonly createdAt: Date;
}

export interface ValidationResult {
  readonly run: ReturnType<typeof createValidationRun>;
  readonly outcome: ValidationOutcome;
}

function atomicChanges(change: Candidate["change"]): readonly CandidateAtomicChange[] {
  return change.type === "composite" ? change.changes : [change];
}

function targetKey(change: CandidateAtomicChange): string {
  if (change.type === "text" || change.type === "local_text") {
    return `Scene:${change.sceneId}`;
  }
  if (change.type === "canonical_fact") {
    return `CanonicalFact:${change.canonicalFactId}`;
  }
  return `StateRecord:${change.stateRecordId}`;
}

function toEvidence(
  code: string,
  details: Readonly<Record<string, unknown>>,
): readonly ValidationEvidence[] {
  const observation = JSON.stringify(details);
  return Object.freeze([
    Object.freeze({
      id: `${code}:detail`,
      type: "validation_detail",
      sourceReference: Object.freeze({
        identity: code,
        version: "1",
        hash: hashContent(observation),
      }),
      observation,
    }),
  ]);
}

function addFinding(
  findings: ValidationFinding[],
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>>,
): void {
  findings.push({
    code,
    severity: "error",
    confidence: 1,
    message,
    evidence: toEvidence(code, details),
  });
}

function targetSpanErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("anchor not found")) return "TARGET_ANCHOR_NOT_FOUND";
  if (message.includes("text does not match")) return "TARGET_TEXT_MISMATCH";
  if (message.includes("source hash does not match")) return "TARGET_SOURCE_HASH_MISMATCH";
  if (message.includes("ambiguous")) return "TARGET_SPAN_AMBIGUOUS";
  if (message.includes("not present")) return "TARGET_TEXT_NOT_FOUND";
  return "TARGET_SPAN_INVALID";
}

function validateAtomicChange(
  change: CandidateAtomicChange,
  scene: Scene | undefined,
  findings: ValidationFinding[],
): void {
  if (change.type === "text") {
    if (!scene) {
      addFinding(findings, "SCENE_REQUIRED", "Text change requires a scene.", {
        sceneId: change.sceneId,
      });
    } else if (change.sceneId !== scene.id) {
      addFinding(
        findings,
        "SCENE_MISMATCH",
        "Text change targets a different scene.",
        { expectedSceneId: scene.id, actualSceneId: change.sceneId },
      );
    }
    if (!change.text.trim()) {
      addFinding(findings, "EMPTY_TEXT", "Text candidate cannot be empty.", {
        sceneId: change.sceneId,
      });
    }
    return;
  }

  if (change.type === "local_text") {
    if (!scene) {
      addFinding(findings, "SCENE_REQUIRED", "Local text change requires a scene.", {
        sceneId: change.sceneId,
      });
      return;
    }
    if (change.sceneId !== scene.id) {
      addFinding(
        findings,
        "SCENE_MISMATCH",
        "Local text change targets a different scene.",
        { expectedSceneId: scene.id, actualSceneId: change.sceneId },
      );
      return;
    }
    try {
      resolveTargetSpan(scene, change.targetSpan);
    } catch (error) {
      addFinding(
        findings,
        targetSpanErrorCode(error),
        error instanceof Error ? error.message : "Target span is invalid.",
        { anchorId: change.targetSpan.anchorId },
      );
    }
    return;
  }

  const targetId =
    change.type === "structured_state" ? change.stateRecordId : change.canonicalFactId;
  if (!targetId.trim()) {
    addFinding(
      findings,
      "EMPTY_STRUCTURED_TARGET_ID",
      "Structured candidate requires a target id.",
      { changeType: change.type },
    );
  }
  if (Object.keys(change.content).length === 0) {
    addFinding(
      findings,
      "EMPTY_STRUCTURED_CHANGE",
      "Structured candidate cannot be empty.",
      { changeType: change.type, targetId },
    );
  }
}

function resultingSceneText(
  scene: Scene | undefined,
  changes: readonly CandidateAtomicChange[],
  findings: ValidationFinding[],
): string {
  const sceneChanges = changes.filter(
    (change): change is Extract<CandidateAtomicChange, { type: "text" | "local_text" }> =>
      change.type === "text" || change.type === "local_text",
  );
  if (sceneChanges.length === 0) return scene?.text ?? "";
  if (sceneChanges.length > 1) {
    addFinding(
      findings,
      "DUPLICATE_CANDIDATE_TARGET",
      "Composite candidate contains multiple changes for one scene.",
      { sceneId: scene?.id ?? "unknown" },
    );
    return scene?.text ?? "";
  }

  const sceneChange = sceneChanges[0];
  if (!sceneChange) return scene?.text ?? "";
  if (sceneChange.type === "text") return sceneChange.text;
  try {
    if (!scene) return "";
    return replaceTargetSpan({
      scene,
      target: sceneChange.targetSpan,
      replacement: sceneChange.replacement,
    });
  } catch {
    return scene?.text ?? "";
  }
}

export function validateCandidate(request: ValidationRequest): ValidationResult {
  const findings: ValidationFinding[] = [];
  const changes = atomicChanges(request.candidate.change);
  const seenTargets = new Set<string>();
  for (const change of changes) {
    const key = targetKey(change);
    if (seenTargets.has(key)) {
      addFinding(
        findings,
        "DUPLICATE_CANDIDATE_TARGET",
        "Composite candidate contains duplicate targets.",
        { target: key },
      );
    }
    seenTargets.add(key);
    validateAtomicChange(change, request.scene, findings);
  }

  const proposedText = resultingSceneText(request.scene, changes, findings);
  for (const phrase of request.mustPreserve) {
    if (!proposedText.includes(phrase)) {
      addFinding(
        findings,
        "REQUIRED_PHRASE_MISSING",
        `Required phrase is missing: ${phrase}`,
        { phrase },
      );
    }
  }

  const outcome: ValidationOutcome = findings.some((finding) => finding.severity === "error")
    ? "fail"
    : "pass";

  const entryResults: readonly ValidationEntryResult[] = Object.freeze([
    Object.freeze({
      entryReference: "basic-candidate-validation",
      executionMode: "full_reexecution" as const,
      verdict: outcome,
      findings: Object.freeze(findings),
      evidence: Object.freeze([]),
    }),
  ]);

  const run = createValidationRun({
    id: request.validationId,
    changeSetRevisionId: request.changeSetRevisionId,
    planVersionId: request.planVersionId,
    validatorId: "basic-candidate-validator",
    entryResults,
    executionState: "completed",
    outcome,
    createdAt: request.createdAt,
  });

  return { run, outcome };
}
```

Then migrate `tests/production/basicValidator.test.ts`. Keep all 12 existing cases and their expected codes / outcomes unchanged:

1. Add `changeSetRevisionId: "cs-1-r1",` and `planVersionId: "plan-1",` to every `validateCandidate({ ... })` call.
2. Findings now live inside the entry result. Replace every `run.findings` read with the same read on `run.entryResults[0]?.findings` (for example `result.run.entryResults[0]?.findings[0]` and `result.run.entryResults[0]?.findings.some(...)`). The `run.outcome` and `result.outcome` reads stay as they are.
3. Add this case that pins the new binding:

```ts
  it("binds the validation run to the change set revision and frozen plan version", () => {
    const result = validateCandidate({
      validationId: "validation-binding",
      changeSetRevisionId: "cs-1-r1",
      planVersionId: "plan-1",
      candidate: candidate({ type: "text", sceneId: "scene-1", text: "New text" }),
      scene: scene(),
      mustPreserve: [],
      createdAt: now,
    });

    expect(result.run.changeSetRevisionId).toBe("cs-1-r1");
    expect(result.run.planVersionId).toBe("plan-1");
    expect("candidateId" in result.run).toBe(false);
    expect("candidateRevisionId" in result.run).toBe(false);
    expect(result.run.entryResults[0]?.entryReference).toBe("basic-candidate-validation");
  });
```

`planVersionId` stands for an already-frozen Validation Plan version. Do not derive it from a mutable plan or from a Candidate Revision, and do not build a Frozen Validation Plan assembly or any advanced validator here.

- [ ] **Step 6: Run typecheck and the validator tests**

Run:

```bash
npm test -- --run tests/production/validationRun.test.ts
npm test -- --run tests/production/basicValidator.test.ts
npm run typecheck
```

Expected: PASS with 7 tests and 13 tests; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/production/domain/validationRun.ts tests/production/validationRun.test.ts src/production/application/validateCandidate.ts tests/production/basicValidator.test.ts
git commit -m "refactor: bind validation run to change set revision"
```

### Task 9: Re-bind ReviewDecision to Change Set Revision and Approval Scope

**Files:**
- Modify: `src/production/domain/reviewDecision.ts`
- Modify: `tests/production/reviewDecision.test.ts`

**Interfaces:**
- Consumes: `DomainId`, `RevisionId`; `TargetType` from Task 1.
- Produces: `ReviewDecisionType`, `ReviewDecisionMaker`, `RequirementDomain`, `ApprovalScope`, `ReviewDecision`, `createReviewDecision`, `approvalScopeKey`.

- [ ] **Step 1: Rewrite the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  approvalScopeKey,
  createReviewDecision,
  type ApprovalScope,
} from "../../src/production/domain/reviewDecision";

const now = new Date("2026-10-03T00:00:00.000Z");

function scope(overrides: Partial<ApprovalScope> = {}): ApprovalScope {
  return {
    requirementDomain: "canon",
    targetType: "canonical_fact",
    objectId: "fact-1",
    ...overrides,
  };
}

describe("ReviewDecision", () => {
  it("binds to a change set revision and an approval scope", () => {
    const decision = createReviewDecision({
      id: "review-1",
      changeSetRevisionId: "cs-1-r3",
      approvalScope: scope(),
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "",
      evidenceReferences: ["validation-1"],
      createdAt: now,
    });
    expect(decision.changeSetRevisionId).toBe("cs-1-r3");
    expect(decision.approvalScope.requirementDomain).toBe("canon");
    expect(Object.prototype.hasOwnProperty.call(decision, "candidateId")).toBe(false);
  });

  it("requires a reason for rejection", () => {
    expect(() =>
      createReviewDecision({
        id: "review-1",
        changeSetRevisionId: "cs-1-r3",
        approvalScope: scope(),
        decision: "reject",
        decidedBy: "human",
        actorId: "author-1",
        reason: "",
        evidenceReferences: [],
        createdAt: now,
      }),
    ).toThrow("A rejection requires a reason");
  });

  it("requires policy version and decision rule for policy decisions", () => {
    expect(() =>
      createReviewDecision({
        id: "review-1",
        changeSetRevisionId: "cs-1-r3",
        approvalScope: scope(),
        decision: "approve",
        decidedBy: "policy",
        actorId: "low-risk-policy",
        reason: "",
        evidenceReferences: [],
        createdAt: now,
      }),
    ).toThrow("A policy decision requires policyVersion");

    const decision = createReviewDecision({
      id: "review-1",
      changeSetRevisionId: "cs-1-r3",
      approvalScope: scope(),
      decision: "approve",
      decidedBy: "policy",
      actorId: "low-risk-policy",
      reason: "",
      evidenceReferences: [],
      policyVersion: "policy-1",
      decisionRule: "low-risk-auto-approve",
      createdAt: now,
    });
    expect(decision.policyVersion).toBe("policy-1");
    expect(decision.decisionRule).toBe("low-risk-auto-approve");
  });

  it("builds a stable approval scope key", () => {
    expect(approvalScopeKey(scope())).toBe("canon:canonical_fact:fact-1");
    expect(approvalScopeKey(scope({ subAddress: "goal" }))).toBe(
      "canon:canonical_fact:fact-1#goal",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/production/reviewDecision.test.ts`
Expected: FAIL because `ReviewDecision` is still Candidate-bound.

- [ ] **Step 3: Replace the implementation**

```ts
import type { DomainId, RevisionId } from "../../shared/domain/ids";
import type { TargetType } from "./change";

export type ReviewDecisionType = "approve" | "reject" | "request_regeneration";
export type ReviewDecisionMaker = "human" | "policy";
export type RequirementDomain = "canon" | "plan" | "structure" | "manuscript" | "story_state";

export interface ApprovalScope {
  readonly requirementDomain: RequirementDomain;
  readonly targetType: TargetType;
  readonly objectId: DomainId;
  readonly subAddress?: string;
}

export interface ReviewDecision {
  readonly id: DomainId;
  readonly changeSetRevisionId: RevisionId;
  readonly approvalScope: ApprovalScope;
  readonly decision: ReviewDecisionType;
  readonly decidedBy: ReviewDecisionMaker;
  readonly actorId: DomainId;
  readonly reason?: string;
  readonly policyVersion?: string;
  readonly decisionRule?: string;
  readonly evidenceReferences: readonly string[];
  readonly createdAt: Date;
}

export function approvalScopeKey(scope: ApprovalScope): string {
  const base = `${scope.requirementDomain}:${scope.targetType}:${scope.objectId}`;
  return scope.subAddress ? `${base}#${scope.subAddress}` : base;
}

export function createReviewDecision(input: {
  id: DomainId;
  changeSetRevisionId: RevisionId;
  approvalScope: ApprovalScope;
  decision: ReviewDecisionType;
  decidedBy: ReviewDecisionMaker;
  actorId: DomainId;
  reason: string;
  evidenceReferences: readonly string[];
  policyVersion?: string;
  decisionRule?: string;
  createdAt: Date;
}): ReviewDecision {
  if (!input.id) throw new Error("id is required");
  if (!input.changeSetRevisionId) throw new Error("changeSetRevisionId is required");
  if (!input.approvalScope) throw new Error("approvalScope is required");
  if (!input.approvalScope.objectId) throw new Error("approvalScope.objectId is required");
  if (!input.actorId) throw new Error("actorId is required");
  if (input.decision === "reject" && !input.reason.trim()) {
    throw new Error("A rejection requires a reason");
  }
  if (input.decidedBy === "policy" && !input.policyVersion) {
    throw new Error("A policy decision requires policyVersion");
  }
  if (input.decidedBy === "policy" && !input.decisionRule) {
    throw new Error("A policy decision requires decisionRule");
  }

  return Object.freeze({
    id: input.id,
    changeSetRevisionId: input.changeSetRevisionId,
    approvalScope: Object.freeze({ ...input.approvalScope }),
    decision: input.decision,
    decidedBy: input.decidedBy,
    actorId: input.actorId,
    reason: input.reason.trim() || undefined,
    policyVersion: input.policyVersion,
    decisionRule: input.decisionRule,
    evidenceReferences: Object.freeze([...input.evidenceReferences]),
    createdAt: input.createdAt,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/production/reviewDecision.test.ts`
Expected: PASS with 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/production/domain/reviewDecision.ts tests/production/reviewDecision.test.ts
git commit -m "refactor: bind review decision to change set revision"
```

### Task 10: Re-bind NarrativeCommit to Change Set Revision

**Files:**
- Modify: `src/safety/domain/narrativeCommit.ts`
- Modify: `tests/safety/narrativeCommit.test.ts`

**Interfaces:**
- Consumes: `DomainId`, `RevisionId`, `VersionSet`; `ChangeSetRevision` from Task 3; `ValidationRun` from Task 8; `ReviewDecision` from Task 9.
- Produces: `NarrativeCommitStatus`, `NarrativeCommit`, `createNarrativeCommit`, `markNarrativeCommitCommitted`, `markNarrativeCommitStale`, `markNarrativeCommitFailed`.

- [ ] **Step 1: Rewrite the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  createNarrativeCommit,
  markNarrativeCommitCommitted,
  markNarrativeCommitFailed,
  markNarrativeCommitStale,
} from "../../src/safety/domain/narrativeCommit";
import { createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import { createValidationRun } from "../../src/production/domain/validationRun";
import { createReviewDecision } from "../../src/production/domain/reviewDecision";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-03T00:00:00.000Z");

function revision() {
  return createInitialChangeSetRevision({
    revisionId: "cs-1-r1",
    changeSetId: "cs-1",
    novelId: "novel-1",
    createdAt: now,
  });
}

function validationRun(outcome: "pass" | "fail" | "needs_review" = "pass") {
  return createValidationRun({
    id: "validation-1",
    changeSetRevisionId: "cs-1-r1",
    planVersionId: "cs-1-r1-plan-1",
    validatorId: "core-validator",
    entryResults: [
      {
        entryReference: "rule:core",
        executionMode: "full_reexecution",
        verdict: outcome,
        findings: [],
        evidence: [],
      },
    ],
    executionState: "completed",
    outcome,
    createdAt: now,
  });
}

function reviewDecision(decision: "approve" | "reject" = "approve") {
  return createReviewDecision({
    id: "review-1",
    changeSetRevisionId: "cs-1-r1",
    approvalScope: {
      requirementDomain: "manuscript",
      targetType: "manuscript",
      objectId: "scene-1",
    },
    decision,
    decidedBy: "human",
    actorId: "author-1",
    reason: decision === "reject" ? "Not preferred" : "",
    evidenceReferences: ["validation-1"],
    createdAt: now,
  });
}

describe("NarrativeCommit", () => {
  it("binds to a change set revision", () => {
    const commit = createNarrativeCommit({
      id: "commit-1",
      novelId: "novel-1",
      changeSetRevision: revision(),
      validationRuns: [validationRun()],
      reviewDecisions: [reviewDecision()],
      createdAt: now,
    });
    expect(commit.changeSetRevisionId).toBe("cs-1-r1");
    expect(Object.prototype.hasOwnProperty.call(commit, "candidateId")).toBe(false);
  });

  it("rejects a revision from another novel", () => {
    expect(() =>
      createNarrativeCommit({
        id: "commit-1",
        novelId: "novel-2",
        changeSetRevision: revision(),
        validationRuns: [validationRun()],
        reviewDecisions: [reviewDecision()],
        createdAt: now,
      }),
    ).toThrow("Change set revision novel does not match commit novel");
  });

  it("rejects validation runs bound to another revision", () => {
    const foreign = createValidationRun({
      id: "validation-foreign",
      changeSetRevisionId: "cs-9-r9",
      planVersionId: "plan-9",
      validatorId: "validator",
      entryResults: [],
      executionState: "completed",
      outcome: "pass",
      createdAt: now,
    });
    expect(() =>
      createNarrativeCommit({
        id: "commit-1",
        novelId: "novel-1",
        changeSetRevision: revision(),
        validationRuns: [foreign],
        reviewDecisions: [reviewDecision()],
        createdAt: now,
      }),
    ).toThrow("Validation run does not match change set revision");
  });

  it("rejects a failed validation outcome", () => {
    expect(() =>
      createNarrativeCommit({
        id: "commit-1",
        novelId: "novel-1",
        changeSetRevision: revision(),
        validationRuns: [validationRun("fail")],
        reviewDecisions: [reviewDecision()],
        createdAt: now,
      }),
    ).toThrow("A failed validation cannot be committed");
  });

  it("requires at least one approving review decision", () => {
    expect(() =>
      createNarrativeCommit({
        id: "commit-1",
        novelId: "novel-1",
        changeSetRevision: revision(),
        validationRuns: [validationRun()],
        reviewDecisions: [reviewDecision("reject")],
        createdAt: now,
      }),
    ).toThrow("At least one approving review decision is required");
  });

  it("marks the commit complete only with resulting revisions", () => {
    const pending = createNarrativeCommit({
      id: "commit-1",
      novelId: "novel-1",
      changeSetRevision: revision(),
      validationRuns: [validationRun()],
      reviewDecisions: [reviewDecision()],
      createdAt: now,
    });
    const committed = markNarrativeCommitCommitted({
      commit: pending,
      resultingVersionSet: createVersionSet({
        scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
      }),
      committedAt: now,
    });
    expect(pending.status).toBe("pending");
    expect(committed.status).toBe("committed");
  });

  it("supports stale and failed terminal states", () => {
    const pending = createNarrativeCommit({
      id: "commit-1",
      novelId: "novel-1",
      changeSetRevision: revision(),
      validationRuns: [validationRun()],
      reviewDecisions: [reviewDecision()],
      createdAt: now,
    });
    expect(markNarrativeCommitStale(pending, now).status).toBe("stale");
    const failed = markNarrativeCommitFailed({ commit: pending, reason: "Write failed", failedAt: now });
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("Write failed");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/safety/narrativeCommit.test.ts`
Expected: FAIL because `NarrativeCommit` is still Candidate-bound.

- [ ] **Step 3: Replace the implementation**

```ts
import type { DomainId, RevisionId } from "../../shared/domain/ids";
import type { VersionSet } from "../../shared/domain/versioning";
import type { ChangeSetRevision } from "../../production/domain/changeSetRevision";
import type { ValidationRun } from "../../production/domain/validationRun";
import type { ReviewDecision } from "../../production/domain/reviewDecision";

export type NarrativeCommitStatus = "pending" | "committed" | "stale" | "failed";

export interface NarrativeCommit {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly changeSetRevisionId: RevisionId;
  readonly validationRunIds: readonly DomainId[];
  readonly reviewDecisionIds: readonly DomainId[];
  readonly basedOnVersionSet: VersionSet;
  readonly resultingVersionSet?: VersionSet;
  readonly status: NarrativeCommitStatus;
  readonly failureReason?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function createNarrativeCommit(input: {
  id: DomainId;
  novelId: DomainId;
  changeSetRevision: ChangeSetRevision;
  validationRuns: readonly ValidationRun[];
  reviewDecisions: readonly ReviewDecision[];
  basedOnVersionSet?: VersionSet;
  createdAt: Date;
}): NarrativeCommit {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (input.changeSetRevision.novelId !== input.novelId) {
    throw new Error("Change set revision novel does not match commit novel");
  }
  if (input.validationRuns.length === 0) throw new Error("At least one validation run is required");

  for (const run of input.validationRuns) {
    if (run.changeSetRevisionId !== input.changeSetRevision.revisionId) {
      throw new Error("Validation run does not match change set revision");
    }
  }
  if (input.validationRuns.some(run => run.outcome === "fail")) {
    throw new Error("A failed validation cannot be committed");
  }

  for (const decision of input.reviewDecisions) {
    if (decision.changeSetRevisionId !== input.changeSetRevision.revisionId) {
      throw new Error("Review decision does not match change set revision");
    }
  }
  if (!input.reviewDecisions.some(decision => decision.decision === "approve")) {
    throw new Error("At least one approving review decision is required");
  }

  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    changeSetRevisionId: input.changeSetRevision.revisionId,
    validationRunIds: Object.freeze(input.validationRuns.map(run => run.id)),
    reviewDecisionIds: Object.freeze(input.reviewDecisions.map(decision => decision.id)),
    basedOnVersionSet: input.basedOnVersionSet ?? Object.freeze({}),
    status: "pending",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function markNarrativeCommitCommitted(input: {
  commit: NarrativeCommit;
  resultingVersionSet: VersionSet;
  committedAt: Date;
}): NarrativeCommit {
  if (input.commit.status !== "pending") throw new Error("Only a pending commit can be completed");
  if (Object.keys(input.resultingVersionSet).length === 0) {
    throw new Error("A committed transition requires resulting revisions");
  }
  return Object.freeze({
    ...input.commit,
    resultingVersionSet: input.resultingVersionSet,
    status: "committed",
    updatedAt: input.committedAt,
  });
}

export function markNarrativeCommitStale(commit: NarrativeCommit, updatedAt: Date): NarrativeCommit {
  if (commit.status !== "pending") throw new Error("Only a pending commit can become stale");
  return Object.freeze({ ...commit, status: "stale", updatedAt });
}

export function markNarrativeCommitFailed(input: {
  commit: NarrativeCommit;
  reason: string;
  failedAt: Date;
}): NarrativeCommit {
  if (input.commit.status !== "pending") throw new Error("Only a pending commit can fail");
  if (!input.reason.trim()) throw new Error("failure reason is required");
  return Object.freeze({
    ...input.commit,
    status: "failed",
    failureReason: input.reason.trim(),
    updatedAt: input.failedAt,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/safety/narrativeCommit.test.ts`
Expected: PASS with 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/safety/domain/narrativeCommit.ts tests/safety/narrativeCommit.test.ts
git commit -m "refactor: bind narrative commit to change set revision"
```

### Task 11: Commit Gate Evaluation

**Files:**
- Create: `src/safety/domain/commitGate.ts`
- Test: `tests/safety/commitGate.test.ts`

**Interfaces:**
- Produces: `CommitGateBlockerType`, `CommitGateBlocker`, `CommitGateRequiredAction`, `CommitGateResult`, `CommitGateInput`, `evaluateCommitGate`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { evaluateCommitGate, type CommitGateInput } from "../../src/safety/domain/commitGate";

function input(overrides: Partial<CommitGateInput> = {}): CommitGateInput {
  return {
    unresolvedConflict: false,
    stale: false,
    occConflict: false,
    invariantViolations: [],
    validationOutcome: "pass",
    requiredApproval: true,
    approvalState: "approved",
    ...overrides,
  };
}

describe("commit gate", () => {
  it("allows a clean revision", () => {
    const result = evaluateCommitGate(input());
    expect(result.allowed).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.requiredActions).toEqual([]);
  });

  it("reports every blocker at once instead of failing fast", () => {
    const result = evaluateCommitGate(
      input({
        unresolvedConflict: true,
        stale: true,
        occConflict: true,
        invariantViolations: ["target span must be preserved"],
        validationOutcome: "fail",
        approvalState: "pending",
      }),
    );
    expect(result.allowed).toBe(false);
    expect(result.blockers.map(blocker => blocker.type).sort()).toEqual(
      [
        "invalid_revision",
        "stale_revision",
        "occ_conflict",
        "invariant_violation",
        "mandatory_validation_failed",
        "missing_required_approval",
      ].sort(),
    );
  });

  it("requires approval when needs_review is reported", () => {
    const result = evaluateCommitGate(input({ validationOutcome: "needs_review", approvalState: "pending" }));
    expect(result.blockers.map(blocker => blocker.type)).toEqual([
      "mandatory_needs_review",
      "missing_required_approval",
    ]);
  });

  it("blocks a rejected review decision", () => {
    const result = evaluateCommitGate(input({ approvalState: "rejected" }));
    expect(result.blockers.map(blocker => blocker.type)).toEqual(["review_rejected"]);
    expect(result.requiredActions).toEqual(["revise_revision"]);
  });

  it("does not require approval when the policy does not", () => {
    const result = evaluateCommitGate(input({ requiredApproval: false, approvalState: "not_required" }));
    expect(result.allowed).toBe(true);
  });

  it("keeps conflict and stale blockers independent", () => {
    const result = evaluateCommitGate(input({ unresolvedConflict: true, stale: true }));
    expect(result.blockers.map(blocker => blocker.type).sort()).toEqual([
      "invalid_revision",
      "stale_revision",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/safety/commitGate.test.ts`
Expected: FAIL because `src/safety/domain/commitGate.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
export type CommitGateBlockerType =
  | "invalid_revision"
  | "stale_revision"
  | "occ_conflict"
  | "invariant_violation"
  | "mandatory_validation_failed"
  | "mandatory_needs_review"
  | "missing_required_approval"
  | "review_rejected";

export interface CommitGateBlocker {
  readonly type: CommitGateBlockerType;
  readonly reason: string;
  readonly evidenceReferences: readonly string[];
}

export type CommitGateRequiredAction =
  | "resolve_conflict"
  | "rebase"
  | "reconcile_version"
  | "fix_invariant"
  | "fix_validation"
  | "obtain_review_decision"
  | "revise_revision";

export interface CommitGateResult {
  readonly allowed: boolean;
  readonly blockers: readonly CommitGateBlocker[];
  readonly requiredActions: readonly CommitGateRequiredAction[];
}

export interface CommitGateInput {
  readonly unresolvedConflict: boolean;
  readonly stale: boolean;
  readonly occConflict: boolean;
  readonly invariantViolations: readonly string[];
  readonly validationOutcome?: "pass" | "fail" | "needs_review";
  readonly requiredApproval: boolean;
  readonly approvalState: "not_required" | "pending" | "approved" | "rejected";
}

export function evaluateCommitGate(input: CommitGateInput): CommitGateResult {
  const blockers: CommitGateBlocker[] = [];
  const actions: CommitGateRequiredAction[] = [];

  if (input.unresolvedConflict) {
    blockers.push({
      type: "invalid_revision",
      reason: "The revision has an unresolved conflict",
      evidenceReferences: [],
    });
    actions.push("resolve_conflict");
  }

  if (input.stale) {
    blockers.push({
      type: "stale_revision",
      reason: "The revision base version is no longer compatible",
      evidenceReferences: [],
    });
    actions.push("rebase");
  }

  if (input.occConflict) {
    blockers.push({
      type: "occ_conflict",
      reason: "Optimistic concurrency check failed",
      evidenceReferences: [],
    });
    actions.push("reconcile_version");
  }

  for (const violation of input.invariantViolations) {
    blockers.push({
      type: "invariant_violation",
      reason: violation,
      evidenceReferences: [],
    });
    actions.push("fix_invariant");
  }

  if (input.validationOutcome === "fail") {
    blockers.push({
      type: "mandatory_validation_failed",
      reason: "Mandatory validation failed",
      evidenceReferences: [],
    });
    actions.push("fix_validation");
  }

  if (input.validationOutcome === "needs_review") {
    blockers.push({
      type: "mandatory_needs_review",
      reason: "Mandatory validation requires human review",
      evidenceReferences: [],
    });
    actions.push("obtain_review_decision");
  }

  if (input.requiredApproval && input.approvalState === "pending") {
    blockers.push({
      type: "missing_required_approval",
      reason: "A required approval is missing",
      evidenceReferences: [],
    });
    actions.push("obtain_review_decision");
  }

  if (input.approvalState === "rejected") {
    blockers.push({
      type: "review_rejected",
      reason: "The review decision rejected this revision",
      evidenceReferences: [],
    });
    actions.push("revise_revision");
  }

  return Object.freeze({
    allowed: blockers.length === 0,
    blockers: Object.freeze(blockers),
    requiredActions: Object.freeze([...new Set(actions)]),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/safety/commitGate.test.ts`
Expected: PASS with 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/safety/domain/commitGate.ts tests/safety/commitGate.test.ts
git commit -m "feat: add commit gate evaluation"
```

### Task 12: Commit Application Service and Legacy Removal

**Files:**
- Create: `src/safety/application/commitChangeSetRevision.ts`
- Delete: `src/safety/application/commitCandidate.ts`
- Modify: `src/http/routes.ts`
- Modify: `tests/app/coCreationLoop.test.ts`
- Modify: `tests/http/api.test.ts`

**Interfaces:**
- Consumes: `ChangeSetRevision`, `Scene`, `CanonicalFact`, `StateRecord`, `ValidationRun`, `ReviewDecision`, `NarrativeCommit`, `evaluateCommitGate`, `EventStore`.
- Produces: `CommitChangeSetRevisionDependencies`, `CommitChangeSetRevisionInput`, `commitChangeSetRevision`.
- Removes: `commitCandidate`.

- [ ] **Step 1: Write the failing application test**

```ts
import { describe, expect, it } from "vitest";
import { InMemoryRepository, InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import { InMemoryEventStore } from "../../src/safety/infrastructure/eventStore";
import { commitChangeSetRevision } from "../../src/safety/application/commitChangeSetRevision";
import { createChange } from "../../src/production/domain/change";
import { createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import { createValidationRun } from "../../src/production/domain/validationRun";
import { createReviewDecision } from "../../src/production/domain/reviewDecision";
import { commitSceneText, createScene, type Scene } from "../../src/manuscript/domain/scene";
import type { CanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../src/narrative/state/domain/stateRecord";
import type { NarrativeCommit } from "../../src/safety/domain/narrativeCommit";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-03T00:00:00.000Z");

async function setup() {
  const base = createScene({
    id: "scene-1",
    novelId: "novel-1",
    chapterId: "chapter-1",
    title: "The Northern Gate",
    revisionId: "scene-rev-1",
    commitId: "initial",
    createdAt: now,
  });
  const scene = commitSceneText({
    scene: base,
    text: "Old text",
    revisionId: "scene-rev-2",
    commitId: "initial",
    updatedAt: now,
  });
  const scenes = new InMemoryRevisionedRepository<Scene>();
  await scenes.save(scene);

  const change = createChange({
    id: "change-1",
    sourceType: "author_edit",
    sourceReference: { identity: "author-1", version: "r1", hash: "hash-1" },
    targetAddress: { targetType: "manuscript", objectId: "scene-1" },
    payload: { text: "New text" },
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
    }),
  });
  const revision = createInitialChangeSetRevision({
    revisionId: "cs-1-r1",
    changeSetId: "cs-1",
    novelId: "novel-1",
    createdAt: now,
  });
  const revisionWithChanges = Object.freeze({ ...revision, changes: Object.freeze([change]) });

  const validation = createValidationRun({
    id: "validation-1",
    changeSetRevisionId: "cs-1-r1",
    planVersionId: "plan-1",
    validatorId: "validator",
    entryResults: [],
    executionState: "completed",
    outcome: "pass",
    createdAt: now,
  });
  const review = createReviewDecision({
    id: "review-1",
    changeSetRevisionId: "cs-1-r1",
    approvalScope: { requirementDomain: "manuscript", targetType: "manuscript", objectId: "scene-1" },
    decision: "approve",
    decidedBy: "human",
    actorId: "author-1",
    reason: "",
    evidenceReferences: ["validation-1"],
    createdAt: now,
  });

  return { scenes, revisionWithChanges, validation, review };
}

describe("commitChangeSetRevision", () => {
  it("applies manuscript changes from the change set revision", async () => {
    const context = await setup();
    const commit = await commitChangeSetRevision({
      repositories: {
        scenes: context.scenes,
        canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
        stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
        narrativeCommits: new InMemoryRepository<NarrativeCommit>(),
      },
      eventStore: new InMemoryEventStore(),
      input: {
        commitId: "commit-1",
        changeSetRevision: context.revisionWithChanges,
        validationRuns: [context.validation],
        reviewDecisions: [context.review],
        now,
      },
    });

    expect(commit.status).toBe("committed");
    expect((await context.scenes.findById("scene-1"))?.text).toBe("New text");
  });

  it("blocks the commit when the change gate reports a stale base version", async () => {
    const context = await setup();
    await context.scenes.save(
      commitSceneText({
        scene: (await context.scenes.findById("scene-1"))!,
        text: "Author changed it",
        revisionId: "scene-rev-3",
        commitId: "author-commit",
        updatedAt: now,
      }),
    );

    await expect(
      commitChangeSetRevision({
        repositories: {
          scenes: context.scenes,
          canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
          stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
          narrativeCommits: new InMemoryRepository<NarrativeCommit>(),
        },
        eventStore: new InMemoryEventStore(),
        input: {
          commitId: "commit-2",
          changeSetRevision: context.revisionWithChanges,
          validationRuns: [context.validation],
          reviewDecisions: [context.review],
          now,
        },
      }),
    ).rejects.toThrow("occ_conflict");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/app/coCreationLoop.test.ts`
Expected: FAIL because `commitChangeSetRevision` does not exist.

- [ ] **Step 3: Write the new application service**

```ts
import type { Repository, RevisionedRepository } from "../../shared/application/repository";
import type { ChangeSetRevision } from "../../production/domain/changeSetRevision";
import type { Scene } from "../../manuscript/domain/scene";
import { commitSceneText } from "../../manuscript/domain/scene";
import type { CanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import { replaceCanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../narrative/state/domain/stateRecord";
import { replaceStateRecord } from "../../narrative/state/domain/stateRecord";
import type { ValidationRun } from "../../production/domain/validationRun";
import type { ReviewDecision } from "../../production/domain/reviewDecision";
import { createDomainEvent } from "../domain/domainEvent";
import type { EventStore } from "../infrastructure/eventStore";
import { evaluateCommitGate } from "../domain/commitGate";
import {
  createNarrativeCommit,
  markNarrativeCommitCommitted,
  type NarrativeCommit,
} from "../domain/narrativeCommit";
import { createVersionReference, type VersionSet } from "../../shared/domain/versioning";

export interface CommitChangeSetRevisionRepositories {
  readonly scenes: RevisionedRepository<Scene>;
  readonly canonicalFacts: RevisionedRepository<CanonicalFact>;
  readonly stateRecords: RevisionedRepository<StateRecord>;
  readonly narrativeCommits: Repository<NarrativeCommit>;
}

export interface CommitChangeSetRevisionInput {
  readonly commitId: string;
  readonly changeSetRevision: ChangeSetRevision;
  readonly validationRuns: readonly ValidationRun[];
  readonly reviewDecisions: readonly ReviewDecision[];
  readonly now: Date;
}

function validationOutcomeOf(runs: readonly ValidationRun[]): "pass" | "fail" | "needs_review" {
  if (runs.some(run => run.outcome === "fail")) return "fail";
  if (runs.some(run => run.outcome === "needs_review")) return "needs_review";
  return "pass";
}

function approvalStateOf(decisions: readonly ReviewDecision[]): "pending" | "approved" | "rejected" {
  if (decisions.some(decision => decision.decision === "reject")) return "rejected";
  if (decisions.some(decision => decision.decision === "approve")) return "approved";
  return "pending";
}

async function isBaseVersionCurrent(
  repositories: CommitChangeSetRevisionRepositories,
  versionSet: VersionSet,
): Promise<boolean> {
  for (const reference of Object.values(versionSet)) {
    let current: string | undefined;
    if (reference.aggregateType === "Scene") {
      current = (await repositories.scenes.findById(reference.objectId))?.currentRevisionId;
    } else if (reference.aggregateType === "CanonicalFact") {
      current = (await repositories.canonicalFacts.findById(reference.objectId))?.currentRevisionId;
    } else if (reference.aggregateType === "StateRecord") {
      current = (await repositories.stateRecords.findById(reference.objectId))?.currentRevisionId;
    } else {
      return false;
    }
    if (current !== reference.revisionId) return false;
  }
  return true;
}

export async function commitChangeSetRevision(input: {
  repositories: CommitChangeSetRevisionRepositories;
  eventStore: EventStore;
  input: CommitChangeSetRevisionInput;
}): Promise<NarrativeCommit> {
  const revision = input.input.changeSetRevision;
  const versionSets = revision.changes.map(change => change.basedOnVersionSet);

  let occConflict = false;
  for (const versionSet of versionSets) {
    if (!(await isBaseVersionCurrent(input.repositories, versionSet))) {
      occConflict = true;
      break;
    }
  }

  const gate = evaluateCommitGate({
    unresolvedConflict: false,
    stale: false,
    occConflict,
    invariantViolations: [],
    validationOutcome: validationOutcomeOf(input.input.validationRuns),
    requiredApproval: true,
    approvalState: approvalStateOf(input.input.reviewDecisions),
  });

  if (!gate.allowed) {
    throw new Error(gate.blockers.map(blocker => blocker.type).join(","));
  }

  const resultingVersionSet: Record<string, ReturnType<typeof createVersionReference>> = {};

  for (const change of revision.changes) {
    if (change.targetAddress.targetType === "manuscript") {
      const scene = await input.repositories.scenes.findById(change.targetAddress.objectId);
      if (!scene) throw new Error(`Scene not found: ${change.targetAddress.objectId}`);
      const nextRevisionId = `${scene.currentRevisionId}:${input.input.commitId}`;
      const nextText = typeof change.payload.text === "string" ? change.payload.text : scene.text;
      const nextScene = commitSceneText({
        scene,
        text: nextText,
        revisionId: nextRevisionId,
        commitId: input.input.commitId,
        updatedAt: input.input.now,
      });
      await input.repositories.scenes.save(nextScene);
      resultingVersionSet.scene = createVersionReference("Scene", nextScene.id, nextRevisionId);
    } else if (change.targetAddress.targetType === "canonical_fact") {
      const fact = await input.repositories.canonicalFacts.findById(change.targetAddress.objectId);
      if (!fact) throw new Error(`Canonical fact not found: ${change.targetAddress.objectId}`);
      const nextRevisionId = `${fact.currentRevisionId}:${input.input.commitId}`;
      const nextFact = replaceCanonicalFact({
        fact,
        content: change.payload,
        revisionId: nextRevisionId,
        commitId: input.input.commitId,
        updatedAt: input.input.now,
      });
      await input.repositories.canonicalFacts.save(nextFact);
      resultingVersionSet.canonicalFact = createVersionReference(
        "CanonicalFact",
        nextFact.id,
        nextRevisionId,
      );
    } else if (change.targetAddress.targetType === "story_state") {
      const record = await input.repositories.stateRecords.findById(change.targetAddress.objectId);
      if (!record) throw new Error(`State record not found: ${change.targetAddress.objectId}`);
      const nextRevisionId = `${record.currentRevisionId}:${input.input.commitId}`;
      const nextRecord = replaceStateRecord({
        record,
        content: change.payload,
        revisionId: nextRevisionId,
        commitId: input.input.commitId,
        updatedAt: input.input.now,
      });
      await input.repositories.stateRecords.save(nextRecord);
      resultingVersionSet.stateRecord = createVersionReference(
        "StateRecord",
        nextRecord.id,
        nextRevisionId,
      );
    }
  }

  const commit = createNarrativeCommit({
    id: input.input.commitId,
    novelId: revision.novelId,
    changeSetRevision: revision,
    validationRuns: input.input.validationRuns,
    reviewDecisions: input.input.reviewDecisions,
    createdAt: input.input.now,
  });
  const committed = markNarrativeCommitCommitted({
    commit,
    resultingVersionSet: Object.freeze(resultingVersionSet),
    committedAt: input.input.now,
  });
  await input.repositories.narrativeCommits.save(committed);
  await input.eventStore.append(
    createDomainEvent({
      eventId: `event:${committed.id}`,
      name: "NarrativeCommitRecorded",
      context: "ai_production",
      novelId: committed.novelId,
      objectId: committed.id,
      revisionId: committed.changeSetRevisionId,
      commitId: committed.id,
      payload: { changeSetRevisionId: committed.changeSetRevisionId },
      occurredAt: input.input.now,
    }),
  );

  return committed;
}
```

- [ ] **Step 4: Delete the legacy application path and update callers**

```bash
git rm src/safety/application/commitCandidate.ts
```

In `src/http/routes.ts`, replace the `commitCandidate` import and the `/candidates/:candidateId/commit` handler body with a `/change-sets/:changeSetId/commit` handler that:

1. builds a `ChangeSetRevision` from the request (Changes derived from the Candidate, which stays a Change Source / context only);
2. keeps the basic validator capability: call `validateCandidate({ validationId, changeSetRevisionId: revision.revisionId, planVersionId, candidate, scene, mustPreserve, createdAt })` so the produced `ValidationRun` binds to the Change Set Revision and the frozen plan version, and keep the `outcome === "fail"` -> `422` response;
3. builds the `ReviewDecision` bound to `changeSetRevisionId` + `approvalScope` instead of `candidateId` / `candidateRevisionId`;
4. runs `commitChangeSetRevision` and returns the commit.

Add `planVersionId` to the request body for the frozen Validation Plan version. Do not pass `candidateId` or `candidateRevisionId` to the validation layer as a Validation Target, and do not drop the `validateCandidate` capability.

Then update `tests/app/coCreationLoop.test.ts` and `tests/http/api.test.ts` so they build a Change Set Revision and call `commitChangeSetRevision` instead of `commitCandidate`.

- [ ] **Step 5: Run the full verification suite**

Run:

```bash
npm run typecheck
npm test -- --run
```

Expected: PASS with no failures. Then run the acceptance greps from Section 11:

```bash
rg -n "candidateRevisionId" src
rg -n "candidateIds" src/production/domain/generationTask.ts
rg -n "commitCandidate" src
```

Expected: the first two return no matches for the migrated aggregates, and the third returns no matches.

- [ ] **Step 6: Commit**

```bash
git add src/safety/application/commitChangeSetRevision.ts src/http/routes.ts tests/app/coCreationLoop.test.ts tests/http/api.test.ts
git commit -m "refactor: commit change set revisions and remove legacy candidate path"
```

---

## 15. Plan Self-Review Checklist

- Every task has a failing test, a passing test, and a commit step.
- Change Set is an Aggregate Root; Change and Revision match the locked model.
- ValidationRun, ReviewDecision, and NarrativeCommit bind only to Change Set Revision.
- validateCandidate is migrated (not deleted) and its ValidationRun binds to the Change Set Revision + frozen plan version.
- GenerationTask holds no candidate id state.
- No task leaves two formal semantic systems in place.
- Deferred items are listed and not implemented.
- Acceptance criteria in Section 11 are executable commands.
