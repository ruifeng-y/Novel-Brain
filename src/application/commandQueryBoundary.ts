export const applicationCapabilities = [
  "generation",
  "validation",
  "approval",
  "commit",
  "run",
  "recall",
  "foundation",
  "manuscript",
  "workspace",
] as const;

export type ApplicationCapability = (typeof applicationCapabilities)[number];
export type ApplicationBoundaryKind = "command" | "query";
export type ApplicationResultChannel = "command-result" | "query-result";

export interface ApplicationCommandContract {
  readonly id: string;
  readonly capability: ApplicationCapability;
  readonly kind: "command";
  readonly effect: "mutation";
  readonly resultChannel: "command-result";
}

export interface ApplicationQueryContract {
  readonly id: string;
  readonly capability: ApplicationCapability;
  readonly kind: "query";
  readonly effect: "read";
  readonly resultChannel: "query-result";
}

export type ApplicationBoundaryContract =
  | ApplicationCommandContract
  | ApplicationQueryContract;

export interface ApplicationCapabilityBoundary {
  readonly capability: ApplicationCapability;
  readonly commands: readonly ApplicationCommandContract[];
  readonly queries: readonly ApplicationQueryContract[];
}

export const applicationCapabilityBoundaries = {
  generation: {
    capability: "generation",
    commands: [
      {
        id: "generation.command.create-generation-task",
        capability: "generation",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "generation.command.start-generation-task",
        capability: "generation",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "generation.command.submit-generation-candidate",
        capability: "generation",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
    ],
    queries: [
      {
        id: "generation.query.generation-task-status",
        capability: "generation",
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
      },
      {
        id: "generation.query.generation-candidate",
        capability: "generation",
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
      },
    ],
  },
  validation: {
    capability: "validation",
    commands: [
      {
        id: "validation.command.validate-candidate",
        capability: "validation",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
    ],
    queries: [
      {
        id: "validation.query.validation-outcome",
        capability: "validation",
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
      },
      {
        id: "validation.query.validation-evidence",
        capability: "validation",
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
      },
    ],
  },
  approval: {
    capability: "approval",
    commands: [
      {
        id: "approval.command.record-review-decision",
        capability: "approval",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
    ],
    queries: [
      {
        id: "approval.query.approval-evidence",
        capability: "approval",
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
      },
    ],
  },
  commit: {
    capability: "commit",
    commands: [
      {
        id: "commit.command.commit-change-set-revision",
        capability: "commit",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "commit.command.rollback-scene",
        capability: "commit",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
    ],
    queries: [
      {
        id: "commit.query.commit-evidence",
        capability: "commit",
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
      },
    ],
  },
  run: {
    capability: "run",
    commands: [
      {
        id: "run.command.create-run-plan-revision",
        capability: "run",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "run.command.approve-run-plan",
        capability: "run",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "run.command.start-run",
        capability: "run",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "run.command.pause-run",
        capability: "run",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "run.command.resume-run",
        capability: "run",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "run.command.cancel-run",
        capability: "run",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "run.command.retry-attempt",
        capability: "run",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "run.command.fallback-attempt",
        capability: "run",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "run.command.record-checkpoint-decision",
        capability: "run",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
    ],
    queries: [
      {
        id: "run.query.run-status",
        capability: "run",
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
      },
      {
        id: "run.query.run-audit",
        capability: "run",
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
      },
    ],
  },
  recall: {
    capability: "recall",
    commands: [
      {
        id: "recall.command.record-recall-disposition",
        capability: "recall",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "recall.command.request-proposed-action",
        capability: "recall",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
    ],
    queries: [
      {
        id: "recall.query.recall-attention",
        capability: "recall",
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
      },
    ],
  },
  foundation: {
    capability: "foundation",
    commands: [
      {
        id: "foundation.command.enter-foundation-idea",
        capability: "foundation",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "foundation.command.extract-foundation-text",
        capability: "foundation",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "foundation.command.create-blank-foundation",
        capability: "foundation",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "foundation.command.create-proposal",
        capability: "foundation",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "foundation.command.revise-proposal",
        capability: "foundation",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "foundation.command.adopt-proposal-content",
        capability: "foundation",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
    ],
    queries: [
      {
        id: "foundation.query.workspace-focus",
        capability: "foundation",
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
      },
      {
        id: "foundation.query.proposal-comparison",
        capability: "foundation",
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
      },
    ],
  },
  manuscript: {
    capability: "manuscript",
    commands: [
      {
        id: "manuscript.command.create-arc",
        capability: "manuscript",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "manuscript.command.create-chapter",
        capability: "manuscript",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
      {
        id: "manuscript.command.reorder-structure",
        capability: "manuscript",
        kind: "command",
        effect: "mutation",
        resultChannel: "command-result",
      },
    ],
    queries: [
      {
        id: "manuscript.query.structural-navigation",
        capability: "manuscript",
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
      },
    ],
  },
  workspace: {
    capability: "workspace",
    commands: [],
    queries: [
      {
        id: "workspace.query.focus-resolution",
        capability: "workspace",
        kind: "query",
        effect: "read",
        resultChannel: "query-result",
      },
    ],
  },
} as const satisfies Record<ApplicationCapability, ApplicationCapabilityBoundary>;

export const applicationBoundaryContracts: readonly ApplicationBoundaryContract[] =
  Object.freeze(
    Object.values(applicationCapabilityBoundaries).flatMap(boundary => [
      ...boundary.commands,
      ...boundary.queries,
    ]),
  );

export function getApplicationBoundaryContract(
  id: string,
  kind: ApplicationBoundaryKind,
): ApplicationBoundaryContract {
  const contract = applicationBoundaryContracts.find(candidate => candidate.id === id);
  if (!contract) throw new Error(`unknown application boundary contract: ${id}`);
  if (contract.kind !== kind) {
    throw new Error(`application boundary contract ${id} is not a ${kind}`);
  }
  return contract;
}
