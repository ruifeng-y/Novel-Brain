import type { Candidate, CandidateAtomicChange } from "../domain/candidate";
import type { Scene } from "../../manuscript/domain/scene";
import { resolveTargetSpan } from "../../manuscript/domain/targetSpan";
import {
  createValidationRun,
  type ValidationFinding,
  type ValidationOutcome,
} from "../domain/validationRun";

export interface ValidationRequest {
  readonly validationId: string;
  readonly candidate: Candidate;
  readonly scene: Scene;
  readonly mustPreserve: readonly string[];
  readonly createdAt: Date;
}

export interface ValidationResult {
  readonly run: ReturnType<typeof createValidationRun>;
  readonly outcome: ValidationOutcome;
}

function validateAtomicChange(
  change: CandidateAtomicChange,
  scene: Scene,
  findings: ValidationFinding[],
): string[] {
  if (change.type === "text") {
    if (change.sceneId !== scene.id) {
      findings.push({
        code: "SCENE_MISMATCH",
        severity: "error",
        confidence: 1,
        message: "Text change targets a different scene.",
        evidence: { expectedSceneId: scene.id, actualSceneId: change.sceneId },
      });
    }
    if (!change.text.trim()) {
      findings.push({
        code: "EMPTY_TEXT",
        severity: "error",
        confidence: 1,
        message: "Text candidate cannot be empty.",
        evidence: { sceneId: change.sceneId },
      });
    }
    return [change.text];
  }

  if (change.type === "local_text") {
    if (change.sceneId !== scene.id) {
      findings.push({
        code: "SCENE_MISMATCH",
        severity: "error",
        confidence: 1,
        message: "Local text change targets a different scene.",
        evidence: { expectedSceneId: scene.id, actualSceneId: change.sceneId },
      });
      return [];
    }
    try {
      resolveTargetSpan(scene, change.targetSpan);
    } catch (error) {
      findings.push({
        code: "TARGET_SPAN_NOT_FOUND",
        severity: "error",
        confidence: 1,
        message: error instanceof Error ? error.message : "Target span is invalid.",
        evidence: { anchorId: change.targetSpan.anchorId },
      });
    }
    return [change.replacement];
  }

  if (change.type === "structured_state" || change.type === "canonical_fact") {
    if (Object.keys(change.content).length === 0) {
      findings.push({
        code: "EMPTY_STRUCTURED_CHANGE",
        severity: "error",
        confidence: 1,
        message: "Structured candidate cannot be empty.",
        evidence: {
          targetId:
            change.type === "structured_state" ? change.stateRecordId : change.canonicalFactId,
        },
      });
    }
  }
  return [];
}

export function validateCandidate(request: ValidationRequest): ValidationResult {
  const findings: ValidationFinding[] = [];
  const proposedTexts: string[] = [];

  if (request.candidate.change.type === "composite") {
    if (request.candidate.change.changes.length === 0) {
      findings.push({
        code: "EMPTY_COMPOSITE_CHANGE",
        severity: "error",
        confidence: 1,
        message: "Composite candidate requires at least one atomic change.",
        evidence: { candidateId: request.candidate.id },
      });
    }
    for (const atomicChange of request.candidate.change.changes) {
      proposedTexts.push(...validateAtomicChange(atomicChange, request.scene, findings));
    }
  } else {
    proposedTexts.push(
      ...validateAtomicChange(request.candidate.change, request.scene, findings),
    );
  }

  const proposedText = proposedTexts.length > 0 ? proposedTexts.join("\n") : request.scene.text;
  for (const phrase of request.mustPreserve) {
    if (!proposedText.includes(phrase)) {
      findings.push({
        code: "REQUIRED_PHRASE_MISSING",
        severity: "error",
        confidence: 1,
        message: `Required phrase is missing: ${phrase}`,
        evidence: { phrase },
      });
    }
  }

  const outcome: ValidationOutcome = findings.some((finding) => finding.severity === "error")
    ? "fail"
    : "pass";

  const run = createValidationRun({
    id: request.validationId,
    candidateId: request.candidate.id,
    candidateRevisionId: request.candidate.currentRevisionId,
    validatorId: "basic-candidate-validator",
    outcome,
    findings,
    createdAt: request.createdAt,
  });

  return { run, outcome };
}
