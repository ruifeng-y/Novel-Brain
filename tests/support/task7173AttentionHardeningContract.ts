import { describe, expect, it } from "vitest";
import {
  applyAttentionAction,
  type AttentionActionInput,
} from "../../src/recall/attention/attentionDisposition";
import { applyAttentionDisposition } from "../../src/recall/attention/attentionDispositionService";
import type { AttentionDispositionPersistence } from "../../src/recall/attention/attentionDispositionPersistence";
import type { RecallItemForAttention } from "../../src/recall/attention/attentionDisposition";
import { describeVerificationGate } from "./capabilityVerificationContract";

function item(suffix: string): RecallItemForAttention {
  return {
    itemId: `item-7173-${suffix}`,
    novelId: "novel-7173",
    candidateId: `candidate-7173-${suffix}`,
    evidenceFingerprint: `fingerprint-7173-${suffix}`,
    explanation: {
      reason: "Evidence needs author attention",
      evidenceReferences: [`ValidationRun:evidence-7173-${suffix}`],
    },
  };
}

function command(
  input: Pick<AttentionActionInput, "item" | "action" | "actionId"> &
    Partial<Pick<AttentionActionInput, "occurredAt">>,
): AttentionActionInput {
  return {
    actorId: "author-7173",
    occurredAt: "2026-10-05T07:00:00.000Z",
    ...input,
  };
}

