import { canonicalJson } from "../../shared/domain/contentHash";
import type { ObservationSource } from "../../shared/domain/observationSource";
import type { ValidationEvidence } from "../../production/domain/validationRun";
import type { VersionSet } from "../../shared/domain/versioning";
import {
  buildDependencyRegistryView,
  compareCodeUnits,
  type DependencyIdentity,
  type DependencyRegistryView,
  type DependencyRelationFact,
} from "../domain/dependencyRegistry";
import {
  assertImpactAnalysisResultIntegrity,
  computeImpactAnalysis,
  type ImpactAnalysisResult,
  type ImpactClassificationFact,
} from "../domain/impactAnalysis";
import type {
  DependencyImpactPersistence,
  DependencyRelationPort,
  ImpactAnalysisPort,
} from "./dependencyImpactPersistence";

export type DependencyImpactPersistenceErrorCode =
  | "relation_conflict"
  | "impact_result_conflict"
  | "layer3_ai_risk_not_persistent"
  | "evidence_integrity";

export class DependencyImpactPersistenceError extends Error {
  readonly code: DependencyImpactPersistenceErrorCode;
  readonly id: string;

  constructor(code: DependencyImpactPersistenceErrorCode, id: string, message: string) {
    super(message);
    this.name = "DependencyImpactPersistenceError";
    this.code = code;
    this.id = id;
  }
}

function isDuplicateRecordError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Record already exists:");
}

interface UniqueSavePort<T extends { readonly id: string }> {
  saveIfAbsent(entity: T): Promise<void>;
  findById(id: string): Promise<T | undefined>;
}

async function saveUniqueIfAbsent<T extends { readonly id: string }>(
  port: UniqueSavePort<T>,
  entity: T,
  code: DependencyImpactPersistenceErrorCode,
  label: string,
): Promise<T> {
  try {
    await port.saveIfAbsent(entity);
    return entity;
  } catch (error) {
    if (!isDuplicateRecordError(error)) throw error;
    const existing = await port.findById(entity.id);
    if (existing && canonicalJson(existing) === canonicalJson(entity)) return existing;
    throw new DependencyImpactPersistenceError(
      code,
      entity.id,
      `${label} identity conflict: ${entity.id}`,
    );
  }
}

export interface RecordDependencyRelationsInput {
  readonly relations: readonly DependencyRelationFact[];
}

export interface QueryDependencyRegistryInput {
  readonly subject: DependencyIdentity;
}

export interface AnalyzeImpactInput {
  readonly analysisId: string;
  readonly novelId: string;
  readonly subject: DependencyIdentity;
  readonly currentVersionSet: VersionSet;
  readonly evidenceSource: ObservationSource<ValidationEvidence>;
  readonly classificationFacts?: readonly ImpactClassificationFact[];
  readonly maxDepth: number;
  readonly computedAt: Date;
}

export class DependencyImpactApplicationService {
  constructor(private readonly persistence: DependencyImpactPersistence) {}

  async recordRelations(
    input: RecordDependencyRelationsInput,
  ): Promise<readonly DependencyRelationFact[]> {
    for (const relation of input.relations) {
      if (relation.sourceKind === "ai_suggested" && relation.lifecycle !== "confirmed") {
        throw new DependencyImpactPersistenceError(
          "layer3_ai_risk_not_persistent",
          relation.id,
          `AI Suggested relation is not a persistent dependency edge: ${relation.id}`,
        );
      }
    }
    return this.persistence.transaction.run(async (work) => {
      const saved: DependencyRelationFact[] = [];
      for (const relation of [...input.relations].sort((left, right) =>
        compareCodeUnits(left.id, right.id),
      )) {
        saved.push(
          await saveUniqueIfAbsent(
            work.relations,
            relation,
            "relation_conflict",
            "Dependency relation",
          ),
        );
      }
      return saved.sort((left, right) => compareCodeUnits(left.id, right.id));
    });
  }

  async queryDependencyRegistry(
    input: QueryDependencyRegistryInput,
  ): Promise<DependencyRegistryView> {
    const relations = await this.persistence.relations.listByNovel(input.subject.novelId);
    return buildDependencyRegistryView({ subject: input.subject, relations });
  }

  async recordImpactAnalysis(result: ImpactAnalysisResult): Promise<ImpactAnalysisResult> {
    try {
      assertImpactAnalysisResultIntegrity(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "impact result integrity";
      throw new DependencyImpactPersistenceError(
        message.includes("sourceReference") || message.includes("snapshot must match") || message.includes("classification fact")
          ? "evidence_integrity"
          : "impact_result_conflict",
        result.id,
        message,
      );
    }
    return saveUniqueIfAbsent(
      this.persistence.impactResults,
      result,
      "impact_result_conflict",
      "Impact analysis",
    );
  }
  async getImpactAnalysis(id: string): Promise<ImpactAnalysisResult | undefined> {
    return this.persistence.impactResults.findById(id);
  }

  async analyzeImpact(input: AnalyzeImpactInput): Promise<ImpactAnalysisResult> {
    return this.persistence.transaction.run(async (work) => {
      const relations = await work.relations.listByNovel(input.novelId);
      const evidenceSnapshot = await input.evidenceSource.snapshot();
      const result = computeImpactAnalysis({
        id: input.analysisId,
        novelId: input.novelId,
        subject: input.subject,
        relations,
        currentVersionSet: input.currentVersionSet,
        evidenceSnapshot,
        classificationFacts: input.classificationFacts,
        maxDepth: input.maxDepth,
        computedAt: input.computedAt,
      });
      return saveUniqueIfAbsent(
        work.impactResults,
        result,
        "impact_result_conflict",
        "Impact analysis",
      );
    });
  }
}
