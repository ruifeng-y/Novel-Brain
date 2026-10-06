/**
 * Candidate Review surface: the review surface of a Candidate Focus.
 *
 * A Candidate is content, not a decision subject. It can be adopted, edited,
 * rejected, or regenerated, and it can be compared, diffed, and inspected
 * against its evidence and impact. It has **no commit control**: committing is
 * decided on a Change Set Revision, after Validation and Approval, through the
 * Commit Gate. This module therefore never renders a commit action and never
 * calls a commit command; a Candidate is never the commit target.
 *
 * The module is DOM-free at import time, so it can be imported and driven in
 * Node. DOM work happens only inside renderCandidateReview.
 */

const ADOPTION_ACTIONS = [
  { action: "adopt", label: "采纳" },
  { action: "edit", label: "编辑", unavailable: "编辑候选内容随提案工作流提供" },
  { action: "reject", label: "驳回", unavailable: "驳回候选随提案工作流提供" },
  { action: "regenerate", label: "重新生成", unavailable: "重新生成随生产运行提供" },
];

const CHANGE_TYPE_LABELS = {
  text: "正文",
  local_text: "局部文本",
  structured_state: "状态",
  canonical_fact: "设定",
  composite: "复合变更",
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

function atomicChangesOf(change) {
  if (!change || typeof change !== "object") return [];
  if (change.type === "composite" && Array.isArray(change.changes)) return change.changes;
  return [change];
}

function targetOf(change) {
  if (change.type === "text" || change.type === "local_text") {
    return change.type === "local_text"
      ? `手稿 / ${change.sceneId} # ${change.targetSpan ? change.targetSpan.anchorId : ""}`
      : `手稿 / ${change.sceneId}`;
  }
  if (change.type === "structured_state") return `故事状态 / ${change.stateRecordId}`;
  if (change.type === "canonical_fact") return `设定 / ${change.canonicalFactId}`;
  return "未知目标";
}

function renderChange(view) {
  const changes = atomicChangesOf(view.change);
  if (changes.length === 0) {
    return stateBlock("disabled", "变更内容不可用");
  }
  return (
    `<ul class="ws-review-list">` +
    changes
      .map(
        change =>
          `<li class="ws-review-item">` +
          chip(CHANGE_TYPE_LABELS[change.type] || change.type) +
          `<span class="ws-review-target">${escapeText(targetOf(change))}</span>` +
          `</li>`,
      )
      .join("") +
    `</ul>`
  );
}

function renderDiff(view) {
  const entries = Array.isArray(view.diffEntries) ? view.diffEntries : [];
  if (entries.length === 0) return stateBlock("disabled", "暂无差异可比");
  return (
    `<ul class="ws-review-list">` +
    entries
      .map(
        entry =>
          `<li class="ws-review-item">` +
          chip(entry.changeType || "change") +
          `<span class="ws-review-target">${escapeText(
            entry.targetAddress === undefined ? "" : JSON.stringify(entry.targetAddress),
          )}</span>` +
          `</li>`,
      )
      .join("") +
    `</ul>`
  );
}

function renderValidation(view) {
  const validation = view.validation;
  if (!validation) return stateBlock("disabled", "尚未运行校验");
  const outcome = validation.outcome;
  const state = outcome === "pass" ? "success" : outcome === "fail" ? "error" : "degraded";
  const label =
    outcome === "pass" ? "校验通过" : outcome === "fail" ? "校验未通过" : "校验待人工确认";
  const findings = Array.isArray(validation.findings) ? validation.findings : [];
  return (
    stateBlock(state, label, validation.runId ? `运行 ${validation.runId}` : "") +
    (findings.length === 0
      ? ""
      : `<ul class="ws-review-list">` +
        findings
          .map(
            finding =>
              `<li class="ws-review-item">` +
              chip(finding.code || "finding") +
              `<span class="ws-review-target">${escapeText(finding.message || "")}</span>` +
              `</li>`,
          )
          .join("") +
        `</ul>`)
  );
}

function renderImpact(view) {
  const impact = Array.isArray(view.impact) ? view.impact : [];
  if (impact.length === 0) return stateBlock("disabled", "暂无影响信息");
  return (
    `<ul class="ws-review-list">` +
    impact.map(entry => `<li class="ws-review-item">${escapeText(entry)}</li>`).join("") +
    `</ul>`
  );
}

function renderAdoption(view) {
  const adoption = view.adoption;
  if (!adoption) return stateBlock("disabled", "尚未采纳");
  return stateBlock(
    "success",
    "已采纳为变更集修订",
    `${adoption.changeSetId} / ${adoption.revisionId}`,
  );
}

/**
 * Renders the Candidate Review surface. `handlers` receives the four adoption
 * actions; the surface itself decides nothing and holds no state.
 */
export function renderCandidateReview(root, view, handlers) {
  if (!root) return;
  const current = view && typeof view === "object" ? view : {};
  const bound = handlers && typeof handlers === "object" ? handlers : {};

  const head =
    `<header class="ws-surface-head"><h2>候选审阅</h2><div class="ws-facts">` +
    chip(`候选：${current.candidateId || "未指定"}`) +
    (current.taskId ? chip(`任务：${current.taskId}`) : "") +
    `</div></header>`;

  const boundary =
    `<p class="ws-review-note">候选内容不是提交对象。采纳后进入变更集修订，` +
    `校验与批准针对修订进行，提交在提交审阅中决定。</p>`;

  const error =
    current.error === undefined || current.error === ""
      ? ""
      : stateBlock("error", "请求失败", current.error);

  const actions =
    `<div class="ws-review-actions">` +
    ADOPTION_ACTIONS.map(action => {
      // Only adoption has an application action in W3; the others are shown as
      // the surface's action set and are honestly unavailable, never faked.
      const blocked = action.unavailable !== undefined || (action.action === "adopt" && !current.changeSetId);
      const title = action.unavailable !== undefined ? action.unavailable : action.action === "adopt" && !current.changeSetId ? "未指定变更集" : action.label;
      return (
        `<button type="button" class="ws-button" data-ws-action="${action.action}"` +
        `${blocked ? " disabled" : ""} title="${escapeText(title)}">${escapeText(action.label)}</button>`
      );
    }).join("") +
    `</div>`;

  root.innerHTML =
    head +
    error +
    boundary +
    section("变更", renderChange(current)) +
    section("差异", renderDiff(current)) +
    section("校验证据", renderValidation(current)) +
    section("影响", renderImpact(current)) +
    section("采纳状态", renderAdoption(current)) +
    actions;

  if (typeof root.querySelector === "function") {
    for (const action of ADOPTION_ACTIONS) {
      if (action.unavailable !== undefined) continue;
      const button = root.querySelector(`[data-ws-action="${action.action}"]`);
      const handler = bound[`on${action.action[0].toUpperCase()}${action.action.slice(1)}`];
      if (button && typeof button.addEventListener === "function" && typeof handler === "function") {
        button.addEventListener("click", event => handler(event));
      }
    }
  }
}