export function runTask7173AttentionHardeningContract(
  adapterName: string,
  createPersistence: () => AttentionDispositionPersistence,
): void {
  describe(`${adapterName} [task:7.1-7.3] attention persistence hardening`, () => {
    describeVerificationGate("domain", "rejects actionId reuse with changed command semantics", () => {
      const first = command({
        item: item("identity"),
        action: "inspect",
        actionId: "attention-command-identity",
      });
      const current = applyAttentionAction(first).record;

      expect(() =>
        applyAttentionAction({
          ...first,
          current,
          action: "confirm",
        }),
      ).toThrow(/action identity conflict/);
    });

    describeVerificationGate("regression", "rejects actionId replay across different evidence fingerprints", () => {
      const first = command({
        item: item("evidence-a"),
        action: "inspect",
        actionId: "attention-command-evidence",
      });
      const current = applyAttentionAction(first).record;
      const changedEvidence = {
        ...first,
        item: {
          ...first.item,
          evidenceFingerprint: "fingerprint-7173-evidence-b",
        },
      };

      expect(() =>
        applyAttentionAction({ ...changedEvidence, current }),
      ).toThrow(/evidence fingerprint conflict/);
    });

    describeVerificationGate("concurrency", "replays identical evidence-bound actionId despite actor/time retry", async () => {
      const persistence = createPersistence();
      const input = command({
        item: item("evidence-idempotency"),
        action: "inspect",
        actionId: "attention-command-evidence-idempotency",
      });
      const first = await applyAttentionDisposition({ ...input, persistence });
      const replay = await applyAttentionDisposition({
        ...input,
        persistence,
        actorId: "author-retry",
        occurredAt: "2026-10-05T07:00:09.000Z",
      });

      expect(replay.replayed).toBe(true);
      expect(replay.record).toEqual(first.record);
      expect(replay.record.history).toHaveLength(1);
    });

    describeVerificationGate("integration", "round-trips the same command identity and evidence binding", async () => {
      const persistence = createPersistence();
      const input = command({
        item: item("round-trip"),
        action: "inspect",
        actionId: "attention-command-round-trip",
      });
      const saved = await applyAttentionDisposition({ ...input, persistence });

      expect(await persistence.dispositions.findById(input.item.itemId)).toEqual(saved.record);
      expect(saved.record.evidenceFingerprint).toBe(input.item.evidenceFingerprint);
      expect(saved.record.history.map(({ eventId }) => eventId)).toEqual([
        saved.record.history[0]!.eventId,
      ]);
    });

    describeVerificationGate("persistence", "persists immutable disposition history", async () => {
      const persistence = createPersistence();
      const base = command({
        item: item("history"),
        action: "inspect",
        actionId: "attention-command-history-1",
      });
      const first = await applyAttentionDisposition({ ...base, persistence });
      const second = await applyAttentionDisposition({
        ...base,
        persistence,
        action: "confirm",
        actionId: "attention-command-history-2",
      });

      expect(second.record.history).toHaveLength(2);
      expect(await persistence.dispositions.findById(base.item.itemId)).toEqual(second.record);
      expect(
        await persistence.dispositions.getRevision(
          base.item.itemId,
          first.record.currentRevisionId,
        ),
      ).toEqual(first.record);
    });

    describeVerificationGate("transaction", "rolls back only a failed nested disposition savepoint", async () => {
      const persistence = createPersistence();
      const base = command({
        item: item("savepoint"),
        action: "inspect",
        actionId: "attention-command-savepoint-1",
      });

      await persistence.transaction.run(async (outer) => {
        const first = applyAttentionAction(base);
        await outer.dispositions.saveRevisionIfAbsent(first.record);
        const next = applyAttentionAction({
          ...base,
          current: first.record,
          action: "confirm",
          actionId: "attention-command-savepoint-2",
        });

        await expect(
          persistence.transaction.run(async (nested) => {
            await nested.dispositions.saveRevisionIfAbsent(next.record);
            throw new Error("attention savepoint rollback");
          }),
        ).rejects.toThrow("attention savepoint rollback");

        expect((await outer.dispositions.findById(base.item.itemId))?.currentRevisionId).toBe(
          first.record.currentRevisionId,
        );
        expect(
          await outer.dispositions.getRevision(
            base.item.itemId,
            next.record.currentRevisionId,
          ),
        ).toBeUndefined();
      });
    });

    describeVerificationGate("concurrency", "reserves one deterministic identity for concurrent identical commands", async () => {
      const persistence = createPersistence();
      const input = command({
        item: item("concurrent"),
        action: "inspect",
        actionId: "attention-command-concurrent",
      });
      const outcomes = await Promise.all(
        Array.from({ length: 8 }, () => applyAttentionDisposition({ ...input, persistence })),
      );

      expect(new Set(outcomes.map((outcome) => outcome.record.currentRevisionId)).size).toBe(1);
      expect(outcomes.filter((outcome) => outcome.replayed)).toHaveLength(7);
      expect(
        (await persistence.dispositions.findById(input.item.itemId))?.history,
      ).toHaveLength(1);
    });

    describeVerificationGate("recovery", "keeps the reservation winner after a conflicting command fails", async () => {
      const persistence = createPersistence();
      const base = item("recovery");
      const winnerInput = command({
        item: base,
        action: "inspect",
        actionId: "attention-command-recovery",
      });
      const conflictingInput = command({
        item: base,
        action: "confirm",
        actionId: "attention-command-recovery",
        occurredAt: "2026-10-05T07:00:01.000Z",
      });

      const outcomes = await Promise.allSettled([
        applyAttentionDisposition({ ...winnerInput, persistence }),
        applyAttentionDisposition({ ...conflictingInput, persistence }),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);

      const winner = outcomes.find((outcome) => outcome.status === "fulfilled") as
        PromiseFulfilledResult<Awaited<ReturnType<typeof applyAttentionDisposition>>>;
      const winnerEvent = winner.value.record.history[0]!;
      if (winnerEvent.action === "recheck") throw new Error("unexpected recheck winner");
      const replay = await applyAttentionDisposition({
        item: base,
        persistence,
        action: winnerEvent.action,
        actionId: winnerEvent.actionId!,
        actorId: winnerEvent.actorId,
        occurredAt: winnerEvent.occurredAt,
        ...(winnerEvent.snoozedUntil === undefined
          ? {}
          : { snoozedUntil: winnerEvent.snoozedUntil }),
      });
      expect(replay.replayed).toBe(true);
      expect(replay.record).toEqual(winner.value.record);
      expect(replay.record.history).toHaveLength(1);
    });

    describeVerificationGate("replay", "replays an existing command without duplicate evidence", async () => {
      const persistence = createPersistence();
      const input = command({
        item: item("replay"),
        action: "snooze",
        actionId: "attention-command-replay",
        occurredAt: "2026-10-05T07:00:00.000Z",
      });
      (input as { snoozedUntil?: string }).snoozedUntil = "2026-10-05T08:00:00.000Z";

      const first = await applyAttentionDisposition({ ...input, persistence });
      const replay = await applyAttentionDisposition({ ...input, persistence });

      expect(replay.replayed).toBe(true);
      expect(replay.record).toEqual(first.record);
      expect(replay.record.history).toHaveLength(1);
    });

    describeVerificationGate("cross-system", "keeps Recall identity scoped to the observed item and evidence", async () => {
      const persistence = createPersistence();
      const observed = item("cross-system");
      const saved = await applyAttentionDisposition({
        ...command({
          item: observed,
          action: "why",
          actionId: "attention-command-cross-system",
        }),
        persistence,
      });

      expect(saved.record).toMatchObject({
        id: observed.itemId,
        novelId: observed.novelId,
        itemId: observed.itemId,
        candidateId: observed.candidateId,
        evidenceFingerprint: observed.evidenceFingerprint,
      });
    });

    describeVerificationGate("regression", "appends each distinct command identity exactly once", async () => {
      const persistence = createPersistence();
      const observed = item("regression");
      await applyAttentionDisposition({
        ...command({
          item: observed,
          action: "inspect",
          actionId: "attention-command-regression-1",
        }),
        persistence,
      });
      const confirmed = await applyAttentionDisposition({
        ...command({
          item: observed,
          action: "confirm",
          actionId: "attention-command-regression-2",
        }),
        persistence,
      });
      const replay = await applyAttentionDisposition({
        ...command({
          item: observed,
          action: "confirm",
          actionId: "attention-command-regression-2",
        }),
        persistence,
      });

      expect(replay.record).toEqual(confirmed.record);
      expect(replay.record.history.map(({ action }) => action)).toEqual(["inspect", "confirm"]);
      expect(replay.record.history.map(({ actionId }) => actionId)).toEqual([
        "attention-command-regression-1",
        "attention-command-regression-2",
      ]);
    });
  });
}
