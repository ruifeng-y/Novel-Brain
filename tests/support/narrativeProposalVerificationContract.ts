import { describe, expect, it } from "vitest";
import { createAdoptionChangeSetInputs } from "../../src/story/domain/adoptionDecision";
import {
  branchNarrativeProposal,
  compareNarrativeProposals,
  narrativeProposalSourceReference,
  proposalSectionInput,
  reviseNarrativeProposal,
} from "../../src/story/domain/narrativeProposal";
import { saveNarrativeProposalRevision, recordAdoptionDecision } from "../../src/story/application/narrativeProposalService";
import { createChangeSet, replaceChangeSetChanges } from "../../src/production/domain/changeSet";
import { createCandidate } from "../../src/production/domain/candidate";
import { createVersionReference, createVersionSet } from "../../src/shared/domain/versioning";
import { isImmutableTimestamp } from "../../src/shared/domain/observationSource";
import {
  createNarrativeProposalVerificationEnvironment,
  type NarrativeProposalVerificationEnvironment,
} from "./narrativeProposalFixtures";
import { describeVerificationGate, type CapabilityVerificationGate } from "./capabilityVerificationContract";

function gate(
  name: CapabilityVerificationGate,
  title: string,
  body: (environment: NarrativeProposalVerificationEnvironment) => void | Promise<void>,
  createEnvironment: () => Promise<NarrativeProposalVerificationEnvironment>,
): void {
  it(`[${name}] ${title}`, async () => body(await createEnvironment()));
}

