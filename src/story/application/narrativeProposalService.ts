import { canonicalJson } from "../../shared/domain/contentHash";
import {
  adoptionDecisionSourceReference,
  assertAdoptionDecisionMatchesProposal,
  type AdoptionDecision,
} from "../domain/adoptionDecision";
import {
  assertInitialProposalRevision,
  assertProposalRevisionSnapshotIntegrity,
  assertProposalRevisionTransition,
  proposalSectionContentHash,
  type NarrativeProposal,
  type ProposalSectionAdoptionDisposition,
} from "../domain/narrativeProposal";
import type {
  AdoptionDecisionPort,
  NarrativeProposalPersistence,
  NarrativeProposalWork,
} from "./narrativeProposalPersistence";

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function currentRevisionConflict(proposal: NarrativeProposal): Error {
  return new Error(`Proposal current revision conflict: ${proposal.id}`);
}

function expectedDisposition(decision: AdoptionDecision): ProposalSectionAdoptionDisposition {
  return decision.decisionType === "adopt"
    ? "adopted"
    : decision.decisionType === "reject"
      ? "rejected"
      : decision.decisionType === "defer"
        ? "deferred"
        : "pending";
}

function decisionReferenceMatches(
  decision: AdoptionDecision,
  reference: { readonly identity: string; readonly version: string; readonly hash: string },
): boolean {
  const actual = adoptionDecisionSourceReference(decision);
  return (
    actual.identity === reference.identity &&
    actual.version === reference.version &&
    actual.hash === reference.hash
  );
}

export async function validateNarrativeProposalPersistenceState(
  work: Pick<NarrativeProposalWork, "proposals" | "decisions">,
  proposal: NarrativeProposal,
): Promise<void> {
  let parentRevision: NarrativeProposal | undefined;
  if (proposal.revisionNumber === 1) {
    assertInitialProposalRevision(proposal);
  } else {
    if (!proposal.parentRevision) throw new Error("parent revision identity mismatch");
    parentRevision = await work.proposals.getRevision(
      proposal.parentRevision.proposalIdentity,
      proposal.parentRevision.revisionId,
    );
    if (!parentRevision) throw new Error("parent revision is not retained");
    assertProposalRevisionTransition(parentRevision, proposal);
    assertProposalRevisionSnapshotIntegrity(proposal);
  }

  const decisions = await work.decisions.listByNovel(proposal.novelId);
  for (const section of proposal.sections) {
    if (!parentRevision || !proposal.parentRevision) {
      if (section.adoptionDisposition === "pending") continue;
      throw new Error("No valid Adoption Decision applies to current parent revision");
    }
    const parentSection = parentRevision.sections.find((candidate) => candidate.id === section.id);
    if (!parentSection) {
      throw new Error("No valid Adoption Decision applies to current parent revision");
    }
    const contentChanged =
      proposalSectionContentHash(parentSection) !== proposalSectionContentHash(section);
    if (section.adoptionDisposition === "pending") {
      if (parentSection.adoptionDisposition === "pending") continue;
      if (parentSection.adoptionDisposition === "adopted" && contentChanged) continue;
      if (contentChanged) {
        throw new Error("Pending transition requires no content invalidation and a latest valid Reopen Decision");
      }
      const reopenCandidates = [];
      for (const candidate of decisions) {
        const target = candidate.targets.find((entry) => entry.scope.sectionIdentity === section.id);
        const reference = adoptionDecisionSourceReference(candidate);
        if (!target || candidate.decisionType !== "reopen") continue;
        const candidateRevision = await work.proposals.getRevision(
          candidate.proposalReference.identity,
          candidate.proposalReference.version,
        );
        if (!candidateRevision) continue;
        try {
          assertAdoptionDecisionMatchesProposal(candidate, candidateRevision);
        } catch {
          continue;
        }
        const candidateSection = candidateRevision.sections.find((entry) => entry.id === section.id);
        if (
          candidate.proposalReference.identity !== proposal.parentRevision.proposalIdentity ||
          candidate.proposalReference.version !== proposal.parentRevision.revisionId ||
          candidate.proposalReference.hash !== proposal.parentRevision.revisionHash ||
          !candidateSection ||
          target.sourceDisposition !== parentSection.adoptionDisposition ||
          proposalSectionContentHash(candidateSection) !== proposalSectionContentHash(parentSection) ||
          expectedDisposition(candidate) !== "pending" ||
          !section.provenance.adoptionDecisionReferences.some((entry) =>
            entry.identity === reference.identity &&
            entry.version === reference.version &&
            entry.hash === reference.hash
          )
        ) {
          continue;
        }
        reopenCandidates.push(candidate);
      }
      reopenCandidates.sort((left, right) => {
        const time = left.decidedAt.epochMilliseconds - right.decidedAt.epochMilliseconds;
        return time !== 0 ? time : left.id.localeCompare(right.id);
      });
      if (!reopenCandidates.at(-1)) {
        throw new Error("Pending transition requires latest valid Reopen Decision");
      }
      continue;
    }
    const references = section.provenance.adoptionDecisionReferences;
    const applicable = [];
    for (const candidate of decisions) {
      const target = candidate.targets.find((entry) => entry.scope.sectionIdentity === section.id);
      const reference = adoptionDecisionSourceReference(candidate);
      if (
        !target ||
        !references.some((entry) =>
          entry.identity === reference.identity &&
          entry.version === reference.version &&
          entry.hash === reference.hash
        )
      ) {
        continue;
      }
      const candidateRevision = await work.proposals.getRevision(
        candidate.proposalReference.identity,
        candidate.proposalReference.version,
      );
      if (!candidateRevision) continue;
      try {
        assertAdoptionDecisionMatchesProposal(candidate, candidateRevision);
      } catch {
        continue;
      }
      const candidateSection = candidateRevision.sections.find((entry) => entry.id === section.id);
      if (!candidateSection) continue;
      if (
        proposalSectionContentHash(candidateSection) !== proposalSectionContentHash(section) ||
        (candidate.decisionType === "adopt" && target.adoptedContent?.contentHash !== candidateSection.sectionHash)
      ) {
        throw new Error("Adoption Decision content hash is stale for current Section snapshot");
      }
      if (
        candidate.proposalReference.identity !== proposal.parentRevision.proposalIdentity ||
        candidate.proposalReference.version !== proposal.parentRevision.revisionId ||
        candidate.proposalReference.hash !== proposal.parentRevision.revisionHash
      ) {
        continue;
      }
      if (
        target.sourceDisposition !== parentSection.adoptionDisposition ||
        proposalSectionContentHash(candidateSection) !== proposalSectionContentHash(parentSection)
      ) {
        continue;
      }
      applicable.push(candidate);
    }
    applicable.sort((left, right) => {
      const time = left.decidedAt.epochMilliseconds - right.decidedAt.epochMilliseconds;
      return time !== 0 ? time : left.id.localeCompare(right.id);
    });
    const latest = applicable.at(-1);
    if (!latest || expectedDisposition(latest) !== section.adoptionDisposition) {
      throw new Error("No valid Adoption Decision applies to current parent revision");
    }
  }
}

