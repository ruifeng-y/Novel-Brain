import {
  createNarrativeProposal,
  proposalSectionHash,
  type NarrativeProposal,
  type NarrativeProposalSectionInput,
} from "../../src/story/domain/narrativeProposal";
import {
  createAdoptionDecision,
  type AdoptionDecision,
  type AdoptionDecisionType,
  type AdoptionTarget,
} from "../../src/story/domain/adoptionDecision";
import type { NarrativeProposalPersistence } from "../../src/story/application/narrativeProposalPersistence";
import type { TargetType } from "../../src/production/domain/change";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";

export interface NarrativeProposalVerificationEnvironment {
  readonly persistence: NarrativeProposalPersistence;
  readonly proposal: NarrativeProposal;
  target(input: {
    id: string;
    sectionId: string;
    targetType: TargetType;
    objectId: string;
    changeId?: string;
  }): AdoptionTarget;
  decision(input?: {
    id?: string;
    decisionType?: AdoptionDecisionType;
    targets?: readonly AdoptionTarget[];
    reason?: string;
  }): AdoptionDecision;
}

const now = new Date("2026-10-04T00:00:00.000Z");

function section(id: string, text: string): NarrativeProposalSectionInput {
  return {
    id,
    content: { text },
    provenance: {
      origin: { type: "ai_generated", references: [] },
      editLineage: [],
      evidenceReferences: [],
      adoptionDecisionReferences: [],
    },
  };
}

export function createNarrativeProposalVerificationEnvironment(
  persistence: NarrativeProposalPersistence,
): NarrativeProposalVerificationEnvironment {
  const proposal = createNarrativeProposal({
    id: "proposal-verification-2.2",
    novelId: "novel-verification-2.2",
    proposalType: "story_concept",
    scope: { dimension: "story-concept" },
    sections: [section("section-a", "A city that dreams"), section("section-b", "A map that remembers"), section("section-c", "A ruler who listens"), section("section-d", "A secret that returns")],
    createdAt: now,
  });

  const target: NarrativeProposalVerificationEnvironment["target"] = ({
    id,
    sectionId,
    targetType,
    objectId,
    changeId,
  }) => {
    const entry = proposal.sections.find((candidate) => candidate.id === sectionId);
    if (!entry) throw new Error(`unknown verification section: ${sectionId}`);
    return {
      id,
      scope: {
        proposalIdentity: proposal.id,
        proposalRevision: proposal.currentRevisionId,
        sectionIdentity: entry.id,
      },
      targetType,
      objectId,
      ...(changeId === undefined ? {} : { proposedChangeId: changeId }),
      ...(changeId === undefined
        ? {}
        : {
            adoptedContent: {
              contentReference: {
                identity: entry.id,
                version: proposal.currentRevisionId,
                hash: proposalSectionHash(entry),
              },
              contentHash: proposalSectionHash(entry),
            },
            payload: { text: entry.content.text },
            basedOnVersionSet: createVersionSet({
              target: createVersionReference("StateRecord", objectId, `${objectId}:rev-1`),
            }),
          }),
    };
  };

  const decision: NarrativeProposalVerificationEnvironment["decision"] = (input = {}) => {
    const decisionType = input.decisionType ?? "adopt";
    const targets = input.targets ?? [
      target({
        id: "target-verification-1",
        sectionId: "section-a",
        targetType: "plan",
        objectId: "plan-verification",
        ...(decisionType === "adopt" ? { changeId: "change-verification-1" } : {}),
      }),
    ];
    return createAdoptionDecision({
      proposal,
      id: input.id ?? "decision-verification-1",
      decisionType,
      targets,
      actor: { type: "author", identity: "author-verification" },
      reason: input.reason ?? "verification adoption",
      decidedAt: now,
    });
  };

  return { persistence, proposal, target, decision };
}
