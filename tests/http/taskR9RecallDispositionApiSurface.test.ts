import { describe, expect, it } from "vitest";
import { createNovelBrainServer } from "../../src/http/server";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import type { HttpBoundaryPipeline } from "../../src/http/httpBoundaryPipeline";
import type { RecallAttentionItem } from "../../src/app/recallAttentionSource";
import { computeStaleImpactResult } from "../support/recallAttentionFixtures";

function harness() {
  const calls: string[] = [];
  const pipeline: HttpBoundaryPipeline = {
    async execute(contractId, _context, input, handler) {
      calls.push(contractId);
      return handler(input);
    },
  };
  const dependencies = createInMemoryEngineDependencies();
  const app = createNovelBrainServer(dependencies, { httpBoundaryPipeline: pipeline });
  return { app, calls, dependencies };
}

function dispositionPayload(
  item: RecallAttentionItem,
  action: string,
  extra: Record<string, unknown> = {},
) {
  return {
    novelId: item.novelId,
    candidateId: item.candidateId,
    evidenceFingerprint: item.evidenceFingerprint,
    reason: item.explanation.reason,
    evidenceReferences: item.explanation.evidenceReferences,
    action,
    ...extra,
  };
}

describe("[task:R9] [cross-system] recall disposition API surface", () => {
  it("records a disposition against a genuinely projected attention item", async () => {
    const { app, calls, dependencies } = harness();
    const impactResult = await computeStaleImpactResult("novel-1");
    await dependencies.product!.dependencyImpactPersistence!.impactResults.saveIfAbsent(
      impactResult,
    );

    const attention = await app.inject({ method: "GET", url: "/novels/novel-1/attention" });
    expect(attention.statusCode).toBe(200);
    const view = attention.json();
    expect(view.items.length).toBeGreaterThan(0);

    const item = view.items[0];
    expect(item.novelId).toBe("novel-1");
    expect(item.evidenceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(item.explanation.evidenceReferences.length).toBeGreaterThan(0);
    expect(item.itemId).toContain(impactResult.id);

    const disposition = await app.inject({
      method: "POST",
      url: `/attention/${encodeURIComponent(item.itemId)}/dispositions`,
      payload: dispositionPayload(item, "dismiss"),
    });
    expect(disposition.statusCode).toBe(201);
    expect(disposition.json().state).toBe("dismissed");
    expect(disposition.json().itemId).toBe(item.itemId);
    expect(disposition.json().evidenceFingerprint).toBe(item.evidenceFingerprint);

    expect(calls).toEqual([
      "recall.query.recall-attention",
      "recall.command.record-recall-disposition",
    ]);
    expect(calls).not.toContain("commit.command.commit-change-set-revision");
    expect(view.authority.mayCreateTaskDirectly).toBe(false);
    expect(view.authority.mayCommit).toBe(false);
  });

  it("accepts a projected fingerprint through the default request boundary", async () => {
    const dependencies = createInMemoryEngineDependencies();
    const impactResult = await computeStaleImpactResult("novel-1");
    await dependencies.product!.dependencyImpactPersistence!.impactResults.saveIfAbsent(
      impactResult,
    );
    const app = createNovelBrainServer(dependencies);

    const attention = await app.inject({ method: "GET", url: "/novels/novel-1/attention" });
    expect(attention.statusCode).toBe(200);
    const item = attention.json().items[0];

    const disposition = await app.inject({
      method: "POST",
      url: `/attention/${encodeURIComponent(item.itemId)}/dispositions`,
      headers: { "x-author-id": "author-1" },
      payload: dispositionPayload(item, "snooze", {
        snoozedUntil: "2026-10-06T00:00:00.000Z",
      }),
    });
    expect(disposition.statusCode).toBe(201);
    expect(disposition.json().state).toBe("snoozed");
    expect(disposition.json().snoozedUntil).toBe("2026-10-06T00:00:00.000Z");
    expect(disposition.json().evidenceFingerprint).toBe(item.evidenceFingerprint);
  });
});
