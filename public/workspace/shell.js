import {
  WORKSPACE_LENSES,
  WORKSPACE_ZOOM_LEVELS,
  applyResolution,
  createSessionState,
  currentFocus,
  currentLens,
  effectiveZoomKey,
  focusToIndex,
  goBack,
  initialiseLens,
  navigate,
  pin,
  setLens,
  setZoom,
  zoomFor,
} from "./focusModel.js";
import { createApiClient } from "./apiClient.js";
import { renderSceneSurface, spanDescriptorFromSelection } from "./sceneSurface.js";
import { renderStructureLens, stepTreeZoom, treeLevelFor, zoomLevelFor } from "./structureLens.js";
import { renderCandidateReview } from "./candidateReview.js";
import { renderCommitReview } from "./commitReview.js";

const STORAGE_KEYS = {
  novelId: "novel-brain.novel-id",
  authorId: "novel-brain.author-id",
};

const KIND_ORDER = [
  "novel",
  "story-foundation",
  "world-character-plot",
  "arc",
  "chapter",
  "scene",
  "target-span",
  "proposal",
  "candidate",
  "change-set-revision",
  "commit",
  "analysis",
  "process",
];

const KIND_LABELS = {
  novel: "小说",
  "story-foundation": "故事基础",
  "world-character-plot": "世界 / 人物 / 情节",
  arc: "故事弧",
  chapter: "章节",
  scene: "场景",
  "target-span": "目标片段",
  proposal: "叙事提案",
  candidate: "候选内容",
  "change-set-revision": "变更集修订",
  commit: "提交",
  analysis: "分析",
  process: "流程",
};

const LENS_LABELS = {
  structure: "结构",
  semantic: "语义",
  temporal: "时序",
  thread: "线索",
  impact: "影响",
  process: "流程",
};

const MODE_LABELS = {
  explore: "探索",
  design: "设计",
  write: "写作",
  review: "审阅",
  analyze: "分析",
};

const ZOOM_LABELS = {
  novel: "小说",
  arc: "故事弧",
  chapter: "章节",
  scene: "场景",
  "target-span": "目标片段",
};

const PANEL_LABELS = {
  Attention: "关注",
  Recent: "最近",
  Health: "健康",
  Proposals: "提案",
  "Proposal Open Questions": "提案待决问题",
  Dependencies: "依赖",
  "Related Objects": "相关对象",
  Scenes: "场景",
  Threads: "线索",
  Foreshadowing: "伏笔",
  Context: "上下文",
  Candidates: "候选内容",
  Validation: "校验",
  Evidence: "证据",
  Impact: "影响",
  Approval: "审批",
  Gate: "提交门",
  Provenance: "来源",
  Audit: "审计",
  "Affected Objects": "受影响对象",
  Findings: "发现",
  "Repair Proposals": "修复提案",
  "Run Plan": "运行计划",
  Progress: "进度",
  Checkpoints: "检查点",
  Failures: "失败",
  Usage: "用量",
};

/**
 * One renderer per surface the server can resolve, keyed by the exact phrase
 * it returns. The client never invents a second set of surface names and never
 * decides which surface a Focus has; it renders the answer it was given.
 */
const SURFACE_RENDERERS = {
  "overview, health, current state": { label: "概览", render: renderOverviewSurface },
  "five-direction skeleton, proposals": { label: "故事基础", render: renderPlaceholderSurface },
  "object content, proposals": { label: "对象内容", render: renderPlaceholderSurface },
  "structure, plan": { label: "结构与计划", render: renderPlaceholderSurface },
  "manuscript editor": { label: "手稿编辑器", scene: true, render: renderPlaceholderSurface },
  "span editor or span provenance": { label: "片段与来源", render: renderPlaceholderSurface },
  "proposal workbench": { label: "提案工作台", render: renderPlaceholderSurface },
  "compare, diff": { label: "候选审阅", review: "candidate", render: renderPlaceholderSurface },
  "revision content, diff": { label: "提交审阅", review: "revision", render: renderPlaceholderSurface },
  "commit detail, change": { label: "提交审阅", review: "commit", render: renderPlaceholderSurface },
  "impact, consistency report": { label: "影响与一致性", render: renderPlaceholderSurface },
  "Process Center": { label: "流程中心", render: renderPlaceholderSurface },
};

const UNKNOWN_SURFACE = { label: "未识别工作面", render: renderPlaceholderSurface };

const client = createApiClient({});

let state = createSessionState("");
let resolution = null;
let structure = null;
let structureError = "";
let scene = null;
let sceneError = "";
let sceneSelection = null;
let reviewView = null;
let reviewError = "";
let whyOpen = false;
let lastError = "";
let statusState = "disabled";
let statusLabel = "未设置小说";

function byId(id) {
  return document.getElementById(id);
}

/**
 * The shell is handed a root whose regions are queried by selector. Only a real
 * element can host a nested region, so the structure tree is skipped when the
 * caller supplies a partial root.
 */
function childOf(element, selector) {
  return element && typeof element.querySelector === "function"
    ? element.querySelector(selector)
    : null;
}

function escapeText(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || kind;
}

function lensLabel(lens) {
  return LENS_LABELS[lens] || lens || "未设置";
}

