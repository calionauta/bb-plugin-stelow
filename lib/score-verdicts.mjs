import { CRITERIA_MET_SCORE, CRITERIA_UNMET_SCORE } from "./skill-criteria.mjs";
import { meetsDecisionThreshold } from "./decision-api.mjs";

/**
 * Shared verdict resolution (pure, no DB).
 *
 * Every Score-based advisory judgment (tasks, gap triage) lands on the
 * same three states with the same failure behavior: a Jev answer keyed
 * `${keyPrefix}:${id}`, or a preset-judge verdict keyed by bare id.
 * Unknown entries, wrong answer shapes, and below-floor confidence all
 * degrade to `unverifiable` — the caller reports, nothing blocks.
 */
export function resolveScoredVerdicts({ items, answers, verdicts, keyPrefix, routeAt = 0.6 }) {
  const list = Array.isArray(items) ? items : [];
  const findings = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" && item.id.length > 0 ? item.id : null;
    if (!id) continue;
    // Fidelity: a name the caller supplied — including an empty string —
    // stays as given; only a non-string falls back to the id.
    const name = typeof item.name === "string" ? item.name : id;
    const base = { id, name, score: null, confidence: null, verdict: "unverifiable", error: null };
    if (verdicts && typeof verdicts === "object") {
      const entry = verdicts[id];
      if (!entry || typeof entry !== "object") { findings.push(base); continue; }
      const confident = meetsDecisionThreshold(entry.confidence, routeAt);
      const status = entry.status === "met" || entry.status === "unmet" ? entry.status : "unverifiable";
      findings.push({ ...base, confidence: entry.confidence ?? null, verdict: confident ? status : "unverifiable" });
      continue;
    }
    const answer = answers ? answers[`${keyPrefix}:${id}`] ?? null : null;
    if (!answer || answer.type !== "score") { findings.push(base); continue; }
    const { score, confidence } = answer;
    if (typeof score !== "number" || !meetsDecisionThreshold(confidence, routeAt)) {
      findings.push({
        ...base,
        score: typeof score === "number" ? score : null,
        confidence: typeof confidence === "number" ? confidence : null,
      });
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
