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
