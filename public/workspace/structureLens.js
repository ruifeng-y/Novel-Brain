/**
 * Structure lens: the browse tree that lives inside the Lens Rail.
 *
 * Placement (Ruling 1): the rail holds the six lens buttons and, beneath them,
 * the browse tree of the current lens. The Structure tree is that tree for the
 * Structure lens; the Working Surface stays the surface for the resolved Focus.
 *
 * Granularity (Ruling 2): the tree reuses the session semantic zoom of
 * focusModel.js. Zoom names the deepest granularity the tree expands to and is
 * pure display state: it never changes Focus, Lens, pinned context, or the
 * Focus Stack, and it never pushes the Focus Stack. The tree can only tell
 * Novel / Arc / Chapter apart, so granularities below Chapter clamp to it and
 * `stepTreeZoom` reports a limit instead of a step that changes nothing.
 *
 * Honesty (Ruling 3): a degraded structure renders as degraded with its issues,
 * a dangling container entry appears only in the issues (the query already
 * excludes it from `children`, so no placeholder node is ever synthesized), and
 * orphan scenes render as scenes that belong to no chapter.
 *
 * The module holds no canonical truth and no structure of its own: it renders
 * the answer of `GET /novels/:novelId/structure`. It is DOM-free at import
 * time, so the W1 regression harness can import it in Node; DOM work happens
 * only inside renderStructureLens.
 */

import { zoomFor } from "./focusModel.js";

/**
 * The session zoom vocabulary is the one focusModel stores ("target-span").
 * The tree names granularity with the structure vocabulary of Spec 10.1, so
 * the two are translated here and nowhere else.
 */
const SESSION_TO_LEVEL = {
  novel: "novel",
  arc: "arc",
  chapter: "chapter",
  scene: "scene",
  "target-span": "span",
};

/**
 * Novel -> Arc -> Chapter -> Scene. The tree has no node below a scene, so
 * "scene" is exactly the deepest representable granularity and "span" clamps
 * to it: the tree is fully expanded and nothing pretends there is more. Target
 * span granularity needs span data the structure query does not carry, so it is
 * out of W2 rather than faked.
 */
const LEVEL_DEPTH = {
  novel: 1,
  arc: 2,
  chapter: 3,
  scene: 3,
  span: 3,
};

const TREE_MAX_DEPTH = 3;

const ISSUE_LABELS = {
  arc_missing: "章节引用了不存在的故事弧",
  chapter_missing: "场景引用了不存在的章节",
  chapter_pointer_mismatch: "章节未被所属故事弧列出",
  scene_pointer_mismatch: "场景未被所属章节列出",
  arc_chapter_entry_missing: "故事弧列出了不存在的章节",
  chapter_scene_entry_missing: "章节列出了不存在的场景",
};

const boundRoots = new WeakSet();
const selectionHandlers = new WeakMap();

