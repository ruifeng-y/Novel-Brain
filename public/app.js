(function () {
  "use strict";

  var STORAGE_KEYS = {
    novelId: "novel-brain.novel-id",
    authorId: "novel-brain.author-id",
    runId: "novel-brain.run-id",
  };

  var VIEWS = ["overview", "foundation", "run", "recall"];

  function emptyRunChain() {
    return {
      sceneId: "",
      sceneRevisionId: "",
      sceneTitle: "",
      chapterId: "",
      intent: "",
      planGoal: "",
      generationTaskId: "",
      planRevisionId: "",
      approvalId: "",
    };
  }

  var appState = {
    novelId: "",
    authorId: "",
    runId: "",
    activeView: "overview",
    foundationMode: "idea",
    foundationResult: undefined,
    recallItems: [],
    runChain: emptyRunChain(),
  };

  var STAGE_ORDER = ["frame", "explore", "deepen", "refine"];

  var STAGE_LABELS = {
    frame: "框架",
    explore: "探索",
    deepen: "深化",
    refine: "精炼",
  };

  function stageLabel(stage) {
    return STAGE_LABELS[stage] || stage;
  }

  var STATE_MARKUP = {
    loading:
      '<div class="state-block" data-state="loading"><span class="pulse" aria-hidden="true"></span><span class="state-label">加载中</span></div>',
    empty:
      '<div class="state-block" data-state="empty"><span class="state-label">暂无内容</span><span class="state-detail"></span><div class="state-actions" data-role="state-actions"></div></div>',
    error:
      '<div class="state-block" data-state="error"><span class="state-label">请求失败</span><span class="state-detail"></span><div class="state-actions"><button type="button" class="button" data-action="retry" title="重试请求">重试</button></div></div>',
    disabled:
      '<div class="state-block" data-state="disabled"><span class="state-label">不可用</span><span class="state-detail"></span></div>',
    success: '<div class="state-block" data-state="success"></div>',
  };

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function text(value) {
    return escapeHtml(value === undefined || value === null || value === "" ? "-" : value);
  }

  function code(value) {
    return "<code>" + text(value) + "</code>";
  }

  function row(label, value) {
    return "<dt>" + escapeHtml(label) + "</dt><dd>" + value + "</dd>";
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function viewSection(view) {
    return document.querySelector('[data-view="' + view + '"]');
  }

  function surfaceFor(view) {
    return document.querySelector('[data-view="' + view + '"] [data-role="view-surface"]');
  }

  function newId(prefix) {
    var suffix =
      window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : String(Date.now()) + "-" + String(Math.floor(Math.random() * 1000000));
    return prefix + "-" + suffix;
  }

  function setContextStatus(state, message) {
    var status = document.querySelector('[data-role="context-status"]');
    if (!status) return;
    status.setAttribute("data-state", state);
    status.textContent = message || "";
  }

  function mountSurface(view, controlsMarkup) {
    var surface = surfaceFor(view);
    if (!surface) return null;
    if (surface.dataset.mounted === "true") {
      return surface.querySelector('[data-role="outcome"]');
    }
    var controls = controlsMarkup
      ? '<div class="toolbar">' + controlsMarkup + "</div>"
      : "";
    surface.innerHTML = controls + '<div data-role="outcome"></div>';
    surface.dataset.mounted = "true";
    return surface.querySelector('[data-role="outcome"]');
  }

  function remountSurface(view) {
    var surface = surfaceFor(view);
    if (!surface) return;
    surface.innerHTML = "";
    surface.dataset.mounted = "false";
  }

  function renderState(outcome, state, options) {
    var config = options || {};
    if (!outcome) return null;
    outcome.innerHTML = STATE_MARKUP[state];
    var block = outcome.firstElementChild;
    if (!block) return null;
    var label = block.querySelector(".state-label");
    if (label && config.label) label.textContent = config.label;
    var detail = block.querySelector(".state-detail");
    if (detail && config.detail !== undefined) detail.textContent = config.detail;
    if (state === "success" && config.content) block.innerHTML = config.content;
    if (state === "empty" && config.actions) {
      var actions = block.querySelector('[data-role="state-actions"]');
      if (actions) actions.innerHTML = config.actions;
    }
    return block;
  }

  function showError(outcome, error) {
    var message = error && error.message ? error.message : "请求失败";
    setContextStatus("error", message);
    renderState(outcome, "error", { detail: message });
  }

  function api(path, options) {
    var config = options || {};
    var headers = { accept: "application/json" };
    if (appState.authorId) headers["x-author-id"] = appState.authorId;
    var request = { method: config.method || "GET", headers: headers };
    if (config.body !== undefined) {
      headers["content-type"] = "application/json";
      request.body = JSON.stringify(config.body);
    }
    return fetch(path, request).then(function (response) {
      return response.text().then(function (raw) {
        var payload = null;
        if (raw) {
          try {
            payload = JSON.parse(raw);
          } catch (error) {
            payload = raw;
          }
        }
        if (!response.ok) {
          var reason =
            payload && typeof payload === "object" && (payload.error || payload.message);
          var failure = new Error(
            typeof reason === "string" ? reason : "HTTP " + response.status,
          );
          failure.status = response.status;
          throw failure;
        }
        return payload;
      });
    });
  }

  function requireNovel(outcome) {
    if (appState.novelId) return true;
    renderState(outcome, "disabled", {
      label: "需要小说 ID",
      detail: "请设置小说 ID。",
    });
    return false;
  }

  function listOrEmpty(items, renderItem, emptyLabel) {
    if (items.length === 0) {
      return '<p class="inline-empty">' + escapeHtml(emptyLabel) + "</p>";
    }
    return '<ul class="item-list">' + items.map(renderItem).join("") + "</ul>";
  }

  /* Workspace bootstrap */
  function createNovel() {
    var authorField = byId("author-id");
    var titleField = byId("novel-title");
    var authorId = authorField ? authorField.value.trim() : appState.authorId;
    var title = titleField ? titleField.value.trim() : "";
    if (!authorId) {
      setContextStatus("disabled", "请先填写作者 ID");
      return;
    }
    if (!title) {
      setContextStatus("disabled", "请先填写书名");
      return;
    }
    var requestedId = newId("novel");
    setContextStatus("loading", "正在创建小说");
    api("/novels", {
      method: "POST",
      body: { id: requestedId, authorId: authorId, title: title },
    })
      .then(function (novel) {
        var createdId = novel && novel.id ? novel.id : requestedId;
        appState.novelId = createdId;
        if (byId("novel-id")) byId("novel-id").value = createdId;
        if (titleField) titleField.value = "";
        // A brand-new Novel cannot continue the previous Run chain.
        appState.runChain = emptyRunChain();
        saveRunId("");
        remountSurface("run");
        persistIdentity();
        setContextStatus("success", "小说已创建");
        loadView(appState.activeView);
      })
      .catch(function (error) {
        setContextStatus("error", error && error.message ? error.message : "创建小说失败");
      });
  }

  /* Overview */
  function loadOverview() {
    var outcome = mountSurface("overview", "");
    if (!requireNovel(outcome)) return;
    renderState(outcome, "loading");
    api("/workspace/" + encodeURIComponent(appState.novelId))
      .then(function (view) {
        renderState(outcome, "success", { content: overviewMarkup(view) });
        setContextStatus("success", "工作区已载入");
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  function overviewMarkup(view) {
    var proposal = view.proposal || {};
    var proposals = Array.isArray(proposal.proposals) ? proposal.proposals : [];
    var openQuestions = Array.isArray(proposal.openQuestions) ? proposal.openQuestions : [];
    var run = view.run;
    var attention = view.attention || { items: [] };
    var items = Array.isArray(attention.items) ? attention.items : [];
    var focus = proposal.focus || {};
    var truth = view.sharedTruth || {};
    return (
      '<div class="panel"><h3 class="panel-title">工作区</h3><dl class="data-grid">' +
      row("小说", code(view.novelId)) +
      row("焦点对象", text(focus.object)) +
      row("焦点模式", text(focus.mode)) +
      row("提案", text(proposals.length)) +
      row("待解决问题", text(openQuestions.length)) +
      row("生产运行状态", text(run ? run.status : "无")) +
      row("关注项", text(items.length)) +
      row("真相所有者", text(truth.owner)) +
      "</dl></div>" +
      '<div class="panel"><h3 class="panel-title">提案</h3>' +
      listOrEmpty(
        proposals,
        function (proposal) {
          return (
            '<li><span class="item-main">' +
            escapeHtml(proposal.id) +
            '<span class="item-meta">' +
            escapeHtml(stageLabel(proposal.stage) || "") +
            "</span></span></li>"
          );
        },
        "暂无提案",
      ) +
      "</div>"
    );
  }

  /* Foundation */
  var FOUNDATION_STATUS_LABELS = {
    proposal_created: "提案已创建",
    empty_narrative_state: "空的叙事状态",
  };

  function stageFor(proposalId) {
    try {
      var saved = localStorage.getItem("novel-brain.stage." + proposalId);
      if (saved && STAGE_ORDER.indexOf(saved) >= 0) return saved;
    } catch (error) {
      return "frame";
    }
    return "frame";
  }

  function saveStage(proposalId, stage) {
    try {
      localStorage.setItem("novel-brain.stage." + proposalId, stage);
    } catch (error) {
      return;
    }
  }

  function nextStage(stage) {
    var index = STAGE_ORDER.indexOf(stage);
    return index >= 0 && index < STAGE_ORDER.length - 1 ? STAGE_ORDER[index + 1] : undefined;
  }

  function foundationControlsMarkup() {
    return (
      '<div class="segmented" role="group" aria-label="故事基础模式">' +
      '<button type="button" class="segmented-item" data-mode="idea" data-action="set-foundation-mode" title="灵感">灵感</button>' +
      '<button type="button" class="segmented-item" data-mode="existing_text" data-action="set-foundation-mode" title="已有文本">已有文本</button>' +
      '<button type="button" class="segmented-item" data-mode="blank" data-action="set-foundation-mode" title="空白">空白</button>' +
      "</div>" +
      '<div class="form-field" data-role="foundation-input"></div>' +
      '<button type="button" class="button" data-action="create-foundation" title="创建提案" disabled>创建提案</button>'
    );
  }

  function foundationInputMarkup() {
    if (appState.foundationMode === "idea") {
      return (
        '<label for="foundation-idea">灵感</label>' +
        '<textarea id="foundation-idea" name="idea" rows="2" spellcheck="false"></textarea>'
      );
    }
    if (appState.foundationMode === "existing_text") {
      return (
        '<label for="foundation-text">已有文本</label>' +
        '<textarea id="foundation-text" name="text" rows="2" spellcheck="false"></textarea>'
      );
    }
    return '<p class="inline-empty">空的叙事状态</p>';
  }

  function renderFoundationForm() {
    var surface = surfaceFor("foundation");
    if (!surface) return;
    var buttons = surface.querySelectorAll("[data-mode]");
    for (var index = 0; index < buttons.length; index += 1) {
      var active = buttons[index].getAttribute("data-mode") === appState.foundationMode;
      buttons[index].classList.toggle("is-active", active);
      buttons[index].setAttribute("aria-pressed", active ? "true" : "false");
    }
    var input = surface.querySelector('[data-role="foundation-input"]');
    if (input) input.innerHTML = foundationInputMarkup();
    var submit = surface.querySelector('[data-action="create-foundation"]');
    if (submit) {
      var label = appState.foundationMode === "blank" ? "创建空状态" : "创建提案";
      submit.textContent = label;
      submit.setAttribute("title", label);
    }
    syncFoundationSubmit();
  }

  function syncFoundationSubmit() {
    var surface = surfaceFor("foundation");
    if (!surface) return;
    var submit = surface.querySelector('[data-action="create-foundation"]');
    if (!submit) return;
    var ready = Boolean(appState.novelId);
    if (appState.foundationMode === "idea") {
      var ideaField = byId("foundation-idea");
      ready = ready && Boolean(ideaField && ideaField.value.trim());
    } else if (appState.foundationMode === "existing_text") {
      var existingField = byId("foundation-text");
      ready = ready && Boolean(existingField && existingField.value.trim());
    }
    submit.disabled = !ready;
  }

  function foundationEntryPayload(mode, content) {
    var payload = {
      entryId: newId("entry"),
      novelId: appState.novelId,
      proposalId: newId("proposal"),
      mode: mode,
    };
    if (mode === "blank") return payload;
    if (mode === "idea") {
      payload.idea = content;
    } else {
      payload.text = content;
    }
    payload.generation = {
      taskId: newId("generation-task"),
      agentRole: "planner",
      modelPolicy: { provider: "deterministic", model: "foundation-reference", maxOutputTokens: 512 },
      basedOnVersionSet: {
        novel: { aggregateType: "Novel", objectId: appState.novelId, revisionId: "rev-1" },
      },
    };
    return payload;
  }

  function loadFoundation() {
    var outcome = mountSurface("foundation", foundationControlsMarkup());
    if (!outcome) return;
    renderFoundationForm();
    if (!requireNovel(outcome)) return;
    renderState(outcome, "loading");
    api("/workspace/" + encodeURIComponent(appState.novelId) + "?object=story-foundation")
      .then(function (view) {
        var proposal = view.proposal || {};
        var proposals = Array.isArray(proposal.proposals) ? proposal.proposals : [];
        var openQuestions = Array.isArray(proposal.openQuestions) ? proposal.openQuestions : [];
        if (proposals.length === 0) {
          renderState(outcome, "empty", {
            label: "暂无提案",
            detail: "该小说尚无叙事提案。",
          });
        } else {
          renderState(outcome, "success", {
            content: foundationMarkup(proposals, openQuestions),
          });
        }
        setContextStatus("success", "故事基础已载入");
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  function foundationMarkup(proposals, openQuestions) {
    return (
      foundationResultMarkup() +
      '<div class="panel"><h3 class="panel-title">提案</h3>' +
      '<ul class="item-list">' +
      proposals.map(proposalItemMarkup).join("") +
      "</ul></div>" +
      '<div class="panel"><h3 class="panel-title">待解决问题</h3>' +
      listOrEmpty(
        openQuestions,
        function (entry) {
          var question = entry.question || {};
          return (
            '<li><span class="item-main">' +
            escapeHtml(question.text || question.id || "-") +
            "</span></li>"
          );
        },
        "暂无待解决问题",
      ) +
      "</div>"
    );
  }

  function proposalItemMarkup(proposal) {
    var stage = stageFor(proposal.id);
    var next = nextStage(stage);
    var stageText = stageLabel(stage);
    var nextText = next ? stageLabel(next) : "";
    var actions = next
      ? '<input class="inline-input" type="text" data-role="question" data-proposal-id="' +
        escapeHtml(proposal.id) +
        '" aria-label="待解决问题" title="待解决问题" />' +
        '<button type="button" class="button" data-action="advance-proposal" data-proposal-id="' +
        escapeHtml(proposal.id) +
        '" data-from="' +
        escapeHtml(stage) +
        '" data-to="' +
        escapeHtml(next) +
        '" title="推进到' +
        escapeHtml(nextText) +
        '" disabled>推进到' +
        escapeHtml(nextText) +
        "</button>"
      : '<span class="boundary-badge">' + escapeHtml(stageText) + "</span>";
    return (
      '<li><span class="item-main">' +
      escapeHtml(proposal.id) +
      '<span class="item-meta">' +
      escapeHtml(stageText) +
      " / " +
      escapeHtml(proposal.currentRevisionId || "") +
      "</span></span>" +
      '<span class="item-actions">' +
      actions +
      "</span></li>"
    );
  }

  function foundationResultMarkup() {
    var result = appState.foundationResult;
    if (!result) return "";
    var created = result.status === "proposal_created";
    var label = FOUNDATION_STATUS_LABELS[result.status] || result.status;
    return (
      '<div class="panel"><h3 class="panel-title">最近一次录入</h3><dl class="data-grid">' +
      row("状态", text(result.status)) +
      row("结果", text(label)) +
      row("模式", text(result.mode)) +
      (created ? row("提案", code(result.proposalId)) : "") +
      row("自动提交", text(String(result.automaticCommit))) +
      "</dl></div>"
    );
  }

  function createFoundationEntry() {
    var outcome = mountSurface("foundation", foundationControlsMarkup());
    if (!appState.novelId) {
      if (outcome) requireNovel(outcome);
      return;
    }
    var mode = appState.foundationMode;
    var content = "";
    if (mode === "idea") {
      var ideaField = byId("foundation-idea");
      content = ideaField ? ideaField.value.trim() : "";
    } else if (mode === "existing_text") {
      var existingField = byId("foundation-text");
      content = existingField ? existingField.value.trim() : "";
    }
    if (mode !== "blank" && !content) return;
    appState.foundationResult = undefined;
    if (outcome) renderState(outcome, "loading");
    api("/foundation/entries", { method: "POST", body: foundationEntryPayload(mode, content) })
      .then(function (result) {
        appState.foundationResult = result;
        setContextStatus("success", FOUNDATION_STATUS_LABELS[result.status] || result.status);
        loadFoundation();
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  function advanceProposal(trigger) {
    var proposalId = trigger.getAttribute("data-proposal-id");
    var from = trigger.getAttribute("data-from");
    var to = trigger.getAttribute("data-to");
    var container = trigger.closest(".item-actions");
    var questionField = container ? container.querySelector('[data-role="question"]') : null;
    var questionText = questionField ? questionField.value.trim() : "";
    if (!proposalId || !from || !to || !questionText) return;
    var outcome = mountSurface("foundation", foundationControlsMarkup());
    if (outcome) renderState(outcome, "loading");
    api(
      "/foundation/proposals/" + encodeURIComponent(proposalId) + "/transitions",
      {
        method: "POST",
        body: {
          from: from,
          to: to,
          actor: "author",
          changes: [
            { kind: "add_open_question", question: { id: newId("question"), text: questionText } },
          ],
        },
      },
    )
      .then(function (result) {
        saveStage(proposalId, result.stage || to);
        setContextStatus("success", "阶段已推进");
        loadFoundation();
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  /* Run */
  function runControlsMarkup() {
    var chain = appState.runChain;
    var value = appState.runId ? ' value="' + escapeHtml(appState.runId) + '"' : "";
    return (
      '<div class="form-field"><label for="run-scene-title">场景标题</label>' +
      '<input id="run-scene-title" name="sceneTitle" type="text" autocomplete="off" spellcheck="false"' +
      (chain.sceneTitle ? ' value="' + escapeHtml(chain.sceneTitle) + '"' : "") +
      " /></div>" +
      '<div class="form-field"><label for="run-chapter-id">章节 ID</label>' +
      '<input id="run-chapter-id" name="chapterId" type="text" autocomplete="off" spellcheck="false"' +
      (chain.chapterId ? ' value="' + escapeHtml(chain.chapterId) + '"' : "") +
      " /></div>" +
      '<div class="form-field"><label for="run-scene-id">场景 ID</label>' +
      '<input id="run-scene-id" name="sceneId" type="text" autocomplete="off" spellcheck="false"' +
      (chain.sceneId ? ' value="' + escapeHtml(chain.sceneId) + '"' : "") +
      " /></div>" +
      '<button type="button" class="button" data-action="create-scene" title="创建场景">创建场景</button>' +
      '<div class="form-field"><label for="run-intent">生成意图</label>' +
      '<input id="run-intent" name="intent" type="text" autocomplete="off" spellcheck="false"' +
      (chain.intent ? ' value="' + escapeHtml(chain.intent) + '"' : "") +
      " /></div>" +
      '<button type="button" class="button" data-action="create-generation-task" title="创建生成任务">创建生成任务</button>' +
      '<div class="form-field"><label for="run-plan-goal">计划目标</label>' +
      '<input id="run-plan-goal" name="goal" type="text" autocomplete="off" spellcheck="false"' +
      (chain.planGoal ? ' value="' + escapeHtml(chain.planGoal) + '"' : "") +
      " /></div>" +
      '<button type="button" class="button" data-action="create-run-plan" title="创建计划修订">创建计划修订</button>' +
      '<button type="button" class="button" data-action="approve-run-plan" title="批准计划修订">批准计划</button>' +
      '<div class="form-field"><label for="run-id">生产运行 ID</label>' +
      '<input id="run-id" name="runId" type="text" autocomplete="off" spellcheck="false"' +
      value +
      " /></div>" +
      '<button type="button" class="button" data-action="load-run" title="载入生产运行状态">载入</button>' +
      '<button type="button" class="button" data-action="start-run" title="启动生产运行">启动生产运行</button>'
    );
  }

  function runChainMarkup() {
    var chain = appState.runChain;
    return (
      '<div class="panel"><h3 class="panel-title">创建链路</h3><dl class="data-grid">' +
      row("场景", chain.sceneId ? code(chain.sceneId) : text("未创建")) +
      row("场景修订", chain.sceneRevisionId ? code(chain.sceneRevisionId) : text("未创建")) +
      row("生成任务", chain.generationTaskId ? code(chain.generationTaskId) : text("未创建")) +
      row("计划修订", chain.planRevisionId ? code(chain.planRevisionId) : text("未创建")) +
      row("计划批准", chain.approvalId ? code(chain.approvalId) : text("未批准")) +
      row("生产运行", appState.runId ? code(appState.runId) : text("未启动")) +
      "</dl></div>"
    );
  }

  function loadRun() {
    var outcome = mountSurface("run", runControlsMarkup());
    if (!appState.novelId) {
      renderState(outcome, "disabled", {
        label: "需要小说 ID",
        detail: "请设置小说 ID。",
      });
      return;
    }
    if (!appState.runId) {
      var chain = appState.runChain;
      if (!chain.sceneId && !chain.generationTaskId && !chain.planRevisionId && !chain.approvalId) {
        renderState(outcome, "empty", {
          label: "尚无生产运行",
          detail: "先创建生成任务与计划修订，批准后即可启动生产运行。",
        });
        return;
      }
      renderState(outcome, "success", { content: runChainMarkup() });
      return;
    }
    renderState(outcome, "loading");
    api("/runs/" + encodeURIComponent(appState.runId) + "/status")
      .then(function (view) {
        renderState(outcome, "success", { content: runMarkup(view) + runChainMarkup() });
        setContextStatus("success", "生产运行已载入");
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  function createScene() {
    var outcome = mountSurface("run", runControlsMarkup());
    var titleField = byId("run-scene-title");
    var chapterField = byId("run-chapter-id");
    var sceneField = byId("run-scene-id");
    var title = titleField ? titleField.value.trim() : "";
    var chapterId = chapterField ? chapterField.value.trim() : "";
    var typedSceneId = sceneField ? sceneField.value.trim() : "";
    var chain = appState.runChain;
    if (!appState.novelId) {
      renderState(outcome, "disabled", {
        label: "需要小说 ID",
        detail: "请先创建或设置小说 ID。",
      });
      return;
    }
    if (!chapterId || !title) {
      renderState(outcome, "disabled", {
        label: "需要章节与场景标题",
        detail: "请填写章节 ID 与场景标题。",
      });
      return;
    }
    var sceneId = typedSceneId || newId("scene");
    chain.sceneTitle = title;
    chain.chapterId = chapterId;
    if (outcome) renderState(outcome, "loading");
    api("/novels/" + encodeURIComponent(appState.novelId) + "/scenes", {
      method: "POST",
      body: { id: sceneId, chapterId: chapterId, title: title },
    })
      .then(function (scene) {
        var createdSceneId = scene && scene.id ? scene.id : sceneId;
        var createdRevisionId =
          scene && scene.currentRevisionId ? scene.currentRevisionId : "";
        chain.sceneId = createdSceneId;
        chain.sceneRevisionId = createdRevisionId;
        if (byId("run-scene-id")) byId("run-scene-id").value = createdSceneId;
        setContextStatus("success", "场景已创建");
        loadRun();
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  function createGenerationTask() {
    var outcome = mountSurface("run", runControlsMarkup());
    var sceneField = byId("run-scene-id");
    var intentField = byId("run-intent");
    var sceneId = sceneField ? sceneField.value.trim() : "";
    var intent = intentField ? intentField.value.trim() : "";
    var chain = appState.runChain;
    if (!appState.novelId || !sceneId || !intent) {
      renderState(outcome, "disabled", {
        label: "需要小说、场景与意图",
        detail: "请设置小说 ID、场景 ID 与生成意图。",
      });
      return;
    }
    if (!chain.sceneRevisionId || chain.sceneId !== sceneId) {
      renderState(outcome, "disabled", {
        label: "需要先创建场景",
        detail: "请先创建场景，生成任务将引用该场景返回的修订。",
      });
      return;
    }
    chain.intent = intent;
    if (outcome) renderState(outcome, "loading");
    api("/novels/" + encodeURIComponent(appState.novelId) + "/generation-tasks", {
      method: "POST",
      body: {
        id: newId("generation-task"),
        operation: "scene_generation",
        targetSceneId: sceneId,
        intent: intent,
        basedOnVersionSet: {
          scene: {
            aggregateType: "Scene",
            objectId: sceneId,
            revisionId: chain.sceneRevisionId,
          },
        },
      },
    })
      .then(function (task) {
        appState.runChain.generationTaskId = task && task.id ? task.id : "";
        setContextStatus("success", "生成任务已创建");
        loadRun();
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  function createRunPlan() {
    var outcome = mountSurface("run", runControlsMarkup());
    var goalField = byId("run-plan-goal");
    var goal = goalField ? goalField.value.trim() : "";
    var chain = appState.runChain;
    if (!appState.novelId || !chain.generationTaskId || !goal) {
      renderState(outcome, "disabled", {
        label: "需要生成任务与计划目标",
        detail: "请先创建生成任务，并填写计划目标。",
      });
      return;
    }
    chain.planGoal = goal;
    var revisionId = newId("plan-revision");
    if (outcome) renderState(outcome, "loading");
    api("/run-plans", {
      method: "POST",
      body: {
        id: revisionId,
        planId: newId("plan"),
        novelId: appState.novelId,
        revisionNumber: 1,
        goal: goal,
        steps: [
          { id: "step-1", ordinal: 1, generationTaskId: chain.generationTaskId, dependsOn: [] },
        ],
      },
    })
      .then(function (revision) {
        chain.planRevisionId = revision && revision.id ? revision.id : revisionId;
        chain.approvalId = "";
        setContextStatus("success", "计划修订已创建");
        loadRun();
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  function approveRunPlan() {
    var outcome = mountSurface("run", runControlsMarkup());
    var chain = appState.runChain;
    if (!chain.planRevisionId) {
      renderState(outcome, "disabled", {
        label: "需要计划修订",
        detail: "请先创建计划修订，再批准计划。",
      });
      return;
    }
    if (outcome) renderState(outcome, "loading");
    api("/run-plans/" + encodeURIComponent(chain.planRevisionId) + "/approvals", {
      method: "POST",
      body: {
        approvalId: newId("approval"),
        approvedBy: appState.authorId || "author",
        evidenceReferences: [chain.planRevisionId],
      },
    })
      .then(function (approval) {
        chain.approvalId = approval && approval.id ? approval.id : "";
        setContextStatus("success", "计划已批准");
        loadRun();
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  function startRun() {
    var outcome = mountSurface("run", runControlsMarkup());
    var chain = appState.runChain;
    if (!appState.novelId || !chain.planRevisionId || !chain.approvalId) {
      renderState(outcome, "disabled", {
        label: "需要已批准的计划修订",
        detail: "请先创建计划修订并批准，再启动生产运行。",
      });
      return;
    }
    var runIdField = byId("run-id");
    var runId = runIdField && runIdField.value.trim() ? runIdField.value.trim() : newId("run");
    saveRunId(runId);
    if (runIdField) runIdField.value = runId;
    if (outcome) renderState(outcome, "loading");
    api("/runs", {
      method: "POST",
      body: { id: runId, novelId: appState.novelId, runPlanRevisionId: chain.planRevisionId },
    })
      .then(function (view) {
        renderState(outcome, "success", { content: runMarkup(view) + runChainMarkup() });
        setContextStatus("success", "生产运行已启动");
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  function runMarkup(view) {
    var run = view.run || {};
    var steps = Array.isArray(run.stepStates) ? run.stepStates : [];
    var boundary = view.stateBoundary || {};
    var canPause = run.status === "running";
    var canResume = run.status === "paused";
    return (
      '<div class="panel"><h3 class="panel-title">生产运行</h3><dl class="data-grid">' +
      row("生产运行", code(run.id || view.runId)) +
      row("小说", text(run.novelId || view.novelId)) +
      row("状态", text(run.status)) +
      row("叙事状态所有者", text(boundary.narrativeStateOwner)) +
      row("拥有叙事真相", text(String(boundary.ownsNarrativeTruth))) +
      "</dl>" +
      '<div class="form-row run-actions">' +
      '<button type="button" class="button" data-action="pause-run" title="暂停生产运行"' +
      (canPause ? "" : " disabled") +
      ">暂停</button>" +
      '<button type="button" class="button" data-action="resume-run" title="继续生产运行"' +
      (canResume ? "" : " disabled") +
      ">继续</button>" +
      "</div></div>" +
      '<div class="panel"><h3 class="panel-title">步骤</h3>' +
      listOrEmpty(
        steps,
        function (step) {
          return (
            '<li><span class="item-main">' +
            escapeHtml(step.stepId || step.id || "-") +
            '<span class="item-meta">' +
            escapeHtml(step.status || "") +
            "</span></span></li>"
          );
        },
        "暂无步骤",
      ) +
      "</div>"
    );
  }

  function transitionRun(action) {
    if (!appState.runId) return;
    var outcome = mountSurface("run", runControlsMarkup());
    if (outcome) renderState(outcome, "loading");
    api("/runs/" + encodeURIComponent(appState.runId) + "/" + action, {
      method: "POST",
      body: {},
    })
      .then(function () {
        loadRun();
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  /* Recall */
  var RECALL_ACTIONS = [
    { action: "inspect", label: "查看" },
    { action: "dismiss", label: "关闭" },
    { action: "snooze", label: "暂停" },
    { action: "confirm", label: "确认" },
    { action: "ignore", label: "忽略" },
    { action: "why", label: "原因" },
  ];

  var RECALL_STATE_LABELS = {
    active: "待处理",
    inspected: "已查看",
    dismissed: "已关闭",
    snoozed: "已暂停",
    confirmed: "已确认",
    ignored: "已忽略",
    why_requested: "已请求原因",
  };

  function recallStateLabel(state) {
    return RECALL_STATE_LABELS[state] || state || "未处置";
  }

  function recallControlsMarkup() {
    return (
      '<div class="form-field"><label for="recall-snooze-until">暂停至此时间</label>' +
      '<input id="recall-snooze-until" name="snoozedUntil" type="text" autocomplete="off"' +
      ' spellcheck="false" placeholder="2026-10-06T00:00:00.000Z" /></div>'
    );
  }

  function loadRecall() {
    var outcome = mountSurface("recall", recallControlsMarkup());
    if (!requireNovel(outcome)) return;
    renderState(outcome, "loading");
    api("/novels/" + encodeURIComponent(appState.novelId) + "/attention")
      .then(function (view) {
        var items = Array.isArray(view.items) ? view.items : [];
        appState.recallItems = items;
        if (items.length === 0) {
          renderState(outcome, "empty", {
            label: "暂无关注项",
            detail: "该小说目前没有标记项。",
          });
        } else {
          renderState(outcome, "success", { content: recallMarkup(view, items) });
        }
        setContextStatus("success", "召回已载入");
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  function recallMarkup(view, items) {
    var authority = view.authority || {};
    var dispositions = Array.isArray(view.dispositions) ? view.dispositions : [];
    var dispositionByItem = Object.create(null);
    dispositions.forEach(function (disposition) {
      dispositionByItem[disposition.itemId] = disposition;
    });
    return (
      '<div class="panel"><h3 class="panel-title">关注</h3><dl class="data-grid">' +
      row("条目", text(items.length)) +
      row("已处置", text(dispositions.length)) +
      row("具有权威性", text(String(authority.authoritative))) +
      row("可修改叙事真相", text(String(authority.mayMutateNarrativeTruth))) +
      row("可直接创建任务", text(String(authority.mayCreateTaskDirectly))) +
      row("可提交", text(String(authority.mayCommit))) +
      row("建议动作通道", text(authority.proposedActionChannel)) +
      "</dl><p class=\"inline-note\">召回只读：记录处置只变更关注状态，不提交、不创建任务。</p></div>" +
      '<div class="panel"><h3 class="panel-title">条目</h3>' +
      listOrEmpty(
        items,
        function (item) {
          return recallItemMarkup(item, dispositionByItem[item.itemId]);
        },
        "暂无关注项",
      ) +
      "</div>"
    );
  }

  function recallItemMarkup(item, disposition) {
    var explanation = item.explanation || {};
    return (
      '<li data-item-id="' +
      escapeHtml(item.itemId) +
      '"><span class="item-main">' +
      escapeHtml(item.classification || item.detectionKind || item.itemId) +
      '<span class="item-meta">' +
      escapeHtml(explanation.reason || "") +
      "</span>" +
      '<span class="item-meta">处置状态：' +
      escapeHtml(recallStateLabel(disposition ? disposition.state : "")) +
      "</span></span>" +
      '<span class="item-actions">' +
      recallActionButtons(item) +
      "</span></li>"
    );
  }

  function recallActionButtons(item) {
    return RECALL_ACTIONS.map(function (entry) {
      return (
        '<button type="button" class="button" data-action="record-disposition" data-item-id="' +
        escapeHtml(item.itemId) +
        '" data-disposition-action="' +
        entry.action +
        '" title="' +
        escapeHtml(entry.label) +
        '该关注项">' +
        escapeHtml(entry.label) +
        "</button>"
      );
    }).join("");
  }

  function recallItemById(itemId) {
    for (var index = 0; index < appState.recallItems.length; index += 1) {
      if (appState.recallItems[index].itemId === itemId) return appState.recallItems[index];
    }
    return null;
  }

  function dispositionEvidenceReferences(item) {
    var explanation = item.explanation || {};
    if (
      Array.isArray(explanation.evidenceReferences) &&
      explanation.evidenceReferences.length > 0
    ) {
      return explanation.evidenceReferences;
    }
    if (Array.isArray(item.evidence)) {
      return item.evidence
        .map(function (entry) {
          return entry.evidenceReference;
        })
        .filter(function (reference) {
          return Boolean(reference);
        });
    }
    return [];
  }

  function recordDisposition(itemId, action) {
    var outcome = mountSurface("recall", recallControlsMarkup());
    var item = recallItemById(itemId);
    if (!item || !item.evidenceFingerprint) {
      renderState(outcome, "disabled", {
        label: "关注项不可用",
        detail: "请重新载入关注项后再处置。",
      });
      return;
    }
    var evidenceReferences = dispositionEvidenceReferences(item);
    if (evidenceReferences.length === 0) {
      renderState(outcome, "disabled", {
        label: "缺少证据引用",
        detail: "该关注项没有可回传的证据引用。",
      });
      return;
    }
    var body = {
      novelId: item.novelId || appState.novelId,
      candidateId: item.candidateId,
      evidenceFingerprint: item.evidenceFingerprint,
      reason: (item.explanation && item.explanation.reason) || item.detectionKind,
      evidenceReferences: evidenceReferences,
      action: action,
    };
    if (action === "snooze") {
      var snoozeField = byId("recall-snooze-until");
      var snoozedUntil = snoozeField ? snoozeField.value.trim() : "";
      if (!snoozedUntil) {
        renderState(outcome, "disabled", {
          label: "需要暂停时间",
          detail: "请填写 ISO 时间后再暂停。",
        });
        return;
      }
      body.snoozedUntil = snoozedUntil;
    }
    renderState(outcome, "loading");
    api("/attention/" + encodeURIComponent(itemId) + "/dispositions", {
      method: "POST",
      body: body,
    })
      .then(function () {
        setContextStatus("success", "关注项处置已记录");
        loadRecall();
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  function loadView(view) {
    if (view === "overview") return loadOverview();
    if (view === "foundation") return loadFoundation();
    if (view === "run") return loadRun();
    if (view === "recall") return loadRecall();
    return undefined;
  }

  function showView(view) {
    appState.activeView = view;
    VIEWS.forEach(function (name) {
      var section = viewSection(name);
      var nav = document.querySelector('[data-nav="' + name + '"]');
      var active = name === view;
      if (section) {
        section.hidden = !active;
        section.setAttribute("aria-hidden", active ? "false" : "true");
      }
      if (nav) {
        nav.classList.toggle("is-active", active);
        if (active) nav.setAttribute("aria-current", "true");
        else nav.removeAttribute("aria-current");
      }
    });
    loadView(view);
  }

  function persistIdentity() {
    var novelInput = byId("novel-id");
    var authorInput = byId("author-id");
    appState.novelId = novelInput ? novelInput.value.trim() : appState.novelId;
    appState.authorId = authorInput ? authorInput.value.trim() : appState.authorId;
    try {
      localStorage.setItem(STORAGE_KEYS.novelId, appState.novelId);
      localStorage.setItem(STORAGE_KEYS.authorId, appState.authorId);
    } catch (error) {
      setContextStatus("error", "身份未持久化");
    }
  }

  function readIdentity() {
    try {
      appState.novelId = localStorage.getItem(STORAGE_KEYS.novelId) || "";
      appState.authorId = localStorage.getItem(STORAGE_KEYS.authorId) || "";
      appState.runId = localStorage.getItem(STORAGE_KEYS.runId) || "";
    } catch (error) {
      appState.novelId = appState.novelId || "";
    }
    if (byId("novel-id")) byId("novel-id").value = appState.novelId;
    if (byId("author-id")) byId("author-id").value = appState.authorId;
  }

  function saveRunId(value) {
    appState.runId = value.trim();
    try {
      localStorage.setItem(STORAGE_KEYS.runId, appState.runId);
    } catch (error) {
      setContextStatus("error", "生产运行 ID 未持久化");
    }
  }

  function handleAction(action, trigger) {
    if (action === "reload" || action === "refresh") {
      var section = trigger.closest("[data-view]");
      loadView(section ? section.getAttribute("data-view") : appState.activeView);
      return;
    }
    if (action === "retry") {
      var owner = trigger.closest("[data-view]");
      loadView(owner ? owner.getAttribute("data-view") : appState.activeView);
      return;
    }
    if (action === "create-novel") {
      createNovel();
      return;
    }
    if (action === "set-foundation-mode") {
      appState.foundationMode = trigger.getAttribute("data-mode");
      renderFoundationForm();
      return;
    }
    if (action === "create-foundation") {
      createFoundationEntry();
      return;
    }
    if (action === "advance-proposal") {
      advanceProposal(trigger);
      return;
    }
    if (action === "load-run") {
      var input = byId("run-id");
      saveRunId(input ? input.value : "");
      loadRun();
      return;
    }
    if (action === "create-scene") {
      createScene();
      return;
    }
    if (action === "create-generation-task") {
      createGenerationTask();
      return;
    }
    if (action === "create-run-plan") {
      createRunPlan();
      return;
    }
    if (action === "approve-run-plan") {
      approveRunPlan();
      return;
    }
    if (action === "start-run") {
      startRun();
      return;
    }
    if (action === "pause-run") {
      transitionRun("pause");
      return;
    }
    if (action === "resume-run") {
      transitionRun("resume");
      return;
    }
    if (action === "record-disposition") {
      recordDisposition(
        trigger.getAttribute("data-item-id"),
        trigger.getAttribute("data-disposition-action"),
      );
    }
  }

  function init() {
    readIdentity();

    document.addEventListener("click", function (event) {
      var navTarget = event.target.closest("[data-nav]");
      if (navTarget) {
        showView(navTarget.getAttribute("data-nav"));
        return;
      }
      var actionTarget = event.target.closest("[data-action]");
      if (actionTarget) {
        handleAction(actionTarget.getAttribute("data-action"), actionTarget);
      }
    });

    var novelInput = byId("novel-id");
    var authorInput = byId("author-id");
    [novelInput, authorInput].forEach(function (input) {
      if (!input) return;
      input.addEventListener("input", function () {
        persistIdentity();
      });
      input.addEventListener("change", function () {
        persistIdentity();
        setContextStatus("success", "身份已保存");
        loadView(appState.activeView);
      });
    });

    document.addEventListener("input", function (event) {
      var target = event.target;
      if (!target || typeof target.id !== "string") return;
      if (target.id === "foundation-idea" || target.id === "foundation-text") {
        syncFoundationSubmit();
        return;
      }
      if (target.getAttribute && target.getAttribute("data-role") === "question") {
        var container = target.closest(".item-actions");
        var button = container ? container.querySelector('[data-action="advance-proposal"]') : null;
        if (button) button.disabled = target.value.trim().length === 0;
      }
    });

    showView(appState.activeView);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
