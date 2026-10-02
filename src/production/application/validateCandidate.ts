import type { Candidate, CandidateAtomicChange } from "../domain/candidate";
import type { Scene } from "../../manuscript/domain/scene";
import {
  replaceTargetSpan,
  resolveTargetSpan,
} from "../../manuscript/domain/targetSpan";
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

function atomicChanges(change: Candidate["change"]): readonly CandidateAtomicChange[] {
  return change.type === "composite" ? change.changes : [change];
}

function targetKey(change: CandidateAtomicChange): string {
  if (change.type === "text" || change.type === "local_text") {
    return `Scene:${change.sceneId}`;
  }
  if (change.type === "canonical_fact") {
    return `CanonicalFact:${change.canonicalFactId}`;
  }
  return `StateRecord:${change.stateRecordId}`;
}

function addFinding(
  findings: ValidationFinding[],
  code: string,
  message: string,
  evidence: Readonly<Record<string, unknown>>,
): void {
  findings.push({
    code,
    severity: "error",
    confidence: 1,
    message,
    evidence,
  });
}

function targetSpanErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("anchor not found")) return "TARGET_ANCHOR_NOT_FOUND";
  if (message.includes("text does not match")) return "TARGET_TEXT_MISMATCH";
  if (message.includes("source hash does not match")) return "TARGET_SOURCE_HASH_MISMATCH";
  if (message.includes("ambiguous")) return "TARGET_SPAN_AMBIGUOUS";
  if (message.includes("not present")) return "TARGET_TEXT_NOT_FOUND";
  return "TARGET_SPAN_INVALID";
}

function validateAtomicChange(
  change: CandidateAtomicChange,
  scene: Scene,
  findings: ValidationFinding[],
): void {
  if (change.type === "text") {
    if (change.sceneId !== scene.id) {
      addFinding(
        findings,
        "SCENE_MISMATCH",
        "Text change targets a different scene.",
        { expectedSceneId: scene.id, actualSceneId: change.sceneId },
      );
    }
    if (!change.text.trim()) {
      addFinding(findings, "EMPTY_TEXT", "Text candidate cannot be empty.", {
        sceneId: change.sceneId,
      });
    }
    return;
  }

  if (change.type === "local_text") {
    if (change.sceneId !== scene.id) {
      addFinding(
        findings,
        "SCENE_MISMATCH",
        "Local text change targets a different scene.",
        { expectedSceneId: scene.id, actualSceneId: change.sceneId },
      );
      return;
    }
    try {
      resolveTargetSpan(scene, change.targetSpan);
    } catch (error) {
      addFinding(
        findings,
        targetSpanErrorCode(error),
        error instanceof Error ? error.message : "Target span is invalid.",
        { anchorId: change.targetSpan.anchorId },
      );
    }
    return;
  }

  const targetId =
    change.type === "structured_state" ? change.stateRecordId : change.canonicalFactId;
  if (!targetId.trim()) {
    addFinding(
      findings,
      "EMPTY_STRUCTURED_TARGET_ID",
      "Structured candidate requires a target id.",
      { changeType: change.type },
    );
  }
  if (Object.keys(change.content).length === 0) {
    addFinding(
      findings,
      "EMPTY_STRUCTURED_CHANGE",
      "Structured candidate cannot be empty.",
      { changeType: change.type, targetId },
    );
  }
}

function resultingSceneText(
  scene: Scene,
  changes: readonly CandidateAtomicChange[],
  findings: ValidationFinding[],
): string {
  const sceneChanges = changes.filter(
    (change): change is Extract<CandidateAtomicChange, { type: "text" | "local_text" }> =>
      change.type === "text" || change.type === "local_text",
  );
  if (sceneChanges.length === 0) return scene.text;
  if (sceneChanges.length > 1) {
    addFinding(
      findings,
      "DUPLICATE_CANDIDATE_TARGET",
      "Composite candidate contains multiple changes for one scene.",
      { sceneId: scene.id },
    );
    return scene.text;
  }

  const sceneChange = sceneChanges[0];
  if (!sceneChange) return scene.text;
  if (sceneChange.type === "text") return sceneChange.text;
  try {
    return replaceTargetSpan({
      scene,
      target: sceneChange.targetSpan,
      replacement: sceneChange.replacement,
    });
  } catch {
    return scene.text;
  }
}

export function validateCandidate(request: ValidationRequest): ValidationResult {
  const findings: ValidationFinding[] = [];
  const changes = atomicChanges(request.candidate.change);
  const seenTargets = new Set<string>();
  for (const change of changes) {
    const key = targetKey(change);
    if (seenTargets.has(key)) {
      addFinding(
        findings,
        "DUPLICATE_CANDIDATE_TARGET",
        "Composite candidate contains duplicate targets.",
        { target: key },
      );
    }
    seenTargets.add(key);
    validateAtomicChange(change, request.scene, findings);
  }

  const proposedText = resultingSceneText(request.scene, changes, findings);
  for (const phrase of request.mustPreserve) {
    if (!proposedText.includes(phrase)) {
      addFinding(
        findings,
        "REQUIRED_PHRASE_MISSING",
        `Required phrase is missing: ${phrase}`,
        { phrase },
      );
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
