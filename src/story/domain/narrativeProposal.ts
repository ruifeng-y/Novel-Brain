import { canonicalJson, hashContent } from "../../shared/domain/contentHash";
import { deepFreeze } from "../../shared/domain/immutable";
import type { DomainId, RevisionId } from "../../shared/domain/ids";
import {
  createImmutableTimestamp,
  createSourceReference,
  isImmutableTimestamp,
  type ImmutableTimestamp,
  type SourceReference,
} from "../../shared/domain/observationSource";
import {
  assertAdoptionDecisionMatchesProposal,
  adoptionDecisionSourceReference,
  type AdoptionDecision,
} from "./adoptionDecision";

export type NarrativeProposalType =
  | "story_concept" | "core_conflict" | "world_direction" | "protagonist_direction"
  | "main_plot_story_engine" | "character" | "relationship" | "plot_thread"
  | "foreshadowing" | "theme" | "long_form_direction";
export type ProposalOriginType =
  | "author_created" | "ai_generated" | "branched_from" | "merged_from" | "extracted_from_text";
export type ProposalRevisionChangeTrigger =
  | "content_change" | "disposition_change" | "open_question_state_change"
  | "section_add" | "section_remove";
export type ProposalRevisionTrigger = "initial" | ProposalRevisionChangeTrigger;
export interface ProposalRevisionParent {
  readonly proposalIdentity: DomainId;
  readonly revisionId: RevisionId;
  readonly revisionHash: string;
}
export interface ProposalSectionHash {
  readonly sectionId: DomainId;
  readonly hash: string;
}
export type ProposalScope = Readonly<Record<string, unknown>>;

export type ProposalSectionAdoptionDisposition = "pending" | "adopted" | "rejected" | "deferred";
export type ProposalOpenQuestionState = "open" | "resolved" | "dismissed";
export type ProposalOpenQuestionScope =
  | { readonly kind: "proposal" }
  | { readonly kind: "section"; readonly sectionId: DomainId };

