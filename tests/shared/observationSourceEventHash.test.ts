import { describe, expect, it } from "vitest";
import { createDomainEvent, type DomainEvent } from "../../src/safety/domain/domainEvent";
import { canonicalJson, hashContent } from "../../src/shared/domain/contentHash";
import {
  createObservation,
  createObservationSnapshot,
  resolveObservation,
} from "../../src/shared/domain/observationSource";
import {
  domainEventSourceContent,
  domainEventSourceReference,
} from "../support/observationSourceContract";

const now = new Date("2026-10-04T00:00:00.000Z");

function event(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return createDomainEvent({
    eventId: "event-1",
    name: "SceneCommitted",
    context: "manuscript",
    novelId: "novel-1",
    objectId: "scene-1",
    revisionId: "scene-rev-1",
    commitId: "commit-1",
    payload: { textLength: 12, nested: { value: "one" } },
    occurredAt: now,
    ...overrides,
  });
}

describe("DomainEvent observation source content", () => {
  it("covers complete event identity and content", () => {
    expect(domainEventSourceContent(event())).toEqual({
      eventId: "event-1",
      name: "SceneCommitted",
      context: "manuscript",
      novelId: "novel-1",
      objectId: "scene-1",
      revisionId: "scene-rev-1",
      commitId: "commit-1",
      payload: { textLength: 12, nested: { value: "one" } },
      occurredAt: {
        iso: "2026-10-04T00:00:00.000Z",
        epochMilliseconds: Date.parse("2026-10-04T00:00:00.000Z"),
      },
    });
    expect(domainEventSourceReference(event()).hash).toBe(
      hashContent(
        canonicalJson({
          eventId: "event-1",
          name: "SceneCommitted",
          context: "manuscript",
          novelId: "novel-1",
          objectId: "scene-1",
          revisionId: "scene-rev-1",
          commitId: "commit-1",
          payload: { textLength: 12, nested: { value: "one" } },
          occurredAt: {
            iso: "2026-10-04T00:00:00.000Z",
            epochMilliseconds: Date.parse("2026-10-04T00:00:00.000Z"),
          },
        }),
      ),
    );
  });

  it("is independent of DomainEvent payload key order", () => {
    const left = event({
      payload: { first: 1, nested: { left: 1, right: 2 } },
    });
    const right = event({
      payload: { nested: { right: 2, left: 1 }, first: 1 },
    });

    expect(domainEventSourceReference(left)).toEqual(domainEventSourceReference(right));
  });

  it.each([
    ["eventId", { eventId: "event-2" }],
    ["name", { name: "ValidationCompleted" }],
    ["context", { context: "ai_production" }],
    ["novelId", { novelId: "novel-2" }],
    ["objectId", { objectId: "scene-2" }],
    ["revisionId", { revisionId: "scene-rev-2" }],
    ["commitId", { commitId: undefined }],
    ["payload", { payload: { textLength: 13, nested: { value: "one" } } }],
    ["occurredAt", { occurredAt: new Date("2026-10-05T00:00:00.000Z") }],
  ] as const)("changes the content hash when %s changes", (_field, overrides) => {
    const base = domainEventSourceReference(event()).hash;
    const changed = domainEventSourceReference(event(overrides)).hash;

    expect(changed).not.toBe(base);
  });
  it("maps real DomainEvent version and content changes to source mismatches", () => {
    const base = event();
    const expectedSourceReference = domainEventSourceReference(base);

    const contentChanged = event({
      payload: { textLength: 13, nested: { value: "one" } },
    });
    const contentSnapshot = createObservationSnapshot({
      sourceReference: domainEventSourceReference(contentChanged),
      observations: [
        createObservation({
          evidenceReference: contentChanged.eventId,
          sourceReference: domainEventSourceReference(contentChanged),
          ordinal: 1,
          data: contentChanged,
        }),
      ],
    });
    expect(
      resolveObservation(contentSnapshot, {
        evidenceReference: base.eventId,
        sourceReference: expectedSourceReference,
      }),
    ).toMatchObject({
      status: "hash_mismatch",
      actualSourceReference: domainEventSourceReference(contentChanged),
    });

    const versionChanged = event({ revisionId: "scene-rev-2" });
    const versionSnapshot = createObservationSnapshot({
      sourceReference: domainEventSourceReference(versionChanged),
      observations: [
        createObservation({
          evidenceReference: versionChanged.eventId,
          sourceReference: domainEventSourceReference(versionChanged),
          ordinal: 1,
          data: versionChanged,
        }),
      ],
    });
    expect(
      resolveObservation(versionSnapshot, {
        evidenceReference: base.eventId,
        sourceReference: expectedSourceReference,
      }),
    ).toMatchObject({
      status: "version_mismatch",
      actualSourceReference: domainEventSourceReference(versionChanged),
    });
  });
});
