import assert from "node:assert/strict";
import { decideAutomationIssue, matchAutomationIssues, previewAutomationMatches, ruleSourceKey } from "../lib/automation-rules.mjs";
import { applyRulePrompt, findRelatedIssues, githubIntentFor, normalizeGithubAuthors, normalizeGithubLabels } from "../lib/github-intent.mjs";
import { decideAutomationSpawn, describeParkedReason } from "../lib/github-automation-gate.mjs";

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

const base = { labels: ["stelow-work"], projectId: "proj_web", projectForRepo, firedKeys: [] };

// Happy path: exact labels (AND) + owning project, key shaped repo#number.
assert.deepEqual(matchAutomationIssues(issues, base), [
  { repo: "acme/web", number: 1, key: "acme/web#1" },
], "matches by exact labels inside the rule project only");
assert.equal(ruleSourceKey("acme/web", 1), "acme/web#1", "source key is repo#number");

// Multi-label AND: needs every watched label.
assert.deepEqual(
  matchAutomationIssues(issues, { ...base, labels: ["stelow-work", "bug"] }),
  [{ repo: "acme/web", number: 1, key: "acme/web#1" }],
  "multi-label rules require every label",
);
assert.deepEqual(
  matchAutomationIssues(issues, { ...base, labels: ["stelow-work", "missing"] }),
  [],
  "missing second label matches nothing",
);

// Compat: singular label still works.
assert.deepEqual(
  matchAutomationIssues(issues, { label: "stelow-work", projectId: "proj_web", projectForRepo, firedKeys: [] }),
  [{ repo: "acme/web", number: 1, key: "acme/web#1" }],
  "singular label is an alias for one watched label",
);

// Already-fired and already-imported issues never match twice.
assert.deepEqual(
  matchAutomationIssues(issues, { ...base, firedKeys: ["acme/web#1"] }),
  [],
  "fired source keys are skipped",
);
assert.deepEqual(
  matchAutomationIssues(issues, { ...base, importedKeys: ["acme/web#1"] }),
  [],
  "imported keys are skipped across flows",
);

// Label matching is exact and case-sensitive.
assert.deepEqual(
  matchAutomationIssues([{ repo: "acme/web", number: 9, labels: ["Stelow-Work"] }], base),
  [],
  "label case must match exactly",
);

// Defensive shapes.
assert.deepEqual(matchAutomationIssues([null, "x", 42, {}], base), [], "non-object entries are skipped");
assert.deepEqual(matchAutomationIssues([{ repo: "acme/web", number: 5 }], base), [], "entries without labels never match");
assert.deepEqual(matchAutomationIssues([], base), [], "empty issue list matches nothing");
assert.deepEqual(matchAutomationIssues(null, base), [], "null issue list matches nothing");
assert.deepEqual(matchAutomationIssues(issues, { ...base, labels: [] }), [], "empty watched labels match nothing");

// Shared intent heuristic.
assert.equal(githubIntentFor({ labels: ["bug"], title: "crash" }), "bugfix", "bug label maps to bugfix");
assert.equal(githubIntentFor({ labels: ["stelow-work"], title: "Add feature" }), "feature", "feature title maps to feature");
assert.equal(githubIntentFor({ labels: [], title: "hello" }), "investigate", "fallback is investigate");
assert.deepEqual(normalizeGithubLabels("stelow-work, bug"), ["stelow-work", "bug"], "comma string splits");
assert.deepEqual(normalizeGithubLabels(["stelow-work", " "]), ["stelow-work"], "blanks drop");

console.log("automation rules test ok: labels AND, owning project, shared dedupe, intent");

// One decision core serves the scheduler and the dry-run preview.
const ctx = { watched: ["stelow-work"], projectId: "proj_web", projectForRepo, fired: new Set(), imported: new Set() };
assert.deepEqual(
  decideAutomationIssue({ repo: "acme/web", number: 1, labels: ["stelow-work"] }, ctx),
  { ok: true, key: "acme/web#1" },
  "matching issue decides ok",
);
assert.equal(
  decideAutomationIssue({ repo: "acme/web", number: 2, labels: ["docs"] }, ctx).reason,
  "missing-labels",
  "label miss names its reason",
);
assert.equal(
  decideAutomationIssue({ repo: "acme/api", number: 3, labels: ["stelow-work"] }, ctx).reason,
  "other-project",
  "foreign project names its reason",
);
assert.equal(
  decideAutomationIssue({ repo: "acme/web", number: 1, labels: ["stelow-work"] }, { ...ctx, fired: new Set(["acme/web#1"]) }).reason,
  "already-fired",
  "fired issue names its reason",
);
assert.equal(
  decideAutomationIssue({ repo: "acme/web", number: 1, labels: ["stelow-work"] }, { ...ctx, imported: new Set(["acme/web#1"]) }).reason,
  "already-imported",
  "imported issue names its reason",
);
assert.equal(decideAutomationIssue(null, ctx).reason, "invalid-issue", "junk decides invalid");

