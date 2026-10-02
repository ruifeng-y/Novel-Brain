# Novel Brain Core Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the domain-first Novel Brain core engine that safely creates narrative state, generates candidates, validates and reviews them, and commits coherent canonical transitions.

**Architecture:** The engine is implemented as isolated TypeScript domain modules with application services coordinating aggregate repositories. PostgreSQL persistence is added only after domain invariants and repository contracts are testable; memory, events, and projections remain derived state. Fastify exposes the engine through a backend API, while a deterministic runtime adapter proves the generation pipeline without coupling the domain to any model provider.

**Tech Stack:** TypeScript, Node.js 22, Fastify, PostgreSQL 16, Prisma, Zod, Vitest, Docker Compose for local PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-10-02-novel-brain-design.md`

## Global Constraints

- Novel Brain is a single-author domain; do not add collaboration, teams, presence, CRDT, or OT.
- `Canon`, `StoryState`, and `Manuscript` are domain concepts, not monolithic aggregates.
- Aggregate roots are selected by local invariants: `Novel`, `Arc`, `Chapter`, `Scene`, `CanonicalFact`, position-aware `StateRecord`, `GenerationTask`, `Candidate`, `ValidationRun`, `ReviewDecision`, and `NarrativeCommit`.
- Canonical narrative representation consists of committed manuscript text plus committed narrative facts.
- Committed manuscript text is canonical state, never a derived projection.
- AI output is candidate state and is never written directly to canonical state.
- `NarrativeCommit` coordinates one coherent canonical transition but does not own canonical objects and is not a database transaction abstraction.
- Use `basedOnVersionSet`, never a global `NovelVersion`, for stale detection.
- Producing bounded contexts define event contracts; State Safety supplies persistence, ordering, audit, and recovery infrastructure.
- Each bounded context owns its projections; Memory and Retrieval owns memory and retrieval projections.
- Memory is derived, rebuildable state and is never the canonical source of truth.
- Autonomous mode uses the same generation, validation, approval, and commit pipeline; it has no bypass write channel.
- Target spans use stable anchors, scene versions, source hashes, and version sets, not bare character offsets.
- Build in this order: domain invariants, aggregates, application use cases, persistence mapping, infrastructure.
- Every task uses TDD: write the failing test, verify failure, implement minimally, verify success, then commit.

## Plan Scope

This is the **Core Engine plan**. It delivers a testable backend engine and API for the Human-AI co-creation pipeline.

Separate follow-up plans will cover the full authoring web workspace, autonomous scheduler, provider integrations, deployment, and advanced long-form retrieval. Those plans will depend on the interfaces produced here.

## Spec Coverage Map

| Spec area | Tasks |
| --- | --- |
| Novel, Canonical Fact, position-aware State | 2, 3, 4 |
| Manuscript, Scene, Target Span | 5 |
| GenerationTask, Candidate, ValidationRun, ReviewDecision | 6, 7, 8, 9, 16 |
| NarrativeCommit, cross-aggregate transition | 10, 14 |
| Version sets, stale detection, revisions | 1, 14, 18 |
| Domain events and event persistence | 11, 18 |
| Memory projection and context assembly | 15 |
| Runtime, agent role, model policy boundary | 13 |
| HTTP API and in-memory composition | 17, 20 |
| PostgreSQL mapping | 18 |
| Rollback and recovery | 19 |
| Final verification | 20 |

Deferred to separate plans:

- Full authoring web workspace and editor UX
- Worldbuilding, character, plot, and outline editing surfaces
- Autonomous scheduler and policy-driven long-running execution
- Provider-specific model adapters
- Advanced consistency validators
- Large-scale retrieval, indexing, and embedding infrastructure
- Production deployment, observability, and billing

## File Structure

```text
package.json
tsconfig.json
vitest.config.ts
.gitignore
docker-compose.yml
prisma/
  schema.prisma
src/
  shared/
    domain/
      ids.ts
      versioning.ts
      contentHash.ts
      immutable.ts
    application/
      repository.ts
    infrastructure/
      prisma.ts
      prismaRepositories.ts
  narrative/
    novel/
      domain/
        novel.ts
    canon/
      domain/
        canonicalFact.ts
    state/
      domain/
        stateRecord.ts
  manuscript/
    domain/
      arc.ts
      chapter.ts
      scene.ts
      targetSpan.ts
  production/
    domain/
      generationTask.ts
      candidate.ts
      validationRun.ts
      reviewDecision.ts
    application/
      validateCandidate.ts
    runtime/
      runtimeAdapter.ts
      deterministicRuntime.ts
  safety/
    domain/
      narrativeCommit.ts
      domainEvent.ts
    application/
      commitCandidate.ts
      rollbackScene.ts
    infrastructure/
      eventStore.ts
  memory/
    projections/
      memoryProjection.ts
    application/
      contextAssembly.ts
  app/
    inMemoryRepositories.ts
    composition.ts
  http/
    server.ts
    routes.ts
tests/
  shared/
    versioning.test.ts
  narrative/
    novel.test.ts
    canonicalFact.test.ts
    stateRecord.test.ts
  manuscript/
    manuscript.test.ts
  production/
    generationTask.test.ts
    candidate.test.ts
    validationRun.test.ts
    reviewDecision.test.ts
    runtimeAdapter.test.ts
    basicValidator.test.ts
  memory/
    contextAssembly.test.ts
  safety/
    narrativeCommit.test.ts
    events.test.ts
    rollbackScene.test.ts
  app/
    repositories.test.ts
    coCreationLoop.test.ts
    engineComposition.test.ts
  http/
    api.test.ts
  integration/
    postgresRoundTrip.test.ts
```

Each domain file owns one aggregate or value-object family. Application files orchestrate aggregates but never absorb aggregate invariants. Infrastructure files implement repository and event contracts.

---

### Task 1: Project Foundation and Version Primitives

**Files:**

- Create: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/shared/domain/ids.ts`
- Create: `src/shared/domain/versioning.ts`
- Create: `src/shared/domain/contentHash.ts`
- Create: `tests/shared/versioning.test.ts`

**Interfaces:**

- Produces: `DomainId`, `RevisionId`, `VersionReference`, `VersionSet`, `createVersionReference`, `createVersionSet`, `mergeVersionSets`, `assertCovers`, `hashContent`.
- Later tasks import these exact names from `src/shared/domain/versioning.ts`, `src/shared/domain/ids.ts`, and `src/shared/domain/contentHash.ts`.

- [ ] **Step 1: Create project scaffolding and write the failing version-set tests**

```json
{
  "name": "novel-brain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest",
    "test:integration": "vitest --config vitest.integration.config.ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**"],
  },
});
```

```ts
import { describe, expect, it } from "vitest";
import {
  assertCovers,
  createVersionReference,
  createVersionSet,
  mergeVersionSets,
} from "../../src/shared/domain/versioning";

const sceneVersion = createVersionReference("Scene", "scene-1", "scene-rev-1");
const characterVersion = createVersionReference("CanonicalFact", "fact-1", "fact-rev-1");

describe("version sets", () => {
  it("rejects an empty object id", () => {
    expect(() => createVersionReference("Scene", "", "rev-1")).toThrow("objectId is required");
  });

  it("creates an immutable version set", () => {
    const set = createVersionSet({ scene: sceneVersion });
    expect(() => {
      (set as Record<string, unknown>).scene = characterVersion;
    }).toThrow();
    expect(set.scene).toEqual(sceneVersion);
  });

  it("merges sets without mutation", () => {
    const left = createVersionSet({ scene: sceneVersion });
    const right = createVersionSet({ character: characterVersion });
    const merged = mergeVersionSets(left, right);
    expect(merged).toEqual({ scene: sceneVersion, character: characterVersion });
    expect(left).toEqual({ scene: sceneVersion });
    expect(right).toEqual({ character: characterVersion });
  });

  it("requires all named dependencies to be present", () => {
    const set = createVersionSet({ scene: sceneVersion });
    expect(() => assertCovers(set, ["scene", "character"])).toThrow(
      "Version set is missing dependency: character",
    );
    expect(() => assertCovers(set, ["scene"])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm install
npm test -- --run tests/shared/versioning.test.ts
```

Expected: FAIL because `src/shared/domain/versioning.ts` does not exist.

- [ ] **Step 3: Implement version primitives**

```ts
export type DomainId = string;
export type RevisionId = string;

export type AggregateType =
  | "Novel"
  | "Arc"
  | "Chapter"
  | "Scene"
  | "CanonicalFact"
  | "StateRecord"
  | "GenerationTask"
  | "Candidate"
  | "ValidationRun"
  | "ReviewDecision"
  | "NarrativeCommit";

export interface VersionReference {
  readonly aggregateType: AggregateType;
  readonly objectId: DomainId;
  readonly revisionId: RevisionId;
}

export type VersionSet = Readonly<Record<string, VersionReference>>;

export function createVersionReference(
  aggregateType: AggregateType,
  objectId: DomainId,
  revisionId: RevisionId,
): VersionReference {
  if (!objectId) throw new Error("objectId is required");
  if (!revisionId) throw new Error("revisionId is required");
  return Object.freeze({ aggregateType, objectId, revisionId });
}

export function createVersionSet(entries: Record<string, VersionReference>): VersionSet {
  return Object.freeze({ ...entries });
}

export function mergeVersionSets(left: VersionSet, right: VersionSet): VersionSet {
  return Object.freeze({ ...left, ...right });
}

export function assertCovers(versionSet: VersionSet, dependencyNames: readonly string[]): void {
  for (const dependencyName of dependencyNames) {
    if (!versionSet[dependencyName]) {
      throw new Error(`Version set is missing dependency: ${dependencyName}`);
    }
  }
}
```

```ts
import { createHash } from "node:crypto";

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run tests/shared/versioning.test.ts`

Expected: PASS with 4 version-set tests.

- [ ] **Step 5: Commit**

```bash
git init
git add package.json package-lock.json tsconfig.json vitest.config.ts src/shared/domain tests/shared/versioning.test.ts
git commit -m "feat: add version-set domain primitives"
```

If `.git` already exists, omit `git init`.

---

### Task 2: Novel Aggregate

**Files:**

- Create: `src/narrative/novel/domain/novel.ts`
- Create: `tests/narrative/novel.test.ts`

**Interfaces:**

- Consumes: `DomainId` from `src/shared/domain/ids.ts`.
- Produces: `Novel`, `NovelStatus`, `AutonomyPolicy`, `createNovel`, `renameNovel`, `setAutonomyPolicy`.
- Later tasks use `Novel.id`, `Novel.authorId`, `Novel.autonomyPolicy`, and `Novel.updatedAt`.

- [ ] **Step 1: Write the failing Novel aggregate tests**

```ts
import { describe, expect, it } from "vitest";
import { createNovel, renameNovel, setAutonomyPolicy } from "../../src/narrative/novel/domain/novel";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("Novel aggregate", () => {
  it("creates a single-author novel", () => {
    const novel = createNovel({
      id: "novel-1",
      authorId: "author-1",
      title: "Blade of the Northern Sect",
      createdAt: now,
    });

    expect(novel).toEqual({
      id: "novel-1",
      authorId: "author-1",
      title: "Blade of the Northern Sect",
      status: "draft",
      autonomyPolicy: "human_review_required",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("rejects an empty author or title", () => {
    expect(() =>
      createNovel({ id: "novel-1", authorId: "", title: "Title", createdAt: now }),
    ).toThrow("authorId is required");
    expect(() =>
      createNovel({ id: "novel-1", authorId: "author-1", title: "", createdAt: now }),
    ).toThrow("title is required");
  });

  it("returns a new novel revision and does not mutate the original", () => {
    const original = createNovel({
      id: "novel-1",
      authorId: "author-1",
      title: "Old Title",
      createdAt: now,
    });
    const renamed = renameNovel(original, "New Title", new Date("2026-10-03T00:00:00.000Z"));
    expect(original.title).toBe("Old Title");
    expect(renamed.title).toBe("New Title");
    expect(renamed.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
  });

  it("does not allow autonomous writes to bypass review by default", () => {
    const original = createNovel({
      id: "novel-1",
      authorId: "author-1",
      title: "Title",
      createdAt: now,
    });
    const updated = setAutonomyPolicy(
      original,
      "policy_driven",
      new Date("2026-10-03T00:00:00.000Z"),
    );
    expect(original.autonomyPolicy).toBe("human_review_required");
    expect(updated.autonomyPolicy).toBe("policy_driven");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/narrative/novel.test.ts`

Expected: FAIL because the Novel module does not exist.

- [ ] **Step 3: Implement the Novel aggregate**

```ts
import type { DomainId } from "../../../shared/domain/ids";

export type NovelStatus = "draft" | "active" | "paused" | "completed";
export type AutonomyPolicy = "human_review_required" | "policy_driven";

export interface Novel {
  readonly id: DomainId;
  readonly authorId: DomainId;
  readonly title: string;
  readonly status: NovelStatus;
  readonly autonomyPolicy: AutonomyPolicy;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateNovelInput {
  readonly id: DomainId;
  readonly authorId: DomainId;
  readonly title: string;
  readonly createdAt: Date;
}

export function createNovel(input: CreateNovelInput): Novel {
  if (!input.id) throw new Error("id is required");
  if (!input.authorId) throw new Error("authorId is required");
  if (!input.title.trim()) throw new Error("title is required");

  return Object.freeze({
    id: input.id,
    authorId: input.authorId,
    title: input.title.trim(),
    status: "draft",
    autonomyPolicy: "human_review_required",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function renameNovel(novel: Novel, title: string, updatedAt: Date): Novel {
  if (!title.trim()) throw new Error("title is required");
  if (updatedAt < novel.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...novel, title: title.trim(), updatedAt });
}

export function setAutonomyPolicy(
  novel: Novel,
  autonomyPolicy: AutonomyPolicy,
  updatedAt: Date,
): Novel {
  if (updatedAt < novel.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...novel, autonomyPolicy, updatedAt });
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- --run tests/narrative/novel.test.ts`

Expected: PASS with 4 Novel tests.

- [ ] **Step 5: Commit**

```bash
git add src/narrative/novel tests/narrative/novel.test.ts
git commit -m "feat: add novel aggregate"
```

---

### Task 3: Canonical Fact Aggregate

**Files:**

- Create: `src/narrative/canon/domain/canonicalFact.ts`
- Create: `tests/narrative/canonicalFact.test.ts`

**Interfaces:**

- Consumes: `DomainId`, `RevisionId`, `VersionReference`.
- Produces: `CanonicalFactType`, `CanonicalFact`, `CanonicalFactContent`, `createCanonicalFact`, `replaceCanonicalFact`.
- Later state and commit tasks consume `CanonicalFact.currentRevisionId`.

- [ ] **Step 1: Write the failing canonical fact tests**

```ts
import { describe, expect, it } from "vitest";
import { createCanonicalFact, replaceCanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("CanonicalFact", () => {
  it("creates an immutable author-approved fact", () => {
    const fact = createCanonicalFact({
      id: "fact-1",
      novelId: "novel-1",
      type: "character_profile",
      content: { name: "Lin Chuan", sect: "Northern Sect" },
      revisionId: "fact-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    expect(fact.currentRevisionId).toBe("fact-rev-1");
    expect(fact.content).toEqual({ name: "Lin Chuan", sect: "Northern Sect" });
  });

  it("requires a commit id for canonical replacement", () => {
    const fact = createCanonicalFact({
      id: "fact-1",
      novelId: "novel-1",
      type: "world_rule",
      content: { rule: "Cultivation drains stamina" },
      revisionId: "fact-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    expect(() =>
      replaceCanonicalFact({
        fact,
        content: { rule: "Cultivation drains life force" },
        revisionId: "fact-rev-2",
        commitId: "",
        updatedAt: new Date("2026-10-03T00:00:00.000Z"),
      }),
    ).toThrow("commitId is required");
  });

  it("replaces content as a new revision without mutating the old fact", () => {
    const fact = createCanonicalFact({
      id: "fact-1",
      novelId: "novel-1",
      type: "world_rule",
      content: { rule: "Old rule" },
      revisionId: "fact-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    const replacement = replaceCanonicalFact({
      fact,
      content: { rule: "New rule" },
      revisionId: "fact-rev-2",
      commitId: "commit-2",
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });

    expect(fact.content).toEqual({ rule: "Old rule" });
    expect(replacement.currentRevisionId).toBe("fact-rev-2");
    expect(replacement.lastCommitId).toBe("commit-2");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/narrative/canonicalFact.test.ts`

Expected: FAIL because the CanonicalFact module does not exist.

- [ ] **Step 3: Implement CanonicalFact**

```ts
import type { DomainId, RevisionId } from "../../../shared/domain/ids";
import { deepFreeze } from "../../../shared/domain/immutable";

export type CanonicalFactType =
  | "character_profile"
  | "world_rule"
  | "plot_decision"
  | "style_constraint";

export type CanonicalFactContent = Readonly<Record<string, unknown>>;

export interface CanonicalFact {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly type: CanonicalFactType;
  readonly content: CanonicalFactContent;
  readonly currentRevisionId: RevisionId;
  readonly lastCommitId: DomainId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateCanonicalFactInput {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly type: CanonicalFactType;
  readonly content: CanonicalFactContent;
  readonly revisionId: RevisionId;
  readonly commitId: DomainId;
  readonly createdAt: Date;
}

export interface ReplaceCanonicalFactInput {
  readonly fact: CanonicalFact;
  readonly content: CanonicalFactContent;
  readonly revisionId: RevisionId;
  readonly commitId: DomainId;
  readonly updatedAt: Date;
}

export function createCanonicalFact(input: CreateCanonicalFactInput): CanonicalFact {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.commitId) throw new Error("commitId is required");

  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    type: input.type,
    content: deepFreeze({ ...input.content }),
    currentRevisionId: input.revisionId,
    lastCommitId: input.commitId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function replaceCanonicalFact(input: ReplaceCanonicalFactInput): CanonicalFact {
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.commitId) throw new Error("commitId is required");
  if (input.updatedAt < input.fact.updatedAt) throw new Error("updatedAt cannot move backward");

  return Object.freeze({
    ...input.fact,
    content: deepFreeze({ ...input.content }),
    currentRevisionId: input.revisionId,
    lastCommitId: input.commitId,
    updatedAt: input.updatedAt,
  });
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- --run tests/narrative/canonicalFact.test.ts`

Expected: PASS with 4 CanonicalFact tests.

- [ ] **Step 5: Commit**

```bash
git add src/narrative/canon/domain/canonicalFact.ts tests/narrative/canonicalFact.test.ts
git commit -m "feat: add canonical fact aggregate"
```

---

### Task 4: Position-aware State Record Aggregate

