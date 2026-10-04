import assert from "node:assert/strict";
import {
  DECISION_POINT_PRESET_TIER,
  DECISION_POINT_RETRY_TRANSIENT,
  PRESET_TIER_CRITERIA,
  getDecisionPoint,
  isDecisionPoint,
  modesForPoint,
  presetTierQuestions,
  resolvePresetTier,
  resolveRetryTransient,
  retryTransientQuestions,
} from "../lib/decision-points.mjs";

for (const id of [DECISION_POINT_RETRY_TRANSIENT, DECISION_POINT_PRESET_TIER]) {
  assert.equal(isDecisionPoint(id), true, `${id} is registered`);
  assert.ok(getDecisionPoint(id), `${id} resolves in the registry`);
  // Boot and hot paths never burn a full preset turn on a judgment.
  assert.deepEqual(modesForPoint(id), ["rules", "api"], `${id} refuses preset mode`);
}

// Retry-transient: one Noul, fail-fast everywhere except confident transient.
const retryQuestion = retryTransientQuestions();
assert.equal(retryQuestion.transient.type, "noul", "retry asks one yes/no question");
assert.match(retryQuestion.transient.instructions, /transient/i, "the question names transience");
assert.deepEqual(
  resolveRetryTransient({ apiNoul: 0.9, routeAt: 0.7 }),
  { retry: true, source: "api", confidence: 0.9 },
  "confident transient spends budget",
);
assert.deepEqual(
  resolveRetryTransient({ apiNoul: 0.5, routeAt: 0.7 }).retry,
  false,
  "low confidence keeps fail-fast",
);
assert.deepEqual(
  resolveRetryTransient({ apiNoul: null, routeAt: 0.7 }),
  { retry: false, source: "rules" },
  "missing answer degrades to rules",
);
assert.equal(
  resolveRetryTransient({ apiNoul: "0.9", routeAt: 0.7 }).retry,
  false,
  "non-numeric answers never retry",
);

// Preset-tier: Choice over the stage model_hint scale, shadow-only.
assert.deepEqual(Object.keys(PRESET_TIER_CRITERIA).sort(), ["best", "economy", "standard"], "tier names the hint scale");
const tierQuestion = presetTierQuestions();
assert.equal(tierQuestion.tier.type, "choice", "tier is a Choice judgment");
assert.deepEqual(
  resolvePresetTier({ apiAnswers: { tier: { type: "choice", choice: "best", confidence: 0.9 } }, routeAt: 0.7 }),
  { tier: "best", source: "api", confidence: 0.9 },
  "confident in-schema choice records a suggestion",
);
assert.deepEqual(
  resolvePresetTier({ apiAnswers: { tier: { type: "choice", choice: "ultra", confidence: 0.9 } }, routeAt: 0.7 }),
  { tier: null, source: "rules", confidence: null },
  "out-of-schema choices record nothing",
);
assert.deepEqual(
  resolvePresetTier({ apiAnswers: { tier: { type: "choice", choice: "best", confidence: 0.4 } }, routeAt: 0.7 }).tier,
  null,
  "low confidence records nothing",
);
assert.deepEqual(
  resolvePresetTier({ apiAnswers: null, routeAt: 0.7 }),
  { tier: null, source: "rules", confidence: null },
  "missing answers record nothing",
);
assert.equal(
  getDecisionPoint(DECISION_POINT_PRESET_TIER).defaultMode,
  "rules",
  "tier ships inert until an operator opts into api mode",
);
assert.equal(
  getDecisionPoint(DECISION_POINT_RETRY_TRANSIENT).defaultThresholds.routeAt,
  0.7,
  "retry spends budget only at high confidence",
);

console.log("decision new points test ok: retry-transient and preset-tier registry, builders, resolvers");
