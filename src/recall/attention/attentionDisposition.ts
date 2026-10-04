import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";

export type AttentionAuthorAction =
  | "inspect"
  | "dismiss"
  | "snooze"
  | "confirm"
  | "ignore"
  | "why";

export type AttentionAction = AttentionAuthorAction | "recheck";

export type AttentionDispositionState =
  | "active"
  | "inspected"
  | "dismissed"
  | "snoozed"
  | "confirmed"
  | "ignored"
  | "why_requested";

export interface RecallItemForAttention {
  readonly itemId: string;
  readonly novelId: string;
  readonly candidateId: string;
  readonly evidenceFingerprint: string;
  readonly explanation: {
    readonly reason: string;
    readonly evidenceReferences: readonly string[];
  };
}

export interface AttentionDispositionEvent {
  readonly eventId: string;
  readonly action: AttentionAction;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly evidenceFingerprint: string;
  readonly actionId?: string;
  readonly snoozedUntil?: string;
}

export interface AttentionDispositionRecord {
  readonly id: string;
  readonly novelId: string;
  readonly itemId: string;
  readonly candidateId: string;
  readonly evidenceFingerprint: string;
  readonly state: AttentionDispositionState;
  readonly lastAction: AttentionAction;
  readonly snoozedUntil?: string;
  readonly history: readonly AttentionDispositionEvent[];
  readonly currentRevisionId: string;
}

export interface AttentionActionInput {
  readonly item: RecallItemForAttention;
  readonly current?: AttentionDispositionRecord;
  readonly action: AttentionAuthorAction;
  readonly actionId?: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly snoozedUntil?: string;
  readonly reason?: string;
}

export interface AttentionActionResult {
  readonly record: AttentionDispositionRecord;
  readonly replayed: boolean;
  readonly blocking: false;
}

export interface AttentionRecheckResult {
  readonly record: AttentionDispositionRecord;
  readonly changed: boolean;
  readonly shouldSurface: boolean;
}

const actionStates: Readonly<Record<AttentionAuthorAction, AttentionDispositionState>> = {
  inspect: "inspected",
  dismiss: "dismissed",
  snooze: "snoozed",
  confirm: "confirmed",
  ignore: "ignored",
  why: "why_requested",
};

function requiredText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function timestamp(value: string, name: string): string {
  const normalized = requiredText(value, name);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`${name} must be a canonical ISO timestamp`);
  }
  return normalized;
}

function validateItem(item: RecallItemForAttention): void {
  requiredText(item.itemId, "item.itemId");
  requiredText(item.novelId, "item.novelId");
  requiredText(item.candidateId, "item.candidateId");
  requiredText(item.evidenceFingerprint, "item.evidenceFingerprint");
  requiredText(item.explanation.reason, "item.explanation.reason");
  if (item.explanation.evidenceReferences.length === 0) {
    throw new Error("item.explanation.evidenceReferences must not be empty");
  }
}

// Revision identity reserves the ordered command/evidence chain. Immutable
// history storage rejects any different payload under the same chain identity.
function revisionId(record: Omit<AttentionDispositionRecord, "currentRevisionId">): string {
  return hashContent(
    canonicalJson({
      id: record.id,
      eventIds: record.history.map((event) => event.eventId),
    }),
  );
}

function freezeRecord(
  value: Omit<AttentionDispositionRecord, "currentRevisionId">,
): AttentionDispositionRecord {
  return deepFreeze({
    ...value,
    history: value.history.map((event) => deepFreeze({ ...event })),
    currentRevisionId: revisionId(value),
  });
}

function recheckEventId(item: RecallItemForAttention): string {
  return hashContent(
    canonicalJson({
      itemId: item.itemId,
      candidateId: item.candidateId,
      evidenceFingerprint: item.evidenceFingerprint,
      action: "recheck",
    }),
  );
}

function actionEventId(input: AttentionActionInput): string {
  return input.actionId === undefined
    ? hashContent(
        canonicalJson({
          itemId: input.item.itemId,
          candidateId: input.item.candidateId,
          evidenceFingerprint: input.item.evidenceFingerprint,
          action: input.action,
          actorId: input.actorId,
          occurredAt: input.occurredAt,
          reason: input.reason ?? null,
          snoozedUntil: input.snoozedUntil ?? null,
        }),
      )
    : hashContent(
        canonicalJson({
          itemId: input.item.itemId,
          candidateId: input.item.candidateId,
          evidenceFingerprint: input.item.evidenceFingerprint,
          actionId: input.actionId,
        }),
      );
}

