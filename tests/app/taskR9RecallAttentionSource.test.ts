import { describe, expect, it } from "vitest";
import { createRecallAttentionSource } from "../../src/app/recallAttentionSource";
import { createProductSurfaceCommandService } from "../../src/app/productSurfaceCommandService";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { canonicalJson, hashContent } from "../../src/shared/domain/contentHash";
import {
  computeStaleImpactResult,
  seedStaleImpactRecallFixture,
} from "../support/recallAttentionFixtures";

describe("[task:R9] [integration] recall attention source", () => {
  it("derives attention items from genuinely persisted impact evidence", async () => {
    const fixture = await seedStaleImpactRecallFixture("novel-1");
    const source = createRecallAttentionSource({ impactPersistence: fixture.persistence });

    const items = await source.getAttentionItems({ novelId: "novel-1" });

    expect(items.length).toBeGreaterThan(0);
    const item = items[0]!;
    expect(item.novelId).toBe("novel-1");
    expect(item.explanation.evidenceReferences.length).toBeGreaterThan(0);
    expect(item.evidenceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    // The item comes from the persisted analysis, not from a hand-injected list.
    expect(item.itemId).toContain(fixture.impactResult.id);
    expect(item.evidence[0]!.sourceReference.hash).toBe(fixture.impactResult.contentHash);
    // The fingerprint is the specified deterministic function of the observed
    // evidence references; it is derived, never fabricated or client-supplied.
    expect(item.evidenceFingerprint).toBe(
      hashContent(
        canonicalJson([
          {
            identity: `ImpactAnalysis:${fixture.impactResult.id}`,
            version: fixture.impactResult.readSet.version,
            hash: fixture.impactResult.contentHash,
          },
        ]),
      ),
    );
  });

  it("derives a deterministic, novel-scoped fingerprint", async () => {
    const fixture = await seedStaleImpactRecallFixture("novel-1");
    const source = createRecallAttentionSource({ impactPersistence: fixture.persistence });

    const first = await source.getAttentionItems({ novelId: "novel-1" });
    const second = await source.getAttentionItems({ novelId: "novel-1" });
    expect(second.map((item) => item.evidenceFingerprint)).toEqual(
      first.map((item) => item.evidenceFingerprint),
    );

    const otherNovel = await source.getAttentionItems({ novelId: "novel-other" });
    expect(otherNovel).toEqual([]);
  });
});

describe("[task:R9] [cross-system] recall attention product surface", () => {
  it("serves the composition root's own persisted attention items", async () => {
    const dependencies = createInMemoryEngineDependencies();
    const impactResult = await computeStaleImpactResult("novel-1");
    await dependencies.product!.dependencyImpactPersistence!.impactResults.saveIfAbsent(
      impactResult,
    );

    const surface = createProductSurfaceCommandService(dependencies.product!);
    const attention = await surface.getAttention({ novelId: "novel-1" });

    expect(attention.items.length).toBeGreaterThan(0);
    expect(attention.items[0]!.novelId).toBe("novel-1");
    expect(attention.authority.authoritative).toBe(false);
    expect(attention.authority.mayCreateTaskDirectly).toBe(false);
    expect(attention.authority.mayCommit).toBe(false);
    expect(attention.authority.proposedActionChannel).toBe("production-run-policy");
  });
});
