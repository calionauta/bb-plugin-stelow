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
  DECISION_PROVIDERS,
  CLASSIFIER_DEFAULT_ENDPOINT,
  normalizeDecisionProvider,
  providerRequiresKey,
  defaultEndpointFor,
  buildClassifierRequest,
  parseClassifierResponse,
  buildProbeCall,
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
  DECISION_POINT_AUTO_CONTINUE,
  autoContinueQuestions,
  resolveAutoContinue,
  DECISION_POINT_INBOX_SEVERITY,
  severityBumpQuestions,
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

// Providers: jev speaks state+questions (key required), classifier speaks
// labels (keyless). Unknown providers degrade to jev — never to an
// unintended wire shape.
assert.deepEqual(DECISION_PROVIDERS.map((entry) => entry.id), ["jev", "classifier", "simplejev", "openjev"], "four providers, jev first");
for (const entry of DECISION_PROVIDERS) {
  assert.ok(typeof entry.label === "string" && entry.label.length > 0, `${entry.id} names itself for the select`);
  assert.ok(["jev", "labels"].includes(entry.schema), `${entry.id} declares a known wire schema`);
  assert.ok(isDecisionApiEndpointValid(entry.defaultEndpoint), `${entry.id} ships a valid default endpoint`);
  assert.equal(typeof entry.needsKey, "boolean", `${entry.id} declares its key need`);
  assert.equal(typeof entry.takesModel, "boolean", `${entry.id} declares its model need`);
}
assert.equal(normalizeDecisionProvider("classifier"), "classifier", "classifier survives");
assert.equal(normalizeDecisionProvider("mystery"), "jev", "unknown providers degrade to jev");
assert.equal(providerRequiresKey("jev"), true, "jev requires a key");
assert.equal(providerRequiresKey("classifier"), false, "classifier is keyless");
assert.equal(defaultEndpointFor("classifier"), CLASSIFIER_DEFAULT_ENDPOINT, "classifier defaults to its own endpoint");
assert.equal(defaultEndpointFor("mystery").includes("typesafe"), true, "unknown providers default to the jev endpoint");

// Classifier request: one Choice maps to labels + composed instructions.
const triage = triageIntentQuestions();
const built = buildClassifierRequest({ state: "the checkout button does nothing", questions: triage });
assert.equal(built.ok, true, "triage Choice maps to a classifier call");
assert.deepEqual(built.body.labels, ["bugfix", "refactor", "feature", "new-product", "investigate"], "criteria keys become labels");
assert.ok(built.body.instructions.includes("bugfix:"), "criteria copy rides the instructions");
assert.equal(buildClassifierRequest({ state: "x", questions: {} }).ok, false, "zero questions refuse");
assert.equal(buildClassifierRequest({ state: "x", questions: { a: { type: "noul" }, b: { type: "noul" } } }).ok, false, "two questions refuse (one call, one decision)");
assert.equal(buildClassifierRequest({ state: "x", questions: { a: { type: "noul", instructions: "y?" } } }).ok, false, "Noul has no labels equivalent");
assert.equal(buildClassifierRequest({ state: "x", questions: { a: { type: "noul", instructions: "y?", criteria: { yes: "Y", no: "N" } } } }).ok, false, "even a criteria-carrying Noul refuses (labels decide between congeners, never yes/no)");

// Classifier response: results[0] normalizes to a Choice; out-of-schema
// labels null the answer instead of routing.
const parsed = parseClassifierResponse({ model: "jev-1.13.0", results: [{ label: "bugfix", confidence: 0.99, scores: { bugfix: 0.99 } }] }, "intent", TRIAGE_INTENT_CRITERIA);
assert.equal(parsed.ok, true, "classifier answers parse");
assert.deepEqual(parsed.answers.intent, { type: "choice", choice: "bugfix", probabilities: { bugfix: 0.99 }, confidence: 0.99 }, "scores become probabilities");
assert.deepEqual(parseClassifierResponse({ results: [{ label: "nope", confidence: 1 }] }, "intent", TRIAGE_INTENT_CRITERIA).answers.intent, null, "out-of-schema labels null");
assert.equal(parseClassifierResponse({ results: [] }, "intent", TRIAGE_INTENT_CRITERIA).ok, false, "empty results fail soft");
assert.equal(parseClassifierResponse({}, "intent", TRIAGE_INTENT_CRITERIA).ok, false, "answer-less bodies fail soft");

