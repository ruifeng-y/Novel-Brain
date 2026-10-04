import { describe, expect, it } from "vitest";
import {
  enterFoundation,
  reenterFoundationEntry,
  skipFoundationEntry,
  type FoundationEntryInput,
  type FoundationEntryResult,
  type FoundationProposalResult,
} from "../../src/story/application/foundationEntryService";
import { createInMemoryNarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";
import { loadNarrativeProposal } from "../../src/story/application/narrativeProposalService";
import type {
  RuntimeAdapter,
  RuntimeRequest,
  RuntimeResult,
} from "../../src/production/runtime/runtimeAdapter";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import { createSourceReference } from "../../src/shared/domain/observationSource";

const now = new Date("2026-10-04T00:00:00.000Z");
const inputReference = createSourceReference({
  identity: "foundation-source-1",
  version: "input-1",
  hash: "source-hash-1",
});
const blankReference = createSourceReference({
  identity: "foundation-source-blank",
  version: "input-1",
  hash: "source-hash-blank",
});
const basedOnVersionSet = createVersionSet({
  novel: createVersionReference("Novel", "novel-entry", "novel-rev-1"),
});

function draftContent(text: string): Record<string, unknown> {
  return {
    sections: [{ id: "section-entry", content: { text } }],
    openQuestions: [],
  };
}

function runtimeResult(request: RuntimeRequest, content: Record<string, unknown>): RuntimeResult {
  return {
    taskId: request.taskId,
    agentRole: request.agentRole,
    modelPolicy: request.modelPolicy,
    change: {
      type: "structured_state",
      stateRecordId: request.requestedChange.type === "structured_state"
        ? request.requestedChange.stateRecordId
        : request.taskId,
      content,
    },
    basedOnVersionSet: request.basedOnVersionSet,
  };
}

function runtimeFor(
  content: Record<string, unknown>,
  calls: RuntimeRequest[] = [],
): RuntimeAdapter {
  return {
    async execute(request) {
      calls.push(request);
      return runtimeResult(request, content);
    },
  };
}

function generation() {
  return {
    taskId: "foundation-runtime-task",
    agentRole: "planner" as const,
    modelPolicy: { provider: "test", model: "deterministic", maxOutputTokens: 1000 },
    basedOnVersionSet,
  };
}

type FoundationEntryMetadata = Omit<
  FoundationEntryInput,
  "persistence" | "runtime" | "generation" | "proposalId"
> & { readonly proposalId?: string };

function ideaInput(overrides: Partial<FoundationEntryMetadata> = {}): FoundationEntryMetadata {
  return {
    entryId: "entry-idea",
    novelId: "novel-entry",
    proposalId: "proposal-entry-idea",
    mode: "idea",
    proposalType: "story_concept",
    scope: { dimension: "story-concept" },
    source: { kind: "idea", text: "A city that dreams", sourceReference: inputReference },
    occurredAt: now,
    ...overrides,
  };
}

function proposalResult(result: FoundationEntryResult): FoundationProposalResult {
  if (result.status !== "proposal_created") {
    throw new Error(`expected proposal result, received ${result.status}`);
  }
  return result;
}

describe("[task:3.1] Foundation Entry Services", () => {
  it("[domain] creates bound provenance for Idea and Existing Text and returns Empty Narrative State for Blank", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const ideaCalls: RuntimeRequest[] = [];
    const idea = proposalResult(
      await enterFoundation({
        ...ideaInput(),
        persistence,
        runtime: runtimeFor(draftContent("A city that dreams"), ideaCalls),
        generation: generation(),
      }),
    );

    expect(idea.proposal.sections[0]?.content).toEqual({ text: "A city that dreams" });
    expect(idea.proposal.sections[0]?.provenance.origin.type).toBe("ai_generated");
    expect(idea.proposal.sections[0]?.provenance.origin.references).toEqual([
      inputReference,
      idea.session.provenance.runtimeEvidence?.data.requestReference,
      idea.session.provenance.runtimeEvidence?.data.resultReference,
    ]);
    expect(idea.session.provenance.runtimeEvidence?.data.result.requestReference).toEqual(
      idea.session.provenance.runtimeEvidence?.data.requestReference,
    );
    expect(ideaCalls[0]?.context).toMatchObject({
      operation: "generate",
      sourceText: "A city that dreams",
    });

    const textCalls: RuntimeRequest[] = [];
    const existing = proposalResult(
      await enterFoundation({
        entryId: "entry-text",
        novelId: "novel-entry",
        proposalId: "proposal-entry-text",
        mode: "existing_text",
        proposalType: "story_concept",
        scope: { source: "existing-text" },
        source: {
          kind: "existing_text",
          text: "The old map remembers.",
          sourceReference: createSourceReference({
            identity: "foundation-source-text",
            version: "input-1",
            hash: "source-hash-text",
          }),
        },
        occurredAt: now,
        persistence,
        runtime: runtimeFor(draftContent("The old map remembers."), textCalls),
        generation: generation(),
      }),
    );

    expect(existing.proposal.sections[0]?.provenance.origin.type).toBe("extracted_from_text");
    expect(existing.proposal.sections[0]?.provenance.editLineage).toEqual([
      existing.session.provenance.runtimeEvidence?.data.resultReference,
    ]);
    expect(textCalls[0]?.context).toMatchObject({
      operation: "extract",
      sourceText: "The old map remembers.",
    });

    const blankPersistence = createInMemoryNarrativeProposalPersistence();
    const blank = await enterFoundation({
      entryId: "entry-blank",
      novelId: "novel-entry",
      mode: "blank",
      proposalType: "story_concept",
      scope: { dimension: "blank" },
      source: { kind: "blank", sourceReference: blankReference },
      occurredAt: now,
      persistence: blankPersistence,
    });

    expect(blank.status).toBe("empty_narrative_state");
    expect(blank).not.toHaveProperty("proposal");
    expect(blank).not.toHaveProperty("proposalReference");
    if (blank.status !== "empty_narrative_state") throw new Error("expected Empty Narrative State");
    expect(blank.emptyNarrativeState).toEqual({
      kind: "empty_narrative_state",
      novelId: "novel-entry",
      sourceReference: blankReference,
    });
    expect(await blankPersistence.proposals.listByNovel("novel-entry")).toEqual([]);
  });

  it("[integration] persists and loads the proposal revision", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const result = proposalResult(
      await enterFoundation({
        ...ideaInput(),
        persistence,
        runtime: runtimeFor(draftContent("Persisted design")),
        generation: generation(),
      }),
    );

    expect(await persistence.proposals.findById("proposal-entry-idea")).toBeDefined();
    expect((await loadNarrativeProposal(persistence, "proposal-entry-idea")).revisionHash).toBe(
      result.proposal.revisionHash,
    );
  });

  it("[persistence] binds request and result source references", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const result = proposalResult(
      await enterFoundation({
        ...ideaInput(),
        persistence,
        runtime: runtimeFor(draftContent("Provenance design")),
        generation: generation(),
      }),
    );
    const persisted = await persistence.proposals.findById("proposal-entry-idea");
    const evidence = result.session.provenance.runtimeEvidence;

    expect(evidence).toBeDefined();
    expect(evidence?.data.result.requestReference).toEqual(evidence?.data.requestReference);
    expect(evidence?.data.resultReference.version).toBe(`request:${evidence?.data.requestReference.hash}`);
    expect(persisted?.sections[0]?.provenance.origin.references).toEqual([
      inputReference,
      evidence?.data.requestReference,
      evidence?.data.resultReference,
    ]);
  });

  it("[transaction] Blank and skip are no-op entry paths", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const blank = await enterFoundation({
      entryId: "entry-blank-no-op",
      novelId: "novel-entry",
      mode: "blank",
      proposalType: "story_concept",
      scope: { dimension: "blank" },
      source: { kind: "blank", sourceReference: blankReference },
      occurredAt: now,
      persistence,
    });
    const skipped = skipFoundationEntry({
      entryId: "entry-skip-no-op",
      novelId: "novel-entry",
      mode: "idea",
      proposalType: "story_concept",
      scope: { dimension: "story-concept" },
      source: { kind: "idea", text: "Optional proposal id", sourceReference: inputReference },
      occurredAt: now,
      persistence,
    });

    expect(blank.status).toBe("empty_narrative_state");
    expect(skipped.status).toBe("skipped");
    expect(await persistence.proposals.listByNovel("novel-entry")).toEqual([]);
    expect(await persistence.decisions.listByNovel("novel-entry")).toEqual([]);
  });

  it("[concurrency] accepts identical concurrent entry attempts idempotently", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const runtime = runtimeFor(draftContent("Concurrent design"));
    const first = enterFoundation({
      ...ideaInput(),
      persistence,
      runtime,
      generation: generation(),
    });
    const second = enterFoundation({
      ...ideaInput(),
      persistence,
      runtime,
      generation: generation(),
    });
    const [left, right] = await Promise.all([first, second]);

    expect(proposalResult(left).proposal.revisionHash).toBe(
      proposalResult(right).proposal.revisionHash,
    );
    expect(await persistence.proposals.listByNovel("novel-entry")).toHaveLength(1);
  });

  it("[recovery] allows re-entry after runtime failure", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    let attempts = 0;
    const runtime: RuntimeAdapter = {
      async execute(request) {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary runtime failure");
        return runtimeResult(request, draftContent("Recovered design"));
      },
    };

    await expect(
      enterFoundation({
        ...ideaInput(),
        persistence,
        runtime,
        generation: generation(),
      }),
    ).rejects.toThrow("temporary runtime failure");

    const recovered = proposalResult(
      await enterFoundation({
        ...ideaInput(),
        persistence,
        runtime,
        generation: generation(),
      }),
    );
    expect(recovered.proposal.sections[0]?.content).toEqual({ text: "Recovered design" });
  });

  it("[replay] returns identical provenance and proposal on replay", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const runtime = runtimeFor(draftContent("Replay design"));
    const first = await enterFoundation({
      ...ideaInput(),
      persistence,
      runtime,
      generation: generation(),
    });
    const replay = await enterFoundation({
      ...ideaInput(),
      persistence,
      runtime,
      generation: generation(),
    });

    expect(replay).toEqual(first);
    expect(await persistence.proposals.listByNovel("novel-entry")).toHaveLength(1);
  });

  it("[cross-system] rejects RuntimeResult provenance mismatch and mutates no Canon or Adoption state", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const mismatches: RuntimeAdapter[] = [
      {
        async execute(request) {
          return { ...runtimeResult(request, draftContent("Bad agent")), agentRole: "writer" };
        },
      },
      {
        async execute(request) {
          return {
            ...runtimeResult(request, draftContent("Bad model")),
            modelPolicy: { ...request.modelPolicy, model: "other-model" },
          };
        },
      },
      {
        async execute(request) {
          return {
            ...runtimeResult(request, draftContent("Bad version set")),
            basedOnVersionSet: createVersionSet({
              novel: createVersionReference("Novel", "other-novel", "novel-rev-2"),
            }),
          };
        },
      },
      {
        async execute(request) {
          return {
            ...runtimeResult(request, draftContent("Bad state")),
            change: {
              type: "structured_state",
              stateRecordId: "other-state",
              content: draftContent("Bad state"),
            },
          };
        },
      },
    ];

    for (const runtime of mismatches) {
      await expect(
        enterFoundation({
          ...ideaInput({ entryId: `entry-mismatch-${mismatches.indexOf(runtime)}` }),
          proposalId: `proposal-mismatch-${mismatches.indexOf(runtime)}`,
          persistence,
          runtime,
          generation: generation(),
        }),
      ).rejects.toThrow(/RuntimeRequest and RuntimeResult must match|Foundation runtime state identity must match request/);
    }

    expect(await persistence.proposals.listByNovel("novel-entry")).toEqual([]);
    expect(await persistence.decisions.listByNovel("novel-entry")).toEqual([]);
  });

  it("[regression] supports skip without proposalId and re-entry into a Proposal", async () => {
    const persistence = createInMemoryNarrativeProposalPersistence();
    const skipped = skipFoundationEntry({
      entryId: "entry-reenter",
      novelId: "novel-entry",
      mode: "idea",
      proposalType: "story_concept",
      scope: { dimension: "story-concept" },
      source: { kind: "idea", text: "Re-entry design", sourceReference: inputReference },
      occurredAt: now,
      persistence,
    });
    expect(skipped.status).toBe("skipped");
    expect(await persistence.proposals.findById("proposal-entry-idea")).toBeUndefined();

    const reentered = proposalResult(
      await reenterFoundationEntry({
        session: skipped.session,
        proposalId: "proposal-entry-idea",
        occurredAt: now,
        persistence,
        runtime: runtimeFor(draftContent("Re-entered design")),
        generation: generation(),
      }),
    );

    expect(reentered.session.provenance.inputReference).toEqual(inputReference);
    expect(reentered.session.provenance.runtimeEvidence?.data.requestReference).toBeDefined();
    expect(reentered.proposal.sections[0]?.provenance.origin.references).toEqual([
      inputReference,
      reentered.session.provenance.runtimeEvidence?.data.requestReference,
      reentered.session.provenance.runtimeEvidence?.data.resultReference,
    ]);
  });
});