function modeLabel(mode) {
  return MODE_LABELS[mode] || mode || "未设置";
}

function zoomLabel(level) {
  return ZOOM_LABELS[level] || level;
}

/**
 * The granularity the Structure browse tree renders at. The tree is rooted at
 * the Novel and only distinguishes Novel / Arc / Chapter, so it follows the zoom
 * the session presents for the Focus path and clamps granularities deeper than
 * Chapter. The focus bar shows this same value while the Structure lens is
 * active, so the tree and the label are one reading rather than two.
 */
function structureGranularity(session) {
  return treeLevelFor(zoomLevelFor(session, effectiveZoomKey(session)));
}

/**
 * The granularity the zoom control is showing, plus whether either direction can
 * still change the tree. In the Structure lens the control steps the tree's own
 * ladder; elsewhere it steps the per-Focus session zoom. At a limit the control
 * shows an at-limit state instead of staying silently inert.
 */
function zoomControl(session, current) {
  if (currentLens(session) === "structure") {
    const level = structureGranularity(session);
    return {
      level: level,
      canZoomOut: stepTreeZoom(level, -1) !== null,
      canZoomIn: stepTreeZoom(level, 1) !== null,
    };
  }
  const level = zoomFor(session, current.key);
  const index = WORKSPACE_ZOOM_LEVELS.indexOf(level);
  return {
    level: level,
    canZoomOut: index > 0,
    canZoomIn: index < WORKSPACE_ZOOM_LEVELS.length - 1,
  };
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

function chip(label) {
  return `<span class="ws-chip">${escapeText(label)}</span>`;
}

function renderLensRail(session) {
  const active = currentLens(session);
  return (
    `<ul class="ws-lens-list">` +
    WORKSPACE_LENSES.map(lens => {
      const selected = lens === active;
      return (
        `<li><button type="button" class="ws-lens" data-ws-action="lens" data-ws-lens="${escapeText(
          lens,
        )}" aria-pressed="${selected ? "true" : "false"}" title="${escapeText(
          `镜头：${lensLabel(lens)}`,
        )}">${escapeText(lensLabel(lens))}</button></li>`
      );
    }).join("") +
    `</ul>` +
    `<div class="ws-structure" data-role="structure-tree"></div>`
  );
}

/**
 * The Lens Rail holds the lens buttons and, beneath them, the browse tree of
 * the current lens. The Structure lens browses the persisted Novel -> Arc ->
 * Chapter -> Scene tree; a lens whose browse tree is not built yet says so
 * instead of borrowing the structure tree.
 *
 * The granularity is the session semantic zoom the Focus path presents, clamped
 * to what the tree can render, so navigating into the tree never collapses it:
 * zoom is display state, not navigation.
 */
function renderStructureRegion(lensRail, session, structureView, structureFailure) {
  const treeRoot = childOf(lensRail, '[data-role="structure-tree"]');
  if (!treeRoot) return;
  if (currentLens(session) !== "structure") {
    treeRoot.innerHTML = stateBlock("empty", "该镜头暂无浏览树");
    return;
  }
  const focusKey = structureFocusKey(session);
  renderStructureLens(treeRoot, structureView, {
    level: structureGranularity(session),
    focusKey: focusKey,
    onSelect: selectStructureNode,
    error: structureFailure,
  });
}

/**
 * The row the browse tree marks as current: the focused object when the tree
 * actually draws it. The tree holds arcs, chapters and scenes; a Novel focus has
 * no row of its own, so no row is marked. Zoom is read through the session's
 * effective zoom key, never through this one.
 */
function structureFocusKey(session) {
  const current = currentFocus(session);
  if (!current || typeof current.key !== "string" || current.key.length === 0) return "";
  if (current.kind === "arc" || current.kind === "chapter" || current.kind === "scene") {
    return current.key;
  }
  return "";
}

function renderFocusBar(session, current, view) {
  const parts = [];
  const canGoBack = session.focusStack.length > 1;

  parts.push(
    `<button type="button" class="ws-icon-button" data-ws-action="back" title="返回上一个焦点" aria-label="返回上一个焦点"${
      canGoBack ? "" : ' data-state="disabled" disabled'
    }>←</button>`,
  );

  if (session.focusStack.length === 0) {
    parts.push(`<span class="ws-path">尚未解析焦点</span>`);
  } else {
    parts.push(
      `<ol class="ws-path">` +
        session.focusStack
          .map(
            (entry, index) =>
              `<li><button type="button" class="ws-crumb" data-ws-action="breadcrumb" data-ws-index="${index}" title="${escapeText(
                `回到 ${kindLabel(entry.kind)}`,
              )}">${escapeText(kindLabel(entry.kind))}</button></li>`,
          )
          .join("") +
        `</ol>`,
    );
  }

  if (session.pinned.length > 0) {
    parts.push(
      `<div class="ws-pinned">` +
        session.pinned
          .map(item => `<span class="ws-pin">${escapeText(item.label || kindLabel(item.kind))}</span>`)
          .join("") +
        `</div>`,
    );
  }

  if (current) {
    const currentPinned = session.pinned.some(item => item.key === current.key);
    const control = zoomControl(session, current);
    parts.push(
      `<div class="ws-zoom">` +
        `<button type="button" class="ws-icon-button" data-ws-action="zoom-out" title="${
          control.canZoomOut ? "缩小粒度" : "已到最小粒度"
        }" aria-label="缩小粒度"${
          control.canZoomOut ? "" : ' data-state="disabled" disabled'
        }>−</button>` +
        `<span class="ws-zoom-label">${escapeText(`粒度：${zoomLabel(control.level)}`)}</span>` +
        `<button type="button" class="ws-icon-button" data-ws-action="zoom-in" title="${
          control.canZoomIn ? "放大粒度" : "已到最大粒度"
        }" aria-label="放大粒度"${
          control.canZoomIn ? "" : ' data-state="disabled" disabled'
        }>+</button>` +
        `</div>`,
    );
    parts.push(
      `<button type="button" class="ws-button" data-ws-action="pin" title="固定当前焦点">${
        currentPinned ? "取消固定" : "固定"
      }</button>`,
    );
  }

  parts.push(
    `<label class="ws-jump"><span class="ws-visually-hidden">定位对象</span><select id="ws-target" title="定位对象">` +
      KIND_ORDER.map(
        kind => `<option value="${escapeText(kind)}">${escapeText(kindLabel(kind))}</option>`,
      ).join("") +
      `</select></label>`,
  );
  parts.push(
    `<button type="button" class="ws-button" data-ws-action="jump" title="定位并解析对象">定位</button>`,
  );
  parts.push(
    `<button type="button" class="ws-button" data-ws-action="why" title="查看当前工作面的依据" aria-expanded="${
      whyOpen ? "true" : "false"
    }">依据</button>`,
  );

  if (whyOpen) parts.push(renderWhy(session, current, view));

  return parts.join("");
}

function renderWhy(session, current, view) {
  if (!current) {
    return `<div class="ws-why">${stateBlock("disabled", "尚未解析焦点")}</div>`;
  }
  const activeMode = view && typeof view.mode === "string" ? view.mode : current.mode;
  const defaultLens = view && typeof view.defaultLens === "string" ? view.defaultLens : null;
  const facts = [
    `对象：${kindLabel(current.kind)}`,
    `模式：${modeLabel(activeMode)}`,
    `镜头：${lensLabel(currentLens(session))}`,
    `默认镜头：${lensLabel(defaultLens)}`,
    `粒度：${zoomLabel(zoomControl(session, current).level)}`,
  ];
  return (
    `<div class="ws-why">` +
    facts.map(fact => chip(fact)).join("") +
    chip("依据：对象入口契约") +
    `</div>`
  );
}

function renderOverviewSurface(session, current) {
  const facts = [
    `小说：${session.workspaceId || "未设置"}`,
    `对象：${kindLabel(current.kind)}`,
    `模式：${modeLabel(current.mode)}`,
  ];
  return (
    `<div class="ws-facts">` +
    facts.map(fact => chip(fact)).join("") +
    `</div>` +
    stateBlock("empty", "暂无内容")
  );
}

function renderPlaceholderSurface(session, current) {
  const facts = [`对象：${kindLabel(current.kind)}`, `模式：${modeLabel(current.mode)}`];
  return (
    `<div class="ws-facts">` +
    facts.map(fact => chip(fact)).join("") +
    `</div>` +
    stateBlock("empty", "暂无内容")
  );
}

/**
 * A resolution describes one Focus. Rendering it against a different Focus is
 * exactly the stale-surface bug, so a mismatch is treated as "not resolved
 * yet" instead of painting the previous focus's surface.
 */
export function resolutionMatchesFocus(resolved, focus) {
  if (!resolved || !focus) return false;
  return resolved.kind === focus.kind && resolved.mode === focus.mode;
}

function renderSurface(session, current, view) {
  if (!current) {
    return (
      `<header class="ws-surface-head"><h2>工作面</h2></header>` +
      (lastError === ""
        ? stateBlock("disabled", "未解析焦点")
        : stateBlock("error", "请求失败", lastError))
    );
  }

  if (!resolutionMatchesFocus(view, current)) {
    const pending =
      `<header class="ws-surface-head"><h2>工作面</h2></header>` +
      stateBlock("loading", "加载中");
    if (lastError === "") return pending;
    return (
      `<header class="ws-surface-head"><h2>工作面</h2></header>` +
      stateBlock("error", "请求失败", lastError) +
      `<button type="button" class="ws-button" data-ws-action="retry" title="重试解析">重试</button>`
    );
  }

  const surfaceKind =
    view && typeof view.surfaceKind === "string" ? view.surfaceKind : "";
  const renderer = SURFACE_RENDERERS[surfaceKind] || UNKNOWN_SURFACE;
  const head =
    `<header class="ws-surface-head">` +
    `<h2>${escapeText(renderer.label)}</h2>` +
    `<div class="ws-facts">` +
    chip(`模式：${modeLabel(current.mode)}`) +
    chip(`镜头：${lensLabel(currentLens(session))}`) +
    `</div>` +
    `</header>`;

  // The scene surface needs a real element to bind the span selection to, so
  // the shell renders the frame here and lets renderSceneSurface fill it.
  if (renderer.scene === true && current.kind === "scene") {
    return head + `<div class="ws-scene" data-role="scene-surface"></div>`;
  }

  // The review surfaces likewise get a frame the shell fills, so the commit
  // control only ever exists inside a revision's Commit Review.
  if (typeof renderer.review === "string") {
    return head + `<div class="ws-review" data-role="review-surface"></div>`;
  }

  return head + renderer.render(session, current);
}

function renderPanels(view) {
  const panels =
    view && Array.isArray(view.defaultPanels) ? view.defaultPanels : [];
  if (panels.length === 0) {
    return `<h2 class="ws-region-title">上下文面板</h2>` + stateBlock("degraded", "面板数据不可用");
  }
  return (
    `<h2 class="ws-region-title">上下文面板</h2>` +
    `<ul class="ws-panel-list">` +
    panels
      .map(
        name =>
          `<li class="ws-panel"><h3>${escapeText(
            PANEL_LABELS[name] || name,
          )}</h3>${stateBlock("degraded", "面板数据不可用")}</li>`,
      )
      .join("") +
    `</ul>`
  );
}

function renderAttention() {
  return `<h2 class="ws-region-title">关注</h2>` + stateBlock("degraded", "关注数据不可用");
}

function renderIdentityStatus() {
  const target = document.querySelector('[data-role="ws-identity-status"]');
  if (!target) return;
  target.setAttribute("data-state", statusState);
  target.textContent = statusLabel;
}

/**
 * Renders the six regions from the session and the server resolution. It is a
 * pure function of its arguments, so the same call also runs outside a browser.
 */
export function renderShell(root, sessionState, resolved, structureInput, sceneInput, reviewInput) {
  if (!root) return;
  const current = currentFocus(sessionState);
  const view = resolved || null;
  const structureView = structureInput ? structureInput.view || null : structure;
  const structureFailure = structureInput ? structureInput.error || "" : structureError;
  const sceneView = sceneInput ? sceneInput.view || null : scene;
  const sceneFailure = sceneInput ? sceneInput.error || "" : sceneError;
  const sceneAttempt = sceneInput ? sceneInput.selection || null : sceneSelection;
  const reviewData = reviewInput ? reviewInput.view || null : reviewView;
  const reviewFailure = reviewInput ? reviewInput.error || "" : reviewError;

  const lensRail = root.querySelector('[data-region="lens-rail"]');
  if (lensRail) {
    lensRail.innerHTML = renderLensRail(sessionState);
    renderStructureRegion(lensRail, sessionState, structureView, structureFailure);
  }

  const focusBar = root.querySelector('[data-region="focus-bar"]');
  if (focusBar) focusBar.innerHTML = renderFocusBar(sessionState, current, view);

  const surface = root.querySelector('[data-region="working-surface"]');
  if (surface) {
    surface.innerHTML = renderSurface(sessionState, current, view);
    const sceneRoot = childOf(surface, '[data-role="scene-surface"]');
    if (sceneRoot) {
      renderSceneSurface(sceneRoot, sceneView, sceneAttempt, {
        error: sceneFailure,
        onSelectSpan: handleSelectSpan,
        onRetry: retryScene,
      });
    }
    const reviewRoot = childOf(surface, '[data-role="review-surface"]');
    if (reviewRoot) {
      const renderReview =
        reviewData && reviewData.surface === "candidate" ? renderCandidateReview : renderCommitReview;
      renderReview(
        reviewRoot,
        Object.assign({}, reviewData || {}, reviewFailure === "" ? {} : { error: reviewFailure }),
        {
          onAdopt: handleAdoptCandidate,
          onEdit: handleCandidateAction,
          onReject: handleCandidateAction,
          onRegenerate: handleCandidateAction,
          onRunValidation: handleRunValidation,
          onCommit: handleCommitRevision,
        },
      );
    }
  }

  const panels = root.querySelector('[data-region="context-panels"]');
  if (panels) panels.innerHTML = renderPanels(view);

  const attention = root.querySelector('[data-region="attention-layer"]');
  if (attention) attention.innerHTML = renderAttention();
}

function setStatus(nextState, label) {
  statusState = nextState;
  statusLabel = label;
}

function render() {
  const root = byId("workspace-shell");
  if (!root) return;
  renderShell(root, state, resolution);
  renderIdentityStatus();
}

function readStoredIdentity() {
  try {
    return {
      novelId: window.localStorage.getItem(STORAGE_KEYS.novelId) || "",
      authorId: window.localStorage.getItem(STORAGE_KEYS.authorId) || "",
    };
  } catch {
    return { novelId: "", authorId: "" };
  }
}

function persistIdentity(novelId, authorId) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.novelId, novelId);
    window.localStorage.setItem(STORAGE_KEYS.authorId, authorId);
  } catch {
    return;
  }
}

