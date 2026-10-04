import {
  cancelProductionRun as cancelRun,
  pauseProductionRun as pauseRun,
  resumeProductionRun as resumeRun,
  type ProductionRun,
} from "../domain/productionRun";
import type { RunOrchestrationPersistence } from "./runPlanPersistence";
import { saveProductionRun as persistProductionRun } from "./runPlanService";

async function transition(
  persistence: RunOrchestrationPersistence,
  runId: string,
  change: (run: ProductionRun) => ProductionRun,
): Promise<ProductionRun> {
  const current = await persistence.runs.findById(runId);
  if (!current) throw new Error("Production Run not found");
  return persistProductionRun(persistence, change(current), current);
}

export function pauseProductionRun(
  persistence: RunOrchestrationPersistence,
  runId: string,
  pausedAt: Date,
  reason: string,
): Promise<ProductionRun> {
  return transition(persistence, runId, (run) => pauseRun(run, pausedAt, reason));
}

export function resumeProductionRun(
  persistence: RunOrchestrationPersistence,
  runId: string,
  resumedAt: Date,
): Promise<ProductionRun> {
  return transition(persistence, runId, (run) => resumeRun(run, resumedAt));
}

export function cancelProductionRun(
  persistence: RunOrchestrationPersistence,
  runId: string,
  cancelledAt: Date,
  reason: string,
): Promise<ProductionRun> {
  return transition(persistence, runId, (run) => cancelRun(run, cancelledAt, reason));
}
