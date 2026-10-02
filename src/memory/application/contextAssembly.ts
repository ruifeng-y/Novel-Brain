import type { Scene } from "../../manuscript/domain/scene";
import type { CanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../narrative/state/domain/stateRecord";
import type { MemoryProjection } from "../projections/memoryProjection";
import { deepFreeze } from "../../shared/domain/immutable";

export interface GenerationContext {
  readonly sceneId: string;
  readonly sceneText: string;
  readonly canonicalFacts: readonly CanonicalFact[];
  readonly stateRecords: readonly StateRecord[];
  readonly memory: MemoryProjection;
  readonly taskIntent: string;
  readonly maxCharacters: number;
  readonly selectedCharacterCount: number;
  readonly overflowed: boolean;
  readonly omittedFactIds: readonly string[];
  readonly omittedStateIds: readonly string[];
}

export function assembleContext(input: {
  scene: Scene;
  canonicalFacts: readonly CanonicalFact[];
  stateRecords: readonly StateRecord[];
  memory: MemoryProjection;
  requiredFactIds: readonly string[];
  requiredStateIds: readonly string[];
  taskIntent: string;
  maxCharacters: number;
}): GenerationContext {
  if (!input.taskIntent.trim()) throw new Error("taskIntent is required");
  if (!Number.isInteger(input.maxCharacters) || input.maxCharacters <= 0) {
    throw new Error("maxCharacters must be a positive integer");
  }
  if (input.memory.novelId !== input.scene.novelId) {
    throw new Error("Memory projection does not match scene novel");
  }

  const canonicalFacts = input.canonicalFacts.filter(
    (fact) => fact.novelId === input.scene.novelId && input.requiredFactIds.includes(fact.id),
  );
  const stateRecords = input.stateRecords.filter(
    (record) =>
      record.novelId === input.scene.novelId &&
      record.position.sceneId === input.scene.id &&
      input.requiredStateIds.includes(record.id),
  );

  for (const factId of input.requiredFactIds) {
    if (!canonicalFacts.some((fact) => fact.id === factId)) {
      throw new Error(`Required canonical fact not found: ${factId}`);
    }
  }
  for (const stateId of input.requiredStateIds) {
    if (!stateRecords.some((record) => record.id === stateId)) {
      throw new Error(`Required state record not found: ${stateId}`);
    }
  }

  const sceneCost = input.scene.text.length;
  if (sceneCost > input.maxCharacters) {
    throw new Error("Context budget exceeded by scene text");
  }

  type ContextEntry = {
    readonly kind: "fact" | "state" | "memory";
    readonly id: string;
    readonly cost: number;
    readonly priority: number;
  };
  const entries: ContextEntry[] = [
    ...canonicalFacts.map((fact, index) => ({
      kind: "fact" as const,
      id: fact.id,
      cost: JSON.stringify(fact).length + 16,
      priority: index,
    })),
    ...stateRecords.map((record, index) => ({
      kind: "state" as const,
      id: record.id,
      cost: JSON.stringify(record).length + 16,
      priority: index,
    })),
    ...Object.entries(input.memory.scenes).map(([sceneId, memory], index) => ({
      kind: "memory" as const,
      id: sceneId,
      cost: memory.summary.length + sceneId.length + 16,
      priority: index,
    })),
  ].sort((left, right) => {
    const kindOrder = { fact: 0, state: 1, memory: 2 } as const;
    return kindOrder[left.kind] - kindOrder[right.kind] || left.priority - right.priority || left.id.localeCompare(right.id);
  });

  let selectedCharacterCount = sceneCost;
  const selectedFactIds = new Set<string>();
  const selectedStateIds = new Set<string>();
  const selectedMemorySceneIds = new Set<string>();
  for (const entry of entries) {
    if (selectedCharacterCount + entry.cost > input.maxCharacters) continue;
    selectedCharacterCount += entry.cost;
    if (entry.kind === "fact") selectedFactIds.add(entry.id);
    if (entry.kind === "state") selectedStateIds.add(entry.id);
    if (entry.kind === "memory") selectedMemorySceneIds.add(entry.id);
  }

  const omittedFactIds = input.requiredFactIds.filter((id) => !selectedFactIds.has(id));
  const omittedStateIds = input.requiredStateIds.filter((id) => !selectedStateIds.has(id));
  const selectedMemory: MemoryProjection = deepFreeze({
    novelId: input.memory.novelId,
    sourceRevisionSet: Object.fromEntries(
      Object.entries(input.memory.sourceRevisionSet).filter(([key]) => {
        const [aggregateType, objectId] = key.split(":");
        return (
          (aggregateType === "Scene" && selectedMemorySceneIds.has(objectId ?? "")) ||
          (aggregateType === "CanonicalFact" && selectedFactIds.has(objectId ?? "")) ||
          (aggregateType === "StateRecord" && selectedStateIds.has(objectId ?? ""))
        );
      }),
    ),
    scenes: Object.fromEntries(
      Object.entries(input.memory.scenes).filter(([sceneId]) =>
        selectedMemorySceneIds.has(sceneId),
      ),
    ),
  });

  return deepFreeze({
    sceneId: input.scene.id,
    sceneText: input.scene.text,
    canonicalFacts: canonicalFacts.filter((fact) => selectedFactIds.has(fact.id)),
    stateRecords: stateRecords.filter((record) => selectedStateIds.has(record.id)),
    memory: selectedMemory,
    taskIntent: input.taskIntent.trim(),
    maxCharacters: input.maxCharacters,
    selectedCharacterCount,
    overflowed: entries.some((entry) => {
      if (entry.kind === "fact") return !selectedFactIds.has(entry.id);
      if (entry.kind === "state") return !selectedStateIds.has(entry.id);
      return !selectedMemorySceneIds.has(entry.id);
    }),
    omittedFactIds,
    omittedStateIds,
  });
}
