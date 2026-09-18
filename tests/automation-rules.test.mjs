import assert from "node:assert/strict";
import { matchAutomationIssues, ruleSourceKey } from "../lib/automation-rules.mjs";

const projectForRepo = new Map([
  ["acme/web", "proj_web"],
  ["acme/api", "proj_api"],
  ["acme/unmapped", null],
]);

const issues = [
  { repo: "acme/web", number: 1, labels: ["stelow-work", "bug"] },
  { repo: "acme/web", number: 2, labels: ["docs"] },
  { repo: "acme/api", number: 3, labels: ["stelow-work"] },
  { repo: "acme/unmapped", number: 4, labels: ["stelow-work"] },
];

const base = { label: "stelow-work", projectId: "proj_web", projectForRepo, firedKeys: [] };

// Happy path: exact label + owning project, key shaped repo#number.
assert.deepEqual(matchAutomationIssues(issues, base), [
  { repo: "acme/web", number: 1, key: "acme/web#1" },
], "matches by exact label inside the rule project only");
assert.equal(ruleSourceKey("acme/web", 1), "acme/web#1", "source key is repo#number");

// Already-fired issues never match twice: re-runs are idempotent.
assert.deepEqual(
  matchAutomationIssues(issues, { ...base, firedKeys: ["acme/web#1"] }),
  [],
  "fired source keys are skipped",
);

// Label matching is exact and case-sensitive: near-miss labels must not
// draft cards the user never asked to watch.
assert.deepEqual(
  matchAutomationIssues([{ repo: "acme/web", number: 9, labels: ["Stelow-Work"] }], base),
  [],
  "label case must match exactly",
);

// Defensive shapes: junk entries, missing labels, empty inputs.
assert.deepEqual(matchAutomationIssues([null, "x", 42, {}], base), [], "non-object entries are skipped");
assert.deepEqual(
  matchAutomationIssues([{ repo: "acme/web", number: 5 }], base),
  [],
  "entries without labels never match",
);
assert.deepEqual(matchAutomationIssues([], base), [], "empty issue list matches nothing");
assert.deepEqual(matchAutomationIssues(null, base), [], "null issue list matches nothing");
assert.deepEqual(matchAutomationIssues(issues, { ...base, label: "" }), [], "empty rule label matches nothing");
assert.deepEqual(matchAutomationIssues(issues, { ...base, label: "stelow-work", firedKeys: null }), [
  { repo: "acme/web", number: 1, key: "acme/web#1" },
], "null fired set means nothing fired yet");

// Plain-object repo maps work like Maps (callers choose).
assert.deepEqual(
  matchAutomationIssues(issues, { ...base, projectForRepo: { "acme/api": "proj_api" }, projectId: "proj_api" }),
  [{ repo: "acme/api", number: 3, key: "acme/api#3" }],
  "plain-object project maps work",
);

console.log("automation rules test ok: exact label, owning project, fire-once dedupe");
