import type { StateRecord } from "../../narrative/state/domain/stateRecord";
import type { ValidationRun } from "../../production/domain/validationRun";
import type { ReviewDecision } from "../../production/domain/reviewDecision";
import type { NarrativeCommit } from "../../safety/domain/narrativeCommit";
import type { RunAuditProjection } from "../../production/application/runAuditProjection";
import {
  createNarrativeObservationLoad,
  createValidationObservationLoad,
  createReviewDecisionObservationLoad,
  createNarrativeCommitObservationLoad,
  createRunSignalsObservationLoad,
} from "../observation/domainSourceLoads";
import {
  createNarrativeObservationAdapter,
  createValidationObservationAdapter,
  createRecallObservationAdapter,
  createRunSignalsObservationAdapter,
} from "../observation/sourceAdapters";
import {
  observeRecallSources,
  type RecallObservationBatch,
  type RecallSourceCollection,
} from "../detection/recallPipeline";

export interface RecallCoreNarrativeInput {
  readonly sourceIdentity: string;
  readonly records: readonly StateRecord[];
}

export interface RecallCoreValidationInput {
  readonly sourceIdentity: string;
  readonly runs: readonly ValidationRun[];
}

export interface RecallCoreReviewInput {
  readonly sourceIdentity: string;
  readonly decisions: readonly ReviewDecision[];
}

export interface RecallCoreCommitInput {
  readonly sourceIdentity: string;
  readonly commits: readonly NarrativeCommit[];
}

export interface RecallCoreRunInput {
  readonly sourceIdentity: string;
  readonly projection: RunAuditProjection;
}

export interface ObserveCoreForRecallInput {
  readonly narrative?: RecallCoreNarrativeInput;
  readonly validation?: RecallCoreValidationInput;
  readonly reviewDecisions?: RecallCoreReviewInput;
  readonly narrativeCommits?: RecallCoreCommitInput;
  readonly runSignals?: RecallCoreRunInput;
}

export async function observeCoreForRecall(
  input: ObserveCoreForRecallInput,
): Promise<RecallObservationBatch> {
  const sources: RecallSourceCollection = {};
  if (input.narrative !== undefined) {
    sources.narrative = createNarrativeObservationAdapter(async () =>
      createNarrativeObservationLoad(input.narrative!),
    );
  }
  if (input.validation !== undefined) {
    sources.validation = createValidationObservationAdapter(async () =>
      createValidationObservationLoad(input.validation!),
    );
  }
  if (input.reviewDecisions !== undefined) {
    sources.review_decision = createRecallObservationAdapter("review_decision", async () =>
      createReviewDecisionObservationLoad(input.reviewDecisions!),
    );
  }
  if (input.narrativeCommits !== undefined) {
    sources.narrative_commit = createRecallObservationAdapter("narrative_commit", async () =>
      createNarrativeCommitObservationLoad(input.narrativeCommits!),
    );
  }
  if (input.runSignals !== undefined) {
    sources.run_signals = createRunSignalsObservationAdapter(async () =>
      createRunSignalsObservationLoad(input.runSignals!),
    );
  }
  return observeRecallSources(sources);
}