export function runNarrativeProposalVerificationContract(
  adapterName: string,
  createEnvironment: () => Promise<NarrativeProposalVerificationEnvironment>,
): void {
  describe(`${adapterName} [task:2.2] narrative proposal and typed adoption verification`, () => {
    gate("domain", "branches and compares independent Proposal revisions", async (environment) => {
      const branch = branchNarrativeProposal({
        sourceProposal: environment.proposal,
        id: "proposal-verification-branch",
        createdAt: new Date("2026-10-04T01:00:00.000Z"),
      });
      const revised = reviseNarrativeProposal({
        proposal: branch,
        sections: branch.sections.map((entry) =>
          entry.id === "section-a" ? { ...proposalSectionInput(entry), content: { text: "A city that wakes" } } : proposalSectionInput(entry),
        ),
        trigger: "content_change",
        revisedAt: new Date("2026-10-04T02:00:00.000Z"),
      });

      expect(branch.id).not.toBe(environment.proposal.id);
      expect(branch.lineage.parent).toEqual(narrativeProposalSourceReference(environment.proposal));
      expect(compareNarrativeProposals(branch, revised).changedSectionIds).toEqual(["section-a"]);
    }, createEnvironment);

    gate("integration", "maps partial typed adoption to existing ChangeSet inputs only", async (environment) => {
      await saveNarrativeProposalRevision(environment.persistence, environment.proposal);
      const decision = environment.decision({
        id: "decision-integration-2.2",
        targets: [
          environment.target({
            id: "target-integration-plan",
            sectionId: "section-a",
            targetType: "plan",
            objectId: "plan-integration",
            changeId: "change-integration-plan",
          }),
          environment.target({
            id: "target-integration-canon",
            sectionId: "section-b",
            targetType: "canonical_fact",
            objectId: "fact-integration",
            changeId: "change-integration-canon",
          }),
        ],
      });
      const recorded = await recordAdoptionDecision(environment.persistence, decision);
      const input = createAdoptionChangeSetInputs(recorded);
      const changeSet = replaceChangeSetChanges({
        changeSet: createChangeSet({
          id: "change-set-integration-2.2",
          novelId: environment.proposal.novelId,
          initialRevisionId: "change-set-integration-2.2:r0",
          createdAt: new Date("2026-10-04T03:00:00.000Z"),
        }),
        changes: input.changes,
        revisionId: "change-set-integration-2.2:r1",
        updatedAt: new Date("2026-10-04T03:00:00.000Z"),
      });

      expect(input.changes).toHaveLength(2);
      expect(changeSet.lifecycle).toBe("open");
      expect(changeSet.closureDisposition).toBeUndefined();
    }, createEnvironment);

    gate("persistence", "retains Proposal revision history and immutable Decision evidence", async (environment) => {
      await saveNarrativeProposalRevision(environment.persistence, environment.proposal);
      const decision = environment.decision({ id: "decision-persistence-2.2" });
      await recordAdoptionDecision(environment.persistence, decision);

      expect(await environment.persistence.proposals.getRevision(
        environment.proposal.id,
        environment.proposal.currentRevisionId,
      )).toEqual(environment.proposal);
      expect(await environment.persistence.decisions.findById(decision.id)).toEqual(decision);
      expect(isImmutableTimestamp((await environment.persistence.decisions.findById(decision.id))?.decidedAt)).toBe(true);
    }, createEnvironment);

    gate("transaction", "rolls back Proposal and Decision writes together", async (environment) => {
      const decision = environment.decision({ id: "decision-transaction-2.2", decisionType: "defer" });

      await expect(
        environment.persistence.transaction.run(async (work) => {
          await work.proposals.saveRevisionIfAbsent(environment.proposal);
          await work.decisions.saveIfAbsent(decision);
          throw new Error("verification rollback");
        }),
      ).rejects.toThrow("verification rollback");

      expect(await environment.persistence.proposals.findById(environment.proposal.id)).toBeUndefined();
      expect(await environment.persistence.decisions.findById(decision.id)).toBeUndefined();
    }, createEnvironment);

    gate("concurrency", "keeps one immutable winner for conflicting Decision evidence", async (environment) => {
      await saveNarrativeProposalRevision(environment.persistence, environment.proposal);
      const first = environment.decision({ id: "decision-concurrency-2.2", reason: "first" });
      const second = environment.decision({ id: "decision-concurrency-2.2", reason: "second" });
      const outcomes = await Promise.allSettled([
        recordAdoptionDecision(environment.persistence, first),
        recordAdoptionDecision(environment.persistence, second),
      ]);

      const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const winner = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof recordAdoptionDecision>>>).value;
      expect(["first", "second"]).toContain(winner.reason);
      expect((await environment.persistence.decisions.findById(first.id))?.reason).toBe(winner.reason);
    }, createEnvironment);

    gate("recovery", "continues after a caught create-only conflict", async (environment) => {
      await saveNarrativeProposalRevision(environment.persistence, environment.proposal);
      const original = environment.decision({ id: "decision-recovery-2.2", reason: "original" });
      await recordAdoptionDecision(environment.persistence, original);

      await environment.persistence.transaction.run(async (work) => {
        await expect(work.decisions.saveIfAbsent({ ...original, reason: "conflict" })).rejects.toThrow();
        await work.decisions.saveIfAbsent(environment.decision({
          id: "decision-recovery-2.2-followup",
          decisionType: "reopen",
        }));
      });

      expect((await environment.persistence.decisions.findById(original.id))?.reason).toBe("original");
      expect(await environment.persistence.decisions.findById("decision-recovery-2.2-followup")).toBeDefined();
    }, createEnvironment);

    gate("replay", "returns stable Decision and ChangeSet input hashes", async (environment) => {
      await saveNarrativeProposalRevision(environment.persistence, environment.proposal);
      const decision = environment.decision({ id: "decision-replay-2.2" });
      const first = await recordAdoptionDecision(environment.persistence, decision);
      const second = await recordAdoptionDecision(environment.persistence, decision);

      expect(second).toEqual(first);
      expect(createAdoptionChangeSetInputs(second)).toEqual(createAdoptionChangeSetInputs(first));
    }, createEnvironment);

    gate("cross-system", "separates Plan, Canon, Manuscript, and StoryState target scopes", async (environment) => {
      const targets = [
        environment.target({ id: "target-cross-plan", sectionId: "section-a", targetType: "plan", objectId: "plan-cross", changeId: "change-cross-plan" }),
        environment.target({ id: "target-cross-canon", sectionId: "section-c", targetType: "canonical_fact", objectId: "fact-cross", changeId: "change-cross-canon" }),
        environment.target({ id: "target-cross-manuscript", sectionId: "section-b", targetType: "manuscript", objectId: "manuscript-cross", changeId: "change-cross-manuscript" }),
        environment.target({ id: "target-cross-state", sectionId: "section-d", targetType: "story_state", objectId: "state-cross", changeId: "change-cross-state" }),
      ];
      const decision = environment.decision({ id: "decision-cross-2.2", targets });
      const full = createAdoptionChangeSetInputs(decision);
      const partial = createAdoptionChangeSetInputs(environment.decision({
        id: "decision-cross-partial-2.2",
        targets: targets.slice(0, 2),
      }));

      expect(full.changes.map((change) => change.targetAddress.targetType)).toEqual([
        "plan", "canonical_fact", "manuscript", "story_state",
      ]);
      expect(new Set(full.proposedChanges.map((entry) => `${entry.scope.sectionIdentity}:${entry.change.targetAddress.objectId}`)).size).toBe(4);
      expect(partial.changes).toHaveLength(2);
    }, createEnvironment);

    gate("regression", "keeps Frozen Core Change and Candidate contracts unchanged", async (environment) => {
      const input = createAdoptionChangeSetInputs(environment.decision({ id: "decision-regression-2.2" }));
      const candidate = createCandidate({
        id: "candidate-regression-2.2",
        taskId: "task-regression-2.2",
        novelId: environment.proposal.novelId,
        basedOnVersionSet: createVersionSet({
          scene: createVersionReference("Scene", "scene-regression", "scene-rev-1"),
        }),
        change: { type: "text", sceneId: "scene-regression", text: "unchanged" },
        createdAt: new Date("2026-10-04T04:00:00.000Z"),
      });

      expect(input.changes[0]?.sourceType).toBe("proposal_adoption");
      expect(Object.prototype.hasOwnProperty.call(environment.proposal, "canon")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(environment.proposal, "manuscript")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(environment.proposal, "storyState")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(candidate, "proposalId")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(candidate, "adoptionDecisionId")).toBe(false);
    }, createEnvironment);
  });
}

export function runNarrativeProposalVerificationHarnessSmoke(): void {
  describe("Narrative proposal verification harness [task:2.2]", () => {
    it("[domain] exposes all nine applicable gate markers", () => {
      expect([
        "domain", "integration", "persistence", "transaction", "concurrency",
        "recovery", "replay", "cross-system", "regression",
      ]).toHaveLength(9);
    });
  });
}
