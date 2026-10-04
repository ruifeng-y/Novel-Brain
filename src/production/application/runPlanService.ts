import { canonicalJson } from "../../shared/domain/contentHash";
import {
  approveRunPlanRevision,
  isValidRunPlanApproval,
  type RunPlanApproval,
  type RunPlanRevision,
} from "../domain/runPlan";
import { productionRunRevisionId, type ProductionRun } from "../domain/productionRun";
import type { RunOrchestrationPersistence } from "./runPlanPersistence";

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function conflict(message: string): Error {
  return new Error(message);
}

export async function saveRunPlanRevision(
  persistence: RunOrchestrationPersistence,
  revision: RunPlanRevision,
): Promise<RunPlanRevision> {
  return persistence.transaction.run(async (work) => {
    const existing = await work.planRevisions.findById(revision.id);
    if (existing) {
      if (!sameValue(existing, revision)) {
        throw conflict("Run Plan Revision already exists with different content");
      }
      return existing;
    }
    try {
      await work.planRevisions.saveIfAbsent(revision);
    } catch {
      const raced = await work.planRevisions.findById(revision.id);
      if (raced && sameValue(raced, revision)) return raced;
      throw conflict("Run Plan Revision already exists with different content");
    }
    return revision;
  });
}

export async function saveRunPlanApproval(
  persistence: RunOrchestrationPersistence,
  approval: RunPlanApproval,
): Promise<RunPlanApproval> {
  return persistence.transaction.run(async (work) => {
    if (!isValidRunPlanApproval(approval)) throw new Error("invalid Run Plan Approval");
    const revision = await work.planRevisions.findById(approval.planRevisionReference.version);
    if (!revision || !approveRunPlanRevision(approval, revision)) {
      throw new Error("Run Plan Approval does not match a persisted revision");
    }
    const existing = await work.planApprovals.findById(approval.id);
    if (existing) {
      if (!sameValue(existing, approval)) throw conflict("Run Plan Approval already exists");
      return existing;
    }
    try {
      await work.planApprovals.saveIfAbsent(approval);
    } catch {
      const raced = await work.planApprovals.findById(approval.id);
      if (raced && sameValue(raced, approval)) return raced;
      throw conflict("Run Plan Approval already exists");
    }
    return approval;
  });
}

export async function loadApprovedRunPlanRevision(
  persistence: RunOrchestrationPersistence,
  revisionId: string,
): Promise<RunPlanRevision> {
  return persistence.transaction.run(async (work) => {
    const revision = await work.planRevisions.findById(revisionId);
    if (!revision) throw new Error("Run Plan Revision not found");
    const approval = await work.planApprovals.findByRevisionId(revisionId, revision.novelId);
    if (!approval || !approveRunPlanRevision(approval, revision)) {
      throw new Error("Run Plan Revision is not approved");
    }
    return revision;
  });
}

export async function saveProductionRun(
  persistence: RunOrchestrationPersistence,
  run: ProductionRun,
  previous?: ProductionRun,
): Promise<ProductionRun> {
  return persistence.transaction.run(async (work) => {
    if (run.currentRevisionId !== productionRunRevisionId(run)) {
      throw conflict("Run revision already exists with different content");
    }
    const historical = await work.runs.getRevision(run.id, run.currentRevisionId);
    if (historical && !sameValue(historical, run)) {
      throw conflict("Run revision already exists with different content");
    }
    const current = await work.runs.findById(run.id);
    if (current?.currentRevisionId === run.currentRevisionId) {
      if (!sameValue(current, run)) throw conflict("Run revision already exists with different content");
      return current;
    }
    if (!current) {
      try {
        await work.runs.saveRevisionIfAbsent(run);
      } catch {
        const raced = await work.runs.getRevision(run.id, run.currentRevisionId);
        if (raced && sameValue(raced, run)) return raced;
        throw conflict("Run revision already exists with different content");
      }
      return run;
    }
    if (previous && !sameValue(previous, current)) {
      throw conflict("Production Run previous revision mismatch");
    }
    if (
      run.revisionNumber !== current.revisionNumber + 1 ||
      run.planRevisionReference.identity !== current.planRevisionReference.identity ||
      run.planRevisionReference.version !== current.planRevisionReference.version ||
      run.planRevisionReference.hash !== current.planRevisionReference.hash
    ) {
      throw conflict("Production Run transition is invalid");
    }
    try {
      await work.runs.saveRevisionIfAbsent(run);
      await work.runs.saveIfCurrent(current.currentRevisionId, run);
    } catch {
      const racedRevision = await work.runs.getRevision(run.id, run.currentRevisionId);
      const racedCurrent = await work.runs.findById(run.id);
      if (
        racedRevision &&
        racedCurrent &&
        sameValue(racedRevision, run) &&
        sameValue(racedCurrent, run)
      ) {
        return racedCurrent;
      }
      throw conflict("Run revision already exists with different content");
    }
    return run;
  });
}