// Backlog-guard seen keys share the never-again semantics.
assert.deepEqual(
  matchAutomationIssues(issues, { ...base, seenKeys: ["acme/web#1"] }),
  [],
  "seen keys never match twice",
);

// Dry-run preview: matches plus exactly-why-not skips, junk silent.
const preview = previewAutomationMatches(
  [...issues, null, { repo: "acme/web", number: 7, labels: ["stelow-work"] }],
  base,
);
assert.deepEqual(preview.matches.map((entry) => entry.key), ["acme/web#1", "acme/web#7"], "preview matches like the scheduler");
assert.deepEqual(
  preview.skipped.map((entry) => `${entry.key}:${entry.reason}`).sort(),
  ["acme/api#3:other-project", "acme/unmapped#4:other-project", "acme/web#2:missing-labels"],
  "every skip names its reason",
);

console.log("automation preview test ok: one decision core, named reasons, seen keys");

// Intent: new-product outranks the generic "new" inside feature.
assert.equal(githubIntentFor({ labels: [], title: "New product launch" }), "new-product", "new product title maps to new-product");
assert.equal(githubIntentFor({ labels: [], title: "Add new feature" }), "feature", "generic new still maps to feature");

// Author allowlist: empty means anyone, otherwise exact login.
assert.deepEqual(normalizeGithubAuthors("@octo, dealer"), ["octo", "dealer"], "@-prefix strips");
assert.deepEqual(
  matchAutomationIssues(
    [{ repo: "acme/web", number: 1, labels: ["stelow-work"], author: "mallory" }],
    { ...base, trustedAuthors: ["octo"] },
  ),
  [],
  "unlisted author never drafts",
);
assert.deepEqual(
  previewAutomationMatches(
    [{ repo: "acme/web", number: 1, labels: ["stelow-work"], author: "mallory" }],
    { ...base, trustedAuthors: ["octo"] },
  ).skipped.map((entry) => entry.reason),
  ["untrusted-author"],
  "allowlist miss names its reason",
);

// Rule prompt threading: empty template is a no-op, capped at 2000 chars.
assert.equal(applyRulePrompt("prompt", "  "), "prompt", "blank template leaves the prompt alone");
assert.ok(applyRulePrompt("prompt", "Reproduce first.").includes("Rule instructions:\nReproduce first."), "template appends as its own block");
assert.ok(applyRulePrompt("prompt", "x".repeat(3000)).length < "prompt".length + 2100, "template is bounded");

// Related issues: title overlap, self excluded, deterministic, capped.
const pool = [
  { repo: "acme/web", number: 1, title: "Crash on checkout cart promo" },
  { repo: "acme/web", number: 2, title: "Checkout cart promo duplicates discount" },
  { repo: "acme/web", number: 3, title: "Unrelated login page typo" },
];
assert.deepEqual(findRelatedIssues(pool[0], pool), ["acme/web#2"], "overlap links, self excluded");
assert.deepEqual(findRelatedIssues(pool[2], pool), [], "no overlap means no hint");

// Spawn gate: band routing wins — only the effective environment decides.
assert.deepEqual(
  decideAutomationSpawn({ startImmediate: true, effectiveEnvKind: "new-worktree" }),
  { start: true, parkedReason: null },
  "isolated spawn starts",
);
assert.deepEqual(
  decideAutomationSpawn({ startImmediate: true, effectiveEnvKind: "project-default" }),
  { start: false, parkedReason: "no-worktree-preset" },
  "shared checkout parks even when asked to start",
);
assert.deepEqual(
  decideAutomationSpawn({ startImmediate: false, effectiveEnvKind: "new-worktree" }),
  { start: false, parkedReason: null },
  "parked-by-choice carries no failure reason",
);
assert.ok(describeParkedReason("no-worktree-preset").includes("New-worktree"), "parked reason names the fix");

console.log("automation gate test ok: intent order, allowlist, prompt, related, spawn gate");
