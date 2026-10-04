import type { ProductionRun } from "../../production/domain/productionRun";
import type {
  NormalRunPolicyRequest,
  RunPolicyRequestPort,
  RunPolicyRequestReceipt,
} from "../run/runAwareRecall";

export interface NormalRunPolicyEffects {
  readonly taskIds: readonly string[];
  readonly commitIds: readonly string[];
}

export interface NormalRunPolicyRequestPort extends RunPolicyRequestPort {
  readonly effects: NormalRunPolicyEffects;
}

export interface NormalRunPolicyPortInput {
  readonly run: ProductionRun;
  readonly policyVersion: string;
  readonly allowProposedGenerationTask: boolean;
}

function receipt(
  request: NormalRunPolicyRequest,
  status: RunPolicyRequestReceipt["status"],
): RunPolicyRequestReceipt {
  return { requestId: request.requestId, status };
}

export function createNormalRunPolicyRequestPort(
  input: NormalRunPolicyPortInput,
): NormalRunPolicyRequestPort {
  if (!input.policyVersion.trim()) throw new Error("policyVersion is required");
  const effects: NormalRunPolicyEffects = Object.freeze({
    taskIds: Object.freeze([]),
    commitIds: Object.freeze([]),
  });
  return Object.freeze({
    effects,
    requestNormalRunPolicy(request: NormalRunPolicyRequest): RunPolicyRequestReceipt {
      if (request.kind !== "normal_run_policy") {
        throw new Error("Run policy accepts only normal Run policy requests");
      }
      if (request.runId !== input.run.id) {
        throw new Error("Run policy request must target the observed Production Run");
      }
      if (input.run.status === "completed" || input.run.status === "failed" || input.run.status === "cancelled") {
        return receipt(request, "rejected");
      }
      if (request.requestType === "generation_task") {
        return receipt(request, input.allowProposedGenerationTask ? "queued" : "rejected");
      }
      return receipt(request, "accepted");
    },
  });
}
