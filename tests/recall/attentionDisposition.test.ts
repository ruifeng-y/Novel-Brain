import { describe, expect, it } from "vitest";
import {
  applyAttentionAction,
  recheckAttentionItem,
  type AttentionDispositionRecord,
  type RecallItemForAttention,
} from "../../src/recall/attention/attentionDisposition";
import {
  createInMemoryAttentionDispositionPersistence,
} from "../../src/recall/attention/attentionDispositionPersistence";
import {
  applyAttentionDisposition,
} from "../../src/recall/attention/attentionDispositionService";

const item: RecallItemForAttention = {
  itemId: "item-1",
  novelId: "novel-1",
  candidateId: "candidate-1",
  evidenceFingerprint: "fingerprint-1",
  explanation: {
    reason: "validation evidence requires attention",
    evidenceReferences: ["ValidationRun:validation-1"],
  },
};

describe("[task:5.3-5.5] [domain] Attention disposition actions", () => {
  it("supports inspect, dismiss, snooze, confirm, ignore, and why without blocking", () => {
    const actions = ["inspect", "dismiss", "snooze", "confirm", "ignore", "why"] as const;
    let record: AttentionDispositionRecord | undefined;

    for (const action of actions) {
      const result = applyAttentionAction({
        item,
        current: record,
        action,
        actorId: "author-1",
        occurredAt: "2026-10-05T00:00:00.000Z",
        actionId: `${action}-1`,
        ...(action === "snooze" ? { snoozedUntil: "2026-10-06T00:00:00.000Z" } : {}),
      });
      record = result.record;
      expect(result.blocking).toBe(false);
      expect(result.record.lastAction).toBe(action);
    }

    expect(record?.state).toBe("why_requested");
    expect(record?.history).toHaveLength(6);
    expect(record?.history.map((event) => event.action)).toEqual(actions);
    expect(record?.history[2]?.snoozedUntil).toBe("2026-10-06T00:00:00.000Z");
  });
});

describe("[task:5.3-5.5] [concurrency] idempotent Attention disposition", () => {
  it("replays the same action without appending duplicate history", () => {
    const first = applyAttentionAction({
      item,
      current: undefined,
      action: "dismiss",
      actorId: "author-1",
      occurredAt: "2026-10-05T00:00:00.000Z",
      actionId: "dismiss-1",
    });
    const second = applyAttentionAction({
      item,
      current: first.record,
      action: "dismiss",
      actorId: "author-2",
      occurredAt: "2026-10-05T01:00:00.000Z",
      actionId: "dismiss-1",
    });

    expect(second.replayed).toBe(true);
    expect(second.record).toBe(first.record);
    expect(second.record.history).toHaveLength(1);
  });

  it("distinguishes duplicate command replay from a later same-kind action", () => {
    const first = applyAttentionAction({
      item,
      action: "inspect",
      actorId: "author-1",
      occurredAt: "2026-10-05T00:00:00.000Z",
      actionId: "inspect-1",
    });
    const duplicate = applyAttentionAction({
      item,
      current: first.record,
      action: "inspect",
      actorId: "author-1",
      occurredAt: "2026-10-05T00:00:00.000Z",
      actionId: "inspect-1",
    });
    const later = applyAttentionAction({
      item,
      current: duplicate.record,
      action: "inspect",
      actorId: "author-1",
      occurredAt: "2026-10-05T02:00:00.000Z",
      actionId: "inspect-2",
    });

    expect(duplicate.replayed).toBe(true);
    expect(duplicate.record.history).toHaveLength(1);
    expect(later.replayed).toBe(false);
    expect(later.record.history).toHaveLength(2);
  });
});

describe("[task:5.3-5.5] [recovery] Attention re-check", () => {
  it("keeps suppression for unchanged evidence and resurfaces changed evidence", () => {
    const dismissed = applyAttentionAction({
      item,
      action: "dismiss",
      actorId: "author-1",
      occurredAt: "2026-10-05T00:00:00.000Z",
      actionId: "dismiss-1",
    }).record;

    const unchanged = recheckAttentionItem({
      item,
      current: dismissed,
      occurredAt: "2026-10-05T01:00:00.000Z",
    });
    const changed = recheckAttentionItem({
      item: { ...item, evidenceFingerprint: "fingerprint-2" },
      current: dismissed,
      occurredAt: "2026-10-05T01:00:00.000Z",
    });

    expect(unchanged).toMatchObject({ changed: false, shouldSurface: false });
    expect(changed).toMatchObject({ changed: true, shouldSurface: true });
    expect(changed.record.state).toBe("active");
    expect(changed.record.evidenceFingerprint).toBe("fingerprint-2");
    expect(changed.record.history.at(-1)?.action).toBe("recheck");
  });

  it("resurfaces a snoozed item only after its snooze deadline", () => {
    const snoozed = applyAttentionAction({
      item,
      action: "snooze",
      actorId: "author-1",
      occurredAt: "2026-10-05T00:00:00.000Z",
      actionId: "snooze-1",
      snoozedUntil: "2026-10-06T00:00:00.000Z",
    }).record;

    expect(recheckAttentionItem({ item, current: snoozed, occurredAt: "2026-10-05T12:00:00.000Z" }).shouldSurface).toBe(false);
    expect(recheckAttentionItem({ item, current: snoozed, occurredAt: "2026-10-06T00:00:00.000Z" }).shouldSurface).toBe(true);
  });
});

describe("[task:5.3-5.5] [persistence] [transaction] Attention application service", () => {
  it("persists one atomic disposition and leaves unrelated state untouched", async () => {
    const persistence = createInMemoryAttentionDispositionPersistence();
    const result = await applyAttentionDisposition({
      persistence,
      item,
      action: "confirm",
      actorId: "author-1",
      occurredAt: "2026-10-05T00:00:00.000Z",
      actionId: "confirm-1",
    });

    expect(result.blocking).toBe(false);
    expect(result.record.state).toBe("confirmed");
    const saved = await persistence.dispositions.findById(item.itemId);
    expect(saved).toEqual(result.record);
  });

  it("rolls back a rejected disposition without changing the saved record", async () => {
    const persistence = createInMemoryAttentionDispositionPersistence();
    await applyAttentionDisposition({
      persistence,
      item,
      action: "confirm",
      actorId: "author-1",
      occurredAt: "2026-10-05T00:00:00.000Z",
      actionId: "confirm-1",
    });

    await expect(
      applyAttentionDisposition({
        persistence,
        item,
        action: "snooze",
        actorId: "author-1",
        occurredAt: "2026-10-05T00:00:00.000Z",
        actionId: "snooze-1",
      }),
    ).rejects.toThrow("snoozedUntil is required");
    expect((await persistence.dispositions.findById(item.itemId))?.state).toBe("confirmed");
  });
});
