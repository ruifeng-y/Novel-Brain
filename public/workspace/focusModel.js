/**
 * Workspace session model.
 *
 * Session state only: what the author is looking at, in which Lens, with which
 * pinned references, at which zoom. It never owns canonical truth and never
 * mutates narrative state, Dependency facts, or a generation context.
 *
 * The client holds no object entry policy. The default Mode, surface, panels,
 * and Lens for a Focus arrive from the server resolution. This module holds
 * only the session vocabulary the shell needs to render the Lens Rail
 * (Spec 3.3) and the semantic zoom ordering (Spec 4.4).
 *
 * The Lens is a session-level property (Spec 3.3). A Focus Stack entry carries
 * only what navigation needs to restore: the focus identity and its Mode.
 * Zoom is stored per Focus (Spec 4.4), so returning to a Focus restores it.
 */

export const WORKSPACE_LENSES = [
  "structure",
  "semantic",
  "temporal",
  "thread",
  "impact",
  "process",
];

/** Spec 4.4 semantic zoom: Novel -> Arc -> Chapter -> Scene -> Target Span. */
export const WORKSPACE_ZOOM_LEVELS = ["novel", "arc", "chapter", "scene", "target-span"];

/**
 * Containment depth. A deeper object is contained by a shallower one, so
 * drilling in pushes the Focus Stack and a lateral move replaces the top.
 */
const FOCUS_DEPTH = {
  novel: 0,
  process: 0,
  "story-foundation": 1,
  "world-character-plot": 1,
  arc: 1,
  proposal: 1,
  candidate: 1,
  "change-set-revision": 1,
  commit: 1,
  analysis: 1,
  chapter: 2,
  scene: 3,
  "target-span": 4,
};

const FOCUS_STACK_LIMIT = 32;

function keyOf(reference) {
  const id = typeof reference.id === "string" ? reference.id : "";
  return id.length === 0 ? reference.kind : `${reference.kind}:${id}`;
}

function depthOf(kind) {
  const depth = FOCUS_DEPTH[kind];
  return typeof depth === "number" ? depth : 0;
}

function withChanges(state, changes) {
  return Object.assign({}, state, changes);
}

export function createSessionState(workspaceId) {
  return {
    workspaceId: typeof workspaceId === "string" ? workspaceId : "",
    focusStack: [],
    pinned: [],
    zoomByFocus: {},
    lens: null,
    resolution: null,
  };
}

export function currentFocus(state) {
  if (state.focusStack.length === 0) return null;
  return state.focusStack[state.focusStack.length - 1];
}

/** The session Lens. Navigation never reads or writes a per-focus Lens. */
export function currentLens(state) {
  return WORKSPACE_LENSES.indexOf(state.lens) >= 0 ? state.lens : null;
}

/**
 * Initialises the session Lens from the Object Entry Contract the first time a
 * Focus resolves in a session. It never overrides a Lens the author chose, so
 * navigation can never pull the Lens back to an object default.
 */
export function initialiseLens(state, lens) {
  if (WORKSPACE_LENSES.indexOf(lens) < 0) return state;
  if (currentLens(state) !== null) return state;
  return withChanges(state, { lens: lens });
}

export function applyResolution(state, resolution) {
  return withChanges(state, { resolution: resolution || null });
}

/**
 * Moves to a resolved target: push or replace is the navigation policy. A
 * drill-down into a deeper object pushes onto the Focus Stack; a lateral move
 * within the same or a shallower depth replaces its top. The Mode and default
 * Lens of the new entry come from the server resolution.
 */
export function navigate(state, target) {
  if (target === null || typeof target !== "object" || typeof target.kind !== "string") {
    return state;
  }
  if (target.kind.length === 0) return state;

  const entry = {
    key: keyOf(target),
    kind: target.kind,
    id: typeof target.id === "string" ? target.id : "",
    mode: typeof target.mode === "string" ? target.mode : null,
    depth: depthOf(target.kind),
  };

  const current = currentFocus(state);
  const drilledIn = current === null || (current.key !== entry.key && entry.depth > current.depth);
  const nextStack = drilledIn
    ? state.focusStack.concat([entry])
    : state.focusStack.slice(0, -1).concat([entry]);
  const bounded =
    nextStack.length > FOCUS_STACK_LIMIT
      ? nextStack.slice(nextStack.length - FOCUS_STACK_LIMIT)
      : nextStack;

  return withChanges(state, { focusStack: bounded });
}

/** Back restores the previous Focus with its Mode, Lens, and zoom intact. */
export function goBack(state) {
  if (state.focusStack.length <= 1) return state;
  return withChanges(state, { focusStack: state.focusStack.slice(0, -1) });
}

/** Jumps to a breadcrumb, dropping the entries the author navigated past. */
export function focusToIndex(state, index) {
  if (!Number.isInteger(index)) return state;
  if (index < 0 || index >= state.focusStack.length) return state;
  return withChanges(state, { focusStack: state.focusStack.slice(0, index + 1) });
}

/**
 * Changes the session Lens while preserving the current focus, its Mode, and
 * the pinned context. A Lens never changes narrative state and never mutates a
 * generation context. When the current focus cannot be represented under the
 * new Lens the shell asks the server for the nearest valid containing or
 * related focus; it never returns the author to a home view and it never rolls
 * the Lens back.
 */
export function setLens(state, lens) {
  if (WORKSPACE_LENSES.indexOf(lens) < 0) return state;
  // Session-level only: the focus stack, the current focus, its Mode, and the
  // pinned context are all untouched.
  return withChanges(state, { lens: lens });
}

/**
 * Toggles a pinned reference. Pinned context is a Workspace preference: it
 * survives navigation and informs derivation, and it never directly changes
 * Narrative State, Dependency facts, or a generation context.
 */
export function pin(state, reference) {
  if (reference === null || typeof reference !== "object") return state;
  if (typeof reference.kind !== "string" || reference.kind.length === 0) return state;

  const key = keyOf(reference);
  const alreadyPinned = state.pinned.some(item => item.key === key);
  const pinned = alreadyPinned
    ? state.pinned.filter(item => item.key !== key)
    : state.pinned.concat([
        {
          key: key,
          kind: reference.kind,
          id: typeof reference.id === "string" ? reference.id : "",
          label: typeof reference.label === "string" ? reference.label : "",
        },
      ]);

  return withChanges(state, { pinned: pinned });
}

/**
 * Zoom is display state stored per Focus. It is not navigation, so it never
 * pushes the Focus Stack, and returning to a Focus restores its zoom.
 */
export function setZoom(state, focusId, level) {
  if (typeof focusId !== "string" || focusId.length === 0) return state;
  if (WORKSPACE_ZOOM_LEVELS.indexOf(level) < 0) return state;
  const zoomByFocus = Object.assign({}, state.zoomByFocus);
  zoomByFocus[focusId] = level;
  return withChanges(state, { zoomByFocus: zoomByFocus });
}

export function zoomFor(state, focusId) {
  const stored = state.zoomByFocus[focusId];
  return WORKSPACE_ZOOM_LEVELS.indexOf(stored) >= 0 ? stored : WORKSPACE_ZOOM_LEVELS[0];
}
