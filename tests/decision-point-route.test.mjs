import assert from "node:assert/strict";
import { normalizePointRoute, resolvePointRoute, modesForPoint, pointSupportsPresetJudge, DECISION_POINT_TRIAGE_INTENT, DECISION_POINT_AUTO_CONTINUE } from "../lib/decision-points.mjs";

// Per-point route overrides fall back to the shared endpoint field by field:
// a point can pin just a model (or just a key) without redeclaring the route.
assert.deepEqual(
  resolvePointRoute({ override: null, fallback: { provider: "jev", endpoint: "https://a", apiKey: "k", model: "m" } }),
  { provider: "jev", endpoint: "https://a", apiKey: "k", model: "m" },
  "a missing override resolves entirely from shared settings",
);
assert.deepEqual(
  resolvePointRoute({ override: { model: "fast" }, fallback: { provider: "jev", endpoint: "https://a", apiKey: "k", model: "m" } }),
  { provider: "jev", endpoint: "https://a", apiKey: "k", model: "fast" },
  "a partial override replaces only its own fields",
);
assert.deepEqual(
  resolvePointRoute({
    override: { provider: "labels", endpoint: "https://b", apiKey: "k2", model: "m2" },
    fallback: { provider: "jev", endpoint: "https://a", apiKey: "k", model: "m" },
  }),
  { provider: "labels", endpoint: "https://b", apiKey: "k2", model: "m2" },
  "a full override replaces the whole route",
);

// Blank strings and non-strings normalize to nulls — half-saved forms and
// corrupt rows degrade to shared settings instead of empty credentials,
// while valid fields survive untouched.
assert.deepEqual(
  normalizePointRoute({ provider: "  ", endpoint: null, apiKey: 42, model: "m" }),
  { provider: null, endpoint: null, apiKey: null, model: "m" },
  "blanks and non-strings drop, valid fields survive",
);
assert.deepEqual(
  normalizePointRoute({ provider: "jev", endpoint: "https://a", apiKey: "k", model: "  m  " }),
  { provider: "jev", endpoint: "https://a", apiKey: "k", model: "m" },
  "values trim, empties drop",
);
assert.deepEqual(normalizePointRoute("jev"), { provider: null, endpoint: null, apiKey: null, model: null }, "non-objects normalize empty");

// Preset judging is offered only where a spawned thread per judgment is
// affordable: triage seeds once per card, criteria runs on explicit calls.
// Hot paths never see the mode, so they can never burn turns on it.
assert.equal(pointSupportsPresetJudge(DECISION_POINT_TRIAGE_INTENT), true, "triage may judge via preset");
assert.equal(pointSupportsPresetJudge(DECISION_POINT_AUTO_CONTINUE), false, "auto-continue may not judge via preset");
assert.ok(modesForPoint(DECISION_POINT_TRIAGE_INTENT).includes("preset"), "triage advertises preset mode");
assert.ok(!modesForPoint(DECISION_POINT_AUTO_CONTINUE).includes("preset"), "auto-continue hides preset mode");

console.log("decision point route test ok: field-level fallback, normalization, preset gating");
