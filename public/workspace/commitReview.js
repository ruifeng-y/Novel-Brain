/**
 * Commit Review surface: the review surface of a Change Set Revision and of a
 * committed Commit.
 *
 * For a revision it renders the five Commit Gate conditions independently —
 * each with its own status and reason — plus the required actions and the
 * commit control. The commit control is disabled while the gate is blocked and
 * names the blocking conditions; the surface never decides the gate itself, it
 * draws the answer of `commit.query.commit-gate`.
 *
 * For a commit it renders the provenance and audit of that commit: what it was
 * made of and what it recorded. It is read-only.
 *
 * The module is DOM-free at import time, so it can be imported and driven in
 * Node. DOM work happens only inside renderCommitReview.
 */

const GATE_CONDITIONS = [
  { key: "revisionValidity", label: "修订有效性" },
  { key: "concurrency", label: "并发一致性" },
  { key: "invariant", label: "不变量" },
  { key: "validation", label: "校验" },
  { key: "approval", label: "批准" },
];

const REQUIRED_ACTION_LABELS = {
  resolve_conflict: "解决冲突",
  rebase: "重做基线",
  reconcile_version: "对齐版本",
  fix_invariant: "修复不变量",
  fix_validation: "修复校验",
  obtain_review_decision: "取得审阅决策",
  revise_revision: "修改修订",
  regenerate: "重新生成",
};

const COMMIT_STATUS_LABELS = {
  pending: "待提交",
  committed: "已提交",
  stale: "已过期",
  failed: "提交失败",
};

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

function chip(label) {
  return `<span class="ws-chip">${escapeText(label)}</span>`;
}

function section(title, body) {
  return `<section class="ws-review-section"><h3>${escapeText(title)}</h3>${body}</section>`;
}

/**
 * The five conditions, each reported on its own row. They are never collapsed
 * into one indicator, and a failing row names its own reason.
 */
function renderGateConditions(gate) {
  if (!gate || typeof gate !== "object") {
    return stateBlock("disabled", "门禁尚未求值");
  }
  return (
    `<ul class="ws-gate-list">` +
    GATE_CONDITIONS.map(condition => {
      const value = gate[condition.key];
      const ok = value && value.ok === true;
      const reason = value && typeof value.reason === "string" ? value.reason : "";
      return (
        `<li class="ws-gate-row" data-gate="${condition.key}" data-state="${
          ok ? "success" : "error"
        }">` +
        `<span class="ws-gate-label">${escapeText(condition.label)}</span>` +
        `<span class="ws-gate-status">${ok ? "通过" : "未通过"}</span>` +
        (ok || reason === ""
          ? ""
          : `<span class="ws-gate-reason">${escapeText(reason)}</span>`) +
        `</li>`
      );
    }).join("") +
    `</ul>`
  );
}

function renderRequiredActions(gate) {
  const actions = gate && Array.isArray(gate.requiredActions) ? gate.requiredActions : [];
  if (actions.length === 0) return stateBlock("success", "无需额外动作");
  return (
    `<ul class="ws-review-list">` +
    actions
      .map(
        action =>
          `<li class="ws-review-item">${escapeText(REQUIRED_ACTION_LABELS[action] || action)}</li>`,
      )
      .join("") +
    `</ul>`
  );
}

function blockingNames(gate) {
  return GATE_CONDITIONS.filter(condition => {
    const value = gate ? gate[condition.key] : undefined;
    return value && value.ok === false;
  }).map(condition => condition.label);
}

function renderEvidence(view) {
  const runs = Array.isArray(view.validationRunIds) ? view.validationRunIds : [];
  const decisions = Array.isArray(view.reviewDecisionIds) ? view.reviewDecisionIds : [];
  const runRow =
    runs.length === 0
      ? stateBlock("disabled", "尚未指定校验证据")
      : `<div class="ws-facts">${runs.map(run => chip(`校验运行：${run}`)).join("")}</div>`;
  const decisionRow =
    decisions.length === 0
      ? stateBlock("disabled", "尚未记录批准决策")
      : `<div class="ws-facts">${decisions.map(d => chip(`批准决策：${d}`)).join("")}</div>`;
  const validationAction =
    typeof view.candidateId === "string" && view.candidateId.length > 0
      ? `<button type="button" class="ws-button" data-ws-action="run-validation" title="运行校验">运行校验</button>`
      : "";
  return runRow + decisionRow + validationAction;
}