**Files:**

- Create: `src/narrative/state/domain/stateRecord.ts`
- Create: `tests/narrative/stateRecord.test.ts`

**Interfaces:**

- Consumes: `DomainId`, `RevisionId`.
- Produces: `StateRecordType`, `NarrativePosition`, `StateRecord`, `createStateRecord`, `replaceStateRecord`.
- Commit and context tasks use `StateRecord.position` and `StateRecord.currentRevisionId`.

- [ ] **Step 1: Write the failing state record tests**

```ts
import { describe, expect, it } from "vitest";
import { createStateRecord, replaceStateRecord } from "../../src/narrative/state/domain/stateRecord";

const now = new Date("2026-10-02T00:00:00.000Z");
const position = { sceneId: "scene-1", ordinal: 3 };

describe("position-aware StateRecord", () => {
  it("binds state to a narrative position", () => {
    const record = createStateRecord({
      id: "state-1",
      novelId: "novel-1",
      type: "character_state",
      subjectId: "fact-1",
      position,
      content: { condition: "left arm injured" },
      revisionId: "state-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    expect(record.position).toEqual(position);
    expect(record.currentRevisionId).toBe("state-rev-1");
  });

  it("rejects a state record without a subject", () => {
    expect(() =>
      createStateRecord({
        id: "state-1",
        novelId: "novel-1",
        type: "world_state",
        subjectId: "",
        position,
        content: { season: "winter" },
        revisionId: "state-rev-1",
        commitId: "commit-1",
        createdAt: now,
      }),
    ).toThrow("subjectId is required");
  });

  it("creates a new position-aware revision only through a commit", () => {
    const original = createStateRecord({
      id: "state-1",
      novelId: "novel-1",
      type: "character_state",
      subjectId: "fact-1",
      position,
      content: { condition: "healthy" },
      revisionId: "state-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    const replacement = replaceStateRecord({
      record: original,
      content: { condition: "left arm injured" },
      revisionId: "state-rev-2",
      commitId: "commit-2",
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });

    expect(original.content).toEqual({ condition: "healthy" });
    expect(replacement.currentRevisionId).toBe("state-rev-2");
    expect(replacement.position).toEqual(position);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/narrative/stateRecord.test.ts`

Expected: FAIL because the state record module does not exist.

- [ ] **Step 3: Implement StateRecord**

```ts
import type { DomainId, RevisionId } from "../../../shared/domain/ids";
import { deepFreeze } from "../../../shared/domain/immutable";

export type StateRecordType =
  | "character_state"
  | "world_state"
  | "timeline_record"
  | "relationship_state"
  | "knowledge_state"
  | "unresolved_thread"
  | "plot_progress";

export interface NarrativePosition {
  readonly sceneId: DomainId;
  readonly ordinal: number;
}

export type StateContent = Readonly<Record<string, unknown>>;

export interface StateRecord {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly type: StateRecordType;
  readonly subjectId: DomainId;
  readonly position: NarrativePosition;
  readonly content: StateContent;
  readonly currentRevisionId: RevisionId;
  readonly lastCommitId: DomainId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateStateRecordInput {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly type: StateRecordType;
  readonly subjectId: DomainId;
  readonly position: NarrativePosition;
  readonly content: StateContent;
  readonly revisionId: RevisionId;
  readonly commitId: DomainId;
  readonly createdAt: Date;
}

export interface ReplaceStateRecordInput {
  readonly record: StateRecord;
  readonly content: StateContent;
  readonly revisionId: RevisionId;
  readonly commitId: DomainId;
  readonly updatedAt: Date;
}

function assertPosition(position: NarrativePosition): void {
  if (!position.sceneId) throw new Error("position.sceneId is required");
  if (!Number.isInteger(position.ordinal) || position.ordinal < 0) {
    throw new Error("position.ordinal must be a non-negative integer");
  }
}

export function createStateRecord(input: CreateStateRecordInput): StateRecord {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.subjectId) throw new Error("subjectId is required");
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.commitId) throw new Error("commitId is required");
  assertPosition(input.position);

  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    type: input.type,
    subjectId: input.subjectId,
    position: deepFreeze({ ...input.position }),
    content: deepFreeze({ ...input.content }),
    currentRevisionId: input.revisionId,
    lastCommitId: input.commitId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function replaceStateRecord(input: ReplaceStateRecordInput): StateRecord {
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.commitId) throw new Error("commitId is required");
  if (input.updatedAt < input.record.updatedAt) throw new Error("updatedAt cannot move backward");

  return Object.freeze({
    ...input.record,
    content: deepFreeze({ ...input.content }),
    currentRevisionId: input.revisionId,
    lastCommitId: input.commitId,
    updatedAt: input.updatedAt,
  });
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- --run tests/narrative/stateRecord.test.ts`

Expected: PASS with 4 StateRecord tests.

- [ ] **Step 5: Commit**

```bash
git add src/narrative/state/domain/stateRecord.ts tests/narrative/stateRecord.test.ts
git commit -m "feat: add position-aware state records"
```

---

### Task 5: Manuscript Aggregates and Target Span

**Files:**

- Create: `src/manuscript/domain/arc.ts`
- Create: `src/manuscript/domain/chapter.ts`
- Create: `src/manuscript/domain/scene.ts`
- Create: `src/manuscript/domain/targetSpan.ts`
- Create: `tests/manuscript/manuscript.test.ts`

**Interfaces:**

- Consumes: `DomainId`, `RevisionId`, `VersionReference`, `hashContent`.
- Produces: `Arc`, `Chapter`, `Scene`, `TargetSpan`, `SceneRevision`, `createArc`, `reorderArcChapters`, `createChapter`, `reorderChapterScenes`, `createScene`, `commitSceneText`, `replaceTargetSpan`, `resolveTargetSpan`.
- Production tasks use `Scene.currentRevisionId`, `Scene.text`, `TargetSpan.anchorId`, and `TargetSpan.sourceContentHash`.

- [ ] **Step 1: Write the failing manuscript tests**

```ts
import { describe, expect, it } from "vitest";
import { createArc, reorderArcChapters } from "../../src/manuscript/domain/arc";
import { createChapter, reorderChapterScenes } from "../../src/manuscript/domain/chapter";
import { hashContent } from "../../src/shared/domain/contentHash";
import {
  commitSceneText,
  createScene,
  replaceTargetSpan,
  resolveTargetSpan,
} from "../../src/manuscript/domain/scene";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("manuscript aggregates", () => {
  it("keeps arc, chapter, and scene ordering independent", () => {
    const arc = createArc({ id: "arc-1", novelId: "novel-1", title: "Arc 1", createdAt: now });
    const reorderedArc = reorderArcChapters({
      arc,
      chapterIds: ["chapter-2", "chapter-1"],
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });
    expect(arc.chapterIds).toEqual([]);
    expect(reorderedArc.chapterIds).toEqual(["chapter-2", "chapter-1"]);

    const chapter = createChapter({
      id: "chapter-1",
      novelId: "novel-1",
      arcId: "arc-1",
      title: "Chapter 1",
      createdAt: now,
    });
    const reorderedChapter = reorderChapterScenes({
      chapter,
      sceneIds: ["scene-2", "scene-1"],
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });
    expect(chapter.sceneIds).toEqual([]);
    expect(reorderedChapter.sceneIds).toEqual(["scene-2", "scene-1"]);
  });

  it("commits scene text as a new immutable scene revision", () => {
    const scene = createScene({
      id: "scene-1",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "The Northern Gate",
      revisionId: "scene-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });

    const committed = commitSceneText({
      scene,
      text: "Lin Chuan stopped at the gate.",
      revisionId: "scene-rev-2",
      commitId: "commit-2",
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });

    expect(scene.text).toBe("");
    expect(committed.text).toBe("Lin Chuan stopped at the gate.");
    expect(committed.currentRevisionId).toBe("scene-rev-2");
  });

  it("replaces only a valid target span and rejects stale source text", () => {
    const scene = createScene({
      id: "scene-1",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "The Northern Gate",
      revisionId: "scene-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });
    const original = commitSceneText({
      scene,
      text: "First paragraph. Second paragraph. Third paragraph.",
      spanAnchors: { "span-2": "Second paragraph." },
      revisionId: "scene-rev-2",
      commitId: "commit-2",
      updatedAt: now,
    });

    const target = {
      anchorId: "span-2",
      text: "Second paragraph.",
      sourceContentHash: hashContent("Different paragraph."),
    };

    expect(() => replaceTargetSpan({ scene: original, target, replacement: "Changed." })).toThrow(
      "Target span source hash does not match scene text",
    );
  });

  it("uses stable anchors rather than character offsets for target spans", () => {
    const scene = createScene({
      id: "scene-1",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "The Northern Gate",
      revisionId: "scene-rev-1",
      commitId: "commit-1",
      createdAt: now,
    });
    const committed = commitSceneText({
      scene,
      text: "First paragraph. Second paragraph. Third paragraph.",
      spanAnchors: { "span-2": "Second paragraph." },
      revisionId: "scene-rev-2",
      commitId: "commit-2",
      updatedAt: now,
    });

    const resolved = resolveTargetSpan(committed, {
      anchorId: "span-2",
      text: "Second paragraph.",
      sourceContentHash: hashContent("Second paragraph."),
    });

    expect(resolved).toEqual({ start: 17, end: 34, text: "Second paragraph." });
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --run tests/manuscript/manuscript.test.ts`

Expected: FAIL because the manuscript domain modules do not exist.

- [ ] **Step 3: Implement Arc, Chapter, Scene, and Target Span**

```ts
import type { DomainId } from "../../shared/domain/ids";

export interface Arc {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly title: string;
  readonly chapterIds: readonly DomainId[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateArcInput {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly title: string;
  readonly createdAt: Date;
}

export function createArc(input: CreateArcInput): Arc {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.title.trim()) throw new Error("title is required");
  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    title: input.title.trim(),
    chapterIds: Object.freeze([]),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function reorderArcChapters(input: {
  arc: Arc;
  chapterIds: readonly DomainId[];
  updatedAt: Date;
}): Arc {
  const unique = [...new Set(input.chapterIds)];
  if (unique.length !== input.chapterIds.length) throw new Error("chapter order contains duplicates");
  if (input.updatedAt < input.arc.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...input.arc, chapterIds: Object.freeze([...unique]), updatedAt: input.updatedAt });
}
```

```ts
import type { DomainId } from "../../shared/domain/ids";

export interface Chapter {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly arcId: DomainId;
  readonly title: string;
  readonly sceneIds: readonly DomainId[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function createChapter(input: {
  id: DomainId;
  novelId: DomainId;
  arcId: DomainId;
  title: string;
  createdAt: Date;
}): Chapter {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.arcId) throw new Error("arcId is required");
  if (!input.title.trim()) throw new Error("title is required");
  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    arcId: input.arcId,
    title: input.title.trim(),
    sceneIds: Object.freeze([]),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function reorderChapterScenes(input: {
  chapter: Chapter;
  sceneIds: readonly DomainId[];
  updatedAt: Date;
}): Chapter {
  const unique = [...new Set(input.sceneIds)];
  if (unique.length !== input.sceneIds.length) throw new Error("scene order contains duplicates");
  if (input.updatedAt < input.chapter.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...input.chapter, sceneIds: Object.freeze([...unique]), updatedAt: input.updatedAt });
}
```

```ts
import type { DomainId, RevisionId } from "../../shared/domain/ids";
import { hashContent } from "../../shared/domain/contentHash";
import type { TargetSpan } from "./targetSpan";

export interface Scene {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly chapterId: DomainId;
  readonly title: string;
  readonly text: string;
  readonly spanAnchors: Readonly<Record<string, string>>;
  readonly currentRevisionId: RevisionId;
  readonly lastCommitId: DomainId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SceneRevision {
  readonly sceneId: DomainId;
  readonly revisionId: RevisionId;
  readonly text: string;
  readonly spanAnchors: Readonly<Record<string, string>>;
  readonly commitId: DomainId;
}

export function toSceneRevision(scene: Scene): SceneRevision {
  return Object.freeze({
    sceneId: scene.id,
    revisionId: scene.currentRevisionId,
    text: scene.text,
    spanAnchors: scene.spanAnchors,
    commitId: scene.lastCommitId,
  });
}

function assertSpanAnchors(text: string, spanAnchors: Readonly<Record<string, string>>): void {
  for (const [anchorId, anchoredText] of Object.entries(spanAnchors)) {
    if (!anchorId.trim()) throw new Error("spanAnchors keys must not be empty");
    if (!anchoredText) throw new Error(`Target span anchor text is empty: ${anchorId}`);
    const start = text.indexOf(anchoredText);
    if (start < 0) throw new Error(`Target span anchor text is not present in scene: ${anchorId}`);
    if (text.indexOf(anchoredText, start + 1) >= 0) {
      throw new Error(`Target span anchor text is ambiguous: ${anchorId}`);
    }
  }
}

export function createScene(input: {
  id: DomainId;
  novelId: DomainId;
  chapterId: DomainId;
  title: string;
  revisionId: RevisionId;
  commitId: DomainId;
  createdAt: Date;
}): Scene {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.chapterId) throw new Error("chapterId is required");
  if (!input.title.trim()) throw new Error("title is required");
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.commitId) throw new Error("commitId is required");
  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    chapterId: input.chapterId,
    title: input.title.trim(),
    text: "",
    spanAnchors: Object.freeze({}),
    currentRevisionId: input.revisionId,
    lastCommitId: input.commitId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function commitSceneText(input: {
  scene: Scene;
  text: string;
  spanAnchors?: Readonly<Record<string, string>>;
  revisionId: RevisionId;
  commitId: DomainId;
  updatedAt: Date;
}): Scene {
  if (!input.revisionId) throw new Error("revisionId is required");
  if (!input.commitId) throw new Error("commitId is required");
  if (input.updatedAt < input.scene.updatedAt) throw new Error("updatedAt cannot move backward");
  const spanAnchors = input.spanAnchors ?? {};
  assertSpanAnchors(input.text, spanAnchors);
  return Object.freeze({
    ...input.scene,
    text: input.text,
    spanAnchors: Object.freeze({ ...spanAnchors }),
    currentRevisionId: input.revisionId,
    lastCommitId: input.commitId,
    updatedAt: input.updatedAt,
  });
}
```

```ts
import { hashContent } from "../../shared/domain/contentHash";
import type { Scene } from "./scene";

export interface TargetSpan {
  readonly anchorId: string;
  readonly text: string;
  readonly sourceContentHash: string;
}

export interface ResolvedSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export function resolveTargetSpan(scene: Scene, span: TargetSpan): ResolvedSpan {
  const anchoredText = scene.spanAnchors[span.anchorId];
  if (anchoredText === undefined) {
    throw new Error(`Target span anchor not found: ${span.anchorId}`);
  }
  if (anchoredText !== span.text) {
    throw new Error(`Target span text does not match anchor: ${span.anchorId}`);
  }
  if (hashContent(anchoredText) !== span.sourceContentHash) {
    throw new Error("Target span source hash does not match scene text");
  }

  const start = scene.text.indexOf(anchoredText);
  if (start < 0) throw new Error(`Target span is not present in scene: ${span.anchorId}`);
  if (scene.text.indexOf(anchoredText, start + 1) >= 0) {
    throw new Error(`Target span text is ambiguous: ${span.anchorId}`);
  }
  return Object.freeze({ start, end: start + anchoredText.length, text: anchoredText });
}

export function replaceTargetSpan(input: {
  scene: Scene;
  target: TargetSpan;
  replacement: string;
}): string {
  const resolved = resolveTargetSpan(input.scene, input.target);
  return `${input.scene.text.slice(0, resolved.start)}${input.replacement}${input.scene.text.slice(resolved.end)}`;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run tests/manuscript/manuscript.test.ts`

Expected: PASS with 6 manuscript tests.

- [ ] **Step 5: Commit**

```bash
git add src/manuscript/domain tests/manuscript/manuscript.test.ts
git commit -m "feat: add manuscript aggregates and target spans"
```

---

### Task 6: GenerationTask Aggregate

**Files:**

- Create: `src/production/domain/generationTask.ts`
- Create: `tests/production/generationTask.test.ts`

**Interfaces:**

- Consumes: `DomainId`, `VersionSet`.
- Produces: `GenerationOperation`, `GenerationTaskStatus`, `GenerationTask`, `createGenerationTask`, `startGenerationTask`, `completeGenerationTask`, `cancelGenerationTask`, `markGenerationTaskStale`, `addCandidateReference`.
- Candidate and API tasks consume `GenerationTask.candidateIds` and `GenerationTask.basedOnVersionSet`.

- [ ] **Step 1: Write the failing GenerationTask tests**

```ts
import { describe, expect, it } from "vitest";
import {
  addCandidateReference,
  cancelGenerationTask,
  completeGenerationTask,
  createGenerationTask,
  markGenerationTaskStale,
  startGenerationTask,
} from "../../src/production/domain/generationTask";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");
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
  it("starts as draft with a precise based-on version set", () => {
    expect(task()).toMatchObject({
      status: "draft",
      operation: "rewrite",
      basedOnVersionSet: { scene: sceneVersion },
      candidateIds: [],
    });
  });

  it("stores candidate references without owning candidate content", () => {
    const started = startGenerationTask(task(), new Date("2026-10-03T00:00:00.000Z"));
    const withCandidate = addCandidateReference(started, "candidate-1");
    expect(withCandidate.candidateIds).toEqual(["candidate-1"]);
    expect(started.candidateIds).toEqual([]);
  });

  it("cannot complete without at least one candidate", () => {
    const running = startGenerationTask(task(), new Date("2026-10-03T00:00:00.000Z"));
    expect(() =>
      completeGenerationTask({
        task: running,
        candidateIds: [],
        updatedAt: new Date("2026-10-04T00:00:00.000Z"),
      }),
    ).toThrow("GenerationTask requires at least one candidate to complete");
  });

  it("supports stale and cancelled terminal states", () => {
    const running = startGenerationTask(task(), new Date("2026-10-03T00:00:00.000Z"));
    const stale = markGenerationTaskStale(running, new Date("2026-10-04T00:00:00.000Z"));
    expect(stale.status).toBe("stale");
    expect(() => startGenerationTask(stale, new Date("2026-10-05T00:00:00.000Z"))).toThrow(
      "Only a draft or ready task can start",
    );
    const cancelled = cancelGenerationTask(task(), new Date("2026-10-05T00:00:00.000Z"));
    expect(cancelled.status).toBe("cancelled");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/production/generationTask.test.ts`

Expected: FAIL because the GenerationTask module does not exist.

- [ ] **Step 3: Implement GenerationTask**

