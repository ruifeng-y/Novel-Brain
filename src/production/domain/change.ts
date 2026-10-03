import { deepFreeze } from "../../shared/domain/immutable";
import type { DomainId } from "../../shared/domain/ids";
import type { VersionSet } from "../../shared/domain/versioning";

export type ChangeSourceType =
  | "proposal_adoption"
  | "candidate"
  | "author_edit"
  | "conflict_resolution";

export interface ChangeSourceReference {
  readonly identity: DomainId;
  readonly version: string;
  readonly hash: string;
}

export type TargetType =
  | "canonical_fact"
  | "plan"
  | "structure"
  | "manuscript"
  | "story_state";

export interface TargetAddress {
  readonly targetType: TargetType;
  readonly objectId: DomainId;
  readonly subAddress?: string;
}

export type ChangePayload = Readonly<Record<string, unknown>>;

export interface Change {
  readonly id: DomainId;
  readonly sourceType: ChangeSourceType;
  readonly sourceReference: ChangeSourceReference;
  readonly targetAddress: TargetAddress;
  readonly payload: ChangePayload;
  readonly basedOnVersionSet: VersionSet;
}

export function createChange(input: {
  id: DomainId;
  sourceType: ChangeSourceType;
  sourceReference: ChangeSourceReference;
  targetAddress: TargetAddress;
  payload: ChangePayload;
  basedOnVersionSet: VersionSet;
}): Change {
  if (!input.id) throw new Error("id is required");
  if (!input.sourceReference) throw new Error("sourceReference is required");
  if (!input.sourceReference.identity) throw new Error("sourceReference.identity is required");
  if (!input.sourceReference.version) throw new Error("sourceReference.version is required");
  if (!input.sourceReference.hash) throw new Error("sourceReference.hash is required");
  if (!input.targetAddress) throw new Error("targetAddress is required");
  if (!input.targetAddress.objectId) throw new Error("targetAddress.objectId is required");
  if (input.targetAddress.objectId.includes("#")) {
    throw new Error("targetAddress.objectId must not contain '#'");
  }
  if (input.targetAddress.subAddress?.includes("#")) {
    throw new Error("targetAddress.subAddress must not contain '#'");
  }
  if (Object.keys(input.basedOnVersionSet).length === 0) {
    throw new Error("basedOnVersionSet must contain at least one dependency");
  }

  return Object.freeze({
    id: input.id,
    sourceType: input.sourceType,
    sourceReference: deepFreeze({ ...input.sourceReference }),
    targetAddress: deepFreeze({ ...input.targetAddress }),
    payload: deepFreeze({ ...input.payload }),
    basedOnVersionSet: input.basedOnVersionSet,
  });
}

export function targetAddressKey(address: TargetAddress): string {
  const base = `${address.targetType}:${address.objectId}`;
  return address.subAddress ? `${base}#${address.subAddress}` : base;
}

export function assertNoDuplicateTargets(changes: readonly Change[]): void {
  const seen = new Set<string>();
  for (const change of changes) {
    const key = targetAddressKey(change.targetAddress);
    if (seen.has(key)) {
      throw new Error(`Duplicate target address in change set revision: ${key}`);
    }
    seen.add(key);
  }
}
