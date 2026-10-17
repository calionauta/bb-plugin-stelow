import assert from "node:assert/strict";
import {
  DECISION_POINTS,
  DECISION_POINT_AUTO_CONTINUE,
  DECISION_POINT_TRIAGE_INTENT,
  getDecisionPoint,
  isDecisionPoint,
  modesForPoint,
  normalizePointMode,
  pointSupportsPresetJudge,
} from "../lib/decision-points.mjs";
import {
  isDecisionApiDisabled,
  isDecisionApiEndpointValid,
  normalizeDecisionProvider,
  resolveDecisionApiKey,
} from "../lib/decision-api.mjs";
import { normalizeReviewGates } from "../lib/review-gates.mjs";

// Decision routers wiring: one settings block (endpoint + key + model),
// per-point modes, and a single execution seam at card creation. Behavioral
// coverage goes through the lib cascades the handlers delegate to.

// Point registry: every registered id resolves, unknown ids do not.
assert.ok(DECISION_POINTS.length > 0, "the registry is not empty");
for (const point of DECISION_POINTS) {
  assert.equal(isDecisionPoint(point.id), true, `${point.id} is a known decision point`);
  assert.equal(getDecisionPoint(point.id)?.id, point.id, `${point.id} resolves to its entry`);
}
assert.equal(isDecisionPoint("no-such-point"), false, "unknown points fail at the registry boundary");
assert.equal(getDecisionPoint("no-such-point"), null, "unknown points resolve to null, never a default entry");

// Mode gate: stored modes are closed to rules/api/preset; unknown modes
// degrade to the caller fallback (reads degrade to rules by default).
assert.equal(normalizePointMode("rules"), "rules", "rules survives");
assert.equal(normalizePointMode("api"), "api", "api survives");
assert.equal(normalizePointMode("preset"), "preset", "preset survives");
assert.equal(normalizePointMode("bogus"), "rules", "unknown modes degrade to rules by default");
assert.equal(normalizePointMode(undefined), "rules", "unconfigured points degrade to rules");
assert.equal(normalizePointMode("bogus", "api"), "api", "explicit fallbacks are honored");

// Preset judge support: hot paths never support preset mode, triage and
// criteria do. A point that cannot judge via preset offers rules/api only.
assert.equal(pointSupportsPresetJudge(DECISION_POINT_TRIAGE_INTENT), true, "triage intent judges via preset");
assert.equal(pointSupportsPresetJudge(DECISION_POINT_AUTO_CONTINUE), false, "auto-continue never burns a turn on preset");
assert.deepEqual(
  modesForPoint(DECISION_POINT_AUTO_CONTINUE).sort(),
  ["api", "rules"],
  "hot paths offer rules/api only",
);
assert.ok(
  modesForPoint(DECISION_POINT_TRIAGE_INTENT).includes("preset"),
  "judge points offer preset mode",
);

// Key cascade: stored key wins with a settings source, env is the fallback,
// absence resolves to null (reads report presence, never the raw key).
assert.deepEqual(
  resolveDecisionApiKey({ storedKey: "sk-live", env: {} }),
  { key: "sk-live", source: "settings" },
  "a stored key resolves with the settings source",
);
assert.equal(
  resolveDecisionApiKey({ storedKey: "", env: { DECISION_API_KEY: "env-key" } }).key,
  "env-key",
  "an empty stored key falls through to the environment",
);
assert.deepEqual(
  resolveDecisionApiKey({ storedKey: null, env: {} }),
  { key: null, source: null },
  "no key anywhere resolves to null, never to a throw",
);

// Kill switch (STELOW_DECISION_API=0): reads degrade, writes and probes
// refuse before any spend — operators block outbound calls host-wide.
assert.equal(isDecisionApiDisabled({ STELOW_DECISION_API: "0" }), true, "the kill switch disables the API");
assert.equal(isDecisionApiDisabled({}), false, "absence leaves the API enabled");
assert.equal(isDecisionApiDisabled(undefined), false, "missing env leaves the API enabled");

// Endpoint validity: bad endpoints refuse with the fix named at save time.
assert.equal(isDecisionApiEndpointValid("https://api.example.com/v1"), true, "https endpoints validate");
assert.equal(isDecisionApiEndpointValid("http://localhost:8080"), true, "http endpoints validate");
assert.equal(isDecisionApiEndpointValid("not-a-url"), false, "bare words refuse");
assert.equal(isDecisionApiEndpointValid(""), false, "empty endpoints refuse");
assert.equal(isDecisionApiEndpointValid(null), false, "missing endpoints refuse");

// Provider normalization: unknown providers degrade to the default instead
// of throwing, so a stale setting never breaks the seam.
assert.equal(normalizeDecisionProvider("bogus-provider", "jev"), "jev", "unknown providers fall back");
assert.equal(typeof normalizeDecisionProvider(undefined), "string", "missing providers resolve to a default");

// Review gates travel with the auto-continue veto surface: the shared
// normalizer keeps the gate contract closed.
assert.deepEqual(normalizeReviewGates(["spec", "bogus"]), ["spec"], "unknown gates are dropped, known ones survive");

console.log("decision routers test ok: registry, mode gate, key cascade, kill switch, provider fallback");
