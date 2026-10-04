import {
  applyAttentionAction,
  type AttentionActionInput,
  type AttentionActionResult,
} from "./attentionDisposition";
import type { AttentionDispositionPersistence } from "./attentionDispositionPersistence";

export type AttentionDispositionServiceInput = Omit<AttentionActionInput, "current"> & {
  readonly persistence: AttentionDispositionPersistence;
};

export async function applyAttentionDisposition(
  input: AttentionDispositionServiceInput,
): Promise<AttentionActionResult> {
  const { persistence, ...actionInput } = input;
  return persistence.transaction.run(async (work) => {
    const current = await work.dispositions.findById(actionInput.item.itemId);
    const result = applyAttentionAction({ ...actionInput, current });
    if (!result.replayed) {
      if (current === undefined) {
        await work.dispositions.saveRevisionIfAbsent(result.record);
      } else {
        await work.dispositions.saveIfCurrent(current.currentRevisionId, result.record);
      }
    }
    return result;
  });
}
