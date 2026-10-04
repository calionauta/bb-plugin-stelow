/**
 * Decision-router registry. Each point names one fuzzy judgment the host
 * makes, its modes, and its thresholds — all constants in one place so
 * questions and thresholds are reviewable without spelunking call sites.
 *
 * Modes: "rules" runs today's built-in heuristics (no extra calls, always
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
export const DECISION_POINT_INBOX_SEVERITY = "inbox-severity";
export const DECISION_POINT_RETRY_TRANSIENT = "retry-transient";
export const DECISION_POINT_PRESET_TIER = "preset-tier";
export const DECISION_POINT_MODES = ["rules", "api", "preset"];

// Only low-frequency points may judge via a spawned preset thread: a preset
// judgment burns a full provider turn, so hot paths (auto-continue checks,
// per-item severity bumps) stay on rules/api. Triage seeds once per card;
// artifact criteria runs on explicit CLI calls.
export const PRESET_JUDGE_POINTS = [DECISION_POINT_TRIAGE_INTENT, DECISION_POINT_ARTIFACT_CRITERIA];

export function pointSupportsPresetJudge(id) {
  return PRESET_JUDGE_POINTS.includes(id);
}

export function modesForPoint(id) {
  if (pointSupportsPresetJudge(id)) return [...DECISION_POINT_MODES];
  return DECISION_POINT_MODES.filter((mode) => mode !== "preset");
}

// The question shapes each point actually asks, as the builders produce
// them. Single source for fit checks: save-time refusal, UI hints, and
// the consistency test that fails when a builder drifts from its entry.
const POINT_QUESTION_KINDS = {
  [DECISION_POINT_TRIAGE_INTENT]: ["choice"],
  [DECISION_POINT_PRESET_TIER]: ["choice"],
  [DECISION_POINT_AUTO_CONTINUE]: ["noul"],
  [DECISION_POINT_INBOX_SEVERITY]: ["noul"],
  [DECISION_POINT_RETRY_TRANSIENT]: ["noul"],
  [DECISION_POINT_ARTIFACT_CRITERIA]: ["score", "noul"],
};

export function questionKindsForPoint(id) {
  return [...(POINT_QUESTION_KINDS[id] ?? [])];
}

/** "any" serves labels-schema providers; anything else needs Jev-schema. Unknown points fail closed to full-schema. */
export function needsSchemaForPoint(id) {
  const kinds = POINT_QUESTION_KINDS[id];
  if (!kinds) return "jev";
  return kinds.every((kind) => kind === "choice") ? "any" : "jev";
}

/** Labels of the points a wire schema can serve; jev-schema serves all. */
export function pointsServedBySchema(schema) {
  return DECISION_POINTS
    .filter((point) => schema !== "labels" || needsSchemaForPoint(point.id) === "any")
    .map((point) => point.label);
}

// Per-point route override. Null/empty fields fall back to the shared
// endpoint row, so a point can pin just a model (or just a key) without
// redeclaring the whole route. Unknown providers pass through untouched —
// the call-site normalizer decides the fallback, never the stored value.
export function normalizePointRoute(input) {
  const out = { provider: null, endpoint: null, apiKey: null, model: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const key of Object.keys(out)) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) out[key] = value.trim();
  }
  return out;
}

export function resolvePointRoute({ override, fallback }) {
  const clean = normalizePointRoute(override);
  const base = normalizePointRoute(fallback);
  return {
    provider: clean.provider ?? base.provider,
    endpoint: clean.endpoint ?? base.endpoint,
    apiKey: clean.apiKey ?? base.apiKey,
    model: clean.model ?? base.model,
  };
}

