/**
 * Focus resolution policy.
 *
 * Focus = Object + Mode. Object and Mode compatibility is policy-governed; not
 * every object supports every mode. Per Spec §3.2 an incompatible requested
 * Mode resolves to the object's default Mode rather than failing.
 *
 * The Spec gives exactly one default Mode per object and states only two
 * multi-mode facts: a Scene under Write is an editor and under Analyze is a
 * dependency / impact view, and Target Span defaults to Write or Review. No
 * further compatibility pairs are invented.
 */

import {
  getObjectEntryContract,
  isWorkspaceObjectKind,
  type WorkspaceMode,
  type WorkspaceObjectKind,
} from "./objectEntryContract";

export type FocusResolution =
  | { readonly resolved: true; readonly kind: WorkspaceObjectKind; readonly mode: WorkspaceMode }
  | { readonly resolved: false; readonly reason: string };

const SUPPORTED_MODE_OVERRIDES: Readonly<
  Partial<Record<WorkspaceObjectKind, readonly WorkspaceMode[]>>
> = Object.freeze({
  scene: Object.freeze<WorkspaceMode[]>(["write", "analyze"]),
  "target-span": Object.freeze<WorkspaceMode[]>(["write", "review"]),
});

function supportedModes(kind: WorkspaceObjectKind): readonly WorkspaceMode[] {
  return SUPPORTED_MODE_OVERRIDES[kind] ?? [getObjectEntryContract(kind).defaultMode];
}

/**
 * True when the object kind can be worked on in the given mode. An unknown
 * kind supports nothing.
 */
export function modeIsCompatible(kind: WorkspaceObjectKind, mode: WorkspaceMode): boolean {
  if (!isWorkspaceObjectKind(kind)) {
    return false;
  }
  return supportedModes(kind).includes(mode);
}

/**
 * Resolves an object and an optional requested Mode into a Focus. An unknown
 * kind is unresolvable; an incompatible Mode falls back to the object default.
 */
export function resolveFocus(input: {
  readonly kind: WorkspaceObjectKind;
  readonly requestedMode?: WorkspaceMode;
}): FocusResolution {
  if (!isWorkspaceObjectKind(input.kind)) {
    return {
      resolved: false,
      reason: `unknown workspace object kind: ${String(input.kind)}`,
    };
  }

  const contract = getObjectEntryContract(input.kind);
  const mode =
    input.requestedMode !== undefined && modeIsCompatible(input.kind, input.requestedMode)
      ? input.requestedMode
      : contract.defaultMode;

  return { resolved: true, kind: input.kind, mode };
}
