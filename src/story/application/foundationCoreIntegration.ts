import { canonicalJson } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";
import type { ChangeSet } from "../../production/domain/changeSet";
import type { ChangeSetRevision } from "../../production/domain/changeSetRevision";
import type { RevisionId } from "../../shared/domain/ids";
import type { NarrativeProposal } from "../domain/narrativeProposal";
import type { AdoptionDecision } from "../domain/adoptionDecision";
import type { NarrativeProposalPersistence } from "./narrativeProposalPersistence";
import {
  loadNarrativeProposal,
  recordAdoptionDecision,
} from "./narrativeProposalService";
import {
  prepareFoundationAdoptionChangeSet,
  type FoundationAdoptionPreparation,
  type PrepareFoundationAdoptionChangeSetInput,
} from "./foundationAdoptionService";

export interface PrepareFoundationCoreAdoptionInput
  extends PrepareFoundationAdoptionChangeSetInput {
  readonly persistence: NarrativeProposalPersistence;
}

export interface FoundationCoreAdoptionResult {
  readonly proposalBefore: NarrativeProposal;
  readonly proposalAfter: NarrativeProposal;
  readonly preparation: FoundationAdoptionPreparation;
  readonly proposalIndependent: true;
  readonly canonicalMutationBeforeCommit: false;
}

export async function prepareFoundationCoreAdoption(
  input: PrepareFoundationCoreAdoptionInput,
): Promise<FoundationCoreAdoptionResult> {
  const proposalBefore = await loadNarrativeProposal(input.persistence, input.proposal.id);
  const preparation = prepareFoundationAdoptionChangeSet(input);
  await recordAdoptionDecision(input.persistence, input.decision);
  const proposalAfter = await loadNarrativeProposal(input.persistence, input.proposal.id);
  if (canonicalJson(proposalBefore) !== canonicalJson(proposalAfter)) {
    throw new Error("Foundation adoption must not mutate the independent Proposal");
  }

  return deepFreeze({
    proposalBefore,
    proposalAfter,
    preparation,
    proposalIndependent: true as const,
    canonicalMutationBeforeCommit: false as const,
  });
}