export const DECISION_POINTS = [
  {
    id: DECISION_POINT_ARTIFACT_CRITERIA,
    label: "Artifact criteria",
    description: "Score an artifact against its skill's semantic criteria. Advisory only — lists met/unmet/unverifiable per criterion, never blocks.",
    rules: "Deterministic validators only (presence, counts, tables) — semantic criteria are listed as unverifiable without a judge.",
    requires: "Jev-compatible provider (Score questions) — labels providers answer Choice only.",
    thresholdLabel: "Accept a criterion at confidence ≥",
    modes: modesForPoint(DECISION_POINT_ARTIFACT_CRITERIA),
    defaultMode: "rules",
    defaultThresholds: { routeAt: 0.6 },
  },
  {
    id: DECISION_POINT_AUTO_CONTINUE,
    label: "Auto-continue",
    description: "Veto idle-worker auto-resumes the heuristic would allow when the last output shows no real progress. Never resumes on its own — saves worker turns, never spends them.",
    rules: "Fresh text or a turn advance with budget remaining resumes; otherwise the card pauses. Host code only, no model, no network.",
    requires: "Jev-compatible provider (yes/no questions) — labels providers keep the heuristic standing.",
    // The one inverted point. This threshold is a floor on confidence that the
    // turn DID make progress, so raising it makes the veto fire more often and
    // the worker spend fewer turns. Labelling it "Act at confidence" here
    // would tell an operator the exact opposite of what the knob does.
    thresholdLabel: "Resume only at confidence ≥ (higher = fewer resumes)",
    modes: modesForPoint(DECISION_POINT_AUTO_CONTINUE),
    defaultMode: "rules",
    defaultThresholds: { routeAt: 0.7 },
  },
  {
    id: DECISION_POINT_INBOX_SEVERITY,
    label: "Inbox severity",
    description: "Promote open routine items the judge finds blocking, with a model-judged chip. Never demotes, never resolves, never re-judges a checked item.",
    rules: "Deterministic tiers only (kind, age, repetitions) — items stay where the scorer put them.",
    requires: "Jev-compatible provider (yes/no questions) — labels providers keep deterministic tiers.",
    thresholdLabel: "Promote at confidence ≥",
    modes: modesForPoint(DECISION_POINT_INBOX_SEVERITY),
    defaultMode: "rules",
    defaultThresholds: { routeAt: 0.6 },
  },
  {
    id: DECISION_POINT_PRESET_TIER,
    label: "Preset tier",
    description: "Shadow-only review of the stage model hint against card context. "
      + "Records agreement, never overrides a preset — promotion to action waits on per-call-model support.",
    rules: "The band preset stands; the tier question is never asked.",
    requires: "Any provider (Choice questions) — labels providers answer Choice natively.",
    thresholdLabel: "Record agreement at confidence ≥",
    modes: modesForPoint(DECISION_POINT_PRESET_TIER),
    defaultMode: "rules",
    defaultThresholds: { routeAt: 0.7 },
  },
  {
    id: DECISION_POINT_RETRY_TRANSIENT,
    label: "Retry transient",
    description: "Rescue unclassified spawn failures a confident judge calls transient. "
      + "Bounded by the same spawn-retry budget; misses keep fail-fast.",
    rules: "Classified transient errors retry, everything else fails fast — the judge is never consulted.",
    requires: "Jev-compatible provider (yes/no questions) — labels providers keep fail-fast standing.",
    thresholdLabel: "Treat as transient at confidence ≥",
    modes: modesForPoint(DECISION_POINT_RETRY_TRANSIENT),
    defaultMode: "rules",
    defaultThresholds: { routeAt: 0.7 },
  },
  {
    id: DECISION_POINT_TRIAGE_INTENT,
    label: "Triage intent",
    description: "Seed a build card's workflow intent (bugfix, feature, …) before triage. The worker always re-settles intent, so the seed is advisory.",
    rules: "Explicit intent wins, else unknown — decided by the card worker in triage on its effective preset (card pin, reliable override, or analysis band). The host adds no calls of its own.",
    thresholdLabel: "Accept the seeded intent at confidence ≥",
    modes: modesForPoint(DECISION_POINT_TRIAGE_INTENT),
    defaultMode: "rules",
    defaultThresholds: { routeAt: 0.6 },
  },
];

export function isDecisionPoint(id) {
  return DECISION_POINTS.some((point) => point.id === id);
}

export function getDecisionPoint(id) {
  return DECISION_POINTS.find((point) => point.id === id) ?? null;
}

export function normalizePointMode(mode, fallback = "rules") {
  if (mode === "api" || mode === "rules" || mode === "preset") return mode;
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

// Inbox severity bump: one yes/no per open routine item — does this block
// the worker from progressing? Asked against the event summary (the only
// text guaranteed present); the card detail carries the rest for the human.
export function severityBumpQuestions() {
  return {
    blocking: {
      type: "noul",
      instructions: "Does this inbox item describe a worker blocked from progressing (failed, stuck, or waiting on the human) rather than routine information?",
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

// Retry-transient needs exactly one judgment: is this unclassified spawn
// failure transient infrastructure (rate limit, timeout, infra flake)
// rather than fatal (auth, config, refusal, code)? The string matcher
// already settled the classified cases; this question never sees them.
export function retryTransientQuestions() {
  return {
    transient: {
      type: "noul",
      instructions: "Is this worker start failure transient infrastructure that a retry could outlast — "
        + "rate limiting, timeouts, temporary unavailability, network flakes — "
        + "rather than a fatal cause like authentication, configuration, refusal, or a code defect?",
    },
  };
}

// Fail-fast resolution: only a confident transient spends retry budget;
// everything else (refusal, missing/non-numeric answer, failure) keeps the
// fail-fast the rules chose. Never invents a retry the rules refused for a
// classified error (that path never reaches this resolver).
export function resolveRetryTransient({ apiNoul, routeAt }) {
  const fallback = { retry: false, source: "rules" };
  if (typeof apiNoul !== "number") return fallback;
  if (!meetsDecisionThreshold(apiNoul, routeAt)) return { retry: false, source: "api", confidence: apiNoul };
  return { retry: true, source: "api", confidence: apiNoul };
}

// Preset-tier vocabulary mirrors the stage model_hint scale, so a future
// per-call-model mapping has stable names to target. Economy/standard/best
// describe the WORKLOAD, never a preset id — the router owns presets.
export const PRESET_TIER_CRITERIA = {
  economy: "Mechanical, well-specified work: single-file edits, clear acceptance, no design choices",
  standard: "Ordinary multi-file feature work with tests: some judgment, bounded blast radius",
  best: "Ambiguous architecture or novel design: high blast radius, decisions that are expensive to reverse",
};

export function presetTierQuestions() {
  return {
    tier: {
      type: "choice",
      instructions: "Which model tier fits this card's next stage work?",
      criteria: { ...PRESET_TIER_CRITERIA },
    },
  };
}

// Shadow resolution: a confident, in-schema Choice records a suggestion;
// everything else records nothing. Suggestions never override a preset —
// promotion to action waits on per-call-model support plus a preset mapping.
export function resolvePresetTier({ apiAnswers, routeAt }) {
  const fallback = { tier: null, source: "rules", confidence: null };
  const answer = apiAnswers?.tier ?? null;
  if (!answer || answer.type !== "choice") return fallback;
  if (!Object.hasOwn(PRESET_TIER_CRITERIA, answer.choice)) return fallback;
  if (!meetsDecisionThreshold(answer.confidence, routeAt)) return fallback;
  return { tier: answer.choice, source: "api", confidence: answer.confidence };
}
