import type { Scene } from "../../manuscript/domain/scene";
import type { CanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../narrative/state/domain/stateRecord";
import type { DomainEvent } from "../../safety/domain/domainEvent";
import type { VersionSet } from "../../shared/domain/versioning";
import { deepFreeze } from "../../shared/domain/immutable";
import { hashContent } from "../../shared/domain/contentHash";

const SCENE_SUMMARY_MAX_CHARS = 160;

export interface SceneMemory {
  readonly revisionId: string;
  readonly summary: string;
  readonly sourceLength: number;
  readonly sourceHash: string;
}

export interface MemoryProjection {
  readonly novelId: string;
  readonly sourceRevisionSet: Readonly<Record<string, string>>;
  readonly scenes: Readonly<Record<string, SceneMemory>>;
}

export interface MemorySources {
  readonly canonicalFacts?: readonly CanonicalFact[];
  readonly stateRecords?: readonly StateRecord[];
}

function summarizeSceneText(text: string): string {
  if (text.length <= SCENE_SUMMARY_MAX_CHARS) return text;
  return `${text.slice(0, SCENE_SUMMARY_MAX_CHARS - 16).trimEnd()}...`;
}

function sourceKey(aggregateType: "Scene" | "CanonicalFact" | "StateRecord", objectId: string): string {
  return `${aggregateType}:${objectId}`;
}

export function rebuildMemoryProjection(
  events: readonly DomainEvent[],
  scenes: readonly Scene[],
  sources: MemorySources = {},
): MemoryProjection {
  if (scenes.length === 0) throw new Error("At least one scene is required");
  const novelId = scenes[0]?.novelId;
  if (!novelId) throw new Error("At least one scene is required");
  if (scenes.some((scene) => scene.novelId !== novelId)) {
    throw new Error("Memory projection cannot span novels");
  }

  const sceneMemories: Record<string, SceneMemory> = {};
  const sourceRevisionSet: Record<string, string> = {};
  const sceneCommitEvents = events.filter(
    (event) => event.name === "SceneCommitted" && event.context === "manuscript",
  );
  const committedSceneRevisions = new Set(
    sceneCommitEvents.map((event) => `${event.objectId}:${event.revisionId}`),
  );
  const hasSceneCommitEvents = sceneCommitEvents.length > 0;

  for (const scene of scenes) {
    sourceRevisionSet[sourceKey("Scene", scene.id)] = scene.currentRevisionId;
    if (
      hasSceneCommitEvents &&
      !committedSceneRevisions.has(`${scene.id}:${scene.currentRevisionId}`)
    ) {
      continue;
    }
    sceneMemories[scene.id] = {
      revisionId: scene.currentRevisionId,
      summary: summarizeSceneText(scene.text),
      sourceLength: scene.text.length,
      sourceHash: hashContent(scene.text),
    };
  }

  for (const fact of sources.canonicalFacts ?? []) {
    sourceRevisionSet[sourceKey("CanonicalFact", fact.id)] = fact.currentRevisionId;
  }
  for (const record of sources.stateRecords ?? []) {
    sourceRevisionSet[sourceKey("StateRecord", record.id)] = record.currentRevisionId;
  }
  for (const event of events) {
    if (event.name === "CanonicalFactChanged") {
      sourceRevisionSet[sourceKey("CanonicalFact", event.objectId)] = event.revisionId;
    }
    if (
      event.name === "CharacterStateChanged" ||
      event.name === "WorldStateChanged" ||
      event.name === "PlotStateChanged"
    ) {
      sourceRevisionSet[sourceKey("StateRecord", event.objectId)] = event.revisionId;
    }
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
      projection.sourceRevisionSet[
        sourceKey(reference.aggregateType as "Scene" | "CanonicalFact" | "StateRecord", reference.objectId)
      ] !== reference.revisionId
    );
  });
}
