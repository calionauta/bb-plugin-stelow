import assert from "node:assert/strict";
import { resolveScoredVerdicts } from "../lib/score-verdicts.mjs";

// One resolution rule for every advisory Score judgment (tasks, gap
// triage): a Jev answer keyed `${keyPrefix}:${id}`, or a preset verdict
// keyed by bare id. Unknown entries, wrong shapes, and below-floor
// confidence all degrade to unverifiable — the caller reports, never blocks.
const items = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }];

const scored = resolveScoredVerdicts({
  items,
  keyPrefix: "task",
  routeAt: 0.6,
  answers: { "task:a": { type: "score", score: 2, confidence: 0.9 }, "task:b": { type: "score", score: 0, confidence: 0.8 } },
});
assert.deepEqual(scored.map((f) => [f.id, f.name, f.verdict]), [["a", "Alpha", "met"], ["b", "Beta", "unmet"]], "scores resolve through the shared anchors");

assert.deepEqual(
  resolveScoredVerdicts({ items, keyPrefix: "task", routeAt: 0.6, answers: { "task:a": { type: "score", score: 2, confidence: 0.3 } } }).map((f) => f.verdict),
  ["unverifiable", "unverifiable"],
  "below-floor confidence and missing answers degrade, never guess",
);
assert.deepEqual(
  resolveScoredVerdicts({ items, keyPrefix: "task", routeAt: 0.6, answers: { "task:a": { type: "choice", value: "x" } } }).map((f) => f.verdict),
  ["unverifiable", "unverifiable"],
  "non-score answers degrade",
);
assert.equal(resolveScoredVerdicts({ items, keyPrefix: "task", routeAt: 0.6, answers: { "task:a": { type: "score", score: 1, confidence: 0.9 } } })[0].verdict, "unverifiable", "a middling score is not a verdict");

// Preset path: verdicts keyed by bare id, same floor; unknown status and
// unknown id degrade.
assert.deepEqual(
  resolveScoredVerdicts({ items, keyPrefix: "gap", routeAt: 0.6, verdicts: { a: { status: "met", confidence: 0.9 }, b: { status: "maybe", confidence: 0.9 } } }).map((f) => f.verdict),
  ["met", "unverifiable"],
  "preset verdicts map onto the same shape; unknown statuses degrade",
);
assert.deepEqual(
  resolveScoredVerdicts({ items, keyPrefix: "gap", routeAt: 0.6, verdicts: { a: { status: "met", confidence: 0.2 } } }).map((f) => f.verdict),
  ["unverifiable", "unverifiable"],
  "preset below-floor confidence degrades too",
);

// The prefix is honored: a `gap:` key never satisfies a `task:` lookup.
assert.equal(
  resolveScoredVerdicts({ items, keyPrefix: "task", routeAt: 0.6, answers: { "gap:a": { type: "score", score: 2, confidence: 0.9 } } })[0].verdict,
  "unverifiable",
  "answer keys are prefix-scoped",
);

assert.deepEqual(resolveScoredVerdicts({ items: null, keyPrefix: "task" }), [], "junk items resolve empty");
assert.deepEqual(resolveScoredVerdicts({ items: [{ name: "No id" }, null], keyPrefix: "task" }), [], "id-less items are dropped");

// Fidelity: extracting this resolver from task-evidence must not change
// what a caller-supplied name means — an empty string is a name the caller
// chose, not a missing one, so only a non-string falls back to the id.
assert.equal(resolveScoredVerdicts({ items: [{ id: "t9", name: "" }], keyPrefix: "task" })[0].name, "", "an empty name survives as given");
assert.equal(resolveScoredVerdicts({ items: [{ id: "t9" }], keyPrefix: "task" })[0].name, "t9", "a missing name falls back to the id");

console.log("score verdicts test ok: shared anchors, prefix scoping, honest degradation");