function escapeText(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stateBlock(stateName, label, detail) {
  const extra =
    detail === undefined || detail === ""
      ? ""
      : `<span class="ws-state-detail">${escapeText(detail)}</span>`;
  return `<div class="ws-state" data-state="${stateName}"><span class="ws-state-label">${escapeText(
    label,
  )}</span>${extra}</div>`;
}

function depthForLevel(level) {
  const depth = LEVEL_DEPTH[level];
  return typeof depth === "number" ? depth : LEVEL_DEPTH.novel;
}

function row(node, depth, focusKey, orphan) {
  const objectId = typeof node.objectId === "string" ? node.objectId : "";
  const kind = typeof node.kind === "string" ? node.kind : "";
  return Object.freeze({
    objectId: objectId,
    kind: kind,
    title: typeof node.title === "string" ? node.title : "",
    depth: depth,
    orphan: orphan === true,
    current: focusKey.length > 0 && focusKey === `${kind}:${objectId}`,
  });
}

/**
 * The visible rows of the tree at a zoom level, in container order. The level
 * only changes how deep the same subtree is drawn; it never reorders it and
 * never invents a node. Orphan scenes are rows like any other scene row, marked
 * `orphan` so the renderer can say they belong to no chapter.
 */
export function visibleNodes(view, level, focusKey) {
  if (!view || typeof view !== "object") return [];
  const key = typeof focusKey === "string" ? focusKey : "";
  const depth = depthForLevel(level);
  const rows = [];
  const arcs = Array.isArray(view.arcs) ? view.arcs : [];

  for (const arc of arcs) {
    rows.push(row(arc, 1, key, false));
    if (depth < 2) continue;
    const chapters = Array.isArray(arc.children) ? arc.children : [];
    for (const chapter of chapters) {
      rows.push(row(chapter, 2, key, false));
      if (depth < 3) continue;
      const scenes = Array.isArray(chapter.children) ? chapter.children : [];
      for (const scene of scenes) rows.push(row(scene, 3, key, false));
    }
  }

  if (depth >= TREE_MAX_DEPTH) {
    const orphans = Array.isArray(view.orphanScenes) ? view.orphanScenes : [];
    for (const orphan of orphans) rows.push(row(orphan, TREE_MAX_DEPTH, key, true));
  }

  return Object.freeze(rows);
}

/** The session zoom of a Focus, named in the structure vocabulary. */
export function zoomLevelFor(state, focusKey) {
  if (!state || typeof focusKey !== "string" || focusKey.length === 0) return "novel";
  const sessionLevel = zoomFor(state, focusKey);
  return SESSION_TO_LEVEL[sessionLevel] || "novel";
}

/**
 * The granularities the browse tree can actually distinguish, shallowest first.
 * The tree is Novel -> Arc -> Chapter -> Scene and has no node below a scene, so
 * "scene" and "target-span" render exactly the same fully expanded tree as
 * "chapter". They clamp to "chapter": the tree never pretends there is more to
 * show than it can show.
 */
export const TREE_ZOOM_LEVELS = ["novel", "arc", "chapter"];

const TREE_LEVEL_FOR_SESSION = {
  novel: "novel",
  arc: "arc",
  chapter: "chapter",
  // "span" is this module's name for the session "target-span"; both clamp.
  span: "chapter",
  "target-span": "chapter",
};

/** Clamps a semantic zoom level to the granularity the tree renders. */
export function treeLevelFor(sessionLevel) {
  return TREE_LEVEL_FOR_SESSION[sessionLevel] || TREE_ZOOM_LEVELS[0];
}

/**
 * The tree granularity one step up (`direction > 0`) or down from `level`, or
 * null when the tree is already as deep or as shallow as it renders. The zoom
 * control uses null to show an at-limit state instead of staying silently inert.
 */
export function stepTreeZoom(level, direction) {
  const index = TREE_ZOOM_LEVELS.indexOf(level);
  const from = index < 0 ? 0 : index;
  const next = from + (direction > 0 ? 1 : -1);
  if (next < 0 || next >= TREE_ZOOM_LEVELS.length) return null;
  return TREE_ZOOM_LEVELS[next];
}

function rowMarkup(entry) {
  const label = entry.title.length > 0 ? entry.title : entry.objectId;
  const attributes = [
    'class="ws-tree-item"',
    "data-structure-node",
    `data-structure-kind="${escapeText(entry.kind)}"`,
    `data-structure-object-id="${escapeText(entry.objectId)}"`,
    `data-structure-depth="${entry.depth}"`,
  ];
  if (entry.orphan) attributes.push('data-structure-orphan="true"');
  if (entry.current) attributes.push('aria-current="true"');
  return (
    `<li ${attributes.join(" ")}>` +
    `<button type="button" class="ws-tree-button" title="${escapeText(label)}">${escapeText(
      label,
    )}</button>` +
    `</li>`
  );
}

function treeMarkup(view, level, focusKey) {
  const rows = visibleNodes(view, level, focusKey);
  if (rows.length === 0) return stateBlock("empty", "暂无结构");

  const placed = rows.filter((entry) => !entry.orphan);
  const orphans = rows.filter((entry) => entry.orphan);
  const parts = [];

  if (placed.length > 0) {
    parts.push(`<ul class="ws-tree">${placed.map(rowMarkup).join("")}</ul>`);
  }
  if (orphans.length > 0) {
    parts.push(
      `<p class="ws-tree-group">不属于任何章节的场景</p>` +
        `<ul class="ws-tree">${orphans.map(rowMarkup).join("")}</ul>`,
    );
  }

  return parts.join("");
}

function degradedMarkup(issues) {
  const items = issues
    .map((issue) => {
      const label = ISSUE_LABELS[issue.kind] || "结构一致性问题";
      const objectId = typeof issue.objectId === "string" ? issue.objectId : "";
      return (
        `<li class="ws-issue"><span class="ws-issue-kind">${escapeText(label)}</span>` +
        `<span class="ws-issue-id">${escapeText(objectId)}</span></li>`
      );
    })
    .join("");
  return (
    stateBlock("degraded", "结构降级") +
    (items.length > 0 ? `<ul class="ws-issues">${items}</ul>` : "")
  );
}

function structureMarkup(view, options) {
  if (options.error) {
    return (
      stateBlock("error", "结构加载失败", String(options.error)) +
      `<button type="button" class="ws-button" data-ws-action="structure-retry" title="重新加载结构">重试</button>`
    );
  }
  if (!view) return stateBlock("loading", "加载中");

  const level = typeof options.level === "string" ? options.level : "novel";
  const focusKey = typeof options.focusKey === "string" ? options.focusKey : "";
  const issues = Array.isArray(view.issues) ? view.issues : [];
  const degraded = view.degraded === true || issues.length > 0;

  return (
    `<h3 class="ws-region-title">结构</h3>` +
    (degraded ? degradedMarkup(issues) : "") +
    treeMarkup(view, level, focusKey)
  );
}

function bindSelection(root, onSelect) {
  if (typeof onSelect !== "function") return;
  if (typeof root.addEventListener !== "function") return;

  selectionHandlers.set(root, onSelect);
  if (boundRoots.has(root)) return;
  boundRoots.add(root);

  root.addEventListener("click", (event) => {
    const handler = selectionHandlers.get(root);
    if (typeof handler !== "function") return;
    const target = event ? event.target : null;
    const trigger =
      target && typeof target.closest === "function"
        ? target.closest("[data-structure-node]")
        : null;
    if (!trigger || typeof trigger.getAttribute !== "function") return;
    const kind = trigger.getAttribute("data-structure-kind");
    const objectId = trigger.getAttribute("data-structure-object-id");
    if (typeof kind !== "string" || kind.length === 0) return;
    if (typeof objectId !== "string" || objectId.length === 0) return;
    handler({ kind: kind, objectId: objectId });
  });
}

/**
 * Renders the browse tree into `root` (the tree container inside the Lens
 * Rail). `handlers` carries the presentation inputs the caller owns — the zoom
 * `level`, the `focusKey` whose row is marked current, and the `error` string
 * when the structure query failed — plus `onSelect`, which receives
 * `{ kind, objectId }` and resolves a Focus through the shell's navigation path.
 */
export function renderStructureLens(root, view, handlers) {
  if (!root) return;
  const options = handlers && typeof handlers === "object" ? handlers : {};
  root.innerHTML = structureMarkup(view, options);
  bindSelection(root, options.onSelect);
}