function baseRecord(
  item: RecallItemForAttention,
  event: AttentionDispositionEvent,
  state: AttentionDispositionState,
  snoozedUntil?: string,
): AttentionDispositionRecord {
  return freezeRecord({
    id: item.itemId,
    novelId: item.novelId,
    itemId: item.itemId,
    candidateId: item.candidateId,
    evidenceFingerprint: item.evidenceFingerprint,
    state,
    lastAction: event.action,
    ...(snoozedUntil === undefined ? {} : { snoozedUntil }),
    history: [event],
  });
}

function appendRecord(
  current: AttentionDispositionRecord,
  item: RecallItemForAttention,
  event: AttentionDispositionEvent,
  state: AttentionDispositionState,
  snoozedUntil?: string,
): AttentionDispositionRecord {
  return freezeRecord({
    id: current.id,
    novelId: current.novelId,
    itemId: current.itemId,
    candidateId: current.candidateId,
    evidenceFingerprint: item.evidenceFingerprint,
    state,
    lastAction: event.action,
    ...(snoozedUntil === undefined ? {} : { snoozedUntil }),
    history: [...current.history, event],
  });
}

export function applyAttentionAction(input: AttentionActionInput): AttentionActionResult {
  validateItem(input.item);
  const actorId = requiredText(input.actorId, "actorId");
  const occurredAt = timestamp(input.occurredAt, "occurredAt");
  const snoozedUntil =
    input.action === "snooze"
      ? timestamp(input.snoozedUntil ?? "", "snoozedUntil")
      : undefined;
  if (input.action !== "snooze" && input.snoozedUntil !== undefined) {
    throw new Error("snoozedUntil is only valid for snooze");
  }
  if (input.reason !== undefined) requiredText(input.reason, "reason");

  const commandEventId = actionEventId(input);
  const reservedEvent = input.actionId === undefined
    ? undefined
    : input.current?.history.find((event) => event.actionId === input.actionId);
  if (reservedEvent !== undefined) {
    if (reservedEvent.evidenceFingerprint !== input.item.evidenceFingerprint) {
      throw new Error(
        `Attention action evidence fingerprint conflict: ${input.actionId}`,
      );
    }
    if (reservedEvent.action !== input.action || reservedEvent.snoozedUntil !== snoozedUntil) {
      throw new Error(`Attention action identity conflict: ${input.actionId}`);
    }
  }
  const existingEvent = input.current?.history.find(
    (event) => event.eventId === commandEventId,
  );
  if (input.current !== undefined && existingEvent !== undefined) {
    return { record: input.current, replayed: true, blocking: false };
  }

  let current = input.current;
  if (current !== undefined && current.evidenceFingerprint !== input.item.evidenceFingerprint) {
    current = appendRecord(
      current,
      input.item,
      {
        eventId: recheckEventId(input.item),
        action: "recheck",
        actorId,
        occurredAt,
        evidenceFingerprint: input.item.evidenceFingerprint,
      },
      "active",
    );
  }

  const event: AttentionDispositionEvent = deepFreeze({
    eventId: commandEventId,
    action: input.action,
    actorId,
    occurredAt,
    evidenceFingerprint: input.item.evidenceFingerprint,
    ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
    ...(snoozedUntil === undefined ? {} : { snoozedUntil }),
  });
  const record =
    current === undefined
      ? baseRecord(input.item, event, actionStates[input.action], snoozedUntil)
      : appendRecord(current, input.item, event, actionStates[input.action], snoozedUntil);

  return { record, replayed: false, blocking: false };
}

export function recheckAttentionItem(input: {
  readonly item: RecallItemForAttention;
  readonly current: AttentionDispositionRecord;
  readonly occurredAt: string;
}): AttentionRecheckResult {
  validateItem(input.item);
  const occurredAt = timestamp(input.occurredAt, "occurredAt");

  if (input.current.evidenceFingerprint === input.item.evidenceFingerprint) {
    const shouldSurface =
      input.current.state === "active" ||
      input.current.state === "inspected" ||
      input.current.state === "why_requested" ||
      (input.current.state === "snoozed" &&
        input.current.snoozedUntil !== undefined &&
        occurredAt >= input.current.snoozedUntil);
    return { record: input.current, changed: false, shouldSurface };
  }

  const record = appendRecord(
    input.current,
    input.item,
    {
      eventId: recheckEventId(input.item),
      action: "recheck",
      actorId: "recall",
      occurredAt,
      evidenceFingerprint: input.item.evidenceFingerprint,
    },
    "active",
  );
  return { record, changed: true, shouldSurface: true };
}
