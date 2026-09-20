import assert from "node:assert/strict";
import {
  DECISION_API_DEFAULT_ENDPOINT,
  DECISION_API_DEFAULT_MODEL,
  resolveDecisionApiKey,
  isDecisionApiEndpointValid,
  normalizeDecisionApiModel,
  buildDecisionRequest,
  normalizeDecisionAnswer,
  parseDecisionResponse,
  meetsDecisionThreshold,
  evaluateDecisionCall,
  isDecisionApiDisabled,
} from "../lib/decision-api.mjs";
import {
  DECISION_POINT_TRIAGE_INTENT,
  isDecisionPoint,
  getDecisionPoint,
  normalizePointMode,
  defaultThresholdsFor,
  normalizeThresholds,
  TRIAGE_INTENT_CRITERIA,
  triageIntentQuestions,
  resolveSeedIntent,
} from "../lib/decision-points.mjs";

// Decision API client + triage point: every failure degrades to built-in
// rules instead of throwing, and every threshold gates on confidence — the
// test that would catch a regression that acts on unconfident answers, leaks
// the key, or throws inside card creation.

// Key resolution: explicit settings win, then env aliases, then nothing.
assert.deepEqual(resolveDecisionApiKey({ storedKey: "k", env: { DECISION_API_KEY: "e" } }), { key: "k", source: "settings" }, "explicit settings beat env");
assert.deepEqual(resolveDecisionApiKey({ storedKey: "", env: { DECISION_API_KEY: "e" } }), { key: "e", source: "env" }, "empty settings fall through to env");
assert.deepEqual(resolveDecisionApiKey({ storedKey: null, env: { TYPESAFE_API_KEY: "t" } }), { key: "t", source: "env" }, "the vendor env alias works");
assert.deepEqual(resolveDecisionApiKey({ storedKey: null, env: {} }), { key: null, source: null }, "no key resolves to nothing, never to a throw");

// Kill switch: STELOW_DECISION_API=0 blocks every outbound call.
assert.equal(isDecisionApiDisabled({ STELOW_DECISION_API: "0" }), true, "explicit 0 disables");
assert.equal(isDecisionApiDisabled({}), false, "absent flag leaves the API on");
assert.equal(isDecisionApiDisabled(null), false, "missing env leaves the API on");

// Endpoint validation refuses non-URL and non-http(s) values at the boundary.
assert.equal(isDecisionApiEndpointValid(DECISION_API_DEFAULT_ENDPOINT), true, "the default endpoint validates");
assert.equal(isDecisionApiEndpointValid("not a url"), false, "gibberish refuses");
assert.equal(isDecisionApiEndpointValid("ftp://host/v1"), false, "non-http(s) refuses");
assert.equal(isDecisionApiEndpointValid(""), false, "empty refuses");

// Model naming always resolves — callers never send an empty model.
assert.equal(normalizeDecisionApiModel("  ", "fb"), "fb", "blank model falls back");
assert.equal(normalizeDecisionApiModel("jev-1.13.0", "fb"), "jev-1.13.0", "explicit versions survive (pinning beats aliases)");

// Request shaping caps state (cost + context budget) and names the model.
const big = buildDecisionRequest({ state: "x".repeat(20000), questions: { a: 1 }, model: null });
assert.ok(big.state.length <= 8000, "state is capped before it leaves the host");
assert.equal(big.model, DECISION_API_DEFAULT_MODEL, "missing model resolves to the default");
assert.deepEqual(Object.keys(big.questions), ["a"], "questions ride unchanged");

// Answer normalization keeps known shapes, nulls the rest per question.
assert.deepEqual(
  normalizeDecisionAnswer({ type: "choice", choice: "bugfix", probabilities: { bugfix: 0.9 }, confidence: 0.8 }),
  { type: "choice", choice: "bugfix", probabilities: { bugfix: 0.9 }, confidence: 0.8 },
  "choices keep probabilities and confidence",
);
assert.equal(normalizeDecisionAnswer({ type: "choice" }), null, "a choice without a pick nulls (no decision to route)");
assert.equal(normalizeDecisionAnswer({ type: "choice", choice: 7 }), null, "a non-string pick nulls");
assert.equal(normalizeDecisionAnswer("bugfix"), null, "prose never parses as an answer");
assert.equal(parseDecisionResponse({ answers: null }).ok, false, "answers-less bodies fail soft");
assert.equal(parseDecisionResponse(null).ok, false, "empty bodies fail soft");

// Threshold gating: missing confidence never acts.
assert.equal(meetsDecisionThreshold(0.8, 0.6), true, "confident answers act");
assert.equal(meetsDecisionThreshold(0.5, 0.6), false, "unconfident answers escalate");
assert.equal(meetsDecisionThreshold(null, 0.6), false, "missing confidence never acts");
assert.equal(meetsDecisionThreshold(0.9, null), false, "missing threshold never acts");