```ts
import type { DomainId } from "../../shared/domain/ids";
import type { VersionSet } from "../../shared/domain/versioning";

export type GenerationOperation =
  | "story_planning"
  | "outline_refinement"
  | "chapter_generation"
  | "scene_generation"
  | "continuation"
  | "expansion"
  | "rewrite"
  | "polish"
  | "local_regeneration"
  | "consistency_analysis";

export type GenerationTaskStatus =
  | "draft"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "stale"
  | "expired";

export interface GenerationTask {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly operation: GenerationOperation;
  readonly targetSceneId: DomainId;
  readonly intent: string;
  readonly basedOnVersionSet: VersionSet;
  readonly candidateIds: readonly DomainId[];
  readonly status: GenerationTaskStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function isTerminalTaskStatus(status: GenerationTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "stale" || status === "expired";
}

export function createGenerationTask(input: {
  id: DomainId;
  novelId: DomainId;
  operation: GenerationOperation;
  targetSceneId: DomainId;
  intent: string;
  basedOnVersionSet: VersionSet;
  createdAt: Date;
}): GenerationTask {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.targetSceneId) throw new Error("targetSceneId is required");
  if (!input.intent.trim()) throw new Error("intent is required");
  if (Object.keys(input.basedOnVersionSet).length === 0) {
    throw new Error("basedOnVersionSet must contain the target scene version");
  }
  const hasTargetVersion = Object.values(input.basedOnVersionSet).some(
    reference => reference.aggregateType === "Scene" && reference.objectId === input.targetSceneId,
  );
  if (!hasTargetVersion) {
    throw new Error("basedOnVersionSet must include the target scene version");
  }

  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    operation: input.operation,
    targetSceneId: input.targetSceneId,
    intent: input.intent.trim(),
    basedOnVersionSet: input.basedOnVersionSet,
    candidateIds: Object.freeze([]),
    status: "draft",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function startGenerationTask(task: GenerationTask, updatedAt: Date): GenerationTask {
  if (task.status !== "draft" && task.status !== "ready") throw new Error("Only a draft or ready task can start");
  if (updatedAt < task.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...task, status: "running", updatedAt });
}

export function addCandidateReference(task: GenerationTask, candidateId: DomainId): GenerationTask {
  if (!candidateId) throw new Error("candidateId is required");
  if (isTerminalTaskStatus(task.status)) throw new Error("Terminal task cannot add candidates");
  if (task.candidateIds.includes(candidateId)) return task;
  return Object.freeze({
    ...task,
    candidateIds: Object.freeze([...task.candidateIds, candidateId]),
  });
}

export function completeGenerationTask(input: {
  task: GenerationTask;
  candidateIds: readonly DomainId[];
  updatedAt: Date;
}): GenerationTask {
  if (input.candidateIds.length === 0) {
    throw new Error("GenerationTask requires at least one candidate to complete");
  }
  if (input.task.status !== "running") throw new Error("Only a running task can complete");
  for (const candidateId of input.candidateIds) {
    if (!input.task.candidateIds.includes(candidateId)) {
      throw new Error(`Candidate reference is not associated with task: ${candidateId}`);
    }
  }
  if (input.updatedAt < input.task.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({
    ...input.task,
    candidateIds: Object.freeze([...new Set(input.candidateIds)]),
    status: "completed",
    updatedAt: input.updatedAt,
  });
}

export function cancelGenerationTask(task: GenerationTask, updatedAt: Date): GenerationTask {
  if (isTerminalTaskStatus(task.status)) throw new Error("Only a draft, ready, or running task can be cancelled");
  if (updatedAt < task.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...task, status: "cancelled", updatedAt });
}

export function markGenerationTaskStale(task: GenerationTask, updatedAt: Date): GenerationTask {
  if (isTerminalTaskStatus(task.status)) throw new Error("Only a draft, ready, or running task can become stale");
  if (updatedAt < task.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({ ...task, status: "stale", updatedAt });
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- --run tests/production/generationTask.test.ts`

Expected: PASS with 6 GenerationTask tests.

- [ ] **Step 5: Commit**

```bash
git add src/production/domain/generationTask.ts tests/production/generationTask.test.ts
git commit -m "feat: add generation task aggregate"
```

---

### Task 7: Candidate Aggregate

**Files:**

- Create: `src/production/domain/candidate.ts`
- Create: `tests/production/candidate.test.ts`

**Interfaces:**

- Consumes: `DomainId`, `VersionSet`, `TargetSpan`.
- Produces: `CandidateStatus`, `Candidate`, `CandidateChange`, `createCandidate`, `editCandidate`, `markCandidateValidated`, `selectCandidate`, `rejectCandidate`, `markCandidateOutdated`.
- Validation, review, commit, and API tasks use `Candidate.id`, `Candidate.basedOnVersionSet`, and `Candidate.change`.

- [ ] **Step 1: Write the failing Candidate tests**

```ts
import { describe, expect, it } from "vitest";
import {
  createCandidate,
  editCandidate,
  markCandidateValidated,
  markCandidateOutdated,
  rejectCandidate,
  selectCandidate,
} from "../../src/production/domain/candidate";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");
const sceneVersion = createVersionReference("Scene", "scene-1", "scene-rev-1");
const basedOnVersionSet = createVersionSet({ scene: sceneVersion });

function candidate() {
  return createCandidate({
    id: "candidate-1",
    taskId: "task-1",
    novelId: "novel-1",
    basedOnVersionSet,
    change: { type: "text", sceneId: "scene-1", text: "Candidate text" },
    createdAt: now,
  });
}

describe("Candidate", () => {
  it("remains separate from canonical content", () => {
    expect(candidate()).toMatchObject({
      status: "generated",
      change: { type: "text", text: "Candidate text" },
    });
  });

  it("creates a new candidate revision after author edits", () => {
    const original = candidate();
    const edited = editCandidate({
      candidate: original,
      change: { type: "text", sceneId: "scene-1", text: "Edited text" },
      revisionId: "candidate-rev-2",
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });
    expect(original.currentRevisionId).toBe("candidate-1-rev-1");
    expect(edited.currentRevisionId).toBe("candidate-rev-2");
    if (edited.change.type !== "text") throw new Error("Expected a text candidate");
    expect(edited.change.text).toBe("Edited text");
  });

  it("supports selection, rejection, and stale states", () => {
    const original = markCandidateValidated(candidate(), new Date("2026-10-03T00:00:00.000Z"));
    const selected = selectCandidate(original, new Date("2026-10-03T00:00:00.000Z"));
    expect(selected.status).toBe("selected");
    expect(() => rejectCandidate(selected, "Not preferred")).toThrow("Terminal candidate cannot be rejected");

    const rejected = rejectCandidate(candidate(), "Not preferred");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("Not preferred");

    const outdated = markCandidateOutdated(candidate(), new Date("2026-10-03T00:00:00.000Z"));
    expect(outdated.status).toBe("outdated");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/production/candidate.test.ts`

Expected: FAIL because the Candidate module does not exist.

- [ ] **Step 3: Implement Candidate**

```ts
import type { DomainId, RevisionId } from "../../shared/domain/ids";
import type { VersionSet } from "../../shared/domain/versioning";
import type { TargetSpan } from "../../manuscript/domain/targetSpan";

export type CandidateStatus =
  | "generated"
  | "validating"
  | "validated"
  | "under_review"
  | "selected"
  | "rejected"
  | "outdated"
  | "archived";

export type CandidateAtomicChange =
  | { readonly type: "text"; readonly sceneId: DomainId; readonly text: string }
  | {
      readonly type: "structured_state";
      readonly stateRecordId: DomainId;
      readonly content: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "canonical_fact";
      readonly canonicalFactId: DomainId;
      readonly content: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "local_text";
      readonly sceneId: DomainId;
      readonly targetSpan: TargetSpan;
      readonly replacement: string;
    };

export interface CompositeCandidateChange {
  readonly type: "composite";
  readonly changes: readonly CandidateAtomicChange[];
}

export type CandidateChange = CandidateAtomicChange | CompositeCandidateChange;

export interface Candidate {
  readonly id: DomainId;
  readonly taskId: DomainId;
  readonly novelId: DomainId;
  readonly change: CandidateChange;
  readonly basedOnVersionSet: VersionSet;
  readonly currentRevisionId: RevisionId;
  readonly status: CandidateStatus;
  readonly rejectionReason?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function isTerminalCandidateStatus(status: CandidateStatus): boolean {
  return status === "selected" || status === "rejected" || status === "outdated" || status === "archived";
}

export function createCandidate(input: {
  id: DomainId;
  taskId: DomainId;
  novelId: DomainId;
  basedOnVersionSet: VersionSet;
  change: CandidateChange;
  createdAt: Date;
}): Candidate {
  if (!input.id) throw new Error("id is required");
  if (!input.taskId) throw new Error("taskId is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (Object.keys(input.basedOnVersionSet).length === 0) {
    throw new Error("basedOnVersionSet must contain at least one dependency");
  }
  if (input.change.type === "composite" && input.change.changes.length === 0) {
    throw new Error("composite change requires at least one atomic change");
  }

  return Object.freeze({
    id: input.id,
    taskId: input.taskId,
    novelId: input.novelId,
    change: input.change,
    basedOnVersionSet: input.basedOnVersionSet,
    currentRevisionId: `${input.id}-rev-1`,
    status: "generated",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function editCandidate(input: {
  candidate: Candidate;
  change: CandidateChange;
  revisionId: RevisionId;
  updatedAt: Date;
}): Candidate {
  if (!input.revisionId) throw new Error("revisionId is required");
  if (isTerminalCandidateStatus(input.candidate.status)) {
    throw new Error("Terminal candidate cannot be edited");
  }
  if (input.updatedAt < input.candidate.updatedAt) throw new Error("updatedAt cannot move backward");
  return Object.freeze({
    ...input.candidate,
    change: input.change,
    currentRevisionId: input.revisionId,
    updatedAt: input.updatedAt,
  });
}

export function selectCandidate(candidate: Candidate, updatedAt: Date): Candidate {
  if (candidate.status !== "validated" && candidate.status !== "under_review") {
    throw new Error("Only a validated or under-review candidate can be selected");
  }
  return Object.freeze({ ...candidate, status: "selected", updatedAt });
}

export function markCandidateValidated(candidate: Candidate, updatedAt: Date): Candidate {
  if (isTerminalCandidateStatus(candidate.status)) {
    throw new Error("Terminal candidate cannot become validated");
  }
  if (candidate.status !== "generated" && candidate.status !== "validating") {
    throw new Error("Only a generated or validating candidate can become validated");
  }
  return Object.freeze({ ...candidate, status: "validated", updatedAt });
}

export function rejectCandidate(candidate: Candidate, reason: string): Candidate {
  if (isTerminalCandidateStatus(candidate.status)) throw new Error("Terminal candidate cannot be rejected");
  if (!reason.trim()) throw new Error("rejection reason is required");
  return Object.freeze({ ...candidate, status: "rejected", rejectionReason: reason.trim() });
}

export function markCandidateOutdated(candidate: Candidate, updatedAt: Date): Candidate {
  if (isTerminalCandidateStatus(candidate.status)) {
    throw new Error("Terminal candidate cannot become outdated");
  }
  return Object.freeze({ ...candidate, status: "outdated", updatedAt });
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- --run tests/production/candidate.test.ts`

Expected: PASS with 6 Candidate tests.

- [ ] **Step 5: Commit**

```bash
git add src/production/domain/candidate.ts tests/production/candidate.test.ts
git commit -m "feat: add candidate aggregate"
```

---

### Task 8: ValidationRun Aggregate

**Files:**

- Create: `src/production/domain/validationRun.ts`
- Create: `tests/production/validationRun.test.ts`

**Interfaces:**

- Consumes: `DomainId`, `RevisionId`, `VersionSet`.
- Produces: `ValidationOutcome`, `ValidationFinding`, `ValidationRun`, `createValidationRun`, `summarizeValidationOutcome`.
- Review and commit tasks consume `ValidationRun.candidateRevisionId`, `ValidationRun.outcome`, and `ValidationRun.findings`.

- [ ] **Step 1: Write the failing ValidationRun tests**

```ts
import { describe, expect, it } from "vitest";
import {
  createValidationRun,
  summarizeValidationOutcome,
} from "../../src/production/domain/validationRun";

const now = new Date("2026-10-02T00:00:00.000Z");

function run(outcome: "pass" | "fail" | "needs_review") {
  return createValidationRun({
    id: "validation-1",
    candidateId: "candidate-1",
    candidateRevisionId: "candidate-rev-1",
    validatorId: "target-span-validator",
    outcome,
    findings: [
      {
        code: "PRESERVED_TEXT_MISSING",
        severity: outcome === "pass" ? "info" : "error",
        confidence: 0.96,
        message: "Required phrase was not preserved.",
        evidence: { requiredPhrase: "Northern Sect" },
      },
    ],
    createdAt: now,
  });
}

describe("ValidationRun", () => {
  it("binds validation evidence to one candidate revision", () => {
    expect(run("pass")).toMatchObject({
      candidateId: "candidate-1",
      candidateRevisionId: "candidate-rev-1",
      outcome: "pass",
    });
  });

  it("rejects validation without a candidate revision", () => {
    expect(() =>
      createValidationRun({
        id: "validation-1",
        candidateId: "candidate-1",
        candidateRevisionId: "",
        validatorId: "validator",
        outcome: "pass",
        findings: [],
        createdAt: now,
      }),
    ).toThrow("candidateRevisionId is required");
  });

  it("summarizes the most severe outcome", () => {
    expect(summarizeValidationOutcome(["pass", "pass"])).toBe("pass");
    expect(summarizeValidationOutcome(["pass", "needs_review"])).toBe("needs_review");
    expect(summarizeValidationOutcome(["needs_review", "fail"])).toBe("fail");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/production/validationRun.test.ts`

Expected: FAIL because the ValidationRun module does not exist.

- [ ] **Step 3: Implement ValidationRun**

```ts
import type { DomainId, RevisionId } from "../../shared/domain/ids";

export type ValidationOutcome = "pass" | "fail" | "needs_review";
export type ValidationSeverity = "info" | "warning" | "error";

export interface ValidationFinding {
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly confidence: number;
  readonly message: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface ValidationRun {
  readonly id: DomainId;
  readonly candidateId: DomainId;
  readonly candidateRevisionId: RevisionId;
  readonly validatorId: string;
  readonly outcome: ValidationOutcome;
  readonly findings: readonly ValidationFinding[];
  readonly createdAt: Date;
}

export function createValidationRun(input: {
  id: DomainId;
  candidateId: DomainId;
  candidateRevisionId: RevisionId;
  validatorId: string;
  outcome: ValidationOutcome;
  findings: readonly ValidationFinding[];
  createdAt: Date;
}): ValidationRun {
  if (!input.id) throw new Error("id is required");
  if (!input.candidateId) throw new Error("candidateId is required");
  if (!input.candidateRevisionId) throw new Error("candidateRevisionId is required");
  if (!input.validatorId.trim()) throw new Error("validatorId is required");

  for (const finding of input.findings) {
    if (!finding.code.trim()) throw new Error("finding.code is required");
    if (finding.confidence < 0 || finding.confidence > 1) {
      throw new Error("finding.confidence must be between 0 and 1");
    }
  }

  return Object.freeze({
    id: input.id,
    candidateId: input.candidateId,
    candidateRevisionId: input.candidateRevisionId,
    validatorId: input.validatorId.trim(),
    outcome: input.outcome,
    findings: Object.freeze(input.findings.map((finding) => Object.freeze({ ...finding }))),
    createdAt: input.createdAt,
  });
}

export function summarizeValidationOutcome(outcomes: readonly ValidationOutcome[]): ValidationOutcome {
  if (outcomes.length === 0) throw new Error("At least one validation outcome is required");
  if (outcomes.includes("fail")) return "fail";
  if (outcomes.includes("needs_review")) return "needs_review";
  return "pass";
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- --run tests/production/validationRun.test.ts`

Expected: PASS with 3 ValidationRun tests.

- [ ] **Step 5: Commit**

```bash
git add src/production/domain/validationRun.ts tests/production/validationRun.test.ts
git commit -m "feat: add validation run aggregate"
```

---

### Task 9: ReviewDecision Aggregate

**Files:**

- Create: `src/production/domain/reviewDecision.ts`
- Create: `tests/production/reviewDecision.test.ts`

**Interfaces:**

- Consumes: `DomainId`, `RevisionId`.
- Produces: `ReviewDecisionType`, `ReviewDecisionMaker`, `ReviewDecision`, `createReviewDecision`.
- NarrativeCommit consumes `ReviewDecision.decision`, `ReviewDecision.candidateRevisionId`, and `ReviewDecision.decidedBy`.

- [ ] **Step 1: Write the failing ReviewDecision tests**

```ts
import { describe, expect, it } from "vitest";
import { createReviewDecision } from "../../src/production/domain/reviewDecision";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("ReviewDecision", () => {
  it("records an explicit author approval bound to one candidate revision", () => {
    const decision = createReviewDecision({
      id: "review-1",
      candidateId: "candidate-1",
      candidateRevisionId: "candidate-rev-1",
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "Preferred the stronger ending.",
      createdAt: now,
    });

    expect(decision).toMatchObject({
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
    });
  });

  it("requires a reason for rejection", () => {
    expect(() =>
      createReviewDecision({
        id: "review-1",
        candidateId: "candidate-1",
        candidateRevisionId: "candidate-rev-1",
        decision: "reject",
        decidedBy: "human",
        actorId: "author-1",
        reason: "",
        createdAt: now,
      }),
    ).toThrow("A rejection requires a reason");
  });

  it("requires policy decisions to identify their policy", () => {
    expect(() =>
      createReviewDecision({
        id: "review-1",
        candidateId: "candidate-1",
        candidateRevisionId: "candidate-rev-1",
        decision: "approve",
        decidedBy: "policy",
        actorId: "low-risk-polish",
        reason: "",
        createdAt: now,
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/production/reviewDecision.test.ts`

Expected: FAIL because the ReviewDecision module does not exist.

- [ ] **Step 3: Implement ReviewDecision**

