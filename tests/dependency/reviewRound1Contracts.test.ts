import { describe, expect, it } from "vitest";
import {
  canonicalDependencyIdentity,
  createDependencyIdentity,
  createDependencyRelationFact,
  createDependencyRevisionProvenance,
  dependencyIdentityKey,
  dependencyObjectKey,
} from "../../src/dependency/domain/dependencyRegistry";
import { hashContent, canonicalJson } from "../../src/shared/domain/contentHash";
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

const createdAt = new Date("2026-10-04T03:00:00.000Z");

function identity(objectId: string, revisionId = `${objectId}-rev-1`, aggregateType: "Scene" | "StateRecord" = "Scene") {
  return createDependencyIdentity({
    novelId: "novel-review-2.3",
    aggregateType,
    objectId,
    revisionId,
  });
}

function evidence(id = "evidence-review", overrides: Partial<ValidationEvidence> = {}) {
  const sourceReference = createSourceReference({
    identity: `source-${id}`,
    version: "source-rev-1",
    hash: `hash-${id}`,
  });
  const data: ValidationEvidence = {
    id,
    type: "revision-binding",
    sourceReference: {
      identity: sourceReference.identity,
      version: sourceReference.version,
      hash: sourceReference.hash,
    },
    observation: "Revision binding evidence.",
    ...overrides,
  };
  return createObservation<ValidationEvidence>({
    evidenceReference: `validation:${id}`,
    sourceReference,
    ordinal: 1,
    data,
  });
}

