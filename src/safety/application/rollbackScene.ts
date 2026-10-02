import type { Scene } from "../../manuscript/domain/scene";
import { commitSceneText } from "../../manuscript/domain/scene";
import type { RevisionedRepository } from "../../shared/application/repository";
import type { EventStore } from "../infrastructure/eventStore";
import { createSceneCommittedEvent } from "../../manuscript/domain/manuscriptEvents";

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
  try {
    await input.eventStore.appendMany([
      createSceneCommittedEvent({
        eventId: `event:${input.input.rollbackId}:${restored.id}`,
        novelId: restored.novelId,
        objectId: restored.id,
        revisionId: restoredRevisionId,
        commitId: input.input.rollbackId,
        payload: { rollback: true, reason: input.input.reason.trim() },
        occurredAt: input.input.now,
      }),
    ]);
  } catch (error) {
    await input.scenes.save(current);
    throw error;
  }

  return Object.freeze({ scene: restored, restoredRevisionId });
}
