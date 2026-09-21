import { CRITERIA_MET_SCORE, CRITERIA_UNMET_SCORE } from "./skill-criteria.mjs";
import { meetsDecisionThreshold } from "./decision-api.mjs";

/**
 * Task-completion evidence (pure, no DB).
 *
 * A completed task status is a worker assertion — this module turns it
 * into a checkable question: given the working-tree diff, does each
 * completed task show evidence of completion? One atomic Score question
 * per task (same Jev shape as skill criteria), resolved against the
 * point's confidence floor. Verdicts are advisory findings, never gates:
 * met / unmet / unverifiable, with low-confidence degrading to
 * unverifiable instead of guessing.
 */

export const TASK_EVIDENCE_DIFF_CHARS = 6000;

// One atomic Score per completed task, keyed for answer lookup. The
// question carries the task plus its parent scope so the judge does not
// score floating text without context.
export function tasksToScoreQuestions(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const questions = {};
  for (const task of list) {
    if (!task || typeof task !== "object") continue;
    const id = typeof task.id === "string" && task.id.length > 0 ? task.id : null;
    const name = typeof task.name === "string" && task.name.length > 0 ? task.name : null;
    if (!id || !name) continue;
    const scope = typeof task.scope === "string" && task.scope.length > 0 ? ` (scope: ${task.scope})` : "";
    questions[`task:${id}`] = {
      type: "score",
      instructions: `Does the diff show this task completed? ${name}${scope}`,
      criteria: ["Not done", "Partially done", "Clearly done"],
    };
  }
  return questions;
}

// Map scored answers (Jev) or parsed preset verdicts onto one findings
// shape. Unknown ids, unknown statuses, and below-floor confidence all
// degrade to unverifiable — the caller reports, never blocks.
export function resolveTaskVerdicts({ tasks, answers, verdicts, routeAt = 0.6 }) {
  const list = Array.isArray(tasks) ? tasks : [];
  const findings = [];
  for (const task of list) {
    if (!task || typeof task !== "object") continue;
    const id = typeof task.id === "string" ? task.id : null;
    const name = typeof task.name === "string" ? task.name : id ?? "Untitled task";
    if (!id) continue;
    const base = { id, name, score: null, confidence: null, verdict: "unverifiable", error: null };
    if (verdicts && typeof verdicts === "object") {
      const entry = verdicts[id];
      if (!entry || typeof entry !== "object") { findings.push(base); continue; }
      const confident = meetsDecisionThreshold(entry.confidence, routeAt);
      const status = entry.status === "met" || entry.status === "unmet" ? entry.status : "unverifiable";
      findings.push({ ...base, confidence: entry.confidence ?? null, verdict: !confident ? "unverifiable" : status });
      continue;
    }
    const answer = answers ? answers[`task:${id}`] ?? null : null;
    if (!answer || answer.type !== "score") { findings.push(base); continue; }
    const { score, confidence } = answer;
    if (typeof score !== "number" || !meetsDecisionThreshold(confidence, routeAt)) {
      findings.push({ ...base, score: typeof score === "number" ? score : null, confidence: typeof confidence === "number" ? confidence : null });
      continue;
    }
    findings.push({
      ...base,
      score,
      confidence,
      verdict: score >= CRITERIA_MET_SCORE ? "met" : score < CRITERIA_UNMET_SCORE ? "unmet" : "unverifiable",
    });
  }
  return findings;
}