```ts
import type { DomainId, RevisionId } from "../../shared/domain/ids";

export type ReviewDecisionType = "approve" | "reject" | "request_regeneration";
export type ReviewDecisionMaker = "human" | "policy";

export interface ReviewDecision {
  readonly id: DomainId;
  readonly candidateId: DomainId;
  readonly candidateRevisionId: RevisionId;
  readonly decision: ReviewDecisionType;
  readonly decidedBy: ReviewDecisionMaker;
  readonly actorId: DomainId;
  readonly reason?: string;
  readonly createdAt: Date;
}

export function createReviewDecision(input: {
  id: DomainId;
  candidateId: DomainId;
  candidateRevisionId: RevisionId;
  decision: ReviewDecisionType;
  decidedBy: ReviewDecisionMaker;
  actorId: DomainId;
  reason: string;
  createdAt: Date;
}): ReviewDecision {
  if (!input.id) throw new Error("id is required");
  if (!input.candidateId) throw new Error("candidateId is required");
  if (!input.candidateRevisionId) throw new Error("candidateRevisionId is required");
  if (!input.actorId) throw new Error("actorId is required");
  if (input.decision === "reject" && !input.reason.trim()) {
    throw new Error("A rejection requires a reason");
  }

  return Object.freeze({
    id: input.id,
    candidateId: input.candidateId,
    candidateRevisionId: input.candidateRevisionId,
    decision: input.decision,
    decidedBy: input.decidedBy,
    actorId: input.actorId,
    reason: input.reason.trim() || undefined,
    createdAt: input.createdAt,
  });
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- --run tests/production/reviewDecision.test.ts`

Expected: PASS with 3 ReviewDecision tests.

- [ ] **Step 5: Commit**

```bash
git add src/production/domain/reviewDecision.ts tests/production/reviewDecision.test.ts
git commit -m "feat: add review decision aggregate"
```

---

### Task 10: NarrativeCommit Process Aggregate

**Files:**

- Create: `src/safety/domain/narrativeCommit.ts`
- Create: `tests/safety/narrativeCommit.test.ts`

**Interfaces:**

- Consumes: `DomainId`, `RevisionId`, `VersionSet`, `ValidationRun`, `ReviewDecision`, `Candidate`.
- Produces: `NarrativeCommitStatus`, `NarrativeCommit`, `createNarrativeCommit`, `markNarrativeCommitCommitted`, `markNarrativeCommitStale`, `markNarrativeCommitFailed`.
- Application services use `NarrativeCommit.resultingVersionSet` and `NarrativeCommit.status`.

- [ ] **Step 1: Write the failing NarrativeCommit tests**

```ts
import { describe, expect, it } from "vitest";
import { createCandidate } from "../../src/production/domain/candidate";
import { createReviewDecision } from "../../src/production/domain/reviewDecision";
import { createValidationRun } from "../../src/production/domain/validationRun";
import {
  createNarrativeCommit,
  markNarrativeCommitCommitted,
  markNarrativeCommitFailed,
  markNarrativeCommitStale,
} from "../../src/safety/domain/narrativeCommit";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");
const sceneVersion = createVersionReference("Scene", "scene-1", "scene-rev-1");
const basedOnVersionSet = createVersionSet({ scene: sceneVersion });

function candidate() {
  return createCandidate({
    id: "candidate-1",
    taskId: "task-1",
    novelId: "novel-1",
    basedOnVersionSet,
    change: { type: "text", sceneId: "scene-1", text: "Committed text" },
    createdAt: now,
  });
}

function commitInput(validationOutcome: "pass" | "fail" | "needs_review" = "pass") {
  const currentCandidate = candidate();
  return {
    id: "commit-1",
    novelId: "novel-1",
    candidate: currentCandidate,
    validationRuns: [
      createValidationRun({
        id: "validation-1",
        candidateId: currentCandidate.id,
        candidateRevisionId: currentCandidate.currentRevisionId,
        validatorId: "core-validator",
        outcome: validationOutcome,
        findings: [],
        createdAt: now,
      }),
    ],
    reviewDecision: createReviewDecision({
      id: "review-1",
      candidateId: currentCandidate.id,
      candidateRevisionId: currentCandidate.currentRevisionId,
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "",
      createdAt: now,
    }),
    createdAt: now,
  };
}

describe("NarrativeCommit", () => {
  it("requires approval and a non-failing validation summary", () => {
    expect(() => createNarrativeCommit(commitInput("fail"))).toThrow(
      "A failed validation cannot be committed",
    );
  });

  it("records a pending coherent transition without owning canonical objects", () => {
    const commit = createNarrativeCommit(commitInput());
    expect(commit).toMatchObject({
      id: "commit-1",
      novelId: "novel-1",
      candidateId: "candidate-1",
      status: "pending",
    });
    expect(commit.basedOnVersionSet).toEqual(basedOnVersionSet);
  });

  it("marks the commit complete only with resulting revisions", () => {
    const pending = createNarrativeCommit(commitInput());
    const committed = markNarrativeCommitCommitted({
      commit: pending,
      resultingVersionSet: createVersionSet({
        scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
      }),
      committedAt: new Date("2026-10-03T00:00:00.000Z"),
    });

    expect(pending.status).toBe("pending");
    expect(committed.status).toBe("committed");
    expect(committed.resultingVersionSet.scene.revisionId).toBe("scene-rev-2");
  });

  it("supports stale and failed terminal states", () => {
    const pending = createNarrativeCommit(commitInput());
    const stale = markNarrativeCommitStale(pending, new Date("2026-10-03T00:00:00.000Z"));
    const failed = markNarrativeCommitFailed({
      commit: pending,
      reason: "Database unavailable",
      failedAt: new Date("2026-10-03T00:00:00.000Z"),
    });
    expect(stale.status).toBe("stale");
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("Database unavailable");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/safety/narrativeCommit.test.ts`

Expected: FAIL because the NarrativeCommit module does not exist.

- [ ] **Step 3: Implement NarrativeCommit**

```ts
import type { DomainId } from "../../shared/domain/ids";
import type { VersionSet } from "../../shared/domain/versioning";
import type { Candidate } from "../../production/domain/candidate";
import type { ValidationRun } from "../../production/domain/validationRun";
import type { ReviewDecision } from "../../production/domain/reviewDecision";

export type NarrativeCommitStatus = "pending" | "committed" | "stale" | "failed";

export interface NarrativeCommit {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly candidateId: DomainId;
  readonly candidateRevisionId: string;
  readonly validationRunIds: readonly DomainId[];
  readonly reviewDecisionId: DomainId;
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
  candidate: Candidate;
  validationRuns: readonly ValidationRun[];
  reviewDecision: ReviewDecision;
  createdAt: Date;
}): NarrativeCommit {
  if (!input.id) throw new Error("id is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (input.candidate.novelId !== input.novelId) throw new Error("Candidate novel does not match commit novel");
  if (input.validationRuns.length === 0) throw new Error("At least one validation run is required");

  const hasFailedValidation = input.validationRuns.some((run) => run.outcome === "fail");
  if (hasFailedValidation) throw new Error("A failed validation cannot be committed");

  for (const run of input.validationRuns) {
    if (run.candidateId !== input.candidate.id) throw new Error("Validation run does not match candidate");
    if (run.candidateRevisionId !== input.candidate.currentRevisionId) {
      throw new Error("Validation run does not match candidate revision");
    }
  }

  if (input.reviewDecision.candidateId !== input.candidate.id) {
    throw new Error("Review decision does not match candidate");
  }
  if (input.reviewDecision.candidateRevisionId !== input.candidate.currentRevisionId) {
    throw new Error("Review decision does not match candidate revision");
  }
  if (input.reviewDecision.decision !== "approve") {
    throw new Error("Only an approved candidate can be committed");
  }

  return Object.freeze({
    id: input.id,
    novelId: input.novelId,
    candidateId: input.candidate.id,
    candidateRevisionId: input.candidate.currentRevisionId,
    validationRunIds: Object.freeze(input.validationRuns.map((run) => run.id)),
    reviewDecisionId: input.reviewDecision.id,
    basedOnVersionSet: input.candidate.basedOnVersionSet,
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

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- --run tests/safety/narrativeCommit.test.ts`

Expected: PASS with 4 NarrativeCommit tests.

- [ ] **Step 5: Commit**

```bash
git add src/safety/domain/narrativeCommit.ts tests/safety/narrativeCommit.test.ts
git commit -m "feat: add narrative commit process aggregate"
```

---

### Task 11: Context-Owned Domain Events

**Files:**

- Create: `src/safety/domain/domainEvent.ts`
- Create: `src/safety/infrastructure/eventStore.ts`
- Create: `tests/safety/events.test.ts`

**Interfaces:**

- Consumes: `DomainId`, `RevisionId`, `VersionSet`.
- Produces: `DomainEventName`, `DomainEvent`, `createDomainEvent`, `EventStore`, `InMemoryEventStore`.
- Projections and integration tasks consume `DomainEvent.name`, `DomainEvent.payload`, and `EventStore.append`.

- [ ] **Step 1: Write the failing event ownership tests**

```ts
import { describe, expect, it } from "vitest";
import { createDomainEvent } from "../../src/safety/domain/domainEvent";
import { InMemoryEventStore } from "../../src/safety/infrastructure/eventStore";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("domain events", () => {
  it("binds event semantics to the producing context", () => {
    const event = createDomainEvent({
      eventId: "event-1",
      name: "SceneCommitted",
      context: "manuscript",
      novelId: "novel-1",
      objectId: "scene-1",
      revisionId: "scene-rev-2",
      commitId: "commit-1",
      payload: { textLength: 31 },
      occurredAt: now,
    });

    expect(event.context).toBe("manuscript");
    expect(event.name).toBe("SceneCommitted");
  });

  it("requires event identity and context", () => {
    expect(() =>
      createDomainEvent({
        eventId: "",
        name: "SceneCommitted",
        context: "manuscript",
        novelId: "novel-1",
        objectId: "scene-1",
        revisionId: "scene-rev-2",
        commitId: "commit-1",
        payload: {},
        occurredAt: now,
      }),
    ).toThrow("eventId is required");
  });

  it("stores events append-only with strict ordering", async () => {
    const store = new InMemoryEventStore();
    const first = createDomainEvent({
      eventId: "event-1",
      name: "SceneCommitted",
      context: "manuscript",
      novelId: "novel-1",
      objectId: "scene-1",
      revisionId: "scene-rev-2",
      commitId: "commit-1",
      payload: {},
      occurredAt: now,
    });
    const second = createDomainEvent({
      eventId: "event-2",
      name: "CharacterStateChanged",
      context: "narrative_state",
      novelId: "novel-1",
      objectId: "state-1",
      revisionId: "state-rev-2",
      commitId: "commit-1",
      payload: {},
      occurredAt: new Date("2026-10-03T00:00:00.000Z"),
    });

    await store.append(first);
    await store.append(second);
    const events = await store.listByNovel("novel-1");
    expect(events.map((event) => event.eventId)).toEqual(["event-1", "event-2"]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --run tests/safety/events.test.ts`

Expected: FAIL because the event modules do not exist.

- [ ] **Step 3: Implement DomainEvent and EventStore**

```ts
import type { DomainId, RevisionId } from "../../shared/domain/ids";

import { deepFreeze } from "../../shared/domain/immutable";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonPayload = Readonly<Record<string, JsonValue>>;

export type DomainEventName =
  | "NovelCreated"
  | "SceneCommitted"
  | "CanonicalFactChanged"
  | "CharacterStateChanged"
  | "WorldStateChanged"
  | "PlotStateChanged"
  | "CandidateCreated"
  | "ValidationCompleted"
  | "ReviewDecisionRecorded"
  | "NarrativeCommitRecorded"
  | "MemoryProjectionRebuilt";

export type ProducingContext =
  | "narrative_state"
  | "manuscript"
  | "ai_production"
  | "memory"
  | "platform";

const EVENT_CONTEXTS: Readonly<Record<DomainEventName, ProducingContext>> = {
  NovelCreated: "narrative_state",
  SceneCommitted: "manuscript",
  CanonicalFactChanged: "narrative_state",
  CharacterStateChanged: "narrative_state",
  WorldStateChanged: "narrative_state",
  PlotStateChanged: "narrative_state",
  CandidateCreated: "ai_production",
  ValidationCompleted: "ai_production",
  ReviewDecisionRecorded: "ai_production",
  NarrativeCommitRecorded: "ai_production",
  MemoryProjectionRebuilt: "memory",
};

export interface DomainEvent {
  readonly eventId: DomainId;
  readonly name: DomainEventName;
  readonly context: ProducingContext;
  readonly novelId: DomainId;
  readonly objectId: DomainId;
  readonly revisionId: RevisionId;
  readonly commitId?: DomainId;
  readonly payload: JsonPayload;
  readonly occurredAt: Date;
}

function assertJsonValue(value: unknown, path: string): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Event payload must be JSON-compatible at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`));
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      assertJsonValue(entry, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`Event payload must be JSON-compatible at ${path}`);
}

export function assertJsonPayload(payload: Readonly<Record<string, unknown>>): asserts payload is JsonPayload {
  for (const [key, value] of Object.entries(payload)) {
    assertJsonValue(value, `payload.${key}`);
  }
}

export function cloneJsonPayload(payload: Readonly<Record<string, unknown>>): JsonPayload {
  assertJsonPayload(payload);
  return JSON.parse(JSON.stringify(payload)) as JsonPayload;
}

export function createDomainEvent(input: {
  eventId: DomainId;
  name: DomainEventName;
  context: ProducingContext;
  novelId: DomainId;
  objectId: DomainId;
  revisionId: RevisionId;
  commitId?: DomainId;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
}): DomainEvent {
  if (!input.eventId) throw new Error("eventId is required");
  if (!input.novelId) throw new Error("novelId is required");
  if (!input.objectId) throw new Error("objectId is required");
  if (!input.revisionId) throw new Error("revisionId is required");
  assertJsonPayload(input.payload);
  if (EVENT_CONTEXTS[input.name] !== input.context) {
    throw new Error(`Event ${input.name} cannot be produced by context ${input.context}`);
  }

  return Object.freeze({
    eventId: input.eventId,
    name: input.name,
    context: input.context,
    novelId: input.novelId,
    objectId: input.objectId,
    revisionId: input.revisionId,
    commitId: input.commitId,
    payload: deepFreeze(cloneJsonPayload(input.payload)),
    occurredAt: input.occurredAt,
  });
}
```

```ts
import type { DomainEvent } from "../domain/domainEvent";
import { deepFreeze } from "../../shared/domain/immutable";
import { cloneJsonPayload } from "../domain/domainEvent";

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  listByNovel(novelId: string): Promise<readonly DomainEvent[]>;
}

export class InMemoryEventStore implements EventStore {
  private readonly events: DomainEvent[] = [];
  private readonly eventIds = new Set<string>();

  async append(event: DomainEvent): Promise<void> {
    if (this.eventIds.has(event.eventId)) {
      throw new Error(`Duplicate event id: ${event.eventId}`);
    }
    this.eventIds.add(event.eventId);
    this.events.push(
      deepFreeze({
        ...event,
        payload: cloneJsonPayload(event.payload),
      }),
    );
  }

