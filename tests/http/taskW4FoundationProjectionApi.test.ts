import { describe, expect, it } from "vitest";
import { createInMemoryEngineDependencies } from "../../src/app/composition";
import { createNovelBrainServer } from "../../src/http/server";
import {
  createHttpBoundaryPipeline,
  type HttpBoundaryContext,
  type HttpBoundaryPipeline,
} from "../../src/http/httpBoundaryPipeline";
import { createProductRequestValidators } from "../../src/http/productRequestSchemas";
import { createPlatformObservabilityBoundary } from "../../src/platform/observabilityBoundary";
import { createProductionSecurityBoundary } from "../../src/platform/productionSecurityProvider";
import { createNovel } from "../../src/narrative/novel/domain/novel";
import { createNarrativeProposal } from "../../src/story/domain/narrativeProposal";

const NOVEL = "novel-1";
const authorToken = "w4-projection-token";
const AT = new Date("2026-10-06T00:00:00.000Z");
const authorHeader = { "x-author-id": authorToken };

function harness() {
  const dependencies = createInMemoryEngineDependencies();
  const calls: string[] = [];
  const security = createProductionSecurityBoundary({
    NB_SECURITY_PRINCIPALS: JSON.stringify([
      {
        token: authorToken,
        subjectId: "w4-author-1",
        accountId: "account-1",
        workspaceIds: [NOVEL],
        roles: ["author"],
      },
    ]),
    NB_SECURITY_RATE_LIMIT: "1000",
    NB_SECURITY_SECRETS: "{}",
  });
  const inner = createHttpBoundaryPipeline({
    security,
    observability: createPlatformObservabilityBoundary({
      sink: () => undefined,
      now: () => new Date(),
      idGenerator: () => "w4-projection-event",
    }),
    validators: createProductRequestValidators(),
  });
  const pipeline: HttpBoundaryPipeline = {
    execute<TValue>(
      contractId: string,
      context: HttpBoundaryContext,
      input: unknown,
      handler: (validated: unknown) => Promise<TValue>,
    ): Promise<TValue> {
      calls.push(contractId);
      return inner.execute(contractId, context, input, handler);
    },
  };
  const app = createNovelBrainServer(dependencies, { httpBoundaryPipeline: pipeline });
  return { app, dependencies, calls };
}

describe("[task:W4] [integration] story foundation projection HTTP surface", () => {
  it("projects the foundation of a novel through the boundary", async () => {
    const { app, dependencies, calls } = harness();
    await dependencies.novels.save(
      createNovel({ id: NOVEL, authorId: "w4-author-1", title: "小说", createdAt: AT }),
    );
    await dependencies.product!.foundationPersistence.proposals.saveRevisionIfAbsent(
      createNarrativeProposal({
        id: "p-1",
        novelId: NOVEL,
        proposalType: "story_concept",
        scope: {},
        sections: [
          {
            id: "s-1",
            content: { entryMode: "idea" },
            provenance: {
              origin: { type: "author_created", references: [] },
              editLineage: [],
              evidenceReferences: [],
              adoptionDecisionReferences: [],
            },
          },
        ],
        createdAt: AT,
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: `/novels/${NOVEL}/foundation-projection`,
      headers: authorHeader,
    });

    expect(response.statusCode).toBe(200);
    const projection = response.json() as {
      entryMode: string;
      directions: readonly { direction: string; status: string }[];
      proposalsByType: Record<string, readonly string[]>;
      adoptionReadiness: { ready: boolean };
    };
    expect(projection.entryMode).toBe("idea");
    expect(projection.directions).toHaveLength(5);
    expect(projection.proposalsByType.story_concept).toEqual(["p-1"]);
    expect(projection.adoptionReadiness.ready).toBe(true);
    expect(calls).toContain("foundation.query.foundation-projection");
    await app.close();
  });

  it("rejects a novel outside the principal's workspace", async () => {
    const { app } = harness();

    const response = await app.inject({
      method: "GET",
      url: "/novels/novel-missing/foundation-projection",
      headers: authorHeader,
    });

    // The boundary authorizes the addressed workspace, so another workspace is
    // refused before the projection is ever consulted.
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
