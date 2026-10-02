import type { Scene } from "../../manuscript/domain/scene";
import type { CanonicalFact } from "../../narrative/canon/domain/canonicalFact";
import type { StateRecord } from "../../narrative/state/domain/stateRecord";
import type { MemoryProjection } from "../projections/memoryProjection";

export interface GenerationContext {
  readonly sceneId: string;
  readonly sceneText: string;
  readonly canonicalFacts: readonly CanonicalFact[];
  readonly stateRecords: readonly StateRecord[];
  readonly memory: MemoryProjection;
  readonly taskIntent: string;
}

export function assembleContext(input: {
  scene: Scene;
  canonicalFacts: readonly CanonicalFact[];
  stateRecords: readonly StateRecord[];
  memory: MemoryProjection;
  requiredFactIds: readonly string[];
  requiredStateIds: readonly string[];
  taskIntent: string;
}): GenerationContext {
  if (!input.taskIntent.trim()) throw new Error("taskIntent is required");
  if (input.memory.novelId !== input.scene.novelId) {
    throw new Error("Memory projection does not match scene novel");
  }

  const canonicalFacts = input.canonicalFacts.filter((fact) =>
    input.requiredFactIds.includes(fact.id),
  );
  const stateRecords = input.stateRecords.filter((record) =>
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

  return Object.freeze({
    sceneId: input.scene.id,
    sceneText: input.scene.text,
    canonicalFacts: Object.freeze([...canonicalFacts]),
    stateRecords: Object.freeze([...stateRecords]),
    memory: input.memory,
    taskIntent: input.taskIntent.trim(),
  });
}
