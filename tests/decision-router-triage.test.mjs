import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDecisionApiDisabled } from "../lib/decision-api.mjs";
import {
  TRIAGE_INTENT_CRITERIA,
  defaultThresholdsFor,
  getDecisionPoint,
  resolveSeedIntent,
  triageIntentQuestions,
} from "../lib/decision-points.mjs";
import { MAX_SPAWN_RETRIES, isRetryableSpawnError } from "../lib/spawn-retry.mjs";

// Triage-intent router: advisory seed only, never advances stage. A
// confident in-schema Choice wins; every other shape (bad type,
// out-of-schema choice, missing answer, low confidence) fails closed to
// "unknown" so worker triage settles it. The kill switch degrades reads
// before any call; start-phase 404s auto-retry bounded, then inbox.

const ROUTE_AT = defaultThresholdsFor("triage-intent").routeAt;
assert.equal(typeof ROUTE_AT, "number", "the triage seed carries a confidence floor");

// The question is one atomic Choice over the closed intent set — bounded
// state (card draft title+body only), never a stage advance.
const questions = triageIntentQuestions();
assert.deepEqual(Object.keys(questions), ["intent"], "triage asks exactly one question");
assert.equal(questions.intent.type, "choice", "the seed is a Choice judgment");
assert.deepEqual(questions.intent.criteria, { ...TRIAGE_INTENT_CRITERIA }, "choices enumerate the closed intent set");

// Confident in-schema Choice wins.
const won = resolveSeedIntent({
  apiAnswers: { intent: { type: "choice", choice: "bugfix", confidence: 0.9 } },
  routeAt: ROUTE_AT,
});
assert.deepEqual(won, { intent: "bugfix", source: "api", confidence: 0.9 }, "a confident in-schema Choice seeds");

// Bad shapes fail closed to unknown — never a throw, never a guess.
assert.deepEqual(
  resolveSeedIntent({ apiAnswers: { intent: { type: "score", score: 1.8, confidence: 0.9 } }, routeAt: ROUTE_AT }),
  { intent: "unknown", source: "rules", confidence: null },
  "a wrong answer type fails closed",
);
assert.deepEqual(
  resolveSeedIntent({ apiAnswers: { intent: { type: "choice", choice: "time-travel", confidence: 0.95 } }, routeAt: ROUTE_AT }),
  { intent: "unknown", source: "rules", confidence: null },
  "an out-of-schema choice fails closed",
);
assert.deepEqual(
  resolveSeedIntent({ apiAnswers: {}, routeAt: ROUTE_AT }),
  { intent: "unknown", source: "rules", confidence: null },
  "a missing answer fails closed",
);
assert.deepEqual(
  resolveSeedIntent({ apiAnswers: null, routeAt: ROUTE_AT }),
  { intent: "unknown", source: "rules", confidence: null },
  "a failed call (null answers) fails closed",
);

// Low confidence never acts — even on an in-schema choice.
assert.deepEqual(
  resolveSeedIntent({
    apiAnswers: { intent: { type: "choice", choice: "feature", confidence: 0.3 } },
    routeAt: ROUTE_AT,
  }),
  { intent: "unknown", source: "rules", confidence: null },
  "low confidence leaves unknown for worker triage",
);
assert.deepEqual(
  resolveSeedIntent({ apiAnswers: { intent: { type: "choice", choice: "feature", confidence: null } }, routeAt: ROUTE_AT }),
  { intent: "unknown", source: "rules", confidence: null },
  "a missing confidence never acts",
);

// Kill switch: operators block every outbound decision call host-wide.
assert.equal(isDecisionApiDisabled({ STELOW_DECISION_API: "0" }), true, "STELOW_DECISION_API=0 disables the API");
assert.equal(isDecisionApiDisabled({}), false, "an unset switch leaves the API enabled");
assert.equal(isDecisionApiDisabled(undefined), false, "a missing env leaves the API enabled");

// Seam wiring: the router gates mode before any call, requires a judge
// preset for preset mode, and consults the kill switch first — removing
// any of these gates fails here before a misconfigured point spends a
// call or blocks a spawn.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const seams = readFileSync(join(root, "server", "decision-api-seams.ts"), "utf8");
assert.match(seams, /if \(isDecisionApiDisabled\(process\.env\)\) return "unknown"/, "the kill switch short-circuits seeding before any config read");
assert.match(seams, /if \(mode !== "api" && mode !== "preset"\) return "unknown"/, "rules/unconfigured points seed unknown without calling out");
assert.match(seams, /if \(!presetId\) return "unknown"/, "preset mode without a configured judge seeds unknown (never an implicit preset)");
assert.match(seams, /resolveSeedIntent\(\{/, "seeding resolves through the lib cascade, never inline");
assert.ok(
  (seams.match(/return "unknown"/g) ?? []).length >= 6,
  "every failure path (kill switch, mode gate, missing key, call failure, bad shape, low confidence) lands on unknown",
);

// Start-phase fallback stays bounded: a 404/skill-tree race retries at
// most MAX_SPAWN_RETRIES times, then the card parks with one inbox event
// instead of retrying forever or spamming.
assert.equal(MAX_SPAWN_RETRIES, 3, "spawn retries are capped");
assert.equal(isRetryableSpawnError("skill tree not found (fetch race)"), true, "start-phase 404s retry");
assert.equal(isRetryableSpawnError(""), false, "empty causes never retry");

// The point stays advisory: registry metadata promises triage settles it.
const point = getDecisionPoint("triage-intent");
assert.ok(point?.description.includes("advisory") || point?.rules.includes("worker"), "the registry names the seed advisory");

console.log("decision router triage test ok: bad-shape fails closed, low-confidence never acts, kill-switch degrades");