function provenance(dependent = identity("state", "state-rev-1", "StateRecord"), dependency = identity("scene")) {
  return createDependencyRevisionProvenance({
    revision: createInitialChangeSetRevision({
      revisionId: "changeset-review:rev-1",
      changeSetId: "changeset-review",
      novelId: "novel-review-2.3",
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

describe("Dependency identity and relation review contracts [task:2.3]", () => {
  it("[domain] returns structured canonical identity without delimiter concatenation", () => {
    const subject = identity("scene");
    const canonical = canonicalDependencyIdentity(subject);

    expect(dependencyIdentityKey(subject)).toEqual({
      scope: "revision",
      novelId: "novel-review-2.3",
      aggregateType: "Scene",
      objectId: "scene",
      revisionId: "scene-rev-1",
    });
    expect(dependencyObjectKey(subject)).toEqual({
      scope: "object",
      novelId: "novel-review-2.3",
      aggregateType: "Scene",
      objectId: "scene",
    });
    expect(canonical.revision).toBe(hashContent(canonicalJson(dependencyIdentityKey(subject))));
    expect(canonical.object).toBe(hashContent(canonicalJson(dependencyObjectKey(subject))));
  });

  it("[domain] binds ChangeSet identity/hash, novel, and VersionSet to relation endpoints", () => {
    const fact = createDependencyRelationFact({
      id: "relation-review",
      novelId: "novel-review-2.3",
      family: "narrative",
      relationType: "dependsOn",
      inverseSemantics: "inverse",
      sourceKind: "commit-derived",
      lifecycle: "active",

      dependent: identity("state", "state-rev-1", "StateRecord"),
      dependency: identity("scene"),
      revisionProvenance: provenance(),
      createdAt,
    });

    expect(fact.revisionProvenance.changeSet.identity).toEqual({
      novelId: "novel-review-2.3",
      changeSetId: "changeset-review",
      revisionId: "changeset-review:rev-1",
      revisionNumber: 1,
      parentChangeSetRevisionId: undefined,
    });
    expect(fact.revisionProvenance.changeSet.hash).toHaveLength(64);
    expect(fact.revisionProvenance.versionSet.scene?.revisionId).toBe("scene-rev-1");
  });

  it("[domain] rejects novel/VersionSet binding mismatches and evidence source mismatches", () => {
    const dependent = identity("state", "state-rev-1", "StateRecord");
    const dependency = identity("scene");

    expect(() =>
      createDependencyRevisionProvenance({
        revision: createInitialChangeSetRevision({
          revisionId: "changeset-other:rev-1",
          changeSetId: "changeset-other",
          novelId: "other-novel",
          createdAt,
        }),
        dependent,
        dependency,
        versionSet: createVersionSet({
          scene: createVersionReference("Scene", dependency.objectId, dependency.revisionId),
          state: createVersionReference("StateRecord", dependent.objectId, dependent.revisionId),
        }),
        evidence: [evidence()],
      }),
    ).toThrow("ChangeSet revision novelId must match dependency identities");

    expect(() =>
      createDependencyRevisionProvenance({
        revision: createInitialChangeSetRevision({
          revisionId: "changeset-review:rev-1",
          changeSetId: "changeset-review",
          novelId: "novel-review-2.3",
          createdAt,
        }),
        dependent,
        dependency,
        versionSet: createVersionSet({
          state: createVersionReference("StateRecord", dependent.objectId, dependent.revisionId),
        }),
        evidence: [evidence()],
      }),
    ).toThrow("VersionSet must bind dependent and dependency revisions");

    expect(() =>
      createDependencyRevisionProvenance({
        revision: createInitialChangeSetRevision({
          revisionId: "changeset-review:rev-1",
          changeSetId: "changeset-review",
          novelId: "novel-review-2.3",
          createdAt,
        }),
        dependent,
        dependency,
        versionSet: createVersionSet({
          scene: createVersionReference("Scene", dependency.objectId, dependency.revisionId),
          state: createVersionReference("StateRecord", dependent.objectId, dependent.revisionId),
        }),
        evidence: [
          evidence("evidence-review", {
            sourceReference: {
              identity: "source-evidence-review",
              version: "different-version",
              hash: "hash-evidence-review",
            },
          }),
        ],
      }),
    ).toThrow("ValidationEvidence sourceReference must match Observation sourceReference");
  });


  it("[domain] validates canonical inverse relation semantics", () => {
    const base = {
      id: "relation-inverse",
      novelId: "novel-review-2.3",
      family: "structural" as const,
      relationType: "contains" as const,
      inverseSemantics: "inverse" as const,
      inverseRelationType: "belongsTo" as const,
      sourceKind: "commit-derived" as const,
      lifecycle: "active" as const,
      dependent: identity("state", "state-rev-1", "StateRecord"),
      dependency: identity("scene"),
      revisionProvenance: provenance(),
      createdAt,
    };
    expect(createDependencyRelationFact(base).inverseRelationType).toBe("belongsTo");
    expect(() =>
      createDependencyRelationFact({
        ...base,
        inverseRelationType: "contains",
      }),
    ).toThrow("inverse relation type must match relation semantics");
    expect(() =>
      createDependencyRelationFact({
        ...base,
        inverseSemantics: "none",
      }),
    ).toThrow("inverse relation type is not allowed for none inverse semantics");
  });
  it("[domain] carries family, relation type, inverse semantics, source kind, lifecycle, and classification facts", () => {
    const fact = createDependencyRelationFact({
      id: "relation-semantics",
      novelId: "novel-review-2.3",
      family: "causal",
      relationType: "appliesTo",
      inverseSemantics: "symmetric",
      sourceKind: "explicit",
      lifecycle: "proposed",

      dependent: identity("state", "state-rev-1", "StateRecord"),
      dependency: identity("scene"),
      revisionProvenance: provenance(),
      createdAt,
    });

    expect(fact).toMatchObject({
      family: "causal",
      relationType: "appliesTo",
      inverseSemantics: "symmetric",
      sourceKind: "explicit",
      lifecycle: "proposed",

    });
    expect(() =>
      createDependencyRelationFact({
        id: "relation-invalid",
        novelId: "novel-review-2.3",
        family: "unknown" as never,
        relationType: "dependsOn",
        inverseSemantics: "inverse",
        sourceKind: "commit-derived",
        lifecycle: "active",

        dependent: identity("state", "state-rev-1", "StateRecord"),
        dependency: identity("scene"),
        revisionProvenance: provenance(),
        createdAt,
      }),
    ).toThrow("Unsupported dependency family");
  });
});
