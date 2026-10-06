import { describe, expect, it } from "vitest";
import { createFoundationProjectionQuery } from "../../src/app/foundationProjectionQuery";
import { createInMemoryNarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";
import { createNarrativeProposal } from "../../src/story/domain/narrativeProposal";
import type { NarrativeProposalType } from "../../src/story/domain/narrativeProposal";
import { createAdoptionDecision } from "../../src/story/domain/adoptionDecision";
import type { AdoptionDecisionType } from "../../src/story/domain/adoptionDecision";
import { InMemoryRepository } from "../../src/app/inMemoryRepositories";
import { createNovel, type Novel } from "../../src/narrative/novel/domain/novel";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

const AT = new Date("2026-10-06T00:00:00.000Z");
const NOVEL = "novel-1";

const provenance = {
  origin: { type: "author_created" as const, references: [] },
  editLineage: [],
  evidenceReferences: [],
  adoptionDecisionReferences: [],
};

function proposalFixture(input: {
  readonly id: string;
  readonly proposalType: NarrativeProposalType;
  readonly entryMode?: string;
  readonly createdAt?: Date;
}) {
  return createNarrativeProposal({
    id: input.id,
    novelId: NOVEL,
    proposalType: input.proposalType,
    scope: {},
    sections: [
      {
        id: `${input.id}:section-1`,
        content: input.entryMode === undefined ? { text: "内容" } : { entryMode: input.entryMode },
        provenance,
      },
    ],
    createdAt: input.createdAt ?? AT,
  });
}

function decisionFixture(input: {
  readonly id: string;
  readonly proposal: ReturnType<typeof proposalFixture>;
  readonly decisionType: AdoptionDecisionType;
  readonly decidedAt?: Date;
}) {
  return createAdoptionDecision({
    proposal: input.proposal,
    id: input.id,
    decisionType: input.decisionType,
    targets: [
      {
        id: `${input.id}:target`,
        scope: {
          proposalIdentity: input.proposal.id,
          proposalRevision: input.proposal.currentRevisionId,
          sectionIdentity: `${input.proposal.id}:section-1`,
        },
        targetType: "manuscript",
        objectId: "scene-1",
        ...(input.decisionType === "adopt"
          ? {
              adoptedContent: {
                contentReference: {
                  identity: input.proposal.sections[0]!.id,
                  version: input.proposal.currentRevisionId,
                  hash: input.proposal.sections[0]!.sectionHash,
                },
                contentHash: input.proposal.sections[0]!.sectionHash,
              },
              proposedChangeId: `${input.id}:change`,
              payload: {},
              basedOnVersionSet: createVersionSet({
                scene: createVersionReference("Scene", "scene-1", "scene-1:rev-1"),
              }),
            }
          : {}),
      },
    ],
    actor: { type: "author", identity: "author-1" },
    reason: "决定",
    decidedAt: input.decidedAt ?? AT,
  });
}

async function harness() {
  const persistence = createInMemoryNarrativeProposalPersistence();
  const novels = new InMemoryRepository<Novel>();
  await novels.save(createNovel({ id: NOVEL, authorId: "author-1", title: "小说", createdAt: AT }));
  const query = createFoundationProjectionQuery({
    novels,
    proposals: persistence.proposals,
    decisions: persistence.decisions,
  });
  return { query, persistence, novels };
}

describe("[task:W4] [domain] story foundation projection query", () => {
  it("reports the five directions with the status their proposals and decisions give them", async () => {
    const { query, persistence } = await harness();
    const concept = proposalFixture({ id: "p-concept", proposalType: "story_concept" });
    const conflict = proposalFixture({ id: "p-conflict", proposalType: "core_conflict" });
    const world = proposalFixture({ id: "p-world", proposalType: "world_direction" });
    for (const proposal of [concept, conflict, world]) {
      await persistence.proposals.saveRevisionIfAbsent(proposal);
    }
    await persistence.decisions.saveIfAbsent(
      decisionFixture({ id: "d-concept", proposal: concept, decisionType: "adopt" }),
    );
    await persistence.decisions.saveIfAbsent(
      decisionFixture({ id: "d-conflict", proposal: conflict, decisionType: "defer" }),
    );

    const projection = await query.project({ novelId: NOVEL });
    const byDirection = Object.fromEntries(
      (projection?.directions ?? []).map(entry => [entry.direction, entry]),
    );

    expect(projection?.directions).toHaveLength(5);
    expect(byDirection.story_concept?.status).toBe("adopted");
    expect(byDirection.core_conflict?.status).toBe("deferred");
    expect(byDirection.world_direction?.status).toBe("proposed");
    // A direction with no proposal is simply open: it may stay open indefinitely.
    expect(byDirection.protagonist_direction?.status).toBe("open");
    expect(byDirection.protagonist_direction?.proposalIds).toEqual([]);
    expect(byDirection.main_plot_story_engine?.status).toBe("open");
  });

  it("aggregates proposal open questions with their owning proposal and rewrites nothing", async () => {
    const { query, persistence } = await harness();
    const proposal = createNarrativeProposal({
      id: "p-questions",
      novelId: NOVEL,
      proposalType: "story_concept",
      scope: {},
      sections: [{ id: "s-1", content: { entryMode: "idea" }, provenance }],
      openQuestions: [
        {
          id: "q-1",
          text: "主角的动机是什么？",
          scope: { kind: "proposal" },
          state: "open",
          provenance,
        },
      ],
      createdAt: AT,
    });
    await persistence.proposals.saveRevisionIfAbsent(proposal);

    const projection = await query.project({ novelId: NOVEL });

    expect(projection?.openQuestions).toEqual([
      {
        proposalId: "p-questions",
        questionId: "q-1",
        text: "主角的动机是什么？",
        state: "open",
      },
    ]);
    // The question is owned by the Proposal; the projection only read it.
    const stored = await persistence.proposals.findById("p-questions");
    expect(stored?.openQuestions[0]?.text).toBe("主角的动机是什么？");
  });

  it("groups proposals by type and derives the entry mode and provenance", async () => {
    const { query, persistence } = await harness();
    await persistence.proposals.saveRevisionIfAbsent(
      proposalFixture({
        id: "p-early",
        proposalType: "story_concept",
        entryMode: "existing_text",
        createdAt: new Date("2026-10-06T00:00:00.000Z"),
      }),
    );
    await persistence.proposals.saveRevisionIfAbsent(
      proposalFixture({
        id: "p-late",
        proposalType: "story_concept",
        entryMode: "blank",
        createdAt: new Date("2026-10-06T01:00:00.000Z"),
      }),
    );

    const projection = await query.project({ novelId: NOVEL });

    expect(projection?.proposalsByType.story_concept).toEqual(["p-early", "p-late"]);
    // How the design started: the earliest proposal, not the session.
    expect(projection?.entryMode).toBe("existing_text");
    expect(projection?.entryProvenance).toBe("author_created");
  });

  it("reports adoption readiness honestly and never invents content", async () => {
    const { query } = await harness();

    const empty = await query.project({ novelId: NOVEL });
    expect(empty?.entryMode).toBe("none");
    expect(empty?.adoptionReadiness).toEqual({ ready: false, reason: "尚无提案" });
    expect(empty?.proposalsByType).toEqual({});

    expect(await query.project({ novelId: "novel-missing" })).toBeUndefined();
  });
});
