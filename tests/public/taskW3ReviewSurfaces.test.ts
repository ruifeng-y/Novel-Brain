import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createNovelBrainServer } from "../../src/http/server";

/**
 * These tests load the real browser modules and drive them directly against a
 * fake root. Both modules are DOM-free at import time, so the render branches
 * run in Node.
 */
async function loadModule(name: string): Promise<Record<string, any>> {
  const url = pathToFileURL(resolve("public/workspace", name)).href;
  return (await import(/* @vite-ignore */ url)) as Record<string, any>;
}

function source(name: string): string {
  return readFileSync(resolve("public/workspace", name), "utf8");
}

function fakeRoot(): { innerHTML: string; querySelector: () => null; addEventListener(): void } {
  return { innerHTML: "", querySelector: () => null, addEventListener() {} };
}

const gateFixture = {
  revisionValidity: { ok: true },
  concurrency: { ok: true },
  invariant: { ok: true },
  validation: { ok: false, reason: "Mandatory validation reported a failed outcome" },
  approval: { ok: true },
  allowed: false,
  blockers: [
    {
      type: "mandatory_validation_failed",
      reason: "Mandatory validation reported a failed outcome",
      facts: ["validationOutcome=fail"],
      evidenceReferences: ["run-1"],
    },
  ],
  requiredActions: ["fix_validation"],
};