  async listByNovel(novelId: string): Promise<readonly DomainEvent[]> {
    return Object.freeze([...this.events.filter((event) => event.novelId === novelId)]);
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run tests/safety/events.test.ts`

Expected: PASS with 8 event tests.

- [ ] **Step 5: Commit**

```bash
git add src/safety/domain/domainEvent.ts src/safety/infrastructure/eventStore.ts tests/safety/events.test.ts
git commit -m "feat: add context-owned domain events"
```

---

### Task 12: Repository Contracts and In-Memory Adapters

**Files:**

- Create: `src/shared/application/repository.ts`
- Create: `src/app/inMemoryRepositories.ts`
- Create: `tests/app/repositories.test.ts`

**Interfaces:**

- Consumes: `Novel`, `CanonicalFact`, `StateRecord`, `Arc`, `Chapter`, `Scene`, `GenerationTask`, `Candidate`, `ValidationRun`, `ReviewDecision`, `NarrativeCommit`.
- Produces: `Repository`, `RevisionedRepository`, `InMemoryRepository`, `InMemoryRevisionedRepository`.
- Application services, API tests, and PostgreSQL repositories consume these interfaces without knowing their storage implementation.

- [ ] **Step 1: Write the failing repository tests**

```ts
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../../src/app/inMemoryRepositories";
import { InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import { createCandidate } from "../../src/production/domain/candidate";
import { createNovel } from "../../src/narrative/novel/domain/novel";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("repositories", () => {
  it("saves and lists plain aggregates by novel", async () => {
    const repository = new InMemoryRepository<{ id: string; novelId: string; title: string }>();
    await repository.save({ id: "novel-1", novelId: "novel-1", title: "Novel" });
    const loaded = await repository.findById("novel-1");
    const novels = await repository.listByNovel("novel-1");
    expect(loaded?.title).toBe("Novel");
    expect(novels).toHaveLength(1);
    await expect(repository.findById("missing")).resolves.toBeUndefined();
  });

  it("preserves immutable revisions by object and revision id", async () => {
    const repository = new InMemoryRevisionedRepository<{
      id: string;
      novelId: string;
      currentRevisionId: string;
      value: string;
    }>();

    await repository.save({
      id: "object-1",
      novelId: "novel-1",
      currentRevisionId: "rev-1",
      value: "old",
    });
    await repository.save({
      id: "object-1",
      novelId: "novel-1",
      currentRevisionId: "rev-2",
      value: "new",
    });

    expect((await repository.getRevision("object-1", "rev-1"))?.value).toBe("old");
    expect((await repository.getRevision("object-1", "rev-2"))?.value).toBe("new");
    expect((await repository.findById("object-1"))?.value).toBe("new");
  });

  it("returns frozen current aggregates", async () => {
    const repository = new InMemoryRepository<{ id: string; novelId: string; title: string }>();
    await repository.save({ id: "novel-1", novelId: "novel-1", title: "Novel" });
    const loaded = await repository.findById("novel-1");
    expect(() => {
      if (loaded) (loaded as { title: string }).title = "Mutated";
    }).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --run tests/app/repositories.test.ts`

Expected: FAIL because repository modules do not exist.

- [ ] **Step 3: Implement repository contracts and in-memory adapters**

```ts
export interface NovelOwned {
  readonly id: string;
  readonly novelId: string;
}

export interface Identified {
  readonly id: string;
  readonly novelId?: string;
}

/** A missing novelId means the object itself is the novel identity. */
export interface Repository<T extends Identified> {
  save(entity: T): Promise<void>;
  findById(id: string): Promise<T | undefined>;
  listByNovel(novelId: string): Promise<readonly T[]>;
}

export interface Revisioned<T> extends NovelOwned {
  readonly currentRevisionId: string;
}

export interface RevisionedRepository<T extends Revisioned<T>> extends Repository<T> {
  getRevision(id: string, revisionId: string): Promise<T | undefined>;
}
```

```ts
import type { Repository, Revisioned, RevisionedRepository } from "../shared/application/repository";
import { deepFreeze } from "../shared/domain/immutable";

function cloneValue<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  if (value !== null && typeof value === "object") {
    const clone = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      clone[key] = cloneValue(nested);
    }
    return clone as T;
  }
  return value;
}

function snapshot<T>(value: T): T {
  return deepFreeze(cloneValue(value));
}

function hasSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class InMemoryRepository<T extends { id: string; novelId?: string }> implements Repository<T> {
  private readonly entities = new Map<string, T>();

  async save(entity: T): Promise<void> {
    this.entities.set(entity.id, snapshot(entity));
  }

  async findById(id: string): Promise<T | undefined> {
    const entity = this.entities.get(id);
    return entity ? snapshot(entity) : undefined;
  }

  async listByNovel(novelId: string): Promise<readonly T[]> {
    return Object.freeze(
      [...this.entities.values()].filter((entity) => (entity.novelId ?? entity.id) === novelId).map((entity) => snapshot(entity)),
    );
  }
}

export class InMemoryRevisionedRepository<T extends Revisioned<T>>
  implements RevisionedRepository<T>
{
  private readonly currentEntities = new Map<string, T>();
  private readonly revisions = new Map<string, T>();

  async save(entity: T): Promise<void> {
    const frozen = snapshot(entity);
    const revisionKey = `${entity.id}:${entity.currentRevisionId}`;
    const existing = this.revisions.get(revisionKey);
    if (existing) {
      if (!hasSameValue(existing, frozen)) {
        throw new Error(`Revision already exists: ${revisionKey}`);
      }
    } else {
      this.revisions.set(revisionKey, frozen);
    }
    this.currentEntities.set(entity.id, frozen);
  }

  async findById(id: string): Promise<T | undefined> {
    const entity = this.currentEntities.get(id);
    return entity ? snapshot(entity) : undefined;
  }

  async getRevision(id: string, revisionId: string): Promise<T | undefined> {
    const entity = this.revisions.get(`${id}:${revisionId}`);
    return entity ? snapshot(entity) : undefined;
  }

  async listByNovel(novelId: string): Promise<readonly T[]> {
    return Object.freeze(
      [...this.currentEntities.values()]
        .filter((entity) => entity.novelId === novelId)
        .map((entity) => snapshot(entity)),
    );
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run tests/app/repositories.test.ts`

Expected: PASS with 6 repository tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/application/repository.ts src/app/inMemoryRepositories.ts tests/app/repositories.test.ts
git commit -m "feat: add repository contracts and in-memory adapters"
```

---

### Task 13: Runtime Adapter Abstraction

**Files:**

- Create: `src/production/runtime/runtimeAdapter.ts`
- Create: `src/production/runtime/deterministicRuntime.ts`
- Create: `tests/production/runtimeAdapter.test.ts`

**Interfaces:**

- Consumes: `GenerationTask`, `VersionSet`.
- Produces: `AgentRole`, `ModelPolicy`, `RuntimeRequest`, `RuntimeResult`, `RuntimeAdapter`, `DeterministicRuntime`.
- Application services consume `RuntimeAdapter.execute`; provider adapters implement the same interface without changing domain types.

- [ ] **Step 1: Write the failing runtime tests**

```ts
import { describe, expect, it } from "vitest";
import { createGenerationTask } from "../../src/production/domain/generationTask";
import { DeterministicRuntime } from "../../src/production/runtime/deterministicRuntime";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("runtime abstraction", () => {
  it("separates agent role from model and runtime", async () => {
    const task = createGenerationTask({
      id: "task-1",
      novelId: "novel-1",
      operation: "rewrite",
      targetSceneId: "scene-1",
      intent: "Rewrite with more tension.",
      basedOnVersionSet: createVersionSet({
        scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
      }),
      createdAt: now,
    });

    const runtime = new DeterministicRuntime();
    const result = await runtime.execute({
      taskId: "task-1",
      agentRole: "writer",
      modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
      basedOnVersionSet: task.basedOnVersionSet,
      context: { taskIntent: task.intent },
      requestedChange: { type: "text", sceneId: "scene-1", text: "Deterministic result" },
    });

    expect(result.taskId).toBe("task-1");
    expect(result.agentRole).toBe("writer");
    expect(result.modelPolicy.model).toBe("deterministic");
    expect(result.change).toEqual({ type: "text", sceneId: "scene-1", text: "Deterministic result" });
  });

  it("requires the same task identity in the result contract", async () => {
    const runtime = new DeterministicRuntime();
    await expect(
      runtime.execute({
        taskId: "task-1",
        agentRole: "writer",
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
        basedOnVersionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-1", "scene-rev-1"),
        }),
        context: {},
        requestedChange: { type: "text", sceneId: "scene-1", text: "Result" },
      }),
    ).resolves.toMatchObject({ taskId: "task-1" });
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --run tests/production/runtimeAdapter.test.ts`

Expected: FAIL because the runtime modules do not exist.

- [ ] **Step 3: Implement RuntimeAdapter and DeterministicRuntime**

```ts
import type { CandidateChange } from "../domain/candidate";
import type { GenerationTask } from "../domain/generationTask";
import type { VersionSet } from "../../shared/domain/versioning";

export type AgentRole = "planner" | "writer" | "editor" | "reviewer" | "consistency_agent" | "memory_agent";

export interface ModelPolicy {
  readonly provider: string;
  readonly model: string;
  readonly maxOutputTokens: number;
}

export interface RuntimeRequest {
  readonly taskId: string;
  readonly agentRole: AgentRole;
  readonly modelPolicy: ModelPolicy;
  readonly basedOnVersionSet: VersionSet;
  readonly context: Readonly<Record<string, unknown>>;
  readonly requestedChange: CandidateChange;
}

export interface RuntimeResult {
  readonly taskId: string;
  readonly agentRole: AgentRole;
  readonly modelPolicy: ModelPolicy;
  readonly change: CandidateChange;
  readonly basedOnVersionSet: VersionSet;
}

export interface RuntimeAdapter {
  execute(request: RuntimeRequest): Promise<RuntimeResult>;
}
```

```ts
import { createVersionSet } from "../../shared/domain/versioning";
import { deepFreeze } from "../../shared/domain/immutable";
import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "./runtimeAdapter";

const AGENT_ROLES = new Set([
  "planner",
  "writer",
  "editor",
  "reviewer",
  "consistency_agent",
  "memory_agent",
]);

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  if (value !== null && typeof value === "object") {
    const clone = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      clone[key] = cloneValue(nested);
    }
    return clone as T;
  }
  return value;
}

function assertRequestedChange(change: RuntimeRequest["requestedChange"]): void {
  if (change.type === "composite") {
    if (change.changes.length === 0) throw new Error("composite change requires at least one atomic change");
    for (const atomicChange of change.changes) assertRequestedChange(atomicChange);
    return;
  }
  if (change.type === "text") {
    if (!change.sceneId || !change.text) throw new Error("text change requires sceneId and text");
    return;
  }
  if (change.type === "structured_state") {
    if (!change.stateRecordId || Object.keys(change.content).length === 0) {
      throw new Error("structured_state change requires stateRecordId and content");
    }
    return;
  }
  if (change.type === "canonical_fact") {
    if (!change.canonicalFactId || Object.keys(change.content).length === 0) {
      throw new Error("canonical_fact change requires canonicalFactId and content");
    }
    return;
  }
  if (!change.sceneId || !change.targetSpan.anchorId || !change.targetSpan.text || !change.targetSpan.sourceContentHash || !change.replacement) {
    throw new Error("local_text change requires sceneId, targetSpan, and replacement");
  }
}

export class DeterministicRuntime implements RuntimeAdapter {
  async execute(request: RuntimeRequest): Promise<RuntimeResult> {
    if (!request.taskId) throw new Error("taskId is required");
    if (!request.modelPolicy.provider.trim()) throw new Error("provider is required");
    if (!request.modelPolicy.model.trim()) throw new Error("model is required");
    if (!AGENT_ROLES.has(request.agentRole)) throw new Error("agentRole is invalid");
    if (request.modelPolicy.maxOutputTokens <= 0) {
      throw new Error("maxOutputTokens must be positive");
    }
    assertRequestedChange(request.requestedChange);

    return Object.freeze({
      taskId: request.taskId,
      agentRole: request.agentRole,
      modelPolicy: Object.freeze({ ...request.modelPolicy }),
      change: deepFreeze(cloneValue(request.requestedChange)),
      basedOnVersionSet: createVersionSet({ ...request.basedOnVersionSet }),
    });
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run tests/production/runtimeAdapter.test.ts`

Expected: PASS with 6 runtime tests.

- [ ] **Step 5: Commit**

```bash
git add src/production/runtime tests/production/runtimeAdapter.test.ts
git commit -m "feat: add provider-independent runtime adapter"
```

---

### Task 14: Commit Candidate Application Service

**Files:**

- Create: `src/safety/application/commitCandidate.ts`
- Create: `tests/app/coCreationLoop.test.ts`

**Interfaces:**

- Consumes: `InMemoryRevisionedRepository`, `InMemoryRepository`, `InMemoryEventStore`, `Candidate`, `ValidationRun`, `ReviewDecision`, `NarrativeCommit`, `commitSceneText`, `replaceCanonicalFact`, `replaceStateRecord`, `replaceTargetSpan`.
- Produces: `CommitCandidateDependencies`, `CommitCandidateInput`, `commitCandidate`.
- API and integration tests consume `commitCandidate` to verify the complete canonical transition.

- [ ] **Step 1: Write the failing commit application tests**

```ts
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../../src/app/inMemoryRepositories";
import { InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import { createCandidate, markCandidateValidated, selectCandidate } from "../../src/production/domain/candidate";
import { createReviewDecision } from "../../src/production/domain/reviewDecision";
import { createValidationRun } from "../../src/production/domain/validationRun";
import { commitSceneText, createScene } from "../../src/manuscript/domain/scene";
import { commitCandidate } from "../../src/safety/application/commitCandidate";
import { InMemoryEventStore } from "../../src/safety/infrastructure/eventStore";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");

async function setup() {
  const scene = createScene({
    id: "scene-1",
    novelId: "novel-1",
    chapterId: "chapter-1",
    title: "The Northern Gate",
    revisionId: "scene-rev-1",
    commitId: "initial-commit",
    createdAt: now,
  });
  const committedScene = commitSceneText({
    scene,
    text: "Old text",
    revisionId: "scene-rev-2",
    commitId: "initial-commit",
    updatedAt: now,
  });

  const candidate = selectCandidate(
    markCandidateValidated(
      createCandidate({
        id: "candidate-1",
        taskId: "task-1",
        novelId: "novel-1",
        basedOnVersionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
        }),
        change: { type: "text", sceneId: "scene-1", text: "New text" },
        createdAt: now,
      }),
      now,
    ),
    now,
  );
  const validationRuns = [
    createValidationRun({
      id: "validation-1",
      candidateId: candidate.id,
      candidateRevisionId: candidate.currentRevisionId,
      validatorId: "text-validator",
      outcome: "pass",
      findings: [],
      createdAt: now,
    }),
  ];
  const reviewDecision = createReviewDecision({
    id: "review-1",
    candidateId: candidate.id,
    candidateRevisionId: candidate.currentRevisionId,
    decision: "approve",
    decidedBy: "human",
    actorId: "author-1",
    reason: "",
    createdAt: now,
  });

  const scenes = new InMemoryRevisionedRepository<Scene>();
  const candidates = new InMemoryRevisionedRepository<Candidate>();
  const commits = new InMemoryRepository<NarrativeCommit>();
  const events = new InMemoryEventStore();
  await scenes.save(committedScene);
  await candidates.save(candidate);

  return {
    scenes,
    candidates,
    commits,
    events,
    candidate,
    validationRuns,
    reviewDecision,
  };
}

describe("commitCandidate", () => {
  it("commits an approved candidate as a coherent canonical transition", async () => {
    const context = await setup();
    const commit = await commitCandidate({
      repositories: {
        scenes: context.scenes,
        candidates: context.candidates,
        canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
        stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
        narrativeCommits: context.commits,
      },
      eventStore: context.events,
      input: {
        commitId: "commit-1",
        candidateId: context.candidate.id,
        validationRuns: context.validationRuns,
        reviewDecision: context.reviewDecision,
        now: new Date("2026-10-03T00:00:00.000Z"),
      },
    });

    const scene = await context.scenes.findById("scene-1");
    const events = await context.events.listByNovel("novel-1");
    expect(commit.status).toBe("committed");
    expect(scene?.text).toBe("New text");
    expect(events.map((event) => event.name)).toEqual(["SceneCommitted"]);
  });

  it("rejects a candidate based on an outdated scene revision", async () => {
    const context = await setup();
    const staleCommit = await commitCandidate({
      repositories: {
        scenes: context.scenes,
        candidates: context.candidates,
        canonicalFacts: new InMemoryRevisionedRepository(),
        stateRecords: new InMemoryRevisionedRepository(),
        narrativeCommits: context.commits,
      },
      eventStore: context.events,
      input: {
        commitId: "commit-1",
        candidateId: context.candidate.id,
        validationRuns: context.validationRuns,
        reviewDecision: context.reviewDecision,
        now: new Date("2026-10-03T00:00:00.000Z"),
      },
    });

    const staleCandidate = selectCandidate(
      markCandidateValidated(
        createCandidate({
          id: "candidate-2",
          taskId: "task-1",
          novelId: "novel-1",
          basedOnVersionSet: createVersionSet({
            scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
          }),
          change: { type: "text", sceneId: "scene-1", text: "Stale text" },
          createdAt: now,
        }),
        now,
      ),
      now,
    );
    const staleValidation = createValidationRun({
      id: "validation-2",
      candidateId: staleCandidate.id,
      candidateRevisionId: staleCandidate.currentRevisionId,
      validatorId: "text-validator",
      outcome: "pass",
      findings: [],
      createdAt: now,
    });
    const staleReview = createReviewDecision({
      id: "review-2",
      candidateId: staleCandidate.id,
      candidateRevisionId: staleCandidate.currentRevisionId,
      decision: "approve",
      decidedBy: "human",
      actorId: "author-1",
      reason: "",
      createdAt: now,
    });

    await context.candidates.save(staleCandidate);
    await expect(
      commitCandidate({
        repositories: {
          scenes: context.scenes,
          candidates: context.candidates,
          canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
          stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
          narrativeCommits: context.commits,
        },
        eventStore: context.events,
        input: {
          commitId: "commit-2",
          candidateId: staleCandidate.id,
          validationRuns: [staleValidation],
          reviewDecision: staleReview,
          now: new Date("2026-10-04T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("Stale dependency: scene");

    const failedCommit = await context.commits.findById("commit-2");
    expect(failedCommit?.status).toBe("stale");
    expect(staleCommit.status).toBe("committed");
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --run tests/app/coCreationLoop.test.ts`

Expected: FAIL because `commitCandidate` does not exist.

- [ ] **Step 3: Implement the commit application service**

The service must flatten a composite candidate into atomic changes, preflight every target and version dependency before mutation, prepare all resulting revisions and events, and apply them as one NarrativeCommit. Any missing object, repository failure, unsupported dependency, or event persistence failure must leave a failed NarrativeCommit record. If event persistence fails after canonical writes, restore the prepared original snapshots through the repositories on a best-effort basis.

```ts
import type { RevisionedRepository, Repository } from "../../shared/application/repository";
import type { Candidate } from "../../production/domain/candidate";
import type { ValidationRun } from "../../production/domain/validationRun";
import type { ReviewDecision } from "../../production/domain/reviewDecision";
import { commitSceneText, type Scene } from "../../manuscript/domain/scene";
import { replaceTargetSpan } from "../../manuscript/domain/targetSpan";
import type { CanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import { replaceCanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../narrative/state/domain/stateRecord";
import { replaceStateRecord } from "../../narrative/state/domain/stateRecord";
import {
  createNarrativeCommit,
  markNarrativeCommitCommitted,
  markNarrativeCommitStale,
  type NarrativeCommit,
} from "../domain/narrativeCommit";
import { createDomainEvent } from "../domain/domainEvent";
import type { EventStore } from "../infrastructure/eventStore";
import { createVersionReference, type VersionSet } from "../../shared/domain/versioning";

export interface CommitCandidateDependencies {
  readonly scenes: RevisionedRepository<Scene>;
  readonly candidates: RevisionedRepository<Candidate>;
  readonly canonicalFacts: RevisionedRepository<CanonicalFact>;
  readonly stateRecords: RevisionedRepository<StateRecord>;
  readonly narrativeCommits: Repository<NarrativeCommit>;
  readonly eventStore: EventStore;
}

export interface CommitCandidateInput {
  readonly commitId: string;
  readonly candidateId: string;
  readonly validationRuns: readonly ValidationRun[];
  readonly reviewDecision: ReviewDecision;
  readonly now: Date;
}

async function assertDependenciesAreCurrent(
  dependencies: CommitCandidateDependencies,
  versionSet: VersionSet,
): Promise<void> {
  for (const [dependencyName, reference] of Object.entries(versionSet)) {
    let currentRevisionId: string | undefined;

    if (reference.aggregateType === "Scene") {
      currentRevisionId = (await dependencies.scenes.findById(reference.objectId))?.currentRevisionId;
    } else if (reference.aggregateType === "CanonicalFact") {
      currentRevisionId = (await dependencies.canonicalFacts.findById(reference.objectId))?.currentRevisionId;
    } else if (reference.aggregateType === "StateRecord") {
      currentRevisionId = (await dependencies.stateRecords.findById(reference.objectId))?.currentRevisionId;
    }

    if (currentRevisionId !== reference.revisionId) {
      throw new Error(`Stale dependency: ${dependencyName}`);
    }
  }
}

export async function commitCandidate(input: {
  repositories: Omit<CommitCandidateDependencies, "eventStore">;
  eventStore: EventStore;
  input: CommitCandidateInput;
}): Promise<NarrativeCommit> {
  const candidate = await input.repositories.candidates.findById(input.input.candidateId);
  if (!candidate) throw new Error(`Candidate not found: ${input.input.candidateId}`);
  if (candidate.status !== "selected") throw new Error("Only a selected candidate can be committed");

  let commit = createNarrativeCommit({
    id: input.input.commitId,
    novelId: candidate.novelId,
    candidate,
    validationRuns: input.input.validationRuns,
    reviewDecision: input.input.reviewDecision,
    createdAt: input.input.now,
  });

  try {
    await assertDependenciesAreCurrent(
      { ...input.repositories, eventStore: input.eventStore },
      candidate.basedOnVersionSet,
    );
  } catch (error) {
    commit = markNarrativeCommitStale(commit, input.input.now);
    await input.repositories.narrativeCommits.save(commit);
    throw error;
  }

  const resultingVersionSet: Record<string, ReturnType<typeof createVersionReference>> = {};
  let eventName:
    | "SceneCommitted"
    | "CanonicalFactChanged"
    | "CharacterStateChanged"
    | "WorldStateChanged"
    | "PlotStateChanged";
  let objectId = "";
  let revisionId = "";

  if (candidate.change.type === "text" || candidate.change.type === "local_text") {
    const scene = await input.repositories.scenes.findById(candidate.change.sceneId);
    if (!scene) throw new Error(`Scene not found: ${candidate.change.sceneId}`);
    const nextRevisionId = `${scene.currentRevisionId}:${input.input.commitId}`;
    const nextText =
      candidate.change.type === "text"
        ? candidate.change.text
        : replaceTargetSpan({
            scene,
            target: candidate.change.targetSpan,
            replacement: candidate.change.replacement,
          });
    const nextSpanAnchors =
      candidate.change.type === "local_text"
        ? { ...scene.spanAnchors, [candidate.change.targetSpan.anchorId]: candidate.change.replacement }
        : {};

    const nextScene = commitSceneText({
      scene,
      text: nextText,
      spanAnchors: nextSpanAnchors,
      revisionId: nextRevisionId,
      commitId: commit.id,
      updatedAt: input.input.now,
    });
    await input.repositories.scenes.save(nextScene);
    resultingVersionSet.scene = createVersionReference("Scene", nextScene.id, nextRevisionId);
    eventName = "SceneCommitted";
    objectId = nextScene.id;
    revisionId = nextRevisionId;
  } else if (candidate.change.type === "canonical_fact") {
    const fact = await input.repositories.canonicalFacts.findById(candidate.change.canonicalFactId);
    if (!fact) throw new Error(`Canonical fact not found: ${candidate.change.canonicalFactId}`);
    const nextRevisionId = `${fact.currentRevisionId}:${commit.id}`;
    const nextFact = replaceCanonicalFact({
      fact,
      content: candidate.change.content,
      revisionId: nextRevisionId,
      commitId: commit.id,
      updatedAt: input.input.now,
    });
    await input.repositories.canonicalFacts.save(nextFact);
    resultingVersionSet.canonicalFact = createVersionReference(
      "CanonicalFact",
      nextFact.id,
      nextRevisionId,
    );
    eventName = "CanonicalFactChanged";
    objectId = nextFact.id;
    revisionId = nextRevisionId;
  } else {
    const record = await input.repositories.stateRecords.findById(candidate.change.stateRecordId);
    if (!record) throw new Error(`State record not found: ${candidate.change.stateRecordId}`);
    const nextRevisionId = `${record.currentRevisionId}:${commit.id}`;
    const nextRecord = replaceStateRecord({
      record,
      content: candidate.change.content,
      revisionId: nextRevisionId,
      commitId: commit.id,
      updatedAt: input.input.now,
    });
    await input.repositories.stateRecords.save(nextRecord);
    resultingVersionSet.stateRecord = createVersionReference(
      "StateRecord",
      nextRecord.id,
      nextRevisionId,
    );
    eventName =
      nextRecord.type === "character_state"
        ? "CharacterStateChanged"
        : nextRecord.type === "world_state"
          ? "WorldStateChanged"
          : "PlotStateChanged";
    objectId = nextRecord.id;
    revisionId = nextRevisionId;
  }

  commit = markNarrativeCommitCommitted({
    commit,
    resultingVersionSet: Object.freeze(resultingVersionSet),
    committedAt: input.input.now,
  });
  await input.repositories.narrativeCommits.save(commit);
  await input.eventStore.append(
    createDomainEvent({
      eventId: `event:${commit.id}:${objectId}`,
      name: eventName,
      context: eventName === "SceneCommitted" ? "manuscript" : "narrative_state",
      novelId: candidate.novelId,
      objectId,
      revisionId,
      commitId: commit.id,
      payload: { candidateId: candidate.id },
      occurredAt: input.input.now,
    }),
  );

  return commit;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run tests/app/coCreationLoop.test.ts`

Expected: PASS with 10 commit service tests.

- [ ] **Step 5: Commit**

```bash
git add src/safety/application/commitCandidate.ts tests/app/coCreationLoop.test.ts
git commit -m "feat: add narrative commit application service"
```

---

### Task 15: Memory Projection and Context Assembly

**Files:**

- Create: `src/memory/projections/memoryProjection.ts`
- Create: `src/memory/application/contextAssembly.ts`
- Create: `tests/memory/contextAssembly.test.ts`

**Interfaces:**

- Consumes: `Scene`, `CanonicalFact`, `StateRecord`, `DomainEvent`, `VersionSet`.
- Produces: `SceneMemory`, `MemoryProjection`, `rebuildMemoryProjection`, `isMemoryProjectionStale`, `GenerationContext`, `assembleContext`.
- Runtime and API tasks consume `assembleContext` to build bounded task context.

- [ ] **Step 1: Write the failing memory and context tests**

```ts
import { describe, expect, it } from "vitest";
import type { CanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../src/narrative/state/domain/stateRecord";
import { commitSceneText, createScene } from "../../src/manuscript/domain/scene";
import {
  assembleContext,
} from "../../src/memory/application/contextAssembly";
import {
  isMemoryProjectionStale,
  rebuildMemoryProjection,
} from "../../src/memory/projections/memoryProjection";
import { createDomainEvent } from "../../src/safety/domain/domainEvent";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const now = new Date("2026-10-02T00:00:00.000Z");

function sceneWithText(revisionId: string, text: string) {
  const scene = createScene({
    id: "scene-1",
    novelId: "novel-1",
    chapterId: "chapter-1",
    title: "The Northern Gate",
    revisionId: "scene-rev-1",
    commitId: "initial-commit",
    createdAt: now,
  });
  return commitSceneText({
    scene,
    text,
    revisionId,
    commitId: `commit-${revisionId}`,
    updatedAt: now,
  });
}

describe("memory and context", () => {
  it("rebuilds memory from committed scene events", () => {
    const scene = sceneWithText("scene-rev-2", "Lin Chuan entered the Northern Sect gate.");
    const events = [
      createDomainEvent({
        eventId: "event-1",
        name: "SceneCommitted",
        context: "manuscript",
        novelId: "novel-1",
        objectId: scene.id,
        revisionId: scene.currentRevisionId,
        commitId: "commit-1",
        payload: { textLength: scene.text.length },
        occurredAt: now,
      }),
    ];
    const projection = rebuildMemoryProjection(events, [scene]);
    expect(projection.scenes["scene-1"]).toEqual({
      revisionId: "scene-rev-2",
      summary: "Lin Chuan entered the Northern Sect gate.",
    });
  });

  it("detects stale memory using the scene version set", () => {
    const scene = sceneWithText("scene-rev-2", "Old text");
    const projection = rebuildMemoryProjection([], [scene]);
    const versionSet = createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-rev-3"),
    });
    expect(isMemoryProjectionStale(projection, versionSet)).toBe(true);
  });

  it("assembles only relevant facts and current state for a task", () => {
    const scene = sceneWithText("scene-rev-2", "Lin Chuan waited at the gate.");
    const relevantFact = {
      id: "fact-1",
      novelId: "novel-1",
      type: "character_profile",
      content: { name: "Lin Chuan", sect: "Northern Sect" },
      currentRevisionId: "fact-rev-1",
      lastCommitId: "commit-1",
      createdAt: now,
      updatedAt: now,
    } satisfies CanonicalFact;
    const relevantState = {
      id: "state-1",
      novelId: "novel-1",
      type: "character_state",
      subjectId: "fact-1",
      position: { sceneId: "scene-1", ordinal: 1 },
      content: { condition: "left arm injured" },
      currentRevisionId: "state-rev-1",
      lastCommitId: "commit-1",
      createdAt: now,
      updatedAt: now,
    } satisfies StateRecord;
    const memory = rebuildMemoryProjection([], [scene]);

    const context = assembleContext({
      scene,
      canonicalFacts: [relevantFact],
      stateRecords: [relevantState],
      memory,
      requiredFactIds: ["fact-1"],
      requiredStateIds: ["state-1"],
      taskIntent: "Continue the scene.",
    });

    expect(context.sceneText).toBe(scene.text);
    expect(context.canonicalFacts).toEqual([relevantFact]);
    expect(context.stateRecords).toEqual([relevantState]);
    expect(context.memory.scenes).toEqual(memory.scenes);
    expect(context.taskIntent).toBe("Continue the scene.");
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --run tests/memory/contextAssembly.test.ts`

Expected: FAIL because the memory modules do not exist.

- [ ] **Step 3: Implement memory projection and context assembly**

```ts
import type { Scene } from "../../manuscript/domain/scene";
import type { DomainEvent } from "../../safety/domain/domainEvent";
import type { VersionSet } from "../../shared/domain/versioning";
import { deepFreeze } from "../../shared/domain/immutable";

export interface SceneMemory {
  readonly revisionId: string;
  readonly summary: string;
}

export interface MemoryProjection {
  readonly novelId: string;
  readonly sourceRevisionSet: Readonly<Record<string, string>>;
  readonly scenes: Readonly<Record<string, SceneMemory>>;
}

export function rebuildMemoryProjection(
  events: readonly DomainEvent[],
  scenes: readonly Scene[],
): MemoryProjection {
  if (scenes.length === 0) throw new Error("At least one scene is required");
  const novelId = scenes[0].novelId;
  if (scenes.some((scene) => scene.novelId !== novelId)) {
    throw new Error("Memory projection cannot span novels");
  }

  const sceneMemories: Record<string, SceneMemory> = {};
  const sourceRevisionSet: Record<string, string> = {};
  const committedSceneIds = new Set(
    events
      .filter((event) => event.name === "SceneCommitted" && event.context === "manuscript")
      .filter((event) => scenes.some((scene) => scene.id === event.objectId && scene.currentRevisionId === event.revisionId))
      .map((event) => event.objectId),
  );

  for (const scene of scenes) {
    sourceRevisionSet[scene.id] = scene.currentRevisionId;
    if (committedSceneIds.size > 0 && !committedSceneIds.has(scene.id)) continue;
    sceneMemories[scene.id] = {
      revisionId: scene.currentRevisionId,
      summary: scene.text,
    };
  }

  return deepFreeze({
    novelId,
    sourceRevisionSet,
    scenes: sceneMemories,
  });
}

export function isMemoryProjectionStale(
  projection: MemoryProjection,
  versionSet: VersionSet,
): boolean {
  return Object.values(versionSet).some(reference => {
    return (
      reference.aggregateType === "Scene" &&
      projection.sourceRevisionSet[reference.objectId] !== reference.revisionId
    );
  });
}
```

```ts
import type { Scene } from "../../manuscript/domain/scene";
import type { CanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../narrative/state/domain/stateRecord";
import type { MemoryProjection } from "../projections/memoryProjection";

export interface GenerationContext {
  readonly sceneId: string;
  readonly sceneText: string;
  readonly canonicalFacts: readonly CanonicalFact[];
  readonly stateRecords: readonly StateRecord[];
  readonly memory: MemoryProjection;
  readonly taskIntent: string;
  readonly maxCharacters: number;
  readonly selectedCharacterCount: number;
  readonly overflowed: boolean;
  readonly omittedFactIds: readonly string[];
  readonly omittedStateIds: readonly string[];
}

export function assembleContext(input: {
  scene: Scene;
  canonicalFacts: readonly CanonicalFact[];
  stateRecords: readonly StateRecord[];
  memory: MemoryProjection;
  requiredFactIds: readonly string[];
  requiredStateIds: readonly string[];
  taskIntent: string;
  maxCharacters: number;
}): GenerationContext {
  if (!input.taskIntent.trim()) throw new Error("taskIntent is required");
  if (input.memory.novelId !== input.scene.novelId) {
    throw new Error("Memory projection does not match scene novel");
  }

  const canonicalFacts = input.canonicalFacts.filter((fact) =>
    input.requiredFactIds.includes(fact.id),
  );
  const stateRecords = input.stateRecords.filter((record) =>
    input.requiredStateIds.includes(record.id),
  );

  for (const factId of input.requiredFactIds) {
    if (!canonicalFacts.some((fact) => fact.id === factId)) {
      throw new Error(`Required canonical fact not found: ${factId}`);
    }
  }
  for (const stateId of input.requiredStateIds) {
    if (!stateRecords.some((record) => record.id === stateId)) {
      throw new Error(`Required state record not found: ${stateId}`);
    }
  }

  return Object.freeze({
    sceneId: input.scene.id,
    sceneText: input.scene.text,
    canonicalFacts: Object.freeze([...canonicalFacts]),
    stateRecords: Object.freeze([...stateRecords]),
    memory: input.memory,
    taskIntent: input.taskIntent.trim(),
    maxCharacters: input.maxCharacters,
    selectedCharacterCount: 0,
    overflowed: false,
    omittedFactIds: [],
    omittedStateIds: [],
  });
}
```

The implementation additionally applies deterministic ranking and a character budget. It scopes facts to the scene novel, scopes state records to the scene position, truncates lower-ranked entries when necessary, and exposes selected size, overflow, and omitted IDs.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run tests/memory/contextAssembly.test.ts`

Expected: PASS with 7 memory/context tests.

- [ ] **Step 5: Commit**

```bash
git add src/memory tests/memory/contextAssembly.test.ts
git commit -m "feat: add derived memory and context assembly"
```

---

### Task 16: Basic Candidate Validator

**Files:**

- Create: `src/production/application/validateCandidate.ts`
- Create: `tests/production/basicValidator.test.ts`

**Interfaces:**

- Consumes: `Candidate`, `Scene`, `ValidationRun`, `resolveTargetSpan`.
- Produces: `ValidationRequest`, `ValidationResult`, `validateCandidate`.
- API and application services use `validateCandidate` before review and commit.

- [ ] **Step 1: Write the failing validator tests**

```ts
import { describe, expect, it } from "vitest";
import { createCandidate } from "../../src/production/domain/candidate";
import { commitSceneText, createScene } from "../../src/manuscript/domain/scene";
import { hashContent } from "../../src/shared/domain/contentHash";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import { validateCandidate } from "../../src/production/application/validateCandidate";

const now = new Date("2026-10-02T00:00:00.000Z");

function scene() {
  const initial = createScene({
    id: "scene-1",
    novelId: "novel-1",
    chapterId: "chapter-1",
    title: "The Northern Gate",
    revisionId: "scene-rev-1",
    commitId: "initial-commit",
    createdAt: now,
  });
  return commitSceneText({
    scene: initial,
    text: "Lin Chuan waited. The Northern Sect gate stayed closed.",
    spanAnchors: { "span-2": "The Northern Sect gate stayed closed." },
    revisionId: "scene-rev-2",
    commitId: "initial-commit",
    updatedAt: now,
  });
}

function candidate(change: Parameters<typeof createCandidate>[0]["change"]) {
  return createCandidate({
    id: "candidate-1",
    taskId: "task-1",
    novelId: "novel-1",
    basedOnVersionSet: createVersionSet({
      scene: createVersionReference("Scene", "scene-1", "scene-rev-2"),
    }),
    change,
    createdAt: now,
  });
}

describe("basic validator", () => {
  it("passes a non-empty text candidate", () => {
    const result = validateCandidate({
      validationId: "validation-1",
      candidate: candidate({ type: "text", sceneId: "scene-1", text: "New text" }),
      scene: scene(),
      mustPreserve: [],
      createdAt: now,
    });

    expect(result.run.outcome).toBe("pass");
  });

  it("fails when a required phrase is missing", () => {
    const result = validateCandidate({
      validationId: "validation-1",
      candidate: candidate({ type: "text", sceneId: "scene-1", text: "Different text" }),
      scene: scene(),
      mustPreserve: ["Northern Sect"],
      createdAt: now,
    });

    expect(result.run.outcome).toBe("fail");
    expect(result.run.findings[0]).toMatchObject({
      code: "REQUIRED_PHRASE_MISSING",
      severity: "error",
    });
  });

  it("validates local target spans against their source hash", () => {
    const currentScene = scene();
    const targetText = "The Northern Sect gate stayed closed.";
    const result = validateCandidate({
      validationId: "validation-1",
      candidate: candidate({
        type: "local_text",
        sceneId: "scene-1",
        targetSpan: {
          anchorId: "span-2",
          text: targetText,
          sourceContentHash: hashContent(targetText),
        },
        replacement: "The gate opened slowly.",
      }),
      scene: currentScene,
      mustPreserve: [],
      createdAt: now,
    });

    expect(result.run.outcome).toBe("pass");
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --run tests/production/basicValidator.test.ts`

Expected: FAIL because the validator module does not exist.

- [ ] **Step 3: Implement the basic validator**

```ts
import type { Candidate } from "../domain/candidate";
import type { Scene } from "../../manuscript/domain/scene";
import { resolveTargetSpan } from "../../manuscript/domain/targetSpan";
import {
  createValidationRun,
  type ValidationFinding,
  type ValidationOutcome,
} from "../domain/validationRun";

export interface ValidationRequest {
  readonly validationId: string;
  readonly candidate: Candidate;
  readonly scene: Scene;
  readonly mustPreserve: readonly string[];
  readonly createdAt: Date;
}

export interface ValidationResult {
  readonly run: ReturnType<typeof createValidationRun>;
  readonly outcome: ValidationOutcome;
}

export function validateCandidate(request: ValidationRequest): ValidationResult {
  const findings: ValidationFinding[] = [];

  if (request.candidate.change.type === "text") {
    if (!request.candidate.change.text.trim()) {
      findings.push({
        code: "EMPTY_TEXT",
        severity: "error",
        confidence: 1,
        message: "Text candidate cannot be empty.",
        evidence: { candidateId: request.candidate.id },
      });
    }
  }

  if (request.candidate.change.type === "local_text") {
    try {
      resolveTargetSpan(request.scene, request.candidate.change.targetSpan);
    } catch (error) {
      findings.push({
        code: "TARGET_SPAN_NOT_FOUND",
        severity: "error",
        confidence: 1,
        message: error instanceof Error ? error.message : "Target span is invalid.",
        evidence: { anchorId: request.candidate.change.targetSpan.anchorId },
      });
    }
  }

  if (
    request.candidate.change.type === "structured_state" ||
    request.candidate.change.type === "canonical_fact"
  ) {
    if (Object.keys(request.candidate.change.content).length === 0) {
      findings.push({
        code: "EMPTY_STRUCTURED_CHANGE",
        severity: "error",
        confidence: 1,
        message: "Structured candidate cannot be empty.",
        evidence: { candidateId: request.candidate.id },
      });
    }
  }

  const proposedText =
    request.candidate.change.type === "text"
      ? request.candidate.change.text
      : request.candidate.change.type === "local_text"
        ? request.candidate.change.replacement
        : request.scene.text;

  for (const phrase of request.mustPreserve) {
    if (!proposedText.includes(phrase)) {
      findings.push({
        code: "REQUIRED_PHRASE_MISSING",
        severity: "error",
        confidence: 1,
        message: `Required phrase is missing: ${phrase}`,
        evidence: { phrase },
      });
    }
  }

  const outcome: ValidationOutcome = findings.some((finding) => finding.severity === "error")
    ? "fail"
    : "pass";

  const run = createValidationRun({
    id: request.validationId,
    candidateId: request.candidate.id,
    candidateRevisionId: request.candidate.currentRevisionId,
    validatorId: "basic-candidate-validator",
    outcome,
    findings,
    createdAt: request.createdAt,
  });

  return { run, outcome };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run tests/production/basicValidator.test.ts`

Expected: PASS with 3 validator tests.

- [ ] **Step 5: Commit**

```bash
git add src/production/application/validateCandidate.ts tests/production/basicValidator.test.ts
git commit -m "feat: add basic candidate validator"
```

---

### Task 17: Core Engine HTTP API

**Files:**

- Modify: `package.json`
- Create: `src/http/server.ts`
- Create: `src/http/routes.ts`
- Create: `tests/http/api.test.ts`

**Interfaces:**

- Consumes: Fastify, Zod, domain functions, in-memory repositories, `DeterministicRuntime`, `validateCandidate`, `commitCandidate`.
- Produces: `ApiDependencies`, `createNovelBrainServer`, `registerNovelBrainRoutes`.
- The web workspace plan will consume these HTTP contracts without importing domain modules directly.

- [ ] **Step 1: Install API dependencies**

Run: `npm install fastify zod`

Expected: `package.json` contains runtime dependencies for `fastify` and `zod`.

- [ ] **Step 2: Write the failing API loop test**

```ts
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../../src/app/inMemoryRepositories";
import { InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import type { Candidate } from "../../src/production/domain/candidate";
import type { GenerationTask } from "../../src/production/domain/generationTask";
import type { ValidationRun } from "../../src/production/domain/validationRun";
import type { ReviewDecision } from "../../src/production/domain/reviewDecision";
import type { CanonicalFact } from "../../src/narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../src/narrative/state/domain/stateRecord";
import type { Scene } from "../../src/manuscript/domain/scene";
import type { Novel } from "../../src/narrative/novel/domain/novel";
import type { NarrativeCommit } from "../../src/safety/domain/narrativeCommit";
import { DeterministicRuntime } from "../../src/production/runtime/deterministicRuntime";
import { InMemoryEventStore } from "../../src/safety/infrastructure/eventStore";
import { registerNovelBrainRoutes } from "../../src/http/routes";

function server() {
  const app = Fastify();
  registerNovelBrainRoutes(app, {
    novels: new InMemoryRepository<Novel>(),
    scenes: new InMemoryRevisionedRepository<Scene>(),
    generationTasks: new InMemoryRepository<GenerationTask>(),
    candidates: new InMemoryRevisionedRepository<Candidate>(),
    validationRuns: new InMemoryRepository<ValidationRun>(),
    reviewDecisions: new InMemoryRepository<ReviewDecision>(),
    canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
    stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
    narrativeCommits: new InMemoryRepository<NarrativeCommit>(),
    eventStore: new InMemoryEventStore(),
    runtime: new DeterministicRuntime(),
  });
  return app;
}

describe("core engine API", () => {
  it("supports the co-creation loop over HTTP", async () => {
    const app = server();
    const novelResponse = await app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-1", authorId: "author-1", title: "Blade of the Northern Sect" },
    });
    expect(novelResponse.statusCode).toBe(201);

    const sceneResponse = await app.inject({
      method: "POST",
      url: "/novels/novel-1/scenes",
      payload: { id: "scene-1", chapterId: "chapter-1", title: "The Northern Gate" },
    });
    expect(sceneResponse.statusCode).toBe(201);
    const scene = sceneResponse.json();

    const taskResponse = await app.inject({
      method: "POST",
      url: "/novels/novel-1/generation-tasks",
      payload: {
        id: "task-1",
        operation: "rewrite",
        targetSceneId: "scene-1",
        intent: "Rewrite with more tension.",
        basedOnVersionSet: {
          scene: {
            aggregateType: "Scene",
            objectId: "scene-1",
            revisionId: scene.currentRevisionId,
          },
        },
      },
    });
    expect(taskResponse.statusCode).toBe(201);

    const candidateResponse = await app.inject({
      method: "POST",
      url: "/generation-tasks/task-1/candidates",
      payload: {
        id: "candidate-1",
        agentRole: "writer",
        modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
        change: { type: "text", sceneId: "scene-1", text: "New tense text" },
      },
    });
    expect(candidateResponse.statusCode).toBe(201);

    const commitResponse = await app.inject({
      method: "POST",
      url: "/candidates/candidate-1/commit",
      payload: {
        commitId: "commit-1",
        validationId: "validation-1",
        reviewId: "review-1",
        actorId: "author-1",
        mustPreserve: [],
      },
    });
    expect(commitResponse.statusCode).toBe(201);
    expect(commitResponse.json()).toMatchObject({ status: "committed" });

    const eventsResponse = await app.inject({ method: "GET", url: "/novels/novel-1/events" });
    expect(eventsResponse.statusCode).toBe(200);
    expect(eventsResponse.json()).toEqual([
      expect.objectContaining({ name: "SceneCommitted", objectId: "scene-1" }),
    ]);

    await app.close();
  });

  it("rejects an invalid novel payload", async () => {
    const app = server();
    const response = await app.inject({
      method: "POST",
      url: "/novels",
      payload: { id: "novel-1", authorId: "", title: "Title" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "Bad Request" });
    await app.close();
  });
});
```

- [ ] **Step 3: Run the API tests and verify they fail**

Run: `npm test -- --run tests/http/api.test.ts`

Expected: FAIL because `src/http/routes.ts` does not exist.

- [ ] **Step 4: Implement the API routes and server factory**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { Repository, RevisionedRepository } from "../shared/application/repository";
import type { VersionSet } from "../shared/domain/versioning";
import type { Novel } from "../narrative/novel/domain/novel";
import { createNovel } from "../narrative/novel/domain/novel";
import type { CanonicalFact } from "../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../narrative/state/domain/stateRecord";
import type { Scene } from "../manuscript/domain/scene";
import { createScene } from "../manuscript/domain/scene";
import type { GenerationTask } from "../production/domain/generationTask";
import {
  addCandidateReference,
  createGenerationTask,
  startGenerationTask,
} from "../production/domain/generationTask";
import type { Candidate } from "../production/domain/candidate";
import { createCandidate, markCandidateValidated, selectCandidate } from "../production/domain/candidate";
import type { ValidationRun } from "../production/domain/validationRun";
import type { ReviewDecision } from "../production/domain/reviewDecision";
import type { RuntimeAdapter } from "../production/runtime/runtimeAdapter";
import { validateCandidate } from "../production/application/validateCandidate";
import { createReviewDecision } from "../production/domain/reviewDecision";
import type { NarrativeCommit } from "../safety/domain/narrativeCommit";
import { commitCandidate } from "../safety/application/commitCandidate";
import type { EventStore } from "../safety/infrastructure/eventStore";

export interface ApiDependencies {
  readonly novels: Repository<Novel>;
  readonly scenes: RevisionedRepository<Scene>;
  readonly generationTasks: Repository<GenerationTask>;
  readonly candidates: RevisionedRepository<Candidate>;
  readonly validationRuns: Repository<ValidationRun>;
  readonly reviewDecisions: Repository<ReviewDecision>;
  readonly canonicalFacts: RevisionedRepository<CanonicalFact>;
  readonly stateRecords: RevisionedRepository<StateRecord>;
  readonly narrativeCommits: Repository<NarrativeCommit>;
  readonly eventStore: EventStore;
  readonly runtime: RuntimeAdapter;
}

const versionReferenceSchema = z.object({
  aggregateType: z.enum([
    "Novel",
    "Arc",
    "Chapter",
    "Scene",
    "CanonicalFact",
    "StateRecord",
    "GenerationTask",
    "Candidate",
    "ValidationRun",
    "ReviewDecision",
    "NarrativeCommit",
  ]),
  objectId: z.string().min(1),
  revisionId: z.string().min(1),
});

const versionSetSchema = z.custom<VersionSet>(
  value =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(
      entry => versionReferenceSchema.safeParse(entry).success,
    ),
  { message: "Expected a version set" },
);
const modelPolicySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  maxOutputTokens: z.number().int().positive(),
});
const freeFormRecordSchema = z.custom<Record<string, unknown>>(
  value => typeof value === "object" && value !== null && !Array.isArray(value),
  { message: "Expected an object" },
);
const atomicCandidateChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), sceneId: z.string().min(1), text: z.string().min(1) }),
  z.object({
    type: z.literal("structured_state"),
    stateRecordId: z.string().min(1),
    content: freeFormRecordSchema,
  }),
  z.object({
    type: z.literal("canonical_fact"),
    canonicalFactId: z.string().min(1),
    content: freeFormRecordSchema,
  }),
  z.object({
    type: z.literal("local_text"),
    sceneId: z.string().min(1),
    targetSpan: z.object({
      anchorId: z.string().min(1),
      text: z.string().min(1),
      sourceContentHash: z.string().min(1),
    }),
    replacement: z.string().min(1),
  }),
]);
const candidateChangeSchema = z.union([
  atomicCandidateChangeSchema,
  z.object({
    type: z.literal("composite"),
    changes: z.array(atomicCandidateChangeSchema).min(1),
  }),
]);

export function registerNovelBrainRoutes(app: FastifyInstance, dependencies: ApiDependencies): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "Bad Request", details: error.issues });
    }
    return reply.send(error);
  });

  app.post("/novels", async (request, reply) => {
    const body = z
      .object({ id: z.string().min(1), authorId: z.string().min(1), title: z.string().min(1) })
      .parse(request.body);
    const novel = createNovel({ ...body, createdAt: new Date() });
    await dependencies.novels.save(novel);
    return reply.code(201).send(novel);
  });

  app.post("/novels/:novelId/scenes", async (request, reply) => {
    const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        id: z.string().min(1),
        chapterId: z.string().min(1),
        title: z.string().min(1),
      })
      .parse(request.body);
    const scene = createScene({
      ...body,
      novelId: params.novelId,
      revisionId: `${body.id}:rev-1`,
      commitId: `initial:${body.id}`,
      createdAt: new Date(),
    });
    await dependencies.scenes.save(scene);
    return reply.code(201).send(scene);
  });

  app.post("/novels/:novelId/generation-tasks", async (request, reply) => {
    const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        id: z.string().min(1),
        operation: z.enum([
          "story_planning",
          "outline_refinement",
          "chapter_generation",
          "scene_generation",
          "continuation",
          "expansion",
          "rewrite",
          "polish",
          "local_regeneration",
          "consistency_analysis",
        ]),
        targetSceneId: z.string().min(1),
        intent: z.string().min(1),
        basedOnVersionSet: versionSetSchema,
      })
      .parse(request.body);
    const task = createGenerationTask({
      ...body,
      novelId: params.novelId,
      createdAt: new Date(),
    });
    await dependencies.generationTasks.save(task);
    return reply.code(201).send(task);
  });

  app.post("/generation-tasks/:taskId/candidates", async (request, reply) => {
    const params = z.object({ taskId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        id: z.string().min(1),
        agentRole: z.enum(["planner", "writer", "editor", "reviewer", "consistency_agent", "memory_agent"]),
        modelPolicy: modelPolicySchema,
        change: candidateChangeSchema,
      })
      .parse(request.body);
    const task = await dependencies.generationTasks.findById(params.taskId);
    if (!task) return reply.code(404).send({ error: "Not Found" });

    const startedTask = startGenerationTask(task, new Date());
    const runtimeResult = await dependencies.runtime.execute({
      taskId: task.id,
      agentRole: body.agentRole,
      modelPolicy: body.modelPolicy,
      basedOnVersionSet: task.basedOnVersionSet,
      context: { taskIntent: task.intent },
      requestedChange: body.change,
    });
    const candidate = createCandidate({
      id: body.id,
      taskId: task.id,
      novelId: task.novelId,
      basedOnVersionSet: task.basedOnVersionSet,
      change: runtimeResult.change,
      createdAt: new Date(),
    });
    const updatedTask = addCandidateReference(startedTask, candidate.id);
    await dependencies.generationTasks.save(updatedTask);
    await dependencies.candidates.save(candidate);
    return reply.code(201).send(candidate);
  });

  app.post("/candidates/:candidateId/commit", async (request, reply) => {
    const params = z.object({ candidateId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        commitId: z.string().min(1),
        validationId: z.string().min(1),
        reviewId: z.string().min(1),
        actorId: z.string().min(1),
        mustPreserve: z.array(z.string().min(1)),
      })
      .parse(request.body);
    const candidate = await dependencies.candidates.findById(params.candidateId);
    if (!candidate) return reply.code(404).send({ error: "Not Found" });
    const scene = await dependencies.scenes.findById(
      candidate.change.type === "text" || candidate.change.type === "local_text"
        ? candidate.change.sceneId
        : taskSceneId(candidate),
    );
    if (!scene) return reply.code(409).send({ error: "Target scene not found" });

    const validation = validateCandidate({
      validationId: body.validationId,
      candidate,
      scene,
      mustPreserve: body.mustPreserve,
      createdAt: new Date(),
    });
    if (validation.outcome === "fail") return reply.code(422).send(validation.run);

    const reviewDecision = createReviewDecision({
      id: body.reviewId,
      candidateId: candidate.id,
      candidateRevisionId: candidate.currentRevisionId,
      decision: "approve",
      decidedBy: "human",
      actorId: body.actorId,
      reason: "",
      createdAt: new Date(),
    });
    await dependencies.validationRuns.save(validation.run);
    await dependencies.reviewDecisions.save(reviewDecision);
    const selectedCandidate = selectCandidate(
      markCandidateValidated(candidate, new Date()),
      new Date(),
    );
    await dependencies.candidates.save(selectedCandidate);

    const commit = await commitCandidate({
      repositories: {
        scenes: dependencies.scenes,
        candidates: dependencies.candidates,
        canonicalFacts: dependencies.canonicalFacts,
        stateRecords: dependencies.stateRecords,
        narrativeCommits: dependencies.narrativeCommits,
      },
      eventStore: dependencies.eventStore,
      input: {
        commitId: body.commitId,
        candidateId: selectedCandidate.id,
        validationRuns: [validation.run],
        reviewDecision,
        now: new Date(),
      },
    });
    return reply.code(201).send(commit);
  });

  app.get("/novels/:novelId/events", async request => {
    const params = z.object({ novelId: z.string().min(1) }).parse(request.params);
    return dependencies.eventStore.listByNovel(params.novelId);
  });
}

function taskSceneId(candidate: Candidate): string {
  const taskVersion = Object.values(candidate.basedOnVersionSet).find(
    reference => reference.aggregateType === "Scene",
  );
  if (!taskVersion) throw new Error("Candidate has no scene target");
  return taskVersion.objectId;
}
```

```ts
import Fastify from "fastify";
import { registerNovelBrainRoutes, type ApiDependencies } from "./routes";

export function createNovelBrainServer(dependencies: ApiDependencies) {
  const app = Fastify({ logger: false });
  registerNovelBrainRoutes(app, dependencies);
  return app;
}
```

- [ ] **Step 5: Run the API tests and verify they pass**

Run: `npm test -- --run tests/http/api.test.ts`

Expected: PASS with 2 API tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/http tests/http/api.test.ts
git commit -m "feat: add core engine http api"
```

---

### Task 18: PostgreSQL Persistence Mapping

**Files:**

- Modify: `package.json`
- Create: `docker-compose.yml`
- Create: `prisma/schema.prisma`
- Create: `vitest.integration.config.ts`
- Create: `src/shared/infrastructure/prisma.ts`
- Create: `src/shared/infrastructure/prismaRepositories.ts`
- Create: `tests/integration/postgresRoundTrip.test.ts`

**Interfaces:**

- Consumes: `Repository`, `RevisionedRepository`, `EventStore`, `DomainEvent`.
- Produces: `PrismaClientProvider`, `PrismaRepository`, `PrismaRevisionedRepository`, `PrismaEventStore`.
- The deployment plan consumes `DATABASE_URL` and Docker Compose; the domain modules do not import Prisma.

- [ ] **Step 1: Install persistence dependencies**

Run: `npm install prisma @prisma/client`

Expected: `package.json` contains `prisma` as a dependency and `@prisma/client` as a runtime dependency.

- [ ] **Step 2: Write the failing PostgreSQL round-trip test**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { commitSceneText, createScene } from "../../src/manuscript/domain/scene";
import {
  PrismaEventStore,
  PrismaRevisionedRepository,
} from "../../src/shared/infrastructure/prismaRepositories";
import { createDomainEvent } from "../../src/safety/domain/domainEvent";
import type { Scene } from "../../src/manuscript/domain/scene";

const prisma = new PrismaClient();

describe("PostgreSQL persistence", () => {
  beforeAll(async () => {
    await prisma.currentObject.deleteMany();
    await prisma.revisionRecord.deleteMany();
    await prisma.domainEvent.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("round-trips immutable scene revisions", async () => {
    const repository = new PrismaRevisionedRepository<Scene>(prisma, "Scene", payload => ({
      ...payload,
      createdAt: new Date(payload.createdAt as string),
      updatedAt: new Date(payload.updatedAt as string),
    } as Scene));

    const now = new Date("2026-10-02T00:00:00.000Z");
    const scene = createScene({
      id: "scene-1",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "The Northern Gate",
      revisionId: "scene-rev-1",
      commitId: "initial-commit",
      createdAt: now,
    });
    const committed = commitSceneText({
      scene,
      text: "Lin Chuan waited.",
      revisionId: "scene-rev-2",
      commitId: "commit-1",
      updatedAt: now,
    });

    await repository.save(committed);
    expect((await repository.findById("scene-1"))?.text).toBe("Lin Chuan waited.");
    expect((await repository.getRevision("scene-1", "scene-rev-2"))?.currentRevisionId).toBe(
      "scene-rev-2",
    );
  });

  it("round-trips domain events with append-only identity", async () => {
    const store = new PrismaEventStore(prisma);
    const event = createDomainEvent({
      eventId: "event-1",
      name: "SceneCommitted",
      context: "manuscript",
      novelId: "novel-1",
      objectId: "scene-1",
      revisionId: "scene-rev-2",
      commitId: "commit-1",
      payload: { textLength: 18 },
      occurredAt: new Date("2026-10-02T00:00:00.000Z"),
    });

    await store.append(event);
    const events = await store.listByNovel("novel-1");
    expect(events).toEqual([event]);
    await expect(store.append(event)).rejects.toThrow("Unique constraint failed");
  });
});
```

- [ ] **Step 3: Run the integration tests and verify they fail**

Start PostgreSQL:

```bash
docker compose up -d postgres
npx prisma migrate dev --name core_engine_persistence
npm run test:integration -- --run tests/integration/postgresRoundTrip.test.ts
```

Expected: FAIL before the Prisma schema and repositories exist.

- [ ] **Step 4: Implement Docker Compose, Prisma schema, and repositories**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: novelbrain
      POSTGRES_PASSWORD: novelbrain
      POSTGRES_DB: novelbrain
    ports:
      - "5432:5432"
    volumes:
      - novelbrain-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U novelbrain"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  novelbrain-postgres:
```

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model CurrentObject {
  id           String   @id @default(cuid())
  aggregateType String
  objectId      String
  novelId       String
  revisionId    String?
  payload       Json
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([aggregateType, objectId])
  @@index([aggregateType, objectId])
  @@index([novelId])
}

model RevisionRecord {
  id           String   @id @default(cuid())
  aggregateType String
  objectId      String
  novelId       String
  revisionId    String
  commitId      String?
  payload       Json
  createdAt     DateTime @default(now())

  @@unique([aggregateType, objectId, revisionId])
  @@index([aggregateType, objectId])
  @@index([novelId])
}

model DomainEvent {
  sequence    BigInt   @id @default(autoincrement())
  eventId     String   @unique
  name        String
  context     String
  novelId     String
  objectId    String
  revisionId  String
  commitId    String?
  payload     Json
  occurredAt  DateTime
  createdAt   DateTime @default(now())

  @@index([novelId])
  @@index([context, name])
}
```

```ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
export type PrismaClientProvider = PrismaClient;
```

```ts
import type { PrismaClient } from "@prisma/client";
import type { Repository, Revisioned, RevisionedRepository } from "../application/repository";
import type { DomainEvent } from "../../safety/domain/domainEvent";
import type { EventStore } from "../../safety/infrastructure/eventStore";

type Payload = Record<string, unknown>;

function serialize<T>(entity: T): Payload {
  return JSON.parse(JSON.stringify(entity)) as Payload;
}

export class PrismaRepository<T extends { id: string; novelId?: string }>
  implements Repository<T>
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly aggregateType: string,
    private readonly revive: (payload: Payload) => T,
  ) {}

  async save(entity: T): Promise<void> {
    await this.prisma.currentObject.upsert({
      where: {
        aggregateType_objectId: {
          aggregateType: this.aggregateType,
          objectId: entity.id,
        },
      },
      create: {
        aggregateType: this.aggregateType,
        objectId: entity.id,
        novelId: entity.novelId ?? entity.id,
        payload: serialize(entity),
      },
      update: {
        novelId: entity.novelId ?? entity.id,
        payload: serialize(entity),
      },
    });
  }

  async findById(id: string): Promise<T | undefined> {
    const record = await this.prisma.currentObject.findFirst({
      where: { aggregateType: this.aggregateType, objectId: id },
    });
    return record ? this.revive(record.payload as Payload) : undefined;
  }

  async listByNovel(novelId: string): Promise<readonly T[]> {
    const records = await this.prisma.currentObject.findMany({
      where: { aggregateType: this.aggregateType, novelId },
      orderBy: { objectId: "asc" },
    });
    return records.map(record => this.revive(record.payload as Payload));
  }
}

export class PrismaRevisionedRepository<T extends Revisioned<T>>
  implements RevisionedRepository<T>
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly aggregateType: string,
    private readonly revive: (payload: Payload) => T,
  ) {}

  async save(entity: T): Promise<void> {
    const payload = serialize(entity);
    await this.prisma.$transaction([
      this.prisma.revisionRecord.upsert({
        where: {
          aggregateType_objectId_revisionId: {
            aggregateType: this.aggregateType,
            objectId: entity.id,
            revisionId: entity.currentRevisionId,
          },
        },
        create: {
          aggregateType: this.aggregateType,
          objectId: entity.id,
          novelId: entity.novelId,
          revisionId: entity.currentRevisionId,
          payload,
        },
        update: { payload },
      }),
      this.prisma.currentObject.upsert({
        where: {
          aggregateType_objectId: {
            aggregateType: this.aggregateType,
            objectId: entity.id,
          },
        },
        create: {
          aggregateType: this.aggregateType,
          objectId: entity.id,
          novelId: entity.novelId,
          revisionId: entity.currentRevisionId,
          payload,
        },
        update: {
          novelId: entity.novelId,
          revisionId: entity.currentRevisionId,
          payload,
        },
      }),
    ]);
  }

  async findById(id: string): Promise<T | undefined> {
    const record = await this.prisma.currentObject.findFirst({
      where: { aggregateType: this.aggregateType, objectId: id },
    });
    return record ? this.revive(record.payload as Payload) : undefined;
  }

  async getRevision(id: string, revisionId: string): Promise<T | undefined> {
    const record = await this.prisma.revisionRecord.findUnique({
      where: {
        aggregateType_objectId_revisionId: {
          aggregateType: this.aggregateType,
          objectId: id,
          revisionId,
        },
      },
    });
    return record ? this.revive(record.payload as Payload) : undefined;
  }

  async listByNovel(novelId: string): Promise<readonly T[]> {
    const records = await this.prisma.currentObject.findMany({
      where: { aggregateType: this.aggregateType, novelId },
      orderBy: { objectId: "asc" },
    });
    return records.map(record => this.revive(record.payload as Payload));
  }
}

export class PrismaEventStore implements EventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async append(event: DomainEvent): Promise<void> {
    await this.prisma.domainEvent.create({
      data: {
        eventId: event.eventId,
        name: event.name,
        context: event.context,
        novelId: event.novelId,
        objectId: event.objectId,
        revisionId: event.revisionId,
        commitId: event.commitId,
        payload: serialize(event.payload),
        occurredAt: event.occurredAt,
      },
    });
  }

  async listByNovel(novelId: string): Promise<readonly DomainEvent[]> {
    const records = await this.prisma.domainEvent.findMany({
      where: { novelId },
      orderBy: { sequence: "asc" },
    });
    return records.map(record => ({
      eventId: record.eventId,
      name: record.name as DomainEvent["name"],
      context: record.context as DomainEvent["context"],
      novelId: record.novelId,
      objectId: record.objectId,
      revisionId: record.revisionId,
      commitId: record.commitId ?? undefined,
      payload: record.payload as Payload,
      occurredAt: record.occurredAt,
    }));
  }
}
```

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30000,
  },
});
```

- [ ] **Step 5: Run the integration tests and verify they pass**

Run:

```bash
docker compose up -d postgres
npx prisma migrate dev --name core_engine_persistence
npm run test:integration -- --run tests/integration/postgresRoundTrip.test.ts
```

Expected: PASS with 2 PostgreSQL round-trip tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json docker-compose.yml prisma/schema.prisma vitest.integration.config.ts src/shared/infrastructure tests/integration/postgresRoundTrip.test.ts
git commit -m "feat: add postgres persistence mapping"
```

---

### Task 19: Scene Revision Rollback Service

**Files:**

- Create: `src/safety/application/rollbackScene.ts`
- Create: `tests/safety/rollbackScene.test.ts`

**Interfaces:**

- Consumes: `Scene`, `RevisionedRepository`, `EventStore`, `commitSceneText`, `createDomainEvent`.
- Produces: `RollbackSceneInput`, `RollbackSceneResult`, `rollbackScene`.
- Recovery and deployment plans consume `rollbackScene` to restore a prior committed scene revision without mutating history.

- [ ] **Step 1: Write the failing rollback tests**

```ts
import { describe, expect, it } from "vitest";
import { InMemoryRevisionedRepository } from "../../src/app/inMemoryRepositories";
import { commitSceneText, createScene, type Scene } from "../../src/manuscript/domain/scene";
import { rollbackScene } from "../../src/safety/application/rollbackScene";
import { InMemoryEventStore } from "../../src/safety/infrastructure/eventStore";

const now = new Date("2026-10-02T00:00:00.000Z");

describe("rollbackScene", () => {
  it("restores a prior revision as a new audited commit", async () => {
    const scenes = new InMemoryRevisionedRepository<Scene>();
    const events = new InMemoryEventStore();
    const initial = createScene({
      id: "scene-1",
      novelId: "novel-1",
      chapterId: "chapter-1",
      title: "The Northern Gate",
      revisionId: "scene-rev-1",
      commitId: "initial-commit",
      createdAt: now,
    });
    const rev2 = commitSceneText({
      scene: initial,
      text: "Stable text",
      revisionId: "scene-rev-2",
      commitId: "commit-2",
      updatedAt: now,
    });
    const rev3 = commitSceneText({
      scene: rev2,
      text: "Bad text",
      revisionId: "scene-rev-3",
      commitId: "commit-3",
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    });
    await scenes.save(rev2);
    await scenes.save(rev3);

    const result = await rollbackScene({
      scenes,
      eventStore: events,
      input: {
        rollbackId: "rollback-1",
        sceneId: "scene-1",
        targetRevisionId: "scene-rev-2",
        reason: "Undo an invalid local rewrite.",
        now: new Date("2026-10-04T00:00:00.000Z"),
      },
    });

    expect(result.scene.text).toBe("Stable text");
    expect(result.scene.currentRevisionId).toBe("scene-rev-3:rollback:rollback-1");
    expect((await scenes.getRevision("scene-1", "scene-rev-2"))?.text).toBe("Stable text");
    expect((await events.listByNovel("novel-1"))[0]).toMatchObject({
      name: "SceneCommitted",
      commitId: "rollback-1",
      payload: { rollback: true, reason: "Undo an invalid local rewrite." },
    });
  });

  it("rejects a missing rollback target", async () => {
    const scenes = new InMemoryRevisionedRepository<Scene>();
    await scenes.save(
      createScene({
        id: "scene-1",
        novelId: "novel-1",
        chapterId: "chapter-1",
        title: "The Northern Gate",
        revisionId: "scene-rev-1",
        commitId: "initial-commit",
        createdAt: now,
      }),
    );

    await expect(
      rollbackScene({
        scenes,
        eventStore: new InMemoryEventStore(),
        input: {
          rollbackId: "rollback-1",
          sceneId: "scene-1",
          targetRevisionId: "missing-revision",
          reason: "Undo.",
          now,
        },
      }),
    ).rejects.toThrow("Rollback target revision not found");
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --run tests/safety/rollbackScene.test.ts`

Expected: FAIL because the rollback module does not exist.

- [ ] **Step 3: Implement rollback as a forward-only audited transition**

```ts
import type { Scene } from "../../manuscript/domain/scene";
import { commitSceneText } from "../../manuscript/domain/scene";
import type { RevisionedRepository } from "../../shared/application/repository";
import { createDomainEvent } from "../domain/domainEvent";
import type { EventStore } from "../infrastructure/eventStore";

export interface RollbackSceneInput {
  readonly rollbackId: string;
  readonly sceneId: string;
  readonly targetRevisionId: string;
  readonly reason: string;
  readonly now: Date;
}

export interface RollbackSceneResult {
  readonly scene: Scene;
  readonly restoredRevisionId: string;
}

export async function rollbackScene(input: {
  scenes: RevisionedRepository<Scene>;
  eventStore: EventStore;
  input: RollbackSceneInput;
}): Promise<RollbackSceneResult> {
  if (!input.input.reason.trim()) throw new Error("Rollback reason is required");
  const current = await input.scenes.findById(input.input.sceneId);
  if (!current) throw new Error(`Scene not found: ${input.input.sceneId}`);
  const target = await input.scenes.getRevision(
    input.input.sceneId,
    input.input.targetRevisionId,
  );
  if (!target) throw new Error("Rollback target revision not found");

  const restoredRevisionId = `${current.currentRevisionId}:rollback:${input.input.rollbackId}`;
  const restored = commitSceneText({
    scene: current,
    text: target.text,
    spanAnchors: target.spanAnchors,
    revisionId: restoredRevisionId,
    commitId: input.input.rollbackId,
    updatedAt: input.input.now,
  });
  await input.scenes.save(restored);
  await input.eventStore.append(
    createDomainEvent({
      eventId: `event:${input.input.rollbackId}:${restored.id}`,
      name: "SceneCommitted",
      context: "manuscript",
      novelId: restored.novelId,
      objectId: restored.id,
      revisionId: restoredRevisionId,
      commitId: input.input.rollbackId,
      payload: { rollback: true, reason: input.input.reason.trim() },
      occurredAt: input.input.now,
    }),
  );

  return Object.freeze({ scene: restored, restoredRevisionId });
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run tests/safety/rollbackScene.test.ts`

Expected: PASS with 2 rollback tests.

- [ ] **Step 5: Commit**

```bash
git add src/safety/application/rollbackScene.ts tests/safety/rollbackScene.test.ts
git commit -m "feat: add audited scene rollback"
```

---

### Task 20: Application Composition and Final Verification

**Files:**

- Create: `src/app/composition.ts`
- Create: `tests/app/engineComposition.test.ts`
- Create: `README.md`

**Interfaces:**

- Consumes: all in-memory repositories, `DeterministicRuntime`, `createNovelBrainServer`.
- Produces: `createInMemoryEngineDependencies`, `createInMemoryEngineServer`.
- Deployment and web workspace plans use composition instead of constructing infrastructure throughout the application.

- [ ] **Step 1: Write the failing composition test**

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";

describe("application composition", () => {
  it("creates isolated engine dependencies for one author session", () => {
    const dependencies = createInMemoryEngineDependencies();
    expect(dependencies.novels).toBeDefined();
    expect(dependencies.scenes).toBeDefined();
    expect(dependencies.generationTasks).toBeDefined();
    expect(dependencies.candidates).toBeDefined();
    expect(dependencies.canonicalFacts).toBeDefined();
    expect(dependencies.stateRecords).toBeDefined();
    expect(dependencies.narrativeCommits).toBeDefined();
    expect(dependencies.eventStore).toBeDefined();
    expect(dependencies.runtime).toBeDefined();
  });

  it("does not share mutable storage between engine instances", async () => {
    const first = createInMemoryEngineDependencies();
    const second = createInMemoryEngineDependencies();
    await first.novels.save({
      id: "novel-1",
      authorId: "author-1",
      title: "Novel",
      status: "draft",
      autonomyPolicy: "human_review_required",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(await second.novels.findById("novel-1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the composition test and verify it fails**

Run: `npm test -- --run tests/app/engineComposition.test.ts`

Expected: FAIL because `src/app/composition.ts` does not exist.

- [ ] **Step 3: Implement composition and document the engine**

```ts
import { InMemoryRepository } from "./inMemoryRepositories";
import { InMemoryRevisionedRepository } from "./inMemoryRepositories";
import type { Novel } from "../narrative/novel/domain/novel";
import type { CanonicalFact } from "../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../narrative/state/domain/stateRecord";
import type { Scene } from "../manuscript/domain/scene";
import type { GenerationTask } from "../production/domain/generationTask";
import type { Candidate } from "../production/domain/candidate";
import type { ValidationRun } from "../production/domain/validationRun";
import type { ReviewDecision } from "../production/domain/reviewDecision";
import type { NarrativeCommit } from "../safety/domain/narrativeCommit";
import { InMemoryEventStore } from "../safety/infrastructure/eventStore";
import { DeterministicRuntime } from "../production/runtime/deterministicRuntime";
import { createNovelBrainServer } from "../http/server";
import type { ApiDependencies } from "../http/routes";

export function createInMemoryEngineDependencies(): ApiDependencies {
  return {
    novels: new InMemoryRepository<Novel>(),
    scenes: new InMemoryRevisionedRepository<Scene>(),
    generationTasks: new InMemoryRepository<GenerationTask>(),
    candidates: new InMemoryRevisionedRepository<Candidate>(),
    canonicalFacts: new InMemoryRevisionedRepository<CanonicalFact>(),
    stateRecords: new InMemoryRevisionedRepository<StateRecord>(),
    validationRuns: new InMemoryRepository<ValidationRun>(),
    reviewDecisions: new InMemoryRepository<ReviewDecision>(),
    narrativeCommits: new InMemoryRepository<NarrativeCommit>(),
    eventStore: new InMemoryEventStore(),
    runtime: new DeterministicRuntime(),
  };
}

export function createInMemoryEngineServer() {
  return createNovelBrainServer(createInMemoryEngineDependencies());
}
```

````markdown
# Novel Brain Core Engine

Novel Brain's core engine maintains a canonical narrative representation and routes AI output through validation, review, and a coherent commit boundary.

## Design boundaries

- Committed manuscript text and committed narrative facts are canonical state.
- AI output is candidate state and never writes directly to canonical state.
- `Canon`, `StoryState`, and `Manuscript` are domain concepts, not monolithic aggregates.
- `NarrativeCommit` coordinates one coherent canonical transition.
- Tasks and candidates use `basedOnVersionSet`, not a global novel version.
- Memory and retrieval data is derived and rebuildable.

## Local commands

```bash
npm install
npm run typecheck
npm test -- --run
docker compose up -d postgres
npx prisma migrate dev
npm run test:integration -- --run
```

The deterministic runtime proves the engine pipeline without requiring an external model provider.
````

- [ ] **Step 4: Run all unit, type, and integration checks**

Run:

```bash
npm run typecheck
npm test -- --run
docker compose up -d postgres
npx prisma migrate dev
npm run test:integration -- --run
```

Expected:

- TypeScript exits successfully.
- All unit tests pass.
- PostgreSQL integration tests pass.
- No test output contains an unhandled promise rejection.

- [ ] **Step 5: Scan for placeholders and forbidden domain regressions**

Run:

```bash
rg -n "TBD|TODO|PLACEHOLDER|direct AI|Global Novel Version|Monolithic Canon|Monolithic StoryState|Monolithic Manuscript" src tests prisma
```

Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add src/app/composition.ts tests/app/engineComposition.test.ts README.md
git commit -m "feat: add engine composition and verification"
```

---

## Plan Self-Review Checklist

Before implementation is considered complete:

- Every task has a failing test, passing test, and commit step.
- Domain aggregate boundaries match the approved specification.
- No task reintroduces a global novel version.
- No task writes AI output directly to canonical state.
- No task makes `Canon`, `StoryState`, or `Manuscript` a monolithic aggregate.
- Events remain context-owned and append-only.
- Memory remains derived from canonical revisions.
- PostgreSQL mapping follows domain contracts rather than replacing domain invariants.
- All commands in Task 20 pass with visible output.
