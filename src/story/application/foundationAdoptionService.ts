import type { ChangeSet } from "../../production/domain/changeSet";
import { replaceChangeSetChanges } from "../../production/domain/changeSet";
import type { ChangeSetRevision } from "../../production/domain/changeSetRevision";
import { createChangeSetRevision } from "../../production/domain/changeSetRevision";
import type { RevisionId } from "../../shared/domain/ids";
import {
  adoptionDecisionSourceReference,
  createAdoptionChangeSetInputs,
  validateAdoptionDecision,
  type AdoptionChangeSetInput,
  type AdoptionDecision,
} from "../domain/adoptionDecision";
import type { NarrativeProposal } from "../domain/narrativeProposal";
import type { NarrativeProposalPersistence } from "./narrativeProposalPersistence";
import { recordAdoptionDecision } from "./narrativeProposalService";

export interface PrepareFoundationAdoptionChangeSetInput {
  readonly changeSet: ChangeSet;
  readonly parentRevision: ChangeSetRevision;
  readonly proposal: NarrativeProposal;
  readonly decision: AdoptionDecision;
  readonly revisionId: RevisionId;
  readonly createdAt: Date;
}

export interface FoundationAdoptionPreparation {
  readonly changeSet: ChangeSet;
  readonly changeSetRevision: ChangeSetRevision;
  readonly adoptionInputs: AdoptionChangeSetInput;
  readonly selectedSectionIds: readonly string[];
  readonly unselectedSectionIds: readonly string[];
}

export interface RecordFoundationAdoptionPreparationInput
  extends PrepareFoundationAdoptionChangeSetInput {
  readonly persistence: NarrativeProposalPersistence;
}

function assertExistingChangeSetRevision(input: PrepareFoundationAdoptionChangeSetInput): void {
  if (input.parentRevision.changeSetId !== input.changeSet.id) {
    throw new Error("Adoption parent revision belongs to a different Change Set");
  }
  if (input.parentRevision.novelId !== input.changeSet.novelId) {
    throw new Error("Adoption parent revision belongs to a different Novel");
  }
  if (input.changeSet.novelId !== input.proposal.novelId) {
    throw new Error("Adoption Proposal belongs to a different Novel");
  }
  if (input.changeSet.currentRevisionId !== input.parentRevision.revisionId) {
    throw new Error("Adoption parent revision is not the current Change Set revision");
  }
  if (input.changeSet.lifecycle !== "open") {
    throw new Error("Adoption requires an open Change Set");
  }
  if (input.revisionId === input.parentRevision.revisionId) {
    throw new Error("Adoption revision must differ from the current revision");
  }
}

export function prepareFoundationAdoptionChangeSet(
  input: PrepareFoundationAdoptionChangeSetInput,
): FoundationAdoptionPreparation {
  validateAdoptionDecision(input.decision, input.proposal);
  assertExistingChangeSetRevision(input);
  if (input.decision.decisionType !== "adopt") {
    throw new Error("Only an adopt Adoption Decision can create Change Set inputs");
  }

  const adoptionInputs = createAdoptionChangeSetInputs(input.decision);
  if (adoptionInputs.changes.length === 0) {
    throw new Error("Adopt Adoption Decision requires at least one proposed Change");
  }

  const selectedSectionIds = input.decision.targets.map((target) => target.scope.sectionIdentity);
  const unselectedSectionIds = input.proposal.sections
    .map((section) => section.id)
    .filter((sectionId) => !selectedSectionIds.includes(sectionId));
  const changes = [...input.parentRevision.changes, ...adoptionInputs.changes];
  const changeSetRevision = createChangeSetRevision({
    parent: input.parentRevision,
    revisionId: input.revisionId,
    trigger: {
      type: "edit",
      references: [
        input.decision.id,
        adoptionDecisionSourceReference(input.decision).hash,
      ],
    },
    changes,
    createdAt: input.createdAt,
  });
  const changeSet = replaceChangeSetChanges({
    changeSet: input.changeSet,
    changes,
    revisionId: input.revisionId,
    updatedAt: input.createdAt,
  });

  return Object.freeze({
    changeSet,
    changeSetRevision,
    adoptionInputs,
    selectedSectionIds: Object.freeze([...selectedSectionIds]),
    unselectedSectionIds: Object.freeze([...unselectedSectionIds]),
  });
}

export async function recordFoundationAdoptionPreparation(
  input: RecordFoundationAdoptionPreparationInput,
): Promise<FoundationAdoptionPreparation> {
  const preparation = prepareFoundationAdoptionChangeSet(input);
  const decision = await recordAdoptionDecision(input.persistence, input.decision);
  return Object.freeze({
    ...preparation,
    adoptionInputs: createAdoptionChangeSetInputs(decision),
  });
}
