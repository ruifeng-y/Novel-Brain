import { canonicalJson, hashContent } from "../domain/contentHash";

export type CanonicalPersistenceCapability =
  | "core"
  | "story"
  | "production-run"
  | "recall"
  | "dependency";

export type CanonicalPersistenceRole =
  | "canonical-state"
  | "versioned-snapshot"
  | "event-audit"
  | "idempotency-reservation"
  | "projection";

export type CanonicalPersistenceConsistency =
  | "revisioned-cas"
  | "immutable-revision"
  | "unique-reservation"
  | "append-only"
  | "derived";

export type CanonicalTransactionMember =
  | "canonical-state-mutation"
  | "narrative-commit-transition"
  | "required-event-audit-evidence"
  | "idempotency-reservation";

export interface CanonicalPersistenceMappingEntry {
  readonly capability: CanonicalPersistenceCapability;
  /** Logical frozen Domain contract; intentionally not a table, DTO, or field list. */
  readonly contract: string;
  readonly roles: readonly CanonicalPersistenceRole[];
  readonly consistency: CanonicalPersistenceConsistency;
  readonly transactionMembership: "authoritative" | "derived";
}

export interface CanonicalPersistenceMappingContract {
  readonly source: "frozen-domain-contracts";
  readonly authoritativeTransactionMembers: readonly CanonicalTransactionMember[];
  readonly projectionSuccessCriterion: "excluded";
  readonly entries: readonly CanonicalPersistenceMappingEntry[];
}

export interface CanonicalPersistenceValueMapping<TValue, TPersisted> {
  encode(value: TValue): TPersisted;
  decode(value: TPersisted): TValue;
}

export interface IdempotencyReservation {
  readonly key: string;
  readonly fingerprint: string;
}

export const canonicalPersistenceCapabilities: readonly CanonicalPersistenceCapability[] =
  Object.freeze([
    "core",
    "story",
    "production-run",
    "recall",
    "dependency",
  ]);

export const canonicalCommitAuthoritativeTransactionMembers: readonly CanonicalTransactionMember[] =
  Object.freeze([
    "canonical-state-mutation",
    "narrative-commit-transition",
    "required-event-audit-evidence",
    "idempotency-reservation",
  ]);

function entry(
  capability: CanonicalPersistenceCapability,
  contract: string,
  roles: readonly CanonicalPersistenceRole[],
  consistency: CanonicalPersistenceConsistency,
  transactionMembership: "authoritative" | "derived" = "authoritative",
): CanonicalPersistenceMappingEntry {
  return Object.freeze({
    capability,
    contract,
    roles: Object.freeze([...roles]),
    consistency,
    transactionMembership,
  });
}

export const canonicalPersistenceMappingContract: CanonicalPersistenceMappingContract =
  Object.freeze({
    source: "frozen-domain-contracts",
    authoritativeTransactionMembers: canonicalCommitAuthoritativeTransactionMembers,
    projectionSuccessCriterion: "excluded",
    entries: Object.freeze([
      entry("core", "novel", ["canonical-state", "idempotency-reservation"], "unique-reservation"),
      entry("core", "generation-task", ["canonical-state", "idempotency-reservation"], "unique-reservation"),
      entry("core", "candidate", ["canonical-state", "versioned-snapshot"], "revisioned-cas"),
      entry("core", "scene", ["canonical-state", "versioned-snapshot"], "revisioned-cas"),
      entry("core", "canonical-fact", ["canonical-state", "versioned-snapshot"], "revisioned-cas"),
      entry("core", "state-record", ["canonical-state", "versioned-snapshot"], "revisioned-cas"),
      entry("core", "change-set-revision", ["canonical-state", "versioned-snapshot"], "revisioned-cas"),
      entry("core", "validation-run", ["canonical-state", "versioned-snapshot"], "revisioned-cas"),
      entry("core", "review-decision", ["canonical-state", "versioned-snapshot"], "revisioned-cas"),
      entry("core", "narrative-commit", ["canonical-state", "idempotency-reservation"], "unique-reservation"),
      entry("core", "domain-event", ["event-audit", "idempotency-reservation"], "append-only"),

      entry("story", "narrative-proposal", ["canonical-state", "versioned-snapshot", "idempotency-reservation"], "immutable-revision"),
      entry("story", "adoption-decision", ["canonical-state", "idempotency-reservation"], "unique-reservation"),

      entry("production-run", "run-plan-revision", ["canonical-state", "versioned-snapshot", "idempotency-reservation"], "unique-reservation"),
      entry("production-run", "run-plan-approval", ["canonical-state", "idempotency-reservation"], "unique-reservation"),
      entry("production-run", "production-run", ["canonical-state", "versioned-snapshot"], "revisioned-cas"),
      entry("production-run", "execution-attempt", ["canonical-state", "versioned-snapshot"], "revisioned-cas"),
      entry("production-run", "run-checkpoint", ["canonical-state", "versioned-snapshot"], "revisioned-cas"),
      entry("production-run", "run-compensation-record", ["idempotency-reservation"], "unique-reservation"),

      entry("recall", "attention-disposition", ["canonical-state", "versioned-snapshot"], "revisioned-cas"),
      entry("recall", "recall-item-projection", ["projection"], "derived", "derived"),
      entry("recall", "memory-context-projection", ["projection"], "derived", "derived"),

      entry("dependency", "dependency-relation-fact", ["canonical-state", "idempotency-reservation"], "unique-reservation"),
      entry("dependency", "dependency-registry-view", ["projection"], "derived", "derived"),
      entry("dependency", "impact-analysis-result", ["projection", "idempotency-reservation"], "derived", "derived"),
    ]),
  });