// Evaluated calls return result objects on every path — never a throw.
const okFetch = async () => ({ status: 200, json: async () => ({ model: "jev-1.13.0", answers: { intent: { type: "choice", choice: "bugfix", confidence: 0.9 } } }) });
const ok = await evaluateDecisionCall({ endpoint: "https://x.test/v1", apiKey: "k", model: "m", state: "s", questions: {}, fetchImpl: okFetch });
assert.equal(ok.ok, true, "a good call resolves answers");
assert.equal(ok.answers.intent.choice, "bugfix", "answers normalize through the call");
assert.equal(typeof ok.latencyMs, "number", "calls report latency");
const badFetch = async () => ({ status: 401, json: async () => ({}) });
assert.equal((await evaluateDecisionCall({ endpoint: "https://x.test/v1", apiKey: "bad", model: "m", state: "s", questions: {}, fetchImpl: badFetch })).ok, false, "non-2xx fails soft");
const boomFetch = async () => { throw new Error("down"); };
assert.equal((await evaluateDecisionCall({ endpoint: "https://x.test/v1", apiKey: "k", model: "m", state: "s", questions: {}, fetchImpl: boomFetch })).ok, false, "network errors fail soft");
assert.equal((await evaluateDecisionCall({ endpoint: "https://x.test/v1", apiKey: "", model: "m", state: "s", questions: {}, fetchImpl: okFetch })).error.includes("no key"), true, "missing key refuses before any network");
assert.equal((await evaluateDecisionCall({ endpoint: "x", apiKey: "k", model: "m", state: "s", questions: {}, fetchImpl: okFetch })).error.includes("http(s)"), true, "bad endpoint refuses before any network");
assert.equal((await evaluateDecisionCall({ endpoint: "https://x.test/v1", apiKey: "k", model: "m", state: "s", questions: {}, fetchImpl: null })).ok, false, "missing fetch fails soft");
const slowFetch = (ms) => (url, opts) => new Promise((resolve, reject) => {
  const onAbort = () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); };
  opts?.signal?.addEventListener("abort", onAbort);
  setTimeout(() => resolve({ status: 200, json: async () => ({ answers: {} }) }), ms);
});
const timed = await evaluateDecisionCall({ endpoint: "https://x.test/v1", apiKey: "k", model: "m", state: "s", questions: {}, timeoutMs: 50, fetchImpl: slowFetch(5000) });
assert.equal(timed.ok, false, "slow providers time out instead of hanging creation");
assert.ok(timed.error.includes("timed out"), "timeouts name themselves");

// Registry: one entry per point, unknown ids/modes degrade to rules.
assert.equal(isDecisionPoint(DECISION_POINT_TRIAGE_INTENT), true, "triage-intent is registered");
assert.equal(isDecisionPoint("nope"), false, "unknown points are not registered");
assert.equal(getDecisionPoint("nope"), null, "unknown points resolve to null");
assert.equal(normalizePointMode("api"), "api", "api survives");
assert.equal(normalizePointMode("mystery"), "rules", "unknown modes degrade to rules");
assert.deepEqual(defaultThresholdsFor(DECISION_POINT_TRIAGE_INTENT), { routeAt: 0.6 }, "triage defaults to a 0.6 floor");
assert.deepEqual(normalizeThresholds({ routeAt: 0.9 }, { routeAt: 0.6 }), { routeAt: 0.9 }, "stored thresholds apply");
assert.deepEqual(normalizeThresholds({ routeAt: 9 }, { routeAt: 0.6 }), { routeAt: 1 }, "out-of-range thresholds clamp");
assert.deepEqual(normalizeThresholds("junk", { routeAt: 0.6 }), { routeAt: 0.6 }, "junk thresholds fall back");

// Triage questions carry exactly the workflow's seedable intents.
const questions = triageIntentQuestions();
assert.equal(questions.intent.type, "choice", "triage asks one Choice");
assert.deepEqual(Object.keys(questions.intent.criteria).sort(), ["bugfix", "feature", "investigate", "new-product", "refactor"], "criteria match the seedable intents");
assert.ok(Object.keys(TRIAGE_INTENT_CRITERIA).every((key) => typeof TRIAGE_INTENT_CRITERIA[key] === "string" && TRIAGE_INTENT_CRITERIA[key].length > 0), "every option carries reviewable criteria copy");

// Seed resolution: confident in-schema Choices win; everything else stays
// "unknown" for the worker's triage — the seed is advisory, never final.
assert.deepEqual(
  resolveSeedIntent({ apiAnswers: { intent: { type: "choice", choice: "bugfix", confidence: 0.9 } }, routeAt: 0.6 }),
  { intent: "bugfix", source: "api", confidence: 0.9 },
  "confident in-schema answers seed",
);
assert.deepEqual(resolveSeedIntent({ apiAnswers: null, routeAt: 0.6 }), { intent: "unknown", source: "rules", confidence: null }, "failures seed unknown");
assert.deepEqual(
  resolveSeedIntent({ apiAnswers: { intent: { type: "choice", choice: "bugfix", confidence: 0.4 } }, routeAt: 0.6 }),
  { intent: "unknown", source: "rules", confidence: null },
  "low confidence seeds unknown",
);
assert.deepEqual(
  resolveSeedIntent({ apiAnswers: { intent: { type: "choice", choice: "explore", confidence: 0.99 } }, routeAt: 0.6 }),
  { intent: "unknown", source: "rules", confidence: null },
  "out-of-schema choices never seed (explore is not a build intent)",
);
assert.deepEqual(
  resolveSeedIntent({ apiAnswers: { intent: { type: "noul", noul: 1 } }, routeAt: 0.6 }),
  { intent: "unknown", source: "rules", confidence: null },
  "wrong answer types never seed",
);

console.log("decision api test ok: key resolution, validation, fail-soft calls, thresholds, triage seed");