function valueOf(input) {
  return input && typeof input.value === "string" ? input.value.trim() : "";
}

function readIdentity() {
  const legacy = readStoredIdentity();
  const novelId = valueOf(byId("ws-novel-id")) || valueOf(byId("novel-id")) || legacy.novelId;
  const authorId =
    valueOf(byId("ws-author-id")) ||
    valueOf(byId("author-id")) ||
    legacy.authorId ||
    "anonymous-author";
  return { novelId: novelId, authorId: authorId };
}

function syncIdentityInputs(identity) {
  const tuned = [
    [byId("ws-novel-id"), identity.novelId],
    [byId("ws-author-id"), identity.authorId],
  ];
  for (const [input, value] of tuned) {
    if (input && input.value !== value) input.value = value;
  }
}

function mirrorIntoLegacy(identity) {
  const pairs = [
    [byId("novel-id"), identity.novelId],
    [byId("author-id"), identity.authorId],
  ];
  for (const [input, value] of pairs) {
    if (!input || input.value === value) continue;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

async function resolveKind(kind, mode, options) {
  const identity = readIdentity();
  if (identity.novelId.length === 0) {
    setStatus("disabled", "请先填写小说标识");
    render();
    return;
  }

  state = Object.assign({}, state, { workspaceId: identity.novelId });
  setStatus("loading", "解析中");
  render();

  try {
    const answer = await client.resolveFocus({
      workspaceId: identity.novelId,
      authorId: identity.authorId,
      kind: kind,
      mode: mode,
    });
    resolution = answer;
    lastError = "";
    state = applyResolution(state, answer);
    // The contract's default Lens seeds the session once; navigation and
    // Back never move a Lens the author has chosen (Spec 3.3).
    state = initialiseLens(state, answer.defaultLens);
    if (!options || options.navigate !== false) {
      const explicitId = options && typeof options.id === "string" ? options.id : "";
      state = navigate(state, {
        kind: answer.kind,
        id:
          explicitId.length > 0
            ? explicitId
            : answer.kind === "novel"
              ? identity.novelId
              : "",
        mode: answer.mode,
      });
    }
    setStatus("success", "已解析");
  } catch (error) {
    lastError = error && error.message ? error.message : "解析失败";
    setStatus("error", lastError);
  }
  render();
  await syncScene();
  await syncReview();
}

/** Re-asks the server about the current focus, keeping the visible surface. */
async function refreshResolution() {
  const focus = currentFocus(state);
  if (!focus) {
    render();
    return;
  }
  const identity = readIdentity();
  if (identity.novelId.length === 0) {
    render();
    return;
  }

  try {
    const answer = await client.resolveFocus({
      workspaceId: identity.novelId,
      authorId: identity.authorId,
      kind: focus.kind,
      mode: focus.mode,
    });
    resolution = answer;
    lastError = "";
    state = applyResolution(state, answer);
    if (focus.mode !== answer.mode) {
      // The server owns Mode compatibility; the entry follows the answer.
      state = navigate(state, {
        kind: answer.kind,
        id: focus.id,
        mode: answer.mode,
      });
    }
    setStatus("success", "已解析");
  } catch (error) {
    lastError = error && error.message ? error.message : "解析失败";
    setStatus("error", lastError);
  }
  render();
}

/**
 * Resolves the focus that navigation just restored. The previous focus's
 * resolution is dropped first, so the working surface can never be painted
 * from a resolution that belongs to a different focus.
 */
async function resolveCurrentFocus() {
  if (!currentFocus(state)) {
    render();
    return;
  }
  resolution = null;
  lastError = "";
  setStatus("loading", "解析中");
  render();
  await refreshResolution();
}

async function changeLens(lens) {
  state = setLens(state, lens);
  render();
  if (!currentFocus(state)) return;
  await refreshResolution();
}

function focusKeyOf(focus) {
  return focus === null || focus === undefined ? "" : focus.key;
}

/** Re-resolves whenever navigation landed on a different focus. */
async function afterFocusChange(previousKey) {
  const focus = currentFocus(state);
  if (!focus || focus.key === previousKey) {
    render();
    return;
  }
  await resolveCurrentFocus();
  await syncScene();
  await syncReview();
}

/**
 * The zoom control's action, as a pure step of the session. In the Structure
 * lens it steps the browse tree's granularity, which the tree and the focus bar
 * both read; elsewhere it steps the per-Focus session zoom.
 *
 * It is display state only: it never changes the Focus, the Lens, or the pinned
 * context, and it never pushes the Focus Stack. At a granularity limit the step
 * is a no-op, so the control can show an at-limit state instead of a button that
 * silently does nothing.
 */
export function applyZoom(sessionState, direction) {
  const focus = currentFocus(sessionState);
  if (!focus) return sessionState;

  if (currentLens(sessionState) === "structure") {
    const next = stepTreeZoom(structureGranularity(sessionState), direction);
    if (next === null) return sessionState;
    return setZoom(sessionState, focus.key, next);
  }

  const index = WORKSPACE_ZOOM_LEVELS.indexOf(zoomFor(sessionState, focus.key));
  const next = Math.max(0, Math.min(WORKSPACE_ZOOM_LEVELS.length - 1, index + direction));
  return setZoom(sessionState, focus.key, WORKSPACE_ZOOM_LEVELS[next]);
}

function zoomBy(direction) {
  state = applyZoom(state, direction);
  render();
}

/**
 * Selecting a node in the Structure tree resolves a Focus through the same
 * navigation path the locate control uses. It is navigation, not a page switch:
 * Back, the stale-surface guard, the Lens, and the pinned context all keep
 * working.
 */
function selectStructureNode(node) {
  if (!node || typeof node.kind !== "string" || node.kind.length === 0) return;
  resolveKind(node.kind, undefined, { navigate: true, id: node.objectId });
}

/** Loads the persisted structure of the signed-in Novel for the Lens Rail. */
async function loadStructure() {
  const identity = readIdentity();
  if (identity.novelId.length === 0) {
    structure = null;
    structureError = "";
    render();
    return;
  }

  try {
    structure = await client.getStructure({
      novelId: identity.novelId,
      authorId: identity.authorId,
    });
    structureError = "";
  } catch (error) {
    structure = null;
    structureError = error && error.message ? error.message : "结构加载失败";
  }
  render();
}

function clearScene() {
  scene = null;
  sceneError = "";
  sceneSelection = null;
}

/**
 * Loads the scene read view when the current Focus is a Scene, and clears it
 * otherwise. The surface is only painted for the scene the Focus actually
 * addresses: a different focus never inherits the previous scene's text.
 */
async function syncScene() {
  const focus = currentFocus(state);
  if (!focus || focus.kind !== "scene" || typeof focus.id !== "string" || focus.id.length === 0) {
    clearScene();
    render();
    return;
  }
  const identity = readIdentity();
  if (identity.novelId.length === 0) {
    clearScene();
    render();
    return;
  }

  scene = null;
  sceneError = "";
  sceneSelection = null;
  render();

  try {
    scene = await client.getScene({
      novelId: identity.novelId,
      sceneId: focus.id,
      authorId: identity.authorId,
    });
    sceneError = "";
  } catch (error) {
    scene = null;
    sceneError = error && error.message ? error.message : "场景加载失败";
  }
  render();
}

/**
 * A revision Focus addresses a Change Set and a revision: `changeSetId` and
 * `revisionId` are one address, and a revision id is unique only inside its
 * Change Set. The client-side Focus id therefore carries the pair, split at the
 * first colon. This is the same convention the server uses for the address.
 */
function parseRevisionFocus(id) {
  if (typeof id !== "string") return null;
  const index = id.indexOf(":");
  if (index <= 0 || index === id.length - 1) return null;
  return { changeSetId: id.slice(0, index), revisionId: id.slice(index + 1) };
}

function candidateFocusAddress(id) {
  if (typeof id !== "string") return { changeSetId: "", candidateId: "" };
  const index = id.indexOf(":");
  if (index <= 0 || index === id.length - 1) return { changeSetId: "", candidateId: id };
  return { changeSetId: id.slice(0, index), candidateId: id.slice(index + 1) };
}

function addressKey(changeSetId, revisionId) {
  return `${changeSetId}:${revisionId}`;
}

/** Validation evidence is named per revision: the runs this session produced. */
const validationEvidence = new Map();
/** The candidate a revision was adopted from, remembered from the adoption. */
const revisionSources = new Map();

function clearReview() {
  reviewView = null;
  reviewError = "";
}

async function syncReview() {
  const focus = currentFocus(state);
  const identity = readIdentity();
  if (!focus || identity.novelId.length === 0) {
    clearReview();
    render();
    return;
  }

  if (focus.kind === "candidate") {
    const address = candidateFocusAddress(focus.id);
    reviewError = "";
    reviewView = {
      surface: "candidate",
      candidateId: address.candidateId,
      changeSetId: address.changeSetId,
      novelId: identity.novelId,
      adoption: revisionSources.get(`candidate:${address.candidateId}`) || null,
    };
    render();
    return;
  }

  if (focus.kind === "change-set-revision") {
    const address = parseRevisionFocus(focus.id);
    if (!address) {
      clearReview();
      reviewError = "无法解析修订地址";
      render();
      return;
    }
    reviewView = {
      surface: "revision",
      changeSetId: address.changeSetId,
      revisionId: address.revisionId,
      validationRunIds: validationEvidence.get(addressKey(address.changeSetId, address.revisionId)) || [],
      reviewDecisionIds: [],
      candidateId: revisionSources.get(addressKey(address.changeSetId, address.revisionId)) || "",
      gate: null,
    };
    render();
    await refreshGate();
    return;
  }

  if (focus.kind === "commit") {
    reviewView = { surface: "commit", novelId: identity.novelId, provenance: null };
    render();
    try {
      const provenance = await client.getCommitProvenance({
        novelId: identity.novelId,
        commitId: focus.id,
        authorId: identity.authorId,
      });
      reviewView = Object.assign({}, reviewView, { provenance: provenance });
      reviewError = "";
    } catch (error) {
      reviewError = error && error.message ? error.message : "提交来源加载失败";
    }
    render();
    return;
  }

  clearReview();
  render();
}

/**
 * The gate is the server's answer for the named evidence: the client never
 * decides a condition and never fills in a missing one.
 */
async function refreshGate() {
  if (!reviewView || reviewView.surface !== "revision") return;
  const identity = readIdentity();
  const view = reviewView;

  try {
    const decisions = await client.getApprovalEvidence({
      changeSetId: view.changeSetId,
      revisionId: view.revisionId,
      authorId: identity.authorId,
    });
    reviewView = Object.assign({}, reviewView, {
      reviewDecisionIds: (Array.isArray(decisions) ? decisions : []).map(entry => entry.id),
    });
  } catch {
    // Approval evidence is optional here: the gate reports what it has.
  }

  const runs = reviewView.validationRunIds || [];
  if (runs.length === 0) {
    reviewView = Object.assign({}, reviewView, { gate: null });
    reviewError = "";
    render();
    return;
  }

  try {
    const gate = await client.getCommitGate({
      changeSetId: view.changeSetId,
      revisionId: view.revisionId,
      validationRunIds: runs,
      authorId: identity.authorId,
    });
    reviewView = Object.assign({}, reviewView, { gate: gate });
    reviewError = "";
  } catch (error) {
    reviewView = Object.assign({}, reviewView, { gate: null });
    reviewError = error && error.message ? error.message : "门禁求值失败";
  }
  render();
}

/**
 * Adoption is the one write the Candidate Review surface performs. The
 * Candidate becomes a Change Set Revision; nothing is committed here.
 */
async function handleAdoptCandidate() {
  const focus = currentFocus(state);
  const identity = readIdentity();
  if (!focus || focus.kind !== "candidate") return;
  const address = candidateFocusAddress(focus.id);
  if (address.changeSetId.length === 0 || address.candidateId.length === 0) return;

  const revisionId = `${address.changeSetId}:r${Date.now()}`;
  try {
    const revision = await client.adoptCandidate({
      changeSetId: address.changeSetId,
      candidateId: address.candidateId,
      revisionId: revisionId,
      authorId: identity.authorId,
    });
    const source =
      Array.isArray(revision && revision.changes) && revision.changes.length > 0
        ? revision.changes[0].sourceReference && revision.changes[0].sourceReference.identity
        : "";
    if (typeof source === "string" && source.length > 0) {
      revisionSources.set(addressKey(address.changeSetId, revision.revisionId), source);
    }
    revisionSources.set(`candidate:${address.candidateId}`, {
      changeSetId: address.changeSetId,
      revisionId: revision.revisionId,
    });
    reviewError = "";
    await resolveKind("change-set-revision", "review", {
      id: addressKey(address.changeSetId, revision.revisionId),
    });
  } catch (error) {
    reviewError = error && error.message ? error.message : "采纳失败";
    render();
  }
}

/** W3 has no application action for edit / reject / regenerate yet. */
function handleCandidateAction() {
  return undefined;
}

async function handleRunValidation() {
  if (!reviewView || reviewView.surface !== "revision") return;
  if (typeof reviewView.candidateId !== "string" || reviewView.candidateId.length === 0) return;
  const identity = readIdentity();
  const view = reviewView;
  try {
    const run = await client.runValidationForRevision({
      changeSetId: view.changeSetId,
      revisionId: view.revisionId,
      validationId: `${view.revisionId}:validation:${Date.now()}`,
      planVersionId: "plan-v1",
      candidateId: view.candidateId,
      authorId: identity.authorId,
    });
    const key = addressKey(view.changeSetId, view.revisionId);
    validationEvidence.set(key, [run.id]);
    reviewView = Object.assign({}, reviewView, { validationRunIds: [run.id] });
    reviewError = "";
  } catch (error) {
    reviewError = error && error.message ? error.message : "校验运行失败";
  }
  await refreshGate();
}

async function handleCommitRevision() {
  if (!reviewView || reviewView.surface !== "revision") return;
  const gate = reviewView.gate;
  if (!gate || gate.allowed !== true) return;
  const identity = readIdentity();
  const view = reviewView;
  try {
    const commit = await client.commitRevision({
      changeSetId: view.changeSetId,
      authorId: identity.authorId,
      body: {
        commitId: `${view.revisionId}:commit:${Date.now()}`,
        changeSetRevisionId: view.revisionId,
        validationRunIds: view.validationRunIds,
        reviewDecisionIds: view.reviewDecisionIds,
        currentRevisionFacts: { unresolvedConflict: false, stale: false },
        targetInvariantViolations: [],
        approvalRequirements: [],
      },
    });
    reviewError = "";
    await resolveKind("commit", "review", { id: commit.id });
  } catch (error) {
    // A blocked commit answers with the authoritative gate. That answer, not a
    // fresh preview, is what the surface must show: the preview cannot see the
    // facts the commit derives, so trusting it would leave the surface saying
    // "everything is green" while the commit keeps being refused.
    const authoritative =
      error && error.payload && error.payload.gate ? error.payload.gate : null;
    reviewError = error && error.message ? error.message : "提交失败";
    if (authoritative) {
      reviewView = Object.assign({}, reviewView, { gate: authoritative });
      render();
      return;
    }
    await refreshGate();
  }
}

/**
 * Resolves a selection made in the scene text. The descriptor is derived from
 * the selection, and the resolvable / drifted / missing outcome is whatever the
 * server answers: the shell never classifies the span itself.
 */
async function handleSelectSpan(bounds) {
  const focus = currentFocus(state);
  if (!focus || focus.kind !== "scene" || !scene) return;
  const descriptor = spanDescriptorFromSelection(scene.text, bounds);
  if (!descriptor) return;

  const identity = readIdentity();
  sceneSelection = { descriptor: descriptor, resolution: null, pending: true };
  render();

  try {
    const resolution = await client.resolveSpan({
      novelId: identity.novelId,
      sceneId: focus.id,
      descriptor: descriptor,
      authorId: identity.authorId,
    });
    sceneSelection = { descriptor: descriptor, resolution: resolution, pending: false };
  } catch (error) {
    sceneSelection = {
      descriptor: descriptor,
      resolution: null,
      pending: false,
      error: error && error.message ? error.message : "片段解析失败",
    };
  }
  render();
}

function retryScene() {
  syncScene();
}

function jump() {
  const target = byId("ws-target");
  const kind = target && target.value ? target.value : "novel";
  resolveKind(kind, undefined, { navigate: true });
}

function pinCurrent() {
  const focus = currentFocus(state);
  if (!focus) return;
  state = pin(state, { kind: focus.kind, id: focus.id, label: kindLabel(focus.kind) });
  render();
}

function applyIdentity() {
  const identity = readIdentity();
  persistIdentity(identity.novelId, identity.authorId);
  syncIdentityInputs(identity);
  state = createSessionState(identity.novelId);
  resolution = null;
  structure = null;
  structureError = "";
  clearScene();
  lastError = "";
  resolveKind("novel", undefined, { navigate: true });
  loadStructure();
}

function showLegacy() {
  const identity = readIdentity();
  persistIdentity(identity.novelId, identity.authorId);
  mirrorIntoLegacy(identity);
  const legacy = document.querySelector(".app-shell");
  const root = byId("workspace-shell");
  if (legacy) legacy.hidden = false;
  if (root) root.hidden = true;
}

function showWorkspace() {
  const identity = readIdentity();
  persistIdentity(identity.novelId, identity.authorId);
  syncIdentityInputs(identity);
  const legacy = document.querySelector(".app-shell");
  const root = byId("workspace-shell");
  if (legacy) legacy.hidden = true;
  if (root) root.hidden = false;
  state = Object.assign({}, state, { workspaceId: identity.novelId });
  if (currentFocus(state) === null) {
    resolveKind("novel", undefined, { navigate: true });
  } else {
    render();
  }
  if (structure === null) loadStructure();
}

function retry() {
  resolveCurrentFocus();
}

function handleClick(event) {
  const trigger = event.target.closest("[data-ws-action]");
  if (!trigger) return;
  const action = trigger.getAttribute("data-ws-action");

  if (action === "lens") {
    changeLens(trigger.getAttribute("data-ws-lens"));
    return;
  }
  if (action === "back") {
    const previousKey = focusKeyOf(currentFocus(state));
    state = goBack(state);
    afterFocusChange(previousKey);
    return;
  }
  if (action === "breadcrumb") {
    const previousKey = focusKeyOf(currentFocus(state));
    state = focusToIndex(state, Number(trigger.getAttribute("data-ws-index")));
    afterFocusChange(previousKey);
    return;
  }
  if (action === "zoom-in") {
    zoomBy(1);
    return;
  }
  if (action === "zoom-out") {
    zoomBy(-1);
    return;
  }
  if (action === "jump") {
    jump();
    return;
  }
  if (action === "pin") {
    pinCurrent();
    return;
  }
  if (action === "why") {
    whyOpen = !whyOpen;
    render();
    return;
  }
  if (action === "retry") {
    retry();
    return;
  }
  if (action === "structure-retry") {
    loadStructure();
    return;
  }
  if (action === "scene-retry") {
    retryScene();
    return;
  }
  if (action === "apply-identity") {
    applyIdentity();
    return;
  }
  if (action === "show-legacy") {
    showLegacy();
    return;
  }
  if (action === "show-workspace") {
    showWorkspace();
  }
}

/**
 * The Focus can be seeded from the URL as `?focus=<kind>:<id>`. It is a
 * bootstrap, not a navigation surface: no control is added, no contract
 * changes, nothing is written back to the URL. It is the same kind of seeding
 * the identity bar already does for the Novel and the Author, and it is what
 * makes a Focus reachable repeatably without a navigator of its own.
 */
export function seededFocus(search) {
  const query =
    typeof search === "string"
      ? search
      : typeof window !== "undefined" && window.location
        ? window.location.search
        : "";
  if (query.length === 0) return null;
  const raw = new URLSearchParams(query).get("focus");
  if (typeof raw !== "string" || raw.length === 0) return null;
  // The id may itself contain colons (a revision address is
  // `changeSetId:revisionId`), so only the first colon separates the kind.
  const index = raw.indexOf(":");
  const kind = index === -1 ? raw : raw.slice(0, index);
  const id = index === -1 ? "" : raw.slice(index + 1);
  if (!KIND_ORDER.includes(kind)) return null;
  return { kind: kind, id: id };
}

function boot() {
  const root = byId("workspace-shell");
  if (!root) return;
  document.addEventListener("click", handleClick);
  syncIdentityInputs(readIdentity());
  render();
  const seeded = seededFocus();
  if (seeded && seeded.kind !== "novel") {
    // The Novel is resolved first so the structure is loaded, then the seeded
    // Focus is applied on top of it.
    resolveKind("novel", undefined, { navigate: true }).then(() =>
      resolveKind(seeded.kind, undefined, { id: seeded.id }),
    );
    loadStructure();
    return;
  }
  resolveKind(seeded ? seeded.kind : "novel", undefined, { navigate: true });
  loadStructure();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