const forbiddenMetadataKeys = new Set([
  "schema",
  "dto",
  "api",
  "fields",
  "columns",
  "table",
  "tables",
]);

function assertNoSchemaMetadata(entry: CanonicalPersistenceMappingEntry): void {
  for (const key of Object.keys(entry)) {
    if (forbiddenMetadataKeys.has(key)) {
      throw new Error(`schema/field metadata is not allowed: ${entry.contract}.${key}`);
    }
  }
}

function assertRoleConsistency(entry: CanonicalPersistenceMappingEntry): void {
  const roles = new Set(entry.roles);
  if (roles.has("projection") && entry.transactionMembership === "authoritative") {
    throw new Error(
      `projection cannot participate in canonical success: ${entry.contract}`,
    );
  }
  if (entry.transactionMembership === "derived" && !roles.has("projection")) {
    throw new Error(`derived mapping must be a projection: ${entry.contract}`);
  }
  if (roles.has("event-audit") && entry.consistency !== "append-only") {
    throw new Error(`event-audit mapping must be append-only: ${entry.contract}`);
  }
  if (
    roles.has("versioned-snapshot") &&
    !["revisioned-cas", "immutable-revision", "unique-reservation"].includes(
      entry.consistency,
    )
  ) {
    throw new Error(`versioned snapshot has invalid consistency: ${entry.contract}`);
  }
  if (
    roles.has("idempotency-reservation") &&
    !["unique-reservation", "immutable-revision", "append-only", "derived"].includes(
      entry.consistency,
    )
  ) {
    throw new Error(`idempotency reservation has invalid consistency: ${entry.contract}`);
  }
  if (
    entry.transactionMembership === "authoritative" &&
    !["canonical-state", "versioned-snapshot", "event-audit", "idempotency-reservation"].some(
      (role) => roles.has(role as CanonicalPersistenceRole),
    )
  ) {
    throw new Error(`authoritative mapping lacks canonical evidence: ${entry.contract}`);
  }
}

export function validateCanonicalPersistenceMappingContract(
  contract: CanonicalPersistenceMappingContract,
): void {
  if (contract.source !== "frozen-domain-contracts") {
    throw new Error("canonical persistence mapping must follow frozen Domain contracts");
  }
  if (contract.projectionSuccessCriterion !== "excluded") {
    throw new Error("projection cannot participate in canonical success");
  }
  if (
    contract.authoritativeTransactionMembers.length !==
      canonicalCommitAuthoritativeTransactionMembers.length ||
    contract.authoritativeTransactionMembers.some(
      (member, index) => member !== canonicalCommitAuthoritativeTransactionMembers[index],
    )
  ) {
    throw new Error("canonical commit authoritative transaction members are inconsistent");
  }

  const covered = new Set<CanonicalPersistenceCapability>();
  for (const mappingEntry of contract.entries) {
    assertNoSchemaMetadata(mappingEntry);
    assertRoleConsistency(mappingEntry);
    covered.add(mappingEntry.capability);
  }
  for (const capability of canonicalPersistenceCapabilities) {
    if (!covered.has(capability)) {
      throw new Error(`canonical persistence mapping is missing capability: ${capability}`);
    }
  }
}

export function roundTripCanonicalState<TValue, TPersisted>(
  mapping: CanonicalPersistenceValueMapping<TValue, TPersisted>,
  value: TValue,
): TValue {
  return mapping.decode(mapping.encode(value));
}

export function roundTripVersionedSnapshot<TValue, TPersisted>(
  mapping: CanonicalPersistenceValueMapping<TValue, TPersisted>,
  value: TValue,
): TValue {
  return mapping.decode(mapping.encode(value));
}

export function roundTripEventAudit<TValue, TPersisted>(
  mapping: CanonicalPersistenceValueMapping<TValue, TPersisted>,
  value: TValue,
): TValue {
  return mapping.decode(mapping.encode(value));
}

export function mapIdempotencyReservation<TRequest>(
  key: string,
  request: TRequest,
): IdempotencyReservation {
  const normalizedKey = key.trim();
  if (!normalizedKey) throw new Error("idempotency reservation key is required");
  return Object.freeze({
    key: normalizedKey,
    fingerprint: hashContent(canonicalJson(request)),
  });
}