async function validateProposalSnapshot(
  work: Pick<NarrativeProposalWork, "proposals" | "decisions">,
  proposal: NarrativeProposal,
): Promise<void> {
  await validateNarrativeProposalPersistenceState(work, proposal);
}

export async function saveNarrativeProposalRevision(
  persistence: NarrativeProposalPersistence,
  proposal: NarrativeProposal,
  previous?: NarrativeProposal,
): Promise<NarrativeProposal> {
  return persistence.transaction.run(async (work) => {
    await validateProposalSnapshot(work, proposal);
    const current = await work.proposals.findById(proposal.id);
    if (current?.currentRevisionId === proposal.currentRevisionId) {
      if (!sameValue(current, proposal)) {
        throw currentRevisionConflict(proposal);
      }
      return current;
    }
    if (current) {
      if (previous && !sameValue(previous, current)) {
        throw new Error(`Proposal previous revision mismatch: ${proposal.id}`);
      }
      assertProposalRevisionTransition(current, proposal);
      try {
        await work.proposals.saveRevisionIfAbsent(proposal);
        await work.proposals.saveIfCurrent(current.currentRevisionId, proposal);
      } catch {
        const racedRevision = await work.proposals.getRevision(proposal.id, proposal.currentRevisionId);
        const racedCurrent = await work.proposals.findById(proposal.id);
        if (
          racedRevision &&
          racedCurrent &&
          sameValue(racedRevision, proposal) &&
          sameValue(racedCurrent, proposal)
        ) {
          return racedCurrent;
        }
        throw currentRevisionConflict(proposal);
      }
      return proposal;
    }

    assertInitialProposalRevision(proposal);
    try {
      await work.proposals.saveRevisionIfAbsent(proposal);
    } catch {
      const raced = await work.proposals.getRevision(proposal.id, proposal.currentRevisionId);
      if (raced && sameValue(raced, proposal)) return raced;
      throw currentRevisionConflict(proposal);
    }
    const reserved = await work.proposals.findById(proposal.id);
    if (!reserved || !sameValue(reserved, proposal)) {
      throw currentRevisionConflict(proposal);
    }
    return proposal;
  });
}

export async function loadNarrativeProposal(
  persistence: NarrativeProposalPersistence,
  id: string,
): Promise<NarrativeProposal> {
  return persistence.transaction.run(async (work) => {
    const proposal = await work.proposals.findById(id);
    if (!proposal) throw new Error(`Proposal not found: ${id}`);
    await validateProposalSnapshot(work, proposal);
    return proposal;
  });
}

export async function recordAdoptionDecision(
  persistence: NarrativeProposalPersistence,
  decision: AdoptionDecision,
): Promise<AdoptionDecision> {
  return persistence.transaction.run(async (work) => {
    const existing = await work.decisions.findById(decision.id);
    if (existing) {
      const existingRevision = await work.proposals.getRevision(
        existing.proposalReference.identity,
        existing.proposalReference.version,
      );
      if (!existingRevision) {
        throw new Error("Adoption Decision must reference a retained Proposal Revision");
      }
      assertAdoptionDecisionMatchesProposal(existing, existingRevision);
      if (!sameValue(existing, decision)) {
        throw new Error(`Adoption Decision already exists: ${decision.id}`);
      }
      return existing;
    }
    const revision = await work.proposals.getRevision(
      decision.proposalReference.identity,
      decision.proposalReference.version,
    );
    if (!revision) {
      throw new Error("Adoption Decision must reference a retained Proposal Revision");
    }
    assertAdoptionDecisionMatchesProposal(decision, revision);
    try {
      await work.decisions.saveIfAbsent(decision);
    } catch {
      const raced = await work.decisions.findById(decision.id);
      if (!raced || !sameValue(raced, decision)) {
        throw new Error(`Adoption Decision already exists: ${decision.id}`);
      }
      return raced;
    }
    return decision;
  });
}
