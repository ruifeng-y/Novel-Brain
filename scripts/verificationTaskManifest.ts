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
} as const satisfies Record<string, VerificationTaskProfile>;

export function getVerificationTaskProfile(taskId: string): VerificationTaskProfile {
  const profile = verificationTaskProfiles[
    taskId as keyof typeof verificationTaskProfiles
  ];
  if (!profile) throw new Error(`unknown verification task profile: ${taskId}`);
  return profile;
}
