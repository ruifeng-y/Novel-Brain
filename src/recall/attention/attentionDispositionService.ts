import {
  applyAttentionAction,
  type AttentionActionInput,
  type AttentionActionResult,
} from "./attentionDisposition";
import type {
  AttentionDispositionPersistence,
  AttentionDispositionWork,
} from "./attentionDispositionPersistence";

export type AttentionDispositionServiceInput = Omit<AttentionActionInput, "current"> & {
  readonly persistence: AttentionDispositionPersistence;
};

async function replayRacedAction(
  work: AttentionDispositionWork,
  actionInput: Omit<AttentionActionInput, "current">,
): Promise<AttentionActionResult | undefined> {
  const raced = await work.dispositions.findById(actionInput.item.itemId);
  if (!raced) return undefined;
  const replay = applyAttentionAction({ ...actionInput, current: raced });
  return replay.replayed ? replay : undefined;
}

export async function applyAttentionDisposition(
  input: AttentionDispositionServiceInput,
): Promise<AttentionActionResult> {
  const { persistence, ...actionInput } = input;
  return persistence.transaction.run(async (work) => {
    const current = await work.dispositions.findById(actionInput.item.itemId);
    const result = applyAttentionAction({ ...actionInput, current });
    if (result.replayed) return result;

    try {
      if (current === undefined) {
        await work.dispositions.saveRevisionIfAbsent(result.record);
      } else {
        await work.dispositions.saveIfCurrent(current.currentRevisionId, result.record);
      }
    } catch (error) {
      const replayed = await replayRacedAction(work, actionInput);
      if (replayed) return replayed;
      throw error;
    }
    return result;
  });
}
