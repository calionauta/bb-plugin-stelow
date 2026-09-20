/**
 * Skill criteria blocks. Upstream playbooks carry Completeness contracts in
 * prose; a mirrored fenced `criteria:` block lists the same minima as
 * machine-readable items (id, kind, text). Kinds: presence/count route to
 * the existing deterministic validators; semantic routes to one Score
 * question each via the Decision API (advisory until calibrated — see
 * skills-criteria-plan.md). Pure parsing (no host dependency); the caller
 * supplies file text, so sync pipelines and tests feed fixtures directly.
 *
 * Consumers: `bb stelow criteria` (advisory report) and Phase 2
 * verify-advisory output (planned). Until then this
 * module is the tested contract the consumer will be pinned against.
 */

export const SKILL_CRITERION_KINDS = ["presence", "count", "semantic"];

// Verdict cutoffs on the 0–2 Score scale (Not / Partially / Clearly met).
// A verdict needs both the score and the confidence: a confident extreme
// decides, anything else abstains to human review.
export const CRITERIA_MET_SCORE = 1.5;
export const CRITERIA_UNMET_SCORE = 0.5;

// Parse the first `criteria:` list in a markdown file. Malformed items
// (missing id/kind/text, unknown kind) are skipped, never thrown;
// duplicate ids keep the first occurrence. Returns [] when absent.
export function parseCriteriaBlock(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "criteria:");
  if (start < 0) return [];
  const items = [];
  const seen = new Set();
  let current = null;
  const flush = () => {
    if (current && current.id && SKILL_CRITERION_KINDS.includes(current.kind) && current.text && !seen.has(current.id)) {
      seen.add(current.id);
      items.push({ id: current.id, kind: current.kind, text: current.text });
    }
    current = null;
  };
  for (const line of lines.slice(start + 1)) {
    const itemMatch = line.match(/^\s*-\s*id:\s*(.+?)\s*$/);
    if (itemMatch) {
      flush();
      current = { id: itemMatch[1], kind: "", text: "" };
      continue;
    }
    if (!current) {
      if (line.trim() !== "") break;
      continue;
    }
    const kindMatch = line.match(/^\s*kind:\s*(.+?)\s*$/);
    if (kindMatch) {
      current.kind = kindMatch[1];
      continue;
    }
    const textMatch = line.match(/^\s*text:\s*["']?(.+?)["']?\s*$/);
    if (textMatch) {
      current.text = textMatch[1];
      continue;
    }
    if (line.trim() === "") continue;
    flush();
    break;
  }
  flush();
  return items;
}

export function groupCriteriaByKind(items) {
  const groups = { presence: [], count: [], semantic: [] };
  for (const item of Array.isArray(items) ? items : []) {
    if (Object.hasOwn(groups, item?.kind)) groups[item.kind].push(item);
  }
  return groups;
}

import { evaluateDecisionCall, meetsDecisionThreshold, DECISION_API_TIMEOUT_MS } from "./decision-api.mjs";

// One atomic Score per semantic criterion (Autorubric: separate calls avoid
// conflation). Fixed 3-level anchors quoting the criterion — calibration
// refines anchors per criterion later; the question always names its id.
export function semanticCriterionToScore(criterion) {
  const text = typeof criterion?.text === "string" && criterion.text.length > 0 ? criterion.text : "the stated criterion";
  return {
    [`criterion:${criterion?.id ?? "unknown"}`]: {
      type: "score",
      instructions: `Judge ONLY this criterion against the artifact excerpt: ${text}`,
      criteria: ["Not met", "Partially met", "Clearly met"],
    },
  };
}

// Judge every semantic criterion of a skill against one artifact. One
// atomic call per criterion evaluated in parallel — Jev-class providers
// score questions independently, so parallelism buys latency without the
// conflation of one shared reasoning context. Presence/count criteria are
// NOT judged here; they belong to the deterministic validators. Per-item
// failures degrade to unverifiable; total failure degrades the whole call.
export async function judgeArtifactCriteria({ provider = "jev", endpoint, apiKey, model, skillText, artifactText, routeAt = 0.6, timeoutMs = DECISION_API_TIMEOUT_MS, fetchImpl }) {
  const { semantic } = groupCriteriaByKind(parseCriteriaBlock(skillText));
  if (semantic.length === 0) return { ok: true, findings: [], evaluated: 0 };
  const state = typeof artifactText === "string" ? artifactText : "";
  const findings = await Promise.all(semantic.map(async (criterion) => {
    const question = semanticCriterionToScore(criterion);
    const base = { id: criterion.id, kind: "semantic", text: criterion.text, score: null, confidence: null, verdict: "unverifiable", error: null };
    const result = await evaluateDecisionCall({ provider, endpoint, apiKey, model, state, questions: question, timeoutMs, fetchImpl });
    if (!result.ok) return { ...base, error: result.error ?? "call failed" };
    const key = Object.keys(question)[0];
    const answer = result.answers?.[key] ?? null;
    if (!answer || answer.type !== "score") return base;
    const { score, confidence } = answer;
    if (typeof score !== "number" || !meetsDecisionThreshold(confidence, routeAt)) return { ...base, score, confidence };
    if (score >= CRITERIA_MET_SCORE) return { ...base, score, confidence, verdict: "met" };
    if (score < CRITERIA_UNMET_SCORE) return { ...base, score, confidence, verdict: "unmet" };
    return { ...base, score, confidence };
  }));
  if (findings.length > 0 && findings.every((finding) => finding.error)) {
    return { ok: false, error: findings[0].error, findings };
  }
  return { ok: true, findings, evaluated: findings.filter((finding) => !finding.error).length };
}
