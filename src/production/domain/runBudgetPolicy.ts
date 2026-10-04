import { deepFreeze } from "../../shared/domain/immutable";
import type { ReviewDecision } from "./reviewDecision";
import {
  cancelProductionRun,
  pauseProductionRun,
  waitForHumanProductionRun,
  type ProductionRun,
} from "./productionRun";
import {
  pauseRunCheckpoint,
  type CheckpointControl,
  type RunCheckpoint,
} from "./runCheckpoint";

export type BudgetScope = "run" | "task" | "attempt";
export type BudgetMetric = "attempts" | "cost" | "tokens" | "durationMilliseconds";
export type BudgetThresholdAction = "pause" | "checkpoint" | "ask" | "abort";

export interface BudgetLimitSet {
  readonly attempts?: number;
  readonly cost?: number;
  readonly tokens?: number;
  readonly durationMilliseconds?: number;
}

export interface BudgetThresholdRule {
  readonly id: string;
  readonly scope: BudgetScope;
  readonly metric: BudgetMetric;
  readonly atPercent: number;
  readonly action: BudgetThresholdAction;
}

export interface RunBudgetPolicy {
  readonly id: string;
  readonly version: string;
  readonly limits: Readonly<Record<BudgetScope, BudgetLimitSet>>;
  readonly thresholds: readonly BudgetThresholdRule[];
}

export interface BudgetScopeUsage {
  readonly scope: BudgetScope;
  readonly subjectId: string;
  readonly used: BudgetLimitSet;
}

export interface RunBudgetUsage {
  readonly run: BudgetScopeUsage;
  readonly task: BudgetScopeUsage;
  readonly attempt: BudgetScopeUsage;
}

export interface BudgetThresholdEvaluation {
  readonly action?: BudgetThresholdAction;
  readonly withinBudget: boolean;
  readonly triggered: readonly BudgetThresholdRule[];
}

export type RunPolicyProvenance = Pick<
  ReviewDecision,
  "decidedBy" | "actorId" | "reason" | "policyVersion" | "decisionRule" | "evidenceReferences"
>;

export interface BudgetThresholdActionDecision {
  readonly id: string;
  readonly runId: string;
  readonly action: BudgetThresholdAction;
  readonly thresholdId: string;
  readonly reason: string;
  readonly provenance: RunPolicyProvenance;
  readonly decidedAt: Date;
}

export interface BudgetThresholdActionResult {
  readonly run: ProductionRun;
  readonly checkpoint?: RunCheckpoint;
}

const actionSeverity: Readonly<Record<BudgetThresholdAction, number>> = {
  pause: 1,
  checkpoint: 2,
  ask: 3,
  abort: 4,
};

const scopeOrder: Readonly<Record<BudgetScope, number>> = {
  run: 1,
  task: 2,
  attempt: 3,
};

function requiredText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function requirePositive(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`${name} must be positive`);
  }
}

function normalizeUsage(value: BudgetScopeUsage): BudgetScopeUsage {
  requiredText(value.subjectId, `${value.scope} usage subjectId`);
  for (const metric of ["attempts", "cost", "tokens", "durationMilliseconds"] as const) {
    requirePositive(value.used[metric], `${value.scope}.${metric}`);
  }
  return deepFreeze({
    scope: value.scope,
    subjectId: value.subjectId.trim(),
    used: deepFreeze({ ...value.used }),
  });
}

export function runPolicyProvenanceFromReviewDecision(
  decision: ReviewDecision,
): RunPolicyProvenance {
  return deepFreeze({
    decidedBy: decision.decidedBy,
    actorId: decision.actorId,
    reason: decision.reason,
    policyVersion: decision.policyVersion,
    decisionRule: decision.decisionRule,
    evidenceReferences: Object.freeze([...decision.evidenceReferences]),
  });
}

export function createBudgetThresholdActionDecision(input: {
  readonly id: string;
  readonly runId: string;
  readonly action: BudgetThresholdAction;
  readonly thresholdId: string;
  readonly reason: string;
  readonly provenance: RunPolicyProvenance;
  readonly decidedAt: Date;
}): BudgetThresholdActionDecision {
  const id = requiredText(input.id, "id");
  const runId = requiredText(input.runId, "runId");
  const thresholdId = requiredText(input.thresholdId, "thresholdId");
  const reason = requiredText(input.reason, "reason");
  if (!(input.action in actionSeverity)) throw new Error("action is invalid");
  const actorId = requiredText(input.provenance.actorId, "provenance.actorId");
  if (input.provenance.decidedBy === "policy") {
    requiredText(input.provenance.policyVersion ?? "", "policyVersion is required for policy provenance");
    requiredText(input.provenance.decisionRule ?? "", "decisionRule is required for policy provenance");
  }
  if (Number.isNaN(input.decidedAt.getTime())) throw new Error("decidedAt must be a valid Date");
  return deepFreeze({
    id,
    runId,
    action: input.action,
    thresholdId,
    reason,
    provenance: deepFreeze({
      decidedBy: input.provenance.decidedBy,
      actorId,
      reason: input.provenance.reason,
      policyVersion: input.provenance.policyVersion,
      decisionRule: input.provenance.decisionRule,
      evidenceReferences: Object.freeze([...input.provenance.evidenceReferences]),
    }),
    decidedAt: new Date(input.decidedAt.getTime()),
  });
}

