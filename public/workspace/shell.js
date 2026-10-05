import {
  WORKSPACE_LENSES,
  WORKSPACE_ZOOM_LEVELS,
  applyResolution,
  createSessionState,
  currentFocus,
  focusToIndex,
  goBack,
  navigate,
  pin,
  setLens,
  setZoom,
  zoomFor,
} from "./focusModel.js";
import { createApiClient } from "./apiClient.js";

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
  "manuscript editor": { label: "手稿编辑器", render: renderPlaceholderSurface },
  "span editor or span provenance": { label: "片段与来源", render: renderPlaceholderSurface },
  "proposal workbench": { label: "提案工作台", render: renderPlaceholderSurface },
  "compare, diff": { label: "比对与差异", render: renderPlaceholderSurface },
  "revision content, diff": { label: "修订与差异", render: renderPlaceholderSurface },
  "commit detail, change": { label: "提交详情与变更", render: renderPlaceholderSurface },
  "impact, consistency report": { label: "影响与一致性", render: renderPlaceholderSurface },
  "Process Center": { label: "流程中心", render: renderPlaceholderSurface },
};

const UNKNOWN_SURFACE = { label: "未识别工作面", render: renderPlaceholderSurface };

const client = createApiClient({});

let state = createSessionState("");
let resolution = null;
let whyOpen = false;
let lastError = "";
let statusState = "disabled";
let statusLabel = "未设置小说";

function byId(id) {
  return document.getElementById(id);
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

function renderLensRail(session, current) {
  const active = (current && current.lens) || session.lens;
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
    `</ul>`
  );
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
    parts.push(
      `<div class="ws-zoom">` +
        `<button type="button" class="ws-icon-button" data-ws-action="zoom-out" title="缩小粒度" aria-label="缩小粒度">−</button>` +
        `<span class="ws-zoom-label">${escapeText(
          `粒度：${zoomLabel(zoomFor(session, current.key))}`,
        )}</span>` +
        `<button type="button" class="ws-icon-button" data-ws-action="zoom-in" title="放大粒度" aria-label="放大粒度">+</button>` +
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
    `镜头：${lensLabel(current.lens)}`,
    `默认镜头：${lensLabel(defaultLens)}`,
    `粒度：${zoomLabel(zoomFor(session, current.key))}`,
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

function renderSurface(session, current, view) {
  if (!current) {
    return (
      `<header class="ws-surface-head"><h2>工作面</h2></header>` +
      (lastError === ""
        ? stateBlock("disabled", "未解析焦点")
        : stateBlock("error", "请求失败", lastError))
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
    chip(`镜头：${lensLabel(current.lens)}`) +
    `</div>` +
    `</header>`;

  if (lastError !== "" && !view) {
    return (
      head +
      stateBlock("error", "请求失败", lastError) +
      `<button type="button" class="ws-button" data-ws-action="retry" title="重试解析">重试</button>`
    );
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
export function renderShell(root, sessionState, resolved) {
  if (!root) return;
  const current = currentFocus(sessionState);
  const view = resolved || null;

  const lensRail = root.querySelector('[data-region="lens-rail"]');
  if (lensRail) lensRail.innerHTML = renderLensRail(sessionState, current);

  const focusBar = root.querySelector('[data-region="focus-bar"]');
  if (focusBar) focusBar.innerHTML = renderFocusBar(sessionState, current, view);

  const surface = root.querySelector('[data-region="working-surface"]');
  if (surface) surface.innerHTML = renderSurface(sessionState, current, view);

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
    if (!options || options.navigate !== false) {
      state = navigate(state, {
        kind: answer.kind,
        id: answer.kind === "novel" ? identity.novelId : "",
        mode: answer.mode,
        lens: answer.defaultLens,
      });
    }
    setStatus("success", "已解析");
  } catch (error) {
    lastError = error && error.message ? error.message : "解析失败";
    setStatus("error", lastError);
  }
  render();
}

async function changeLens(lens) {
  const focus = currentFocus(state);
  state = setLens(state, lens);
  render();
  if (!focus) return;

  const identity = readIdentity();
  if (identity.novelId.length === 0) return;

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
      state = navigate(state, {
        kind: answer.kind,
        id: focus.id,
        mode: answer.mode,
        lens: lens,
      });
    }
  } catch (error) {
    lastError = error && error.message ? error.message : "解析失败";
    setStatus("error", lastError);
  }
  render();
}

function zoomBy(direction) {
  const focus = currentFocus(state);
  if (!focus) return;
  const index = WORKSPACE_ZOOM_LEVELS.indexOf(zoomFor(state, focus.key));
  const next = Math.max(0, Math.min(WORKSPACE_ZOOM_LEVELS.length - 1, index + direction));
  state = setZoom(state, focus.key, WORKSPACE_ZOOM_LEVELS[next]);
  render();
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
  lastError = "";
  resolveKind("novel", undefined, { navigate: true });
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
}

function retry() {
  const focus = currentFocus(state);
  resolveKind(focus ? focus.kind : "novel", focus ? focus.mode : undefined, {
    navigate: false,
  });
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
    state = goBack(state);
    render();
    return;
  }
  if (action === "breadcrumb") {
    state = focusToIndex(state, Number(trigger.getAttribute("data-ws-index")));
    render();
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

function boot() {
  const root = byId("workspace-shell");
  if (!root) return;
  document.addEventListener("click", handleClick);
  syncIdentityInputs(readIdentity());
  render();
  resolveKind("novel", undefined, { navigate: true });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
