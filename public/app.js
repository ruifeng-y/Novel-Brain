(function () {
  "use strict";

  var STORAGE_KEYS = {
    novelId: "novel-brain.novel-id",
    authorId: "novel-brain.author-id",
    runId: "novel-brain.run-id",
  };

  var VIEWS = ["overview", "foundation", "run", "recall"];

  var appState = {
    novelId: "",
    authorId: "",
    runId: "",
    activeView: "overview",
  };

  var STATE_MARKUP = {
    loading:
      '<div class="state-block" data-state="loading"><span class="pulse" aria-hidden="true"></span><span class="state-label">Loading</span></div>',
    empty:
      '<div class="state-block" data-state="empty"><span class="state-label">No items</span><span class="state-detail"></span><div class="state-actions" data-role="state-actions"></div></div>',
    error:
      '<div class="state-block" data-state="error"><span class="state-label">Request failed</span><span class="state-detail"></span><div class="state-actions"><button type="button" class="button" data-action="retry" title="Retry request">Retry</button></div></div>',
    disabled:
      '<div class="state-block" data-state="disabled"><span class="state-label">Unavailable</span><span class="state-detail"></span></div>',
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
    var message = error && error.message ? error.message : "Request failed";
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
      label: "Novel id required",
      detail: "Set a Novel id.",
    });
    return false;
  }

  function listOrEmpty(items, renderItem, emptyLabel) {
    if (items.length === 0) {
      return '<p class="inline-empty">' + escapeHtml(emptyLabel) + "</p>";
    }
    return '<ul class="item-list">' + items.map(renderItem).join("") + "</ul>";
  }

  /* Overview */
  function loadOverview() {
    var outcome = mountSurface("overview", "");
    if (!requireNovel(outcome)) return;
    renderState(outcome, "loading");
    api("/workspace/" + encodeURIComponent(appState.novelId))
      .then(function (view) {
        renderState(outcome, "success", { content: overviewMarkup(view) });
        setContextStatus("success", "Workspace loaded");
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
      '<div class="panel"><h3 class="panel-title">Workspace</h3><dl class="data-grid">' +
      row("Novel", code(view.novelId)) +
      row("Focus object", text(focus.object)) +
      row("Focus mode", text(focus.mode)) +
      row("Proposals", text(proposals.length)) +
      row("Open questions", text(openQuestions.length)) +
      row("Run status", text(run ? run.status : "none")) +
      row("Attention items", text(items.length)) +
      row("Truth owner", text(truth.owner)) +
      "</dl></div>" +
      '<div class="panel"><h3 class="panel-title">Proposals</h3>' +
      listOrEmpty(
        proposals,
        function (proposal) {
          return (
            '<li><span class="item-main">' +
            escapeHtml(proposal.id) +
            '<span class="item-meta">' +
            escapeHtml(proposal.stage || "") +
            "</span></span></li>"
          );
        },
        "No proposals",
      ) +
      "</div>"
    );
  }

  /* Foundation */
  function loadFoundation() {
    var outcome = mountSurface("foundation", "");
    if (!requireNovel(outcome)) return;
    renderState(outcome, "loading");
    api("/workspace/" + encodeURIComponent(appState.novelId) + "?object=story-foundation")
      .then(function (view) {
        var proposal = view.proposal || {};
        var proposals = Array.isArray(proposal.proposals) ? proposal.proposals : [];
        var openQuestions = Array.isArray(proposal.openQuestions)
          ? proposal.openQuestions
          : [];
        if (proposals.length === 0) {
          renderState(outcome, "empty", {
            label: "No proposals",
            detail: "No Narrative Proposal exists for this Novel.",
            actions:
              '<button type="button" class="button" data-action="start-blank-proposal" title="Start blank proposal">Start proposal</button>',
          });
        } else {
          renderState(outcome, "success", {
            content: foundationMarkup(proposals, openQuestions),
          });
        }
        setContextStatus("success", "Foundation loaded");
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  function foundationMarkup(proposals, openQuestions) {
    return (
      '<div class="panel"><h3 class="panel-title">Proposals</h3>' +
      listOrEmpty(
        proposals,
        function (proposal) {
          return (
            '<li><span class="item-main">' +
            escapeHtml(proposal.id) +
            '<span class="item-meta">' +
            escapeHtml(proposal.stage || "") +
            " / " +
            escapeHtml(proposal.currentRevisionId || "") +
            "</span></span></li>"
          );
        },
        "No proposals",
      ) +
      "</div>" +
      '<div class="panel"><h3 class="panel-title">Open questions</h3>' +
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
        "No open questions",
      ) +
      "</div>" +
      '<div class="panel"><h3 class="panel-title">Blank proposal</h3>' +
      '<div class="form-row"><button type="button" class="button" data-action="start-blank-proposal" title="Start blank proposal">Start proposal</button></div>' +
      "</div>"
    );
  }

  function startBlankProposal() {
    var outcome = mountSurface("foundation", "");
    if (!appState.novelId) {
      if (outcome) requireNovel(outcome);
      return;
    }
    if (outcome) renderState(outcome, "loading");
    api("/foundation/entries", {
      method: "POST",
      body: {
        entryId: newId("entry"),
        novelId: appState.novelId,
        proposalId: newId("proposal"),
        mode: "blank",
      },
    })
      .then(function () {
        setContextStatus("success", "Proposal started");
        loadFoundation();
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  /* Run */
  function runControlsMarkup() {
    var value = appState.runId ? ' value="' + escapeHtml(appState.runId) + '"' : "";
    return (
      '<div class="form-field"><label for="run-id">Run id</label>' +
      '<input id="run-id" name="runId" type="text" autocomplete="off" spellcheck="false"' +
      value +
      " /></div>" +
      '<button type="button" class="button" data-action="load-run" title="Load run status">Load</button>'
    );
  }

  function loadRun() {
    var outcome = mountSurface("run", runControlsMarkup());
    if (!appState.runId) {
      renderState(outcome, "disabled", {
        label: "Run id required",
        detail: "Load a Run to inspect its status.",
      });
      return;
    }
    renderState(outcome, "loading");
    api("/runs/" + encodeURIComponent(appState.runId) + "/status")
      .then(function (view) {
        renderState(outcome, "success", { content: runMarkup(view) });
        setContextStatus("success", "Run loaded");
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
      '<div class="panel"><h3 class="panel-title">Run</h3><dl class="data-grid">' +
      row("Run", code(run.id || view.runId)) +
      row("Novel", text(run.novelId || view.novelId)) +
      row("Status", text(run.status)) +
      row("Narrative state owner", text(boundary.narrativeStateOwner)) +
      row("Owns narrative truth", text(String(boundary.ownsNarrativeTruth))) +
      "</dl>" +
      '<div class="form-row run-actions">' +
      '<button type="button" class="button" data-action="pause-run" title="Pause run"' +
      (canPause ? "" : " disabled") +
      ">Pause</button>" +
      '<button type="button" class="button" data-action="resume-run" title="Resume run"' +
      (canResume ? "" : " disabled") +
      ">Resume</button>" +
      "</div></div>" +
      '<div class="panel"><h3 class="panel-title">Steps</h3>' +
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
        "No steps",
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
  function loadRecall() {
    var outcome = mountSurface("recall", "");
    if (!requireNovel(outcome)) return;
    renderState(outcome, "loading");
    api("/novels/" + encodeURIComponent(appState.novelId) + "/attention")
      .then(function (view) {
        var items = Array.isArray(view.items) ? view.items : [];
        if (items.length === 0) {
          renderState(outcome, "empty", {
            label: "No attention items",
            detail: "Nothing is flagged for this Novel.",
          });
        } else {
          renderState(outcome, "success", { content: recallMarkup(view, items) });
        }
        setContextStatus("success", "Recall loaded");
      })
      .catch(function (error) {
        showError(outcome, error);
      });
  }

  function recallMarkup(view, items) {
    var authority = view.authority || {};
    return (
      '<div class="panel"><h3 class="panel-title">Attention</h3><dl class="data-grid">' +
      row("Items", text(items.length)) +
      row("Authoritative", text(String(authority.authoritative))) +
      row("May mutate narrative truth", text(String(authority.mayMutateNarrativeTruth))) +
      row("May create task directly", text(String(authority.mayCreateTaskDirectly))) +
      row("May commit", text(String(authority.mayCommit))) +
      row("Proposed action channel", text(authority.proposedActionChannel)) +
      "</dl></div>" +
      '<div class="panel"><h3 class="panel-title">Items</h3>' +
      listOrEmpty(
        items,
        function (item) {
          var explanation = item.explanation || {};
          return (
            '<li><span class="item-main">' +
            escapeHtml(item.classification || item.detectionKind || item.itemId) +
            '<span class="item-meta">' +
            escapeHtml(explanation.reason || "") +
            "</span></span></li>"
          );
        },
        "No attention items",
      ) +
      "</div>"
    );
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
      setContextStatus("error", "Identity not persisted");
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
      setContextStatus("error", "Run id not persisted");
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
    if (action === "start-blank-proposal") {
      startBlankProposal();
      return;
    }
    if (action === "load-run") {
      var input = byId("run-id");
      saveRunId(input ? input.value : "");
      loadRun();
      return;
    }
    if (action === "pause-run") {
      transitionRun("pause");
      return;
    }
    if (action === "resume-run") {
      transitionRun("resume");
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
        setContextStatus("success", "Identity saved");
        loadView(appState.activeView);
      });
    });

    showView(appState.activeView);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