function renderCommitControl(view, gate) {
  const allowed = Boolean(gate && gate.allowed === true);
  const blocked = blockingNames(gate);
  const disabledAttribute = allowed ? "" : " disabled";
  const blockedNote = allowed
    ? ""
    : stateBlock(
        "error",
        "提交已停用",
        blocked.length === 0 ? "门禁尚未求值" : `未通过的条件：${blocked.join("、")}`,
      );
  return (
    blockedNote +
    `<div class="ws-review-actions">` +
    `<button type="button" class="ws-button" data-ws-action="commit"${disabledAttribute} ` +
    `title="提交修订">提交修订</button>` +
    `</div>`
  );
}

function renderProvenance(view) {
  const provenance = view.provenance;
  if (!provenance || typeof provenance !== "object") {
    return stateBlock("disabled", "尚无提交来源");
  }
  const commit = provenance.commit || {};
  const runs = Array.isArray(provenance.validationRuns) ? provenance.validationRuns : [];
  const decisions = Array.isArray(provenance.reviewDecisions) ? provenance.reviewDecisions : [];
  const events = Array.isArray(provenance.auditEvents) ? provenance.auditEvents : [];
  return (
    `<div class="ws-facts">` +
    chip(`提交：${commit.id || ""}`) +
    chip(`状态：${COMMIT_STATUS_LABELS[commit.status] || commit.status || ""}`) +
    chip(`修订：${provenance.changeSetRevisionId || ""}`) +
    `</div>` +
    (runs.length === 0 ? "" : `<div class="ws-facts">${runs.map(run => chip(`校验运行：${run.id}`)).join("")}</div>`) +
    (decisions.length === 0
      ? ""
      : `<div class="ws-facts">${decisions.map(d => chip(`批准决策：${d.id}`)).join("")}</div>`) +
    section(
      "审计事件",
      events.length === 0
        ? stateBlock("disabled", "暂无审计事件")
        : `<ul class="ws-review-list">` +
          events
            .map(
              event =>
                `<li class="ws-review-item">` +
                chip(event.name || "event") +
                `<span class="ws-review-target">${escapeText(event.eventId || "")}</span>` +
                `</li>`,
            )
            .join("") +
          `</ul>`,
    )
  );
}

/**
 * Renders the Commit Review surface. `view.surface` is `"revision"` for a
 * Change Set Revision Focus and `"commit"` for a Commit Focus; anything else is
 * an honest unavailable state, because the commit control only belongs to a
 * revision whose gate has been evaluated.
 */
export function renderCommitReview(root, view, handlers) {
  if (!root) return;
  const current = view && typeof view === "object" ? view : {};
  const bound = handlers && typeof handlers === "object" ? handlers : {};
  const surface = current.surface === "commit" ? "commit" : current.surface === "revision" ? "revision" : "";

  const error =
    current.error === undefined || current.error === ""
      ? ""
      : stateBlock("error", "请求失败", current.error);

  if (surface === "") {
    root.innerHTML =
      `<header class="ws-surface-head"><h2>提交审阅</h2></header>` +
      error +
      stateBlock("disabled", "提交审阅仅在变更集修订或提交上可用");
    return;
  }

  if (surface === "commit") {
    root.innerHTML =
      `<header class="ws-surface-head"><h2>提交审阅</h2><div class="ws-facts">` +
      chip("已提交") +
      `</div></header>` +
      error +
      section("来源", renderProvenance(current));
    return;
  }

  const gate = current.gate;
  root.innerHTML =
    `<header class="ws-surface-head"><h2>提交审阅</h2><div class="ws-facts">` +
    chip(`变更集：${current.changeSetId || "未指定"}`) +
    chip(`修订：${current.revisionId || "未指定"}`) +
    `</div></header>` +
    error +
    section("门禁条件", renderGateConditions(gate)) +
    section("需要做的事", renderRequiredActions(gate)) +
    section("校验与批准证据", renderEvidence(current)) +
    section("提交", renderCommitControl(current, gate)) +
    section("来源与审计", renderProvenance(current));

  if (typeof root.querySelector === "function") {
    const bindings = [
      ["commit", bound.onCommit],
      ["run-validation", bound.onRunValidation],
    ];
    for (const [action, handler] of bindings) {
      const button = root.querySelector(`[data-ws-action="${action}"]`);
      if (button && typeof button.addEventListener === "function" && typeof handler === "function") {
        button.addEventListener("click", event => handler(event));
      }
    }
  }
}