// Classifier end-to-end through the dispatcher, no key, no auth header.
let seenHeaders = null;
const classifierFetch = async (url, opts) => {
  seenHeaders = opts.headers;
  assert.ok(String(url).includes("classifier.dev"), "classifier calls hit the classifier endpoint");
  return { status: 200, json: async () => ({ model: "jev-1.13.0", results: [{ label: "feature", confidence: 0.8, scores: { feature: 0.8 } }] }) };
};
const routed = await evaluateDecisionCall({ provider: "classifier", endpoint: "", apiKey: "", model: "", state: "add dark mode", questions: triage, fetchImpl: classifierFetch });
assert.equal(routed.ok, true, "classifier resolves without a key");
assert.equal(routed.answers.intent.choice, "feature", "classifier answers normalize through the dispatcher");
assert.ok(!("Authorization" in (seenHeaders ?? {})), "keyless calls send no auth header");
assert.equal((await evaluateDecisionCall({ provider: "mystery", endpoint: "https://x.test/v1", apiKey: "", model: "m", state: "s", questions: {}, fetchImpl: classifierFetch })).error.includes("no key"), true, "unknown providers fall back to the keyed jev path");
// Keyless jev-schema providers send no auth header and still resolve.
let keylessHeaders = null;
const keylessFetch = async (url, opts) => {
  keylessHeaders = opts.headers;
  return { status: 200, json: async () => ({ answers: { intent: { type: "choice", choice: "feature", confidence: 0.8 } } }) };
};
const keyless = await evaluateDecisionCall({ provider: "simplejev", endpoint: "https://x.test/v1", apiKey: "", model: "m", state: "s", questions: triageIntentQuestions(), fetchImpl: keylessFetch });
assert.equal(keyless.ok, true, "keyless jev-schema providers resolve without a key");
assert.ok(!("Authorization" in (keylessHeaders ?? {})), "empty keys send no auth header");

// Probe builder speaks the provider's native shape.
assert.equal(buildProbeCall("classifier").questions.defect.type, "choice", "classifier probes use Choice");
assert.equal(buildProbeCall("jev").questions.defect.type, "noul", "jev probes use Noul");

// Auto-continue veto: one Noul on the finished turn; only a confident
// "no progress" vetoes, everything else keeps the heuristic standing.
// The veto spends nothing — it only saves worker turns.
assert.equal(DECISION_POINT_AUTO_CONTINUE, "auto-continue", "the point id is pinned");
const autoQuestions = autoContinueQuestions();
assert.equal(autoQuestions.progress.type, "noul", "auto-continue asks one Noul");
assert.ok(autoQuestions.progress.instructions.includes("Chatter"), "the question names what does not count");
assert.deepEqual(resolveAutoContinue({ apiNoul: 0.9, routeAt: 0.7 }), { proceed: true, source: "api", confidence: 0.9 }, "confident progress keeps the resume");
assert.deepEqual(resolveAutoContinue({ apiNoul: 0.7, routeAt: 0.7 }), { proceed: true, source: "api", confidence: 0.7 }, "floor is inclusive");
assert.deepEqual(resolveAutoContinue({ apiNoul: 0.2, routeAt: 0.7 }), { proceed: false, source: "api", confidence: 0.2 }, "confident chatter vetoes");
assert.deepEqual(resolveAutoContinue({ apiNoul: null, routeAt: 0.7 }), { proceed: true, source: "rules" }, "missing answers keep the heuristic standing");
assert.deepEqual(resolveAutoContinue({ apiNoul: "high", routeAt: 0.7 }), { proceed: true, source: "rules" }, "non-numeric answers keep the heuristic standing");

// Severity bump: one Noul per open routine item, asked against the summary.
assert.equal(DECISION_POINT_INBOX_SEVERITY, "inbox-severity", "the bump point id is pinned");
const bumpQuestions = severityBumpQuestions();
assert.equal(bumpQuestions.blocking.type, "noul", "the bump asks one yes/no");
assert.ok(bumpQuestions.blocking.instructions.includes("blocked"), "the question names blocking, not importance");

// Provider requirements ride the registry so the UI states them: triage
// Choice works on both providers; Score/Noul need the Jev schema.
assert.equal(getDecisionPoint(DECISION_POINT_TRIAGE_INTENT).requires ?? null, null, "triage runs on any provider");
assert.ok(getDecisionPoint(DECISION_POINT_TRIAGE_INTENT).rules.includes("band preset"), "triage rules name who judges (card worker, not the host)");
assert.ok(getDecisionPoint("artifact-criteria").requires.includes("Jev-compatible"), "criteria judging names its provider need");
assert.ok(getDecisionPoint(DECISION_POINT_AUTO_CONTINUE).requires.includes("Jev-compatible"), "the veto names its provider need");
assert.ok(getDecisionPoint(DECISION_POINT_INBOX_SEVERITY).requires.includes("Jev-compatible"), "the bump names its provider need");
assert.deepEqual(defaultThresholdsFor(DECISION_POINT_INBOX_SEVERITY), { routeAt: 0.6 }, "the bump defaults to a 0.6 floor");

console.log("decision api test ok: key resolution, validation, fail-soft calls, thresholds, triage seed");