describe("[task:W3] [cross-system] candidate and commit review surfaces", () => {
  it("renders the candidate surface without any commit control", async () => {
    const { renderCandidateReview } = await loadModule("candidateReview.js");
    const root = fakeRoot();

    renderCandidateReview(root, {
      surface: "candidate",
      candidateId: "candidate-1",
      changeSetId: "cs-1",
      taskId: "task-1",
      change: { type: "text", sceneId: "scene-1", text: "新文本。" },
    });

    expect(root.innerHTML).toContain("候选审阅");
    expect(root.innerHTML).toContain("candidate-1");
    // The Candidate is never the commit target: there is no commit control,
    // and the surface says where committing actually happens.
    expect(root.innerHTML).not.toContain('data-ws-action="commit"');
    expect(root.innerHTML).toContain("候选内容不是提交对象");
    // The four adoption actions are present; only adoption is available.
    for (const action of ["adopt", "edit", "reject", "regenerate"]) {
      expect(root.innerHTML).toContain(`data-ws-action="${action}"`);
    }
    expect(root.innerHTML).toContain('data-ws-action="adopt" title="采纳"');
    expect(root.innerHTML).toContain('data-ws-action="edit" disabled');
    expect(root.innerHTML).toContain('data-ws-action="reject" disabled');
    expect(root.innerHTML).toContain('data-ws-action="regenerate" disabled');
  });

  it("renders the five gate conditions independently, each with its own reason", async () => {
    const { renderCommitReview } = await loadModule("commitReview.js");
    const root = fakeRoot();

    renderCommitReview(root, {
      surface: "revision",
      changeSetId: "cs-1",
      revisionId: "cs-1:r1",
      validationRunIds: ["run-1"],
      reviewDecisionIds: ["review-1"],
      gate: gateFixture,
    });

    for (const condition of [
      "revisionValidity",
      "concurrency",
      "invariant",
      "validation",
      "approval",
    ]) {
      expect(root.innerHTML).toContain(`data-gate="${condition}"`);
    }
    expect(root.innerHTML).toContain('data-gate="validation" data-state="error"');
    expect(root.innerHTML).toContain('data-gate="approval" data-state="success"');
    expect(root.innerHTML).toContain("Mandatory validation reported a failed outcome");
    expect(root.innerHTML).toContain("修复校验");
  });

  it("disables the commit control while the gate is blocked and names the blocking conditions", async () => {
    const { renderCommitReview } = await loadModule("commitReview.js");
    const blocked = fakeRoot();
    const allowed = fakeRoot();

    renderCommitReview(blocked, {
      surface: "revision",
      changeSetId: "cs-1",
      revisionId: "cs-1:r1",
      validationRunIds: ["run-1"],
      gate: gateFixture,
    });
    expect(blocked.innerHTML).toContain('data-ws-action="commit" disabled');
    expect(blocked.innerHTML).toContain("提交已停用");
    expect(blocked.innerHTML).toContain("未通过的条件：校验");

    renderCommitReview(allowed, {
      surface: "revision",
      changeSetId: "cs-1",
      revisionId: "cs-1:r1",
      validationRunIds: ["run-1"],
      gate: {
        revisionValidity: { ok: true },
        concurrency: { ok: true },
        invariant: { ok: true },
        validation: { ok: true },
        approval: { ok: true },
        allowed: true,
        blockers: [],
        requiredActions: [],
      },
    });
    expect(allowed.innerHTML).toContain('data-ws-action="commit"');
    expect(allowed.innerHTML).not.toContain('data-ws-action="commit" disabled');
    expect(allowed.innerHTML).toContain("无需额外动作");
  });

  it("renders the provenance and audit of a commit", async () => {
    const { renderCommitReview } = await loadModule("commitReview.js");
    const root = fakeRoot();

    renderCommitReview(root, {
      surface: "commit",
      novelId: "novel-1",
      provenance: {
        commit: { id: "commit-1", status: "committed" },
        changeSetRevisionId: "cs-1:r1",
        validationRuns: [{ id: "run-1" }],
        reviewDecisions: [{ id: "review-1" }],
        auditEvents: [{ eventId: "event-1", name: "NarrativeCommitRecorded" }],
      },
    });

    expect(root.innerHTML).toContain("commit-1");
    expect(root.innerHTML).toContain("已提交");
    expect(root.innerHTML).toContain("cs-1:r1");
    expect(root.innerHTML).toContain("run-1");
    expect(root.innerHTML).toContain("review-1");
    expect(root.innerHTML).toContain("NarrativeCommitRecorded");
    // A commit has already happened: there is nothing to commit from here.
    expect(root.innerHTML).not.toContain('data-ws-action="commit"');
  });

  it("offers no commit control outside a revision or a commit", async () => {
    const { renderCommitReview } = await loadModule("commitReview.js");
    const root = fakeRoot();

    renderCommitReview(root, {
      surface: "candidate",
      candidateId: "candidate-1",
      error: "无法解析修订地址",
    });

    expect(root.innerHTML).not.toContain('data-ws-action="commit"');
    expect(root.innerHTML).toContain("提交审阅仅在变更集修订或提交上可用");
    expect(root.innerHTML).toContain("无法解析修订地址");
  });

  it("serves both review modules as workspace assets", async () => {
    const app = createNovelBrainServer(createInMemoryEngineDependencies());

    for (const name of ["candidateReview.js", "commitReview.js"]) {
      const response = await app.inject({ method: "GET", url: `/workspace/${name}` });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/javascript");
    }
    await app.close();
  });

  it("seeds a Focus from the URL without adding a navigation control", async () => {
    const { seededFocus } = await loadModule("shell.js");

    // A revision address is a pair, so the id keeps its own colon.
    expect(seededFocus("?focus=change-set-revision:cs-1:cs-1:r1")).toEqual({
      kind: "change-set-revision",
      id: "cs-1:cs-1:r1",
    });
    expect(seededFocus("?focus=candidate:cs-1:candidate-1")).toEqual({
      kind: "candidate",
      id: "cs-1:candidate-1",
    });
    expect(seededFocus("?focus=candidate")).toEqual({ kind: "candidate", id: "" });
    expect(seededFocus("?focus=commit:commit-1")).toEqual({ kind: "commit", id: "commit-1" });

    // Only kinds the shell knows, and only when asked.
    expect(seededFocus("?focus=not-a-kind")).toBe(null);
    expect(seededFocus("?other=1")).toBe(null);
    expect(seededFocus("")).toBe(null);
  });

  it("applies the seeded Focus at boot on top of the resolved Novel", () => {
    const shell = source("shell.js");
    const boot = shell.slice(shell.indexOf("function boot()"), shell.indexOf("function boot()") + 900);

    expect(boot).toContain("seededFocus()");
    expect(boot).toContain("resolveKind(seeded.kind, undefined, { id: seeded.id })");
    // The Novel is resolved first, so the structure lens still loads.
    expect(boot).toContain('resolveKind("novel", undefined, { navigate: true })');
  });
});

