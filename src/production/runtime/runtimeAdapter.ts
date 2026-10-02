import type { CandidateChange } from "../domain/candidate";
import type { VersionSet } from "../../shared/domain/versioning";

export type AgentRole = "planner" | "writer" | "editor" | "reviewer" | "consistency_agent" | "memory_agent";

export interface ModelPolicy {
  readonly provider: string;
  readonly model: string;
  readonly maxOutputTokens: number;
}

export interface RuntimeRequest {
  readonly taskId: string;
  readonly agentRole: AgentRole;
  readonly modelPolicy: ModelPolicy;
  readonly context: Readonly<Record<string, unknown>>;
  readonly requestedChange: CandidateChange;
}

export interface RuntimeResult {
  readonly taskId: string;
  readonly agentRole: AgentRole;
  readonly modelPolicy: ModelPolicy;
  readonly change: CandidateChange;
  readonly basedOnVersionSet: VersionSet;
}

export interface RuntimeAdapter {
  execute(request: RuntimeRequest): Promise<RuntimeResult>;
}
