import { describe, expect, it } from "vitest";
import {
  assessDependencyFactStaleness,
  buildDependencyRegistryView,
  canonicalDependencyIdentity,
  createDependencyIdentity,
  createDependencyRelationFact,
  createDependencyRevisionProvenance,
  dependencyIdentityKey,
  dependencyObjectKey,
} from "../../src/dependency/domain/dependencyRegistry";
import { createInitialChangeSetRevision } from "../../src/production/domain/changeSetRevision";
import type { ValidationEvidence } from "../../src/production/domain/validationRun";
import {
  createObservation,
  createSourceReference,
} from "../../src/shared/domain/observationSource";
import {
  createVersionReference,
  createVersionSet,
} from "../../src/shared/domain/versioning";

const createdAt = new Date("2026-10-04T00:00:00.000Z");

function identity(objectId: string, aggregateType: "Scene" | "StateRecord" = "Scene", revisionId = `${objectId}-rev-1`) {
  return createDependencyIdentity({
    novelId: "novel-1",
    aggregateType,
    objectId,
    revisionId,
  });
}

function evidence(id = "evidence-1"): ReturnType<typeof createObservation<ValidationEvidence>> {
  const sourceReference = createSourceReference({
    identity: `source-${id}`,
    version: "source-rev-1",
    hash: `hash-${id}`,
  });
  const data: ValidationEvidence = {
    id,
    type: "revision-comparison",
    sourceReference: {
      identity: sourceReference.identity,
      version: sourceReference.version,
      hash: sourceReference.hash,
    },
    observation: "Observed source revision.",
  };
  return createObservation<ValidationEvidence>({
    evidenceReference: `validation:${id}`,
    sourceReference,
    ordinal: 1,
    data,
  });
}

function provenance(dependent = identity("state-1", "StateRecord"), dependency = identity("scene-1")) {
  return createDependencyRevisionProvenance({
    revision: createInitialChangeSetRevision({
      revisionId: "changeset-1:revision-1",
      changeSetId: "changeset-1",
      novelId: "novel-1",
      createdAt,
    }),
    dependent,
    dependency,
    versionSet: createVersionSet({
      scene: createVersionReference("Scene", dependency.objectId, dependency.revisionId),
      state: createVersionReference("StateRecord", dependent.objectId, dependent.revisionId),
    }),
    evidence: [evidence()],
  });
}

function relation(overrides: Record<string, unknown> = {}) {
  return createDependencyRelationFact({
    id: "relation-1",
    novelId: "novel-1",
    family: "narrative",
    relationType: "dependsOn",
    inverseSemantics: "inverse",
    sourceKind: "commit-derived",
    lifecycle: "active",

    dependent: identity("state-1", "StateRecord"),
    dependency: identity("scene-1"),
    revisionProvenance: provenance(),
    createdAt,
    ...overrides,
  });
}

describe("DependencyRegistry contracts [task:2.3]", () => {
  it("[domain] separates structured revision and object identity", () => {
    const first = identity("scene-1");
    const changedRevision = identity("scene-1", "Scene", "scene-1-rev-2");

    expect(dependencyIdentityKey(first)).toEqual({
      scope: "revision",
      novelId: "novel-1",
      aggregateType: "Scene",
      objectId: "scene-1",
      revisionId: "scene-1-rev-1",
    });
    expect(dependencyObjectKey(first)).toEqual(dependencyObjectKey(changedRevision));
    expect(canonicalDependencyIdentity(first).revision).toHaveLength(64);
  });

  it("[domain] creates immutable relation facts with bound ChangeSet provenance", () => {
    const fact = relation();

    expect(fact.revisionProvenance.changeSet.identity.changeSetId).toBe("changeset-1");
    expect(fact.revisionProvenance.changeSet.hash).toHaveLength(64);
    expect(fact.revisionProvenance.versionSet.scene?.revisionId).toBe("scene-1-rev-1");
    expect(Object.isFrozen(fact)).toBe(true);
    expect(Object.isFrozen(fact.revisionProvenance.evidence[0]?.data)).toBe(true);
  });

  it("[domain] rejects invalid identity, binding, evidence, and relation semantics", () => {
    expect(() => relation({ dependent: identity("scene-1"), dependency: identity("scene-1") })).toThrow(
      "self dependency relation is not allowed",
    );
    expect(() =>
      createDependencyRevisionProvenance({
        revision: createInitialChangeSetRevision({
          revisionId: "changeset-1:revision-1",
          changeSetId: "changeset-1",
          novelId: "other-novel",
          createdAt,
        }),
        dependent: identity("state-1", "StateRecord"),
        dependency: identity("scene-1"),
        versionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-1", "scene-1-rev-1"),
          state: createVersionReference("StateRecord", "state-1", "state-1-rev-1"),
        }),
        evidence: [evidence()],
      }),
    ).toThrow("ChangeSet revision novelId must match dependency identities");
    expect(() =>
      relation({ family: "unknown" as never }),
    ).toThrow("Unsupported dependency family");
    expect(() =>
      relation({ lifecycle: "unknown" as never }),
    ).toThrow("Unsupported dependency lifecycle");
  });

  it("[domain] reports fresh, stale, and missing current revisions deterministically", () => {
    const fact = relation();
    expect(
      assessDependencyFactStaleness(
        fact,
        createVersionSet({
          scene: createVersionReference("Scene", "scene-1", "scene-1-rev-1"),
          state: createVersionReference("StateRecord", "state-1", "state-1-rev-1"),
        }),
      ),
    ).toBe("fresh");
    expect(
      assessDependencyFactStaleness(
        fact,
        createVersionSet({
          scene: createVersionReference("Scene", "scene-1", "scene-1-rev-2"),
          state: createVersionReference("StateRecord", "state-1", "state-1-rev-1"),
        }),
      ),
    ).toBe("stale");
    expect(
      assessDependencyFactStaleness(
        fact,
        createVersionSet({
          state: createVersionReference("StateRecord", "state-1", "state-1-rev-1"),
        }),
      ),
    ).toBe("missing");
  });

  it("[domain] projects sorted outgoing and incoming read-model facts without mutating inputs", () => {
    const subject = identity("scene-1");
    const second = relation({
      id: "relation-0",
      dependent: identity("state-2", "StateRecord"),
      dependency: identity("scene-1"),
    });
    const input = [relation(), second];
    const snapshot = [...input];

    const view = buildDependencyRegistryView({ subject, relations: input });
    input.reverse();

    expect(input).toEqual([...snapshot].reverse());
    expect(view.incoming.map(({ id }) => id)).toEqual(["relation-0", "relation-1"]);
  });
});