describe("[task:W3] [regression] the commit spine does not reopen the candidate path", () => {
  it("never lets the candidate surface reach a commit command", async () => {
    const module = source("candidateReview.js");

    expect(module).not.toContain('data-ws-action="commit"');
    expect(module).not.toContain("commitRevision");
    expect(module).not.toContain("commitChangeSetRevision");
    expect(module).not.toContain("/commit");
  });

  it("keeps the commit request free of candidate fields", () => {
    const routes = readFileSync(resolve("src/http/routes.ts"), "utf8");
    const schema = routes.slice(
      routes.indexOf("const commitRequestSchema"),
      routes.indexOf(".strict();", routes.indexOf("const commitRequestSchema")),
    );

    expect(schema).not.toContain("candidateId");
    expect(schema).not.toContain("candidateSource");
    expect(schema).not.toContain("validationId");
    expect(schema).not.toContain("reviewDecision:");
  });

  it("mounts the review surfaces by the server's own surface phrases only", () => {
    const shell = source("shell.js");

    expect(shell).toContain('"compare, diff": { label: "候选审阅", review: "candidate"');
    expect(shell).toContain('"revision content, diff": { label: "提交审阅", review: "revision"');
    expect(shell).toContain('"commit detail, change": { label: "提交审阅", review: "commit"');
    // The W2 surfaces keep their wiring.
    expect(shell).toContain("renderStructureLens");
    expect(shell).toContain("renderSceneSurface");
    expect(shell).toContain('[data-role="scene-surface"]');
  });

  it("shows the authoritative gate a blocked commit returned, not a stale preview", () => {
    const shell = source("shell.js");
    const commitHandler = shell.slice(
      shell.indexOf("async function handleCommitRevision"),
      shell.indexOf("async function handleCommitRevision") + 2200,
    );

    // A blocked commit answers with the gate the commit itself evaluated; the
    // preview cannot see the facts the commit derives, so the surface must
    // adopt the returned gate instead of re-asking for a preview.
    expect(commitHandler).toContain("error.payload.gate");
    expect(commitHandler).toContain("gate: authoritative");
  });

  it("keeps the structure lens and the scene surface modules intact", async () => {
    const { visibleNodes, renderStructureLens } = await loadModule("structureLens.js");
    const { renderSceneSurface } = await loadModule("sceneSurface.js");
    const treeRoot = fakeRoot();
    const sceneRoot = fakeRoot();

    const view = {
      arcs: [
        {
          objectId: "arc-1",
          kind: "arc",
          title: "弧",
          children: [
            {
              objectId: "chapter-1",
              kind: "chapter",
              title: "章",
              children: [{ objectId: "scene-1", kind: "scene", title: "场", children: [] }],
            },
          ],
        },
      ],
    };

    const rows = visibleNodes(view, "chapter", "scene:scene-1");
    expect(
      rows.some(
        (entry: any) =>
          entry.kind === "scene" && entry.objectId === "scene-1" && entry.current === true,
      ),
    ).toBe(true);
    renderStructureLens(treeRoot, view, {
      level: "chapter",
      focusKey: "scene:scene-1",
      onSelect: () => undefined,
      onZoomStep: () => undefined,
    });
    expect(treeRoot.innerHTML).toContain("ws-tree");

    renderSceneSurface(
      sceneRoot,
      { sceneId: "scene-1", novelId: "novel-1", title: "第一场", text: "第一段。" },
      null,
      { error: "", onSelectSpan: () => undefined, onRetry: () => undefined },
    );
    expect(sceneRoot.innerHTML).toContain("第一段。");
  });
});
