/**
 * Decision-router registry. Each point names one fuzzy judgment the host
 * makes, its modes, and its thresholds — all constants in one place so
 * questions and thresholds are reviewable without spelunking call sites.
 *
 * Modes: "rules" runs today's built-in heuristics (offline, free, always
 * available); "api" calls the shared Decision API (lib/decision-api.mjs)
 * and falls back to rules on any failure or low confidence. Unknown modes
 * degrade to rules — a misconfigured point never refuses work.
 *
 * Additive by design: a new point is one registry entry plus its question
 * builder and resolver. No point ships executing until its judgments are
 * calibrated on real traffic (review_policy precedent).
 */
import { meetsDecisionThreshold } from "./decision-api.mjs";

export const DECISION_POINT_TRIAGE_INTENT = "triage-intent";
export const DECISION_POINT_ARTIFACT_CRITERIA = "artifact-criteria";
export const DECISION_POINT_AUTO_CONTINUE = "auto-continue";
export const DECISION_POINT_MODES = ["rules", "api"];

export const DECISION_POINTS = [
  {
    id: DECISION_POINT_TRIAGE_INTENT,
    label: "Triage intent",
    description: "Seed a build card's workflow intent (bugfix, feature, …) before triage. The worker always re-settles intent, so the seed is advisory.",
    rules: "Explicit intent wins, else unknown for the worker to settle — host code only, no model, no network.",
    modes: [...DECISION_POINT_MODES],
    defaultMode: "rules",
    defaultThresholds: { routeAt: 0.6 },
  },
  {
    id: DECISION_POINT_ARTIFACT_CRITERIA,
    label: "Artifact criteria",
    description: "Score an artifact against its skill's semantic criteria. Advisory only — lists met/unmet/unverifiable per criterion, never blocks.",
    rules: "Deterministic validators only (presence, counts, tables) — semantic criteria are listed as unverifiable without a judge.",
    modes: [...DECISION_POINT_MODES],
    defaultMode: "rules",
    defaultThresholds: { routeAt: 0.6 },
  },
  {
    id: DECISION_POINT_AUTO_CONTINUE,
    label: "Auto-continue",
    description: "Veto idle-worker auto-resumes the heuristic would allow when the last output shows no real progress. Never resumes on its own — saves worker turns, never spends them.",
    rules: "Fresh text or a turn advance with budget remaining resumes; otherwise the card pauses. Host code only, no model, no network.",
    modes: [...DECISION_POINT_MODES],
    defaultMode: "rules",
    defaultThresholds: { routeAt: 0.7 },
  },
];

export function isDecisionPoint(id) {
  return DECISION_POINTS.some((point) => point.id === id);
}

export function getDecisionPoint(id) {
  return DECISION_POINTS.find((point) => point.id === id) ?? null;
}

export function normalizePointMode(mode, fallback = "rules") {
  if (mode === "api" || mode === "rules") return mode;
  return fallback;
}

export function defaultThresholdsFor(id) {
  return { ...(getDecisionPoint(id)?.defaultThresholds ?? { routeAt: 0.6 }) };
}

// Thresholds arrive as free-form JSON from settings: numerics clamp into
// [0, 1], anything else falls back — a bad edit degrades, never throws.
export function normalizeThresholds(input, fallback) {
  const base = { ...(fallback ?? { routeAt: 0.6 }) };
  if (!input || typeof input !== "object") return base;
  for (const key of Object.keys(base)) {
    const candidate = input[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      base[key] = Math.min(1, Math.max(0, candidate));
    }
  }
  return base;
}

// The only question triage needs today: which workflow intent fits the
// request. One atomic question — parallel fan-out arrives with the next
// point that needs more than one signal.
export const TRIAGE_INTENT_CRITERIA = {
  bugfix: "Fixing broken behavior: a bug, defect, or regression",
  refactor: "Restructuring code without changing behavior: cleanup, debt, simplification",
  feature: "New capability or enhancement to an existing product",
  "new-product": "A new product or greenfield offering",
  investigate: "Unclear or exploratory work that needs discovery first",
};

export function triageIntentQuestions() {
  return {
    intent: {
      type: "choice",
      instructions: "Which workflow intent best fits this request?",
      criteria: { ...TRIAGE_INTENT_CRITERIA },
    },
  };
}

// Resolve the seed: a confident, in-schema Choice wins; everything else
// (failure, missing answer, out-of-schema choice, low confidence) leaves
// "unknown" for the worker's triage to settle.
export function resolveSeedIntent({ apiAnswers, routeAt }) {
  const fallback = { intent: "unknown", source: "rules", confidence: null };
  const answer = apiAnswers?.intent ?? null;
  if (!answer || answer.type !== "choice") return fallback;
  if (!Object.hasOwn(TRIAGE_INTENT_CRITERIA, answer.choice)) return fallback;
  if (!meetsDecisionThreshold(answer.confidence, routeAt)) return fallback;
  return { intent: answer.choice, source: "api", confidence: answer.confidence };
}

// Auto-continue needs exactly one judgment: did the finished turn move the
// workflow forward? Chatter, thinking aloud, repeated summaries, questions,
// and stop messages do not count — those are the turns that burn the
// per-stage budget without advancing.
export function autoContinueQuestions() {
  return {
    progress: {
      type: "noul",
      instructions: "Does this worker output show forward progress on its task — completed work, decisions made, or concrete next steps started? Chatter, thinking aloud, repeated summaries, questions, or stop messages do not count.",
    },
  };
}

// Veto-only resolution: a confident progress signal keeps the heuristic
// resume; everything else (refusal, missing/non-numeric answer, failure)
// stands the heuristic down is WRONG direction — it keeps it standing.
// The heuristic already decided to resume; only a confident "no progress"
// vetoes. Never invents a resume the heuristic refused (that path never
// reaches this resolver).
export function resolveAutoContinue({ apiNoul, routeAt }) {
  if (typeof apiNoul !== "number") return { proceed: true, source: "rules" };
  if (meetsDecisionThreshold(apiNoul, routeAt)) return { proceed: true, source: "api", confidence: apiNoul };
  return { proceed: false, source: "api", confidence: apiNoul };
}
