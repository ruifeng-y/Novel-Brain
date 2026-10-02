import type { Scene } from "../../manuscript/domain/scene";
import type { DomainEvent } from "../../safety/domain/domainEvent";
import type { VersionSet } from "../../shared/domain/versioning";
import { deepFreeze } from "../../shared/domain/immutable";

export interface SceneMemory {
  readonly revisionId: string;
  readonly summary: string;
}

export interface MemoryProjection {
  readonly novelId: string;
  readonly sourceRevisionSet: Readonly<Record<string, string>>;
  readonly scenes: Readonly<Record<string, SceneMemory>>;
}

export function rebuildMemoryProjection(
  events: readonly DomainEvent[],
  scenes: readonly Scene[],
): MemoryProjection {
  if (scenes.length === 0) throw new Error("At least one scene is required");
  const novelId = scenes[0]?.novelId;
  if (!novelId) throw new Error("At least one scene is required");
  if (scenes.some((scene) => scene.novelId !== novelId)) {
    throw new Error("Memory projection cannot span novels");
  }

  const sceneMemories: Record<string, SceneMemory> = {};
  const sourceRevisionSet: Record<string, string> = {};
  const committedSceneIds = new Set(
    events
      .filter((event) => event.name === "SceneCommitted" && event.context === "manuscript")
      .map((event) => event.objectId),
  );

  for (const scene of scenes) {
    sourceRevisionSet[scene.id] = scene.currentRevisionId;
    if (committedSceneIds.size > 0 && !committedSceneIds.has(scene.id)) continue;
    sceneMemories[scene.id] = {
      revisionId: scene.currentRevisionId,
      summary: scene.text,
    };
  }

  return deepFreeze({
    novelId,
    sourceRevisionSet,
    scenes: sceneMemories,
  });
}

export function isMemoryProjectionStale(
  projection: MemoryProjection,
  versionSet: VersionSet,
): boolean {
  return Object.values(versionSet).some(reference => {
    return (
      reference.aggregateType === "Scene" &&
      projection.sourceRevisionSet[reference.objectId] !== reference.revisionId
    );
  });
}