export interface ProposalSectionProvenance {
  readonly origin: { readonly type: ProposalOriginType; readonly references: readonly SourceReference[] };
  readonly editLineage: readonly SourceReference[];
  readonly evidenceReferences: readonly SourceReference[];
  readonly adoptionDecisionReferences: readonly SourceReference[];
}
export interface NarrativeProposalSection {
  readonly id: DomainId;
  readonly content: Readonly<Record<string, unknown>>;
  readonly sectionHash: string;
  readonly adoptionDisposition: ProposalSectionAdoptionDisposition;
  readonly provenance: ProposalSectionProvenance;
}
export interface ProposalOpenQuestion {
  readonly id: DomainId;
  readonly text: string;
  readonly scope: ProposalOpenQuestionScope;
  readonly state: ProposalOpenQuestionState;
  readonly resolutionReference?: SourceReference;
  readonly provenance: ProposalSectionProvenance;
}
export interface ProposalOpenQuestionInput {
  readonly id: DomainId;
  readonly text: string;
  readonly scope: ProposalOpenQuestionScope;
  readonly state: ProposalOpenQuestionState;
  readonly resolutionReference?: SourceReference;
  readonly provenance: ProposalSectionProvenance;
}
export interface ProposalSourceSectionDisposition {
  readonly sectionId: DomainId;
  readonly disposition: ProposalSectionAdoptionDisposition;
}
export interface NarrativeProposalLineage {
  readonly parent?: SourceReference;
  readonly mergeSources: readonly SourceReference[];
  readonly sourceSectionDispositions: readonly ProposalSourceSectionDisposition[];
}
export interface NarrativeProposal {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly proposalType: NarrativeProposalType;
  readonly scope: ProposalScope;
  readonly currentRevisionId: RevisionId;
  readonly revisionNumber: number;
  readonly parentRevision?: ProposalRevisionParent;
  readonly revisionTrigger: ProposalRevisionTrigger;
  readonly revisionHash: string;
  readonly sectionHashes: readonly ProposalSectionHash[];
  readonly sections: readonly NarrativeProposalSection[];
  readonly openQuestions: readonly ProposalOpenQuestion[];
  readonly lineage: NarrativeProposalLineage;
  readonly createdAt: ImmutableTimestamp;
  readonly updatedAt: ImmutableTimestamp;
}
export interface NarrativeProposalSectionInput {
  readonly id: DomainId;
  readonly content: Readonly<Record<string, unknown>>;
  readonly provenance: ProposalSectionProvenance;
}
export interface CreateNarrativeProposalInput {
  readonly id: DomainId;
  readonly novelId: DomainId;
  readonly proposalType: NarrativeProposalType;
  readonly scope: ProposalScope;
  readonly sections: readonly NarrativeProposalSectionInput[];
  readonly openQuestions?: readonly ProposalOpenQuestionInput[];
  readonly createdAt: Date | ImmutableTimestamp;
  readonly lineage?: NarrativeProposalLineage;
  readonly revisionNumber?: number;
  readonly revisionId?: RevisionId;
}
export interface ReviseNarrativeProposalInput {
  readonly proposal: NarrativeProposal;
  readonly sections: readonly NarrativeProposalSectionInput[];
  readonly openQuestions?: readonly ProposalOpenQuestionInput[];
  readonly trigger: ProposalRevisionChangeTrigger;
  readonly revisedAt: Date | ImmutableTimestamp;
  readonly revisionId?: RevisionId;
}
export interface BranchNarrativeProposalInput {
  readonly sourceProposal: NarrativeProposal;
  readonly id: DomainId;
  readonly novelId?: DomainId;
  readonly createdAt: Date | ImmutableTimestamp;
  readonly scope?: ProposalScope;
}
export type ProposalSectionChangeAspect = "content" | "adoptionDisposition" | "provenance";
export interface ProposalSectionComparison {
  readonly sectionId: DomainId;
  readonly aspects: readonly ProposalSectionChangeAspect[];
}
export interface NarrativeProposalComparison {
  readonly scopeChanged: boolean;
  readonly addedSectionIds: readonly DomainId[];
  readonly removedSectionIds: readonly DomainId[];
  readonly changedSectionIds: readonly DomainId[];
  readonly unchangedSectionIds: readonly DomainId[];
  readonly changedSectionAspects: readonly ProposalSectionComparison[];
  readonly addedOpenQuestionIds: readonly DomainId[];
  readonly removedOpenQuestionIds: readonly DomainId[];
  readonly changedOpenQuestionIds: readonly DomainId[];
  readonly unchangedOpenQuestionIds: readonly DomainId[];
}

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}
function timestamp(value: Date | ImmutableTimestamp, name: string): ImmutableTimestamp {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${name} must be a valid Date`);
    return createImmutableTimestamp({ iso: value.toISOString(), epochMilliseconds: value.getTime() });
  }
  if (!isImmutableTimestamp(value)) throw new Error(`${name} must be an ImmutableTimestamp`);
  return createImmutableTimestamp(value);
}
function source(value: SourceReference): SourceReference {
  return createSourceReference(value);
}
function cloneProvenance(input: ProposalSectionProvenance): ProposalSectionProvenance {
  return deepFreeze({
    origin: { type: input.origin.type, references: input.origin.references.map(source) },
    editLineage: input.editLineage.map(source),
    evidenceReferences: input.evidenceReferences.map(source),
    adoptionDecisionReferences: input.adoptionDecisionReferences.map(source),
  });
}
function withSectionState(
  input: NarrativeProposalSectionInput,
  adoptionDisposition: ProposalSectionAdoptionDisposition,
): NarrativeProposalSection {
  const section = {
    id: input.id,
    content: { ...input.content },
    adoptionDisposition,
    provenance: cloneProvenance(input.provenance),
  };
  return deepFreeze({ ...section, sectionHash: proposalSectionHash(section) });
}
function cloneSection(input: NarrativeProposalSectionInput): NarrativeProposalSection {
  required(input.id, "section id");
  if (Object.prototype.hasOwnProperty.call(input, "adoptionDisposition")) {
    throw new Error("adoptionDisposition cannot be set by create/revise");
  }
  if (Object.prototype.hasOwnProperty.call(input, "sectionHash")) {
    throw new Error("sectionHash cannot be set by create/revise");
  }
  return withSectionState(input, "pending");
}

function cloneSectionSnapshot(
  input: NarrativeProposalSectionInput | NarrativeProposalSection,
): NarrativeProposalSection {
  if (Object.prototype.hasOwnProperty.call(input, "sectionHash")) {
    const snapshot = input as NarrativeProposalSection;
    const keys = Object.keys(snapshot).sort();
    const expected = ["adoptionDisposition", "content", "id", "provenance", "sectionHash"];
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      throw new Error("Proposal Section snapshot has unexpected fields");
    }
    const cloned = withSectionState({
      id: snapshot.id,
      content: snapshot.content,
      provenance: snapshot.provenance,
    }, snapshot.adoptionDisposition);
    if (snapshot.sectionHash !== cloned.sectionHash) {
      throw new Error("sectionHash must match immutable Section snapshot");
    }
    return cloned;
  }
  return cloneSection(input);
}
function cloneQuestion(input: ProposalOpenQuestionInput): ProposalOpenQuestion {
  required(input.id, "open question id");
  required(input.text, "open question text");
  if (input.scope.kind === "section") required(input.scope.sectionId, "open question sectionId");
  if (input.state === "resolved" && !input.resolutionReference) {
    throw new Error("Resolved open question requires resolutionReference");
  }
  if (input.state !== "resolved" && input.resolutionReference) {
    throw new Error("Only Resolved open questions can carry resolutionReference");
  }
  return deepFreeze({
    id: input.id,
    text: input.text,
    scope: input.scope.kind === "section"
      ? { kind: "section", sectionId: input.scope.sectionId }
      : { kind: "proposal" },
    state: input.state,
    ...(input.resolutionReference ? { resolutionReference: source(input.resolutionReference) } : {}),
    provenance: cloneProvenance(input.provenance),
  });
}
function isAppendOnly(previous: readonly SourceReference[], next: readonly SourceReference[]): boolean {
  return (
    next.length >= previous.length &&
    previous.every((entry, index) => canonicalJson(next[index]) === canonicalJson(entry))
  );
}
function assertProvenanceAppendOnly(
  previous: ProposalSectionProvenance,
  next: ProposalSectionProvenance,
  name: string,
): void {
  if (canonicalJson(next.origin) !== canonicalJson(previous.origin)) {
    throw new Error("Proposal provenance is immutable and append-only");
  }
  if (
    !isAppendOnly(previous.editLineage, next.editLineage) ||
    !isAppendOnly(previous.evidenceReferences, next.evidenceReferences) ||
    !isAppendOnly(previous.adoptionDecisionReferences, next.adoptionDecisionReferences)
  ) {
    throw new Error(`Proposal provenance is immutable and append-only: ${name}`);
  }
}
function semantic(entry: NarrativeProposalSectionInput | NarrativeProposalSection): string {
  return canonicalJson({
    id: entry.id,
    content: entry.content,
    adoptionDisposition:
      (entry as NarrativeProposalSection).adoptionDisposition ?? "pending",
    provenance: entry.provenance,
  });
}
function semanticSections(sections: readonly NarrativeProposalSection[]): string {
  return canonicalJson([...sections].sort((a, b) => a.id.localeCompare(b.id)).map(semantic));
}
function semanticQuestions(questions: readonly ProposalOpenQuestion[]): string {
  return canonicalJson([...questions].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => ({
    id: entry.id,
    text: entry.text,
    scope: entry.scope,
    state: entry.state,
    resolutionReference: entry.resolutionReference ?? null,
    provenance: entry.provenance,
  })));
}
export function proposalSectionInput(section: NarrativeProposalSection): NarrativeProposalSectionInput {
  return { id: section.id, content: section.content, provenance: section.provenance };
}
export function proposalSectionContentHash(
  entry: NarrativeProposalSectionInput | NarrativeProposalSection,
): string {
  return hashContent(canonicalJson({ id: entry.id, content: entry.content }));
}

export function proposalSectionHash(entry: NarrativeProposalSectionInput | NarrativeProposalSection): string {
  return hashContent(canonicalJson({
    id: entry.id,
    content: entry.content,
    adoptionDisposition:
      (entry as NarrativeProposalSection).adoptionDisposition ?? "pending",
    provenance: entry.provenance,
  }));
}
function revisionHash(
  id: DomainId,
  proposalType: NarrativeProposalType,
  scope: ProposalScope,
  sections: readonly NarrativeProposalSection[],
  openQuestions: readonly ProposalOpenQuestion[],
  lineage: NarrativeProposalLineage,
  parentRevision: ProposalRevisionParent | undefined,
  revisionTrigger: ProposalRevisionTrigger,
): string {
  return hashContent(canonicalJson({
    id,
    proposalType,
    scope,
    parentRevision: parentRevision ?? null,
    revisionTrigger,
    sectionHashes: sections.map((entry) => ({ sectionId: entry.id, hash: entry.sectionHash })),
    openQuestions,
    lineage,
  }));
}
function makeProposal(input: {
  id: DomainId;
  novelId: DomainId;
  proposalType: NarrativeProposalType;
  scope: ProposalScope;
  sections: readonly NarrativeProposalSectionInput[];
  openQuestions?: readonly ProposalOpenQuestionInput[];
  lineage?: NarrativeProposalLineage;
  revisionNumber?: number;
  revisionId?: RevisionId;
  parentRevision?: ProposalRevisionParent;
  revisionTrigger?: ProposalRevisionTrigger;
  createdAt: Date | ImmutableTimestamp;
  updatedAt: Date | ImmutableTimestamp;
}): NarrativeProposal {
  required(input.id, "proposal id");
  required(input.novelId, "novelId");
  const sectionIds = new Set<string>();
  for (const entry of input.sections) {
    if (sectionIds.has(entry.id)) throw new Error("Proposal section id must be unique");
    sectionIds.add(entry.id);
  }
  const questionIds = new Set<string>();
  for (const entry of input.openQuestions ?? []) {
    if (questionIds.has(entry.id)) throw new Error("Proposal open question id must be unique");
    questionIds.add(entry.id);
  }
  const sections = input.sections.map(cloneSectionSnapshot);
  const openQuestions = (input.openQuestions ?? []).map(cloneQuestion);
  for (const entry of openQuestions) {
    const scopedSectionId = entry.scope.kind === "section" ? entry.scope.sectionId : undefined;
    if (scopedSectionId !== undefined && !sections.some((section) => section.id === scopedSectionId)) {
      throw new Error("Open question section must exist in Proposal");
    }
  }
  const lineage = deepFreeze({
    ...(input.lineage?.parent ? { parent: source(input.lineage.parent) } : {}),
    mergeSources: (input.lineage?.mergeSources ?? []).map(source),
    sourceSectionDispositions: (input.lineage?.sourceSectionDispositions ?? []).map((entry) => ({
      sectionId: entry.sectionId,
      disposition: entry.disposition,
    })),
  });
  const revisionNumber = input.revisionNumber ?? 1;
  if (!Number.isInteger(revisionNumber) || revisionNumber <= 0) {
    throw new Error("revisionNumber must be a positive integer");
  }
  const currentRevisionId = input.revisionId ?? `${input.id}:r${revisionNumber}`;
  required(currentRevisionId, "currentRevisionId");
  const revisionTrigger = input.revisionTrigger ?? (revisionNumber === 1 ? "initial" : "content_change");
  const parentRevision = input.parentRevision ? {
    proposalIdentity: input.parentRevision.proposalIdentity,
    revisionId: input.parentRevision.revisionId,
    revisionHash: input.parentRevision.revisionHash,
  } : undefined;
  return deepFreeze({
    id: input.id,
    novelId: input.novelId,
    proposalType: input.proposalType,
    scope: { ...input.scope },
    currentRevisionId,
    revisionNumber,
    ...(parentRevision ? { parentRevision: deepFreeze(parentRevision) } : {}),
    revisionTrigger,
    revisionHash: revisionHash(
      input.id,
      input.proposalType,
      input.scope,
      sections,
      openQuestions,
      lineage,
      parentRevision,
      revisionTrigger,
    ),
    sectionHashes: sections.map((entry) => ({ sectionId: entry.id, hash: entry.sectionHash })),
    sections,
    openQuestions,
    lineage,
    createdAt: timestamp(input.createdAt, "createdAt"),
    updatedAt: timestamp(input.updatedAt, "updatedAt"),
  });
}
export function proposalRevisionHash(proposal: NarrativeProposal): string {
  return revisionHash(
    proposal.id,
    proposal.proposalType,
    proposal.scope,
    proposal.sections,
    proposal.openQuestions,
    proposal.lineage,
    proposal.parentRevision,
    proposal.revisionTrigger,
  );
}

export function assertProposalRevisionSnapshotIntegrity(proposal: NarrativeProposal): void {
  const sectionIds = new Set<string>();
  for (const entry of proposal.sections) {
    if (sectionIds.has(entry.id)) throw new Error("Proposal section id must be unique");
    sectionIds.add(entry.id);
  }
  const questionIds = new Set<string>();
  for (const entry of proposal.openQuestions) {
    if (questionIds.has(entry.id)) throw new Error("Proposal open question id must be unique");
    questionIds.add(entry.id);
    const scopedSectionId = entry.scope.kind === "section" ? entry.scope.sectionId : undefined;
    if (scopedSectionId !== undefined && !sectionIds.has(scopedSectionId)) {
      throw new Error("Open question section must exist in Proposal");
    }
  }
  for (const entry of proposal.sections) {
    if (entry.sectionHash !== proposalSectionHash(entry)) {
      throw new Error("sectionHash must match immutable Section snapshot");
    }
  }
  const expectedSectionHashes = proposal.sections.map((entry) => ({
    sectionId: entry.id,
    hash: entry.sectionHash,
  }));
  if (canonicalJson(proposal.sectionHashes) !== canonicalJson(expectedSectionHashes)) {
    throw new Error("sectionHashes must match Section snapshots");
  }
  if (proposal.revisionHash !== proposalRevisionHash(proposal)) {
    throw new Error("revisionHash must cover identity, parent, trigger, and snapshots");
  }
}

export function assertLinearProposalRevision(
  previous: NarrativeProposal,
  next: NarrativeProposal,
): void {
  if (next.revisionNumber !== previous.revisionNumber + 1) {
    throw new Error("revisionNumber must equal previous revisionNumber + 1");
  }
  const expectedRevisionId = `${next.id}:r${next.revisionNumber}`;
  if (next.currentRevisionId !== expectedRevisionId) {
    throw new Error("revision id must follow '<proposal-id>:r<revisionNumber>'");
  }
  if (next.id !== previous.id || next.novelId !== previous.novelId) {
    throw new Error("linear Proposal revision cannot change identity");
  }
  if (canonicalJson(next.lineage) !== canonicalJson(previous.lineage)) {
    throw new Error("Proposal lineage cannot change within linear revision history");
  }
  const expectedParent: ProposalRevisionParent = {
    proposalIdentity: previous.id,
    revisionId: previous.currentRevisionId,
    revisionHash: previous.revisionHash,
  };
  if (
    !next.parentRevision ||
    next.parentRevision.proposalIdentity !== expectedParent.proposalIdentity ||
    next.parentRevision.revisionId !== expectedParent.revisionId
  ) {
    throw new Error("parent revision identity mismatch");
  }
  if (next.parentRevision.revisionHash !== expectedParent.revisionHash) {
    throw new Error("parent revision hash mismatch");
  }
  if (next.revisionTrigger === "initial") {
    throw new Error("non-initial revision requires a change trigger");
  }
  assertProposalRevisionSnapshotIntegrity(next);
}
export function narrativeProposalSourceReference(proposal: NarrativeProposal): SourceReference {
  return source({ identity: proposal.id, version: proposal.currentRevisionId, hash: proposal.revisionHash });
}
export function proposalSectionSourceReference(
  entry: NarrativeProposalSectionInput | NarrativeProposalSection,
  revisionId: RevisionId,
): SourceReference {
  return source({ identity: entry.id, version: revisionId, hash: proposalSectionHash(entry) });
}
export function assertInitialProposalRevision(proposal: NarrativeProposal): void {
  if (
    proposal.revisionNumber !== 1 ||
    proposal.parentRevision !== undefined ||
    proposal.revisionTrigger !== "initial" ||
    proposal.currentRevisionId !== `${proposal.id}:r1`
  ) {
    throw new Error("first Proposal revision must be the initial linear snapshot");
  }
  assertProposalRevisionSnapshotIntegrity(proposal);
}

export function assertProposalRevisionTransition(
  previous: NarrativeProposal,
  next: NarrativeProposal,
): void {
  assertLinearProposalRevision(previous, next);
  assertRevisionTrigger(
    next.revisionTrigger as ProposalRevisionChangeTrigger,
    revisionChanges(previous, next.sections, next.openQuestions),
  );
}

export function rehydrateNarrativeProposal(payload: Record<string, unknown>): NarrativeProposal {
  const proposal = payload as unknown as NarrativeProposal;
  assertProposalRevisionSnapshotIntegrity(proposal);
  return deepFreeze({
    ...proposal,
    sections: proposal.sections.map((entry) => cloneSectionSnapshot(entry)),
    openQuestions: proposal.openQuestions.map((entry) => cloneQuestion(entry)),
  });
}

export function createNarrativeProposal(input: CreateNarrativeProposalInput): NarrativeProposal {
  return makeProposal({
    ...input,
    sections: input.sections.map(cloneSection),
    updatedAt: input.createdAt,
  });
}
interface ProposalRevisionChanges {
  readonly addedSectionIds: readonly DomainId[];
  readonly removedSectionIds: readonly DomainId[];
  readonly contentChanged: boolean;
  readonly provenanceChanged: boolean;
  readonly dispositionChanged: boolean;
  readonly questionsChanged: boolean;
  readonly automaticInvalidationOnly: boolean;
}

function revisionChanges(
  previous: NarrativeProposal,
  sections: readonly NarrativeProposalSection[],
  openQuestions: readonly ProposalOpenQuestion[],
): ProposalRevisionChanges {
  const previousSections = new Map(previous.sections.map((entry) => [entry.id, entry]));
  const nextSectionIds = new Set(sections.map((entry) => entry.id));
  const previousQuestionIds = new Set(previous.openQuestions.map((entry) => entry.id));
  const nextQuestionIds = new Set(openQuestions.map((entry) => entry.id));
  let contentChanged = false;
  let provenanceChanged = false;
  let dispositionChanged = false;
  let automaticInvalidationOnly = true;
  for (const entry of sections) {
    const old = previousSections.get(entry.id);
    if (!old) continue;
    const contentDiffers = canonicalJson(old.content) !== canonicalJson(entry.content);
    const provenanceDiffers = canonicalJson(old.provenance) !== canonicalJson(entry.provenance);
    const dispositionDiffers = old.adoptionDisposition !== entry.adoptionDisposition;
    contentChanged ||= contentDiffers;
    provenanceChanged ||= provenanceDiffers;
    dispositionChanged ||= dispositionDiffers;
    if (
      dispositionDiffers &&
      !(contentDiffers && old.adoptionDisposition === "adopted" && entry.adoptionDisposition === "pending")
    ) {
      automaticInvalidationOnly = false;
    }
  }
  return {
    addedSectionIds: sections.filter((entry) => !previousSections.has(entry.id)).map((entry) => entry.id),
    removedSectionIds: previous.sections.filter((entry) => !nextSectionIds.has(entry.id)).map((entry) => entry.id),
    contentChanged,
    provenanceChanged,
    dispositionChanged,
    questionsChanged: semanticQuestions(previous.openQuestions) !== semanticQuestions(openQuestions) ||
      previousQuestionIds.size !== nextQuestionIds.size,
    automaticInvalidationOnly,
  };
}

function assertRevisionTrigger(
  trigger: ProposalRevisionChangeTrigger,
  changes: ProposalRevisionChanges,
): void {
  const hasSectionAddRemove = changes.addedSectionIds.length > 0 || changes.removedSectionIds.length > 0;
  const sectionSnapshotChanged = changes.contentChanged || changes.provenanceChanged || changes.dispositionChanged;
  const matches =
    trigger === "content_change"
      ? (changes.contentChanged || changes.provenanceChanged) &&
        !hasSectionAddRemove &&
        !changes.questionsChanged &&
        (!changes.dispositionChanged || changes.automaticInvalidationOnly)
      : trigger === "disposition_change"
        ? changes.dispositionChanged &&
          !changes.contentChanged &&
          !hasSectionAddRemove &&
          !changes.questionsChanged
        : trigger === "open_question_state_change"
          ? changes.questionsChanged && !sectionSnapshotChanged && !hasSectionAddRemove
          : trigger === "section_add"
            ? changes.addedSectionIds.length > 0 &&
              changes.removedSectionIds.length === 0 &&
              !sectionSnapshotChanged &&
              !changes.questionsChanged
            : changes.removedSectionIds.length > 0 &&
              changes.addedSectionIds.length === 0 &&
              !sectionSnapshotChanged &&
              !changes.questionsChanged;
  if (!matches) throw new Error("revision trigger does not match actual snapshot changes");
}

function finishProposalRevision(input: {
  previous: NarrativeProposal;
  sections: readonly NarrativeProposalSection[];
  openQuestions: readonly ProposalOpenQuestion[];
  trigger: ProposalRevisionTrigger;
  revisedAt: Date | ImmutableTimestamp;
}): NarrativeProposal {
  const revisionNumber = input.previous.revisionNumber + 1;
  const revised = makeProposal({
    id: input.previous.id,
    novelId: input.previous.novelId,
    proposalType: input.previous.proposalType,
    scope: input.previous.scope,
    sections: input.sections,
    openQuestions: input.openQuestions,
    lineage: input.previous.lineage,
    revisionNumber,
    revisionId: `${input.previous.id}:r${revisionNumber}`,
    parentRevision: {
      proposalIdentity: input.previous.id,
      revisionId: input.previous.currentRevisionId,
      revisionHash: input.previous.revisionHash,
    },
    revisionTrigger: input.trigger,
    createdAt: input.previous.createdAt,
    updatedAt: input.revisedAt,
  });
  assertLinearProposalRevision(input.previous, revised);
  return revised;
}

export function reviseNarrativeProposal(input: ReviseNarrativeProposalInput): NarrativeProposal {
  const previous = input.proposal;
  const openQuestions = (input.openQuestions ?? previous.openQuestions).map(cloneQuestion);
  const previousById = new Map(previous.sections.map((entry) => [entry.id, entry]));
  const next = input.sections.map((inputSection) => {
    const old = previousById.get(inputSection.id);
    if (Object.prototype.hasOwnProperty.call(inputSection, "adoptionDisposition")) {
      throw new Error("adoptionDisposition cannot be set by create/revise");
    }
    if (Object.prototype.hasOwnProperty.call(inputSection, "sectionHash")) {
      throw new Error("sectionHash cannot be set by create/revise");
    }
    const contentChanged = old !== undefined && canonicalJson(old.content) !== canonicalJson(inputSection.content);
    const disposition = old === undefined
      ? "pending" as const
      : contentChanged && old.adoptionDisposition === "adopted"
        ? "pending" as const
        : old.adoptionDisposition;
    return withSectionState({
      id: inputSection.id,
      content: inputSection.content,
      provenance: inputSection.provenance,
    }, disposition);
  });
  for (const entry of next) {
    const old = previousById.get(entry.id);
    if (old) assertProvenanceAppendOnly(old.provenance, entry.provenance, entry.id);
  }
  const previousQuestionById = new Map(previous.openQuestions.map((entry) => [entry.id, entry]));
  for (const entry of openQuestions) {
    const old = previousQuestionById.get(entry.id);
    if (old) assertProvenanceAppendOnly(old.provenance, entry.provenance, entry.id);
  }
  const sections = next.map((entry) => {
    const old = previousById.get(entry.id);
    if (!old || proposalSectionHash(old) === proposalSectionHash(entry)) return entry;
    return withSectionState({
      id: entry.id,
      content: entry.content,
      provenance: {
        ...entry.provenance,
        editLineage: [...entry.provenance.editLineage, proposalSectionSourceReference(old, previous.currentRevisionId)],
      },
    }, entry.adoptionDisposition);
  });
  const changes = revisionChanges(previous, sections, openQuestions);
  if (
    changes.addedSectionIds.length === 0 &&
    changes.removedSectionIds.length === 0 &&
    !changes.contentChanged &&
    !changes.provenanceChanged &&
    !changes.dispositionChanged &&
    !changes.questionsChanged
  ) {
    throw new Error("revision must change semantic proposal content");
  }
  assertRevisionTrigger(input.trigger, changes);
  return finishProposalRevision({
    previous,
    sections,
    openQuestions,
    trigger: input.trigger,
    revisedAt: input.revisedAt,
  });
}

export function reviseNarrativeProposalFromAdoptionDecision(input: {
  readonly proposal: NarrativeProposal;
  readonly decision: AdoptionDecision;
  readonly revisedAt: Date | ImmutableTimestamp;
}): NarrativeProposal {
  const previous = input.proposal;
  const proposalReference = narrativeProposalSourceReference(previous);
  assertAdoptionDecisionMatchesProposal(input.decision, previous);
  if (
    input.decision.proposalReference.identity !== proposalReference.identity ||
    input.decision.proposalReference.version !== proposalReference.version ||
    input.decision.proposalReference.hash !== proposalReference.hash ||
    input.decision.evidence.sourceReference.hash !== proposalReference.hash
  ) {
    throw new Error("validated AdoptionDecision required for this Proposal Revision");
  }
  const dispositionById = new Map<DomainId, ProposalSectionAdoptionDisposition>();
  for (const target of input.decision.targets) {
    dispositionById.set(
      target.scope.sectionIdentity,
      input.decision.decisionType === "adopt"
        ? "adopted"
        : input.decision.decisionType === "reject"
          ? "rejected"
          : input.decision.decisionType === "defer"
            ? "deferred"
            : "pending",
    );
  }
  const decisionReference = adoptionDecisionSourceReference(input.decision);
  const sections = previous.sections.map((entry) => {
    const disposition = dispositionById.get(entry.id) ?? entry.adoptionDisposition;
    const provenance = dispositionById.has(entry.id)
      ? {
          ...entry.provenance,
          adoptionDecisionReferences: [
            ...entry.provenance.adoptionDecisionReferences,
            decisionReference,
          ],
        }
      : entry.provenance;
    return withSectionState({
      id: entry.id,
      content: entry.content,
      provenance,
    }, disposition);
  });
  const changes = revisionChanges(previous, sections, previous.openQuestions);
  assertRevisionTrigger("disposition_change", changes);
  return finishProposalRevision({
    previous,
    sections,
    openQuestions: previous.openQuestions,
    trigger: "disposition_change",
    revisedAt: input.revisedAt,
  });
}
export function branchNarrativeProposal(input: BranchNarrativeProposalInput): NarrativeProposal {
  const from = input.sourceProposal;
  const sections = from.sections.map((entry) =>
    withSectionState({
      id: entry.id,
      content: entry.content,
      provenance: {
        ...entry.provenance,
        editLineage: [...entry.provenance.editLineage, proposalSectionSourceReference(entry, from.currentRevisionId)],
      },
    }, "pending"),
  );
  return makeProposal({
    id: input.id,
    novelId: input.novelId ?? from.novelId,
    proposalType: from.proposalType,
    scope: input.scope ?? from.scope,
    sections,
    openQuestions: from.openQuestions,
    lineage: {
      parent: narrativeProposalSourceReference(from),
      mergeSources: [],
      sourceSectionDispositions: from.sections.map((entry) => ({
        sectionId: entry.id,
        disposition: entry.adoptionDisposition,
      })),
    },
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}
export interface ProposalAdoptionSummary {
  readonly decidedSectionIds: readonly DomainId[];
  readonly undecidedSectionIds: readonly DomainId[];
  readonly adoptedSectionIds: readonly DomainId[];
  readonly rejectedSectionIds: readonly DomainId[];
  readonly deferredSectionIds: readonly DomainId[];
}

export function proposalAdoptionSummary(proposal: NarrativeProposal): ProposalAdoptionSummary {
  const adopted = proposal.sections.filter((entry) => entry.adoptionDisposition === "adopted").map((entry) => entry.id);
  const rejected = proposal.sections.filter((entry) => entry.adoptionDisposition === "rejected").map((entry) => entry.id);
  const deferred = proposal.sections.filter((entry) => entry.adoptionDisposition === "deferred").map((entry) => entry.id);
  const undecided = proposal.sections.filter((entry) => entry.adoptionDisposition === "pending").map((entry) => entry.id);
  return deepFreeze({
    decidedSectionIds: [...adopted, ...rejected, ...deferred].sort(),
    undecidedSectionIds: undecided.sort(),
    adoptedSectionIds: adopted.sort(),
    rejectedSectionIds: rejected.sort(),
    deferredSectionIds: deferred.sort(),
  });
}

export function compareNarrativeProposals(
  left: NarrativeProposal,
  right: NarrativeProposal,
): NarrativeProposalComparison {
  const leftSections = new Map(left.sections.map((entry) => [entry.id, entry]));
  const rightSectionIds = new Set(right.sections.map((entry) => entry.id));
  const added: DomainId[] = [];
  const removed: DomainId[] = [];
  const changed: DomainId[] = [];
  const unchanged: DomainId[] = [];
  const changedSectionAspects: ProposalSectionComparison[] = [];
  for (const entry of right.sections) {
    const previous = leftSections.get(entry.id);
    if (!previous) {
      added.push(entry.id);
      continue;
    }
    const aspects: ProposalSectionChangeAspect[] = [];
    if (canonicalJson(previous.content) !== canonicalJson(entry.content)) aspects.push("content");
    if (previous.adoptionDisposition !== entry.adoptionDisposition) aspects.push("adoptionDisposition");
    if (canonicalJson(previous.provenance) !== canonicalJson(entry.provenance)) aspects.push("provenance");
    if (aspects.length === 0) unchanged.push(entry.id);
    else {
      changed.push(entry.id);
      changedSectionAspects.push({ sectionId: entry.id, aspects });
    }
  }
  for (const entry of left.sections) if (!rightSectionIds.has(entry.id)) removed.push(entry.id);

  const leftQuestions = new Map(left.openQuestions.map((entry) => [entry.id, entry]));
  const rightQuestionIds = new Set(right.openQuestions.map((entry) => entry.id));
  const addedQuestions: DomainId[] = [];
  const removedQuestions: DomainId[] = [];
  const changedQuestions: DomainId[] = [];
  const unchangedQuestions: DomainId[] = [];
  for (const entry of right.openQuestions) {
    const previous = leftQuestions.get(entry.id);
    if (!previous) addedQuestions.push(entry.id);
    else if (canonicalJson(previous) !== canonicalJson(entry)) changedQuestions.push(entry.id);
    else unchangedQuestions.push(entry.id);
  }
  for (const entry of left.openQuestions) {
    if (!rightQuestionIds.has(entry.id)) removedQuestions.push(entry.id);
  }

  return deepFreeze({
    scopeChanged: canonicalJson(left.scope) !== canonicalJson(right.scope),
    addedSectionIds: added.sort(),
    removedSectionIds: removed.sort(),
    changedSectionIds: changed.sort(),
    unchangedSectionIds: unchanged.sort(),
    changedSectionAspects: changedSectionAspects.sort((a, b) => a.sectionId.localeCompare(b.sectionId)),
    addedOpenQuestionIds: addedQuestions.sort(),
    removedOpenQuestionIds: removedQuestions.sort(),
    changedOpenQuestionIds: changedQuestions.sort(),
    unchangedOpenQuestionIds: unchangedQuestions.sort(),
  });
}
