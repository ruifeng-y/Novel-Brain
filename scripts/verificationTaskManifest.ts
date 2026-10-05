export type VerificationGate =
  | "domain"
  | "integration"
  | "persistence"
  | "transaction"
  | "concurrency"
  | "recovery"
  | "replay"
  | "cross-system"
  | "regression";

export const verificationGates: readonly VerificationGate[] = [
  "domain",
  "integration",
  "persistence",
  "transaction",
  "concurrency",
  "recovery",
  "replay",
  "cross-system",
  "regression",
];

export interface VerificationTaskProfile {
  readonly id: string;
  readonly label: string;
  readonly requiredGates: readonly VerificationGate[];
}

export const verificationTaskProfiles = {
  "1.3": {
    id: "1.3",
    label: "[task:1.3]",
    requiredGates: verificationGates,
  },
  "2.1": {
    id: "2.1",
    label: "[task:2.1]",
    requiredGates: verificationGates,
  },
  "2.2": {
    id: "2.2",
    label: "[task:2.2]",
    requiredGates: verificationGates,
  },
  "2.3": {
    id: "2.3",
    label: "[task:2.3]",
    requiredGates: verificationGates,
  },
  "2.3-H": {
    id: "2.3-H",
    label: "[task:2.3-H]",
    requiredGates: verificationGates,
  },
  "2.4": {
    id: "2.4",
    label: "[task:2.4]",
    requiredGates: verificationGates,
  },
  "3.1": {
    id: "3.1",
    label: "[task:3.1]",
    requiredGates: verificationGates,
  },
  "3.2": {
    id: "3.2",
    label: "[task:3.2]",
    requiredGates: verificationGates,
  },
  "3.3-3.4": {
    id: "3.3-3.4",
    label: "[task:3.3-3.4]",
    requiredGates: verificationGates,
  },
  "4.1-4.2": {
    id: "4.1-4.2",
    label: "[task:4.1-4.2]",
    requiredGates: verificationGates,
  },
  "4.3-4.4": {
    id: "4.3-4.4",
    label: "[task:4.3-4.4]",
    requiredGates: verificationGates,
  },
  "4.5-4.6": {
    id: "4.5-4.6",
    label: "[task:4.5-4.6]",
    requiredGates: verificationGates,
  },
  "5.1-5.2": {
    id: "5.1-5.2",
    label: "[task:5.1-5.2]",
    requiredGates: verificationGates,
  },
  "5.3-5.5": {
    id: "5.3-5.5",
    label: "[task:5.3-5.5]",
    requiredGates: verificationGates,
  },
  "6.1-6.5": {
    id: "6.1-6.5",
    label: "[task:6.1-6.5]",
    requiredGates: verificationGates,
  },
  "7.1-7.3": {
    id: "7.1-7.3",
    label: "[task:7.1-7.3]",
    requiredGates: verificationGates,
  },
  "P1.1": {
    id: "P1.1",
    label: "[task:P1.1]",
    requiredGates: [
      "domain",
      "integration",
      "persistence",
      "transaction",
      "concurrency",
      "cross-system",
      "regression",
    ],
  },
  "P1.2": {
    id: "P1.2",
    label: "[task:P1.2]",
    requiredGates: [
      "domain",
      "integration",
      "persistence",
      "transaction",
      "concurrency",
      "recovery",
      "cross-system",
      "regression",
    ],
  },
  "P1.3": {
    id: "P1.3",
    label: "[task:P1.3]",
    requiredGates: [
      "domain",
      "integration",
      "persistence",
      "transaction",
      "concurrency",
      "recovery",
      "replay",
      "cross-system",
      "regression",
    ],
  },
  "P2.1": {
    id: "P2.1",
    label: "[task:P2.1]",
    requiredGates: [
      "domain",
      "integration",
      "cross-system",
      "regression",
    ],
  },
  "P2.2": {
    id: "P2.2",
    label: "[task:P2.2]",
    requiredGates: [
      "domain",
      "integration",
      "concurrency",
      "cross-system",
      "regression",
    ],
  },
  "P2.3": {
    id: "P2.3",
    label: "[task:P2.3]",
    requiredGates: [
      "domain",
      "integration",
      "cross-system",
      "regression",
    ],
  },
  "P3.1": {
    id: "P3.1",
    label: "[task:P3.1]",
    requiredGates: [
      "domain",
      "integration",
      "concurrency",
      "cross-system",
      "regression",
    ],
  },
  "P3.2": {
    id: "P3.2",
    label: "[task:P3.2]",
    requiredGates: verificationGates,
  },
  "7.4-7.5": {
    id: "7.4-7.5",
    label: "[task:7.4-7.5]",
    requiredGates: verificationGates,
  },
} as const satisfies Record<string, VerificationTaskProfile>;

export function getVerificationTaskProfile(taskId: string): VerificationTaskProfile {
  const profile = verificationTaskProfiles[
    taskId as keyof typeof verificationTaskProfiles
  ];
  if (!profile) throw new Error(`unknown verification task profile: ${taskId}`);
  return profile;
}