export function evaluateRunBudgetPolicy(input: {
  readonly policy: RunBudgetPolicy;
  readonly usage: RunBudgetUsage;
}): BudgetThresholdEvaluation {
  requiredText(input.policy.id, "policy.id");
  requiredText(input.policy.version, "policy.version");
  for (const scope of ["run", "task", "attempt"] as const) {
    const limits = input.policy.limits[scope];
    for (const metric of ["attempts", "cost", "tokens", "durationMilliseconds"] as const) {
      requirePositive(limits[metric], `limits.${scope}.${metric}`);
    }
  }
  const usages: readonly BudgetScopeUsage[] = [
    normalizeUsage(input.usage.run),
    normalizeUsage(input.usage.task),
    normalizeUsage(input.usage.attempt),
  ];
  const usageByScope = new Map(usages.map(usage => [usage.scope, usage]));
  const seenThresholds = new Set<string>();
  const triggered: BudgetThresholdRule[] = [];

  for (const rule of input.policy.thresholds) {
    requiredText(rule.id, "threshold.id");
    if (seenThresholds.has(rule.id)) throw new Error(`duplicate threshold id: ${rule.id}`);
    seenThresholds.add(rule.id);
    if (!(rule.scope in input.policy.limits)) throw new Error("threshold.scope is invalid");
    if (!(rule.metric in input.policy.limits[rule.scope])) throw new Error("threshold.metric is invalid");
    if (!(rule.action in actionSeverity)) throw new Error("threshold.action is invalid");
    if (!Number.isFinite(rule.atPercent) || rule.atPercent <= 0) {
      throw new Error("threshold.atPercent must be positive");
    }

    const usage = usageByScope.get(rule.scope);
    const limit = input.policy.limits[rule.scope][rule.metric];
    const used = usage?.used[rule.metric];
    if (limit !== undefined && used !== undefined && used / limit * 100 >= rule.atPercent) {
      triggered.push(rule);
    }
  }

  for (const usage of usages) {
    for (const metric of ["attempts", "cost", "tokens", "durationMilliseconds"] as const) {
      const limit = input.policy.limits[usage.scope][metric];
      const used = usage.used[metric];
      if (limit !== undefined && used !== undefined && used > limit) {
        const hasTrigger = triggered.some(
          rule => rule.scope === usage.scope && rule.metric === metric,
        );
        if (!hasTrigger) {
          triggered.push({
            id: `implicit-limit:${usage.scope}:${metric}`,
            scope: usage.scope,
            metric,
            atPercent: 100,
            action: "abort",
          });
        }
      }
    }
  }

  triggered.sort((left, right) => {
    const actionDifference = actionSeverity[right.action] - actionSeverity[left.action];
    return actionDifference !== 0
      ? actionDifference
      : scopeOrder[right.scope] - scopeOrder[left.scope];
  });
  return deepFreeze({
    action: triggered[0]?.action,
    withinBudget: triggered.length === 0,
    triggered: deepFreeze([...triggered]),
  });
}

function checkpointControl(provenance: RunPolicyProvenance): CheckpointControl {
  if (provenance.decidedBy === "human") {
    return { kind: "human", actorId: provenance.actorId };
  }
  return {
    kind: "policy",
    actorId: provenance.actorId,
    policyVersion: provenance.policyVersion ?? "",
    policyRule: provenance.decisionRule ?? "",
  };
}

export function applyBudgetThresholdAction(input: {
  readonly run: ProductionRun;
  readonly decision: BudgetThresholdActionDecision;
  readonly occurredAt: Date;
  readonly checkpointId?: string;
}): BudgetThresholdActionResult {
  if (input.decision.runId !== input.run.id) {
    throw new Error("Budget decision runId must match Production Run");
  }
  if (input.occurredAt < input.decision.decidedAt) {
    throw new Error("occurredAt cannot move backward");
  }
  if (input.decision.action === "pause") {
    return {
      run: pauseProductionRun(input.run, input.occurredAt, input.decision.reason),
    };
  }
  if (input.decision.action === "checkpoint") {
    const checkpointId = requiredText(input.checkpointId ?? "", "checkpointId");
    const run = pauseProductionRun(input.run, input.occurredAt, input.decision.reason);
    const checkpoint = pauseRunCheckpoint({
      id: checkpointId,
      runId: run.id,
      novelId: run.novelId,
      triggerCategory: "budget",
      triggerReason: input.decision.reason,
      control: checkpointControl(input.decision.provenance),
      evidenceReferences: input.decision.provenance.evidenceReferences,
      pausedAt: input.occurredAt,
    });
    return { run, checkpoint };
  }
  if (input.decision.action === "ask") {
    return {
      run: waitForHumanProductionRun(input.run, input.occurredAt, input.decision.reason),
    };
  }
  return {
    run: cancelProductionRun(input.run, input.occurredAt, input.decision.reason),
  };
}
