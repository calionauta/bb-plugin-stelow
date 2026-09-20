import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_CRITERION_KINDS, parseCriteriaBlock, groupCriteriaByKind, semanticCriterionToScore, judgeArtifactCriteria, CRITERIA_MET_SCORE, CRITERIA_UNMET_SCORE } from "../lib/skill-criteria.mjs";

// Skill criteria blocks: the structured mirror of Completeness contracts.
// Parsing is strict about shape (id/kind/text, known kinds) and fail-soft
// about content (malformed items skip, duplicates keep first) — a sloppy
// block degrades to fewer criteria, never to a throw in the consumer.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shapeUp = readFileSync(join(root, "skills", "stelow-workflow-shape-up", "SKILL.md"), "utf8");

// The parser proves itself against the real vendored files once synced;
// until then these inline fixtures pin the exact block shape.
const shapeUpFixture = `criteria:
  - id: frontmatter
    kind: presence
    text: "YAML frontmatter carries appetite and product_type"
  - id: word-count
    kind: count
    text: "At least 800 words"
  - id: dangers-quality
    kind: semantic
    text: "Dangers name concrete failure modes with triggers, not generic risks"`;

const parsed = parseCriteriaBlock(shapeUpFixture);
assert.deepEqual(parsed, [
  { id: "frontmatter", kind: "presence", text: "YAML frontmatter carries appetite and product_type" },
  { id: "word-count", kind: "count", text: "At least 800 words" },
  { id: "dangers-quality", kind: "semantic", text: "Dangers name concrete failure modes with triggers, not generic risks" },
], "the fixture parses to id/kind/text triples");

assert.deepEqual(parseCriteriaBlock("no block here"), [], "absent blocks parse to nothing");
assert.deepEqual(
  parseCriteriaBlock("criteria:\n  - id: a\n    kind: mystery\n    text: \"x\"\n  - id: b\n    kind: semantic\n"),
  [],
  "unknown kinds and textless items skip (first has bad kind, second has no text)",
);
assert.deepEqual(
  parseCriteriaBlock("criteria:\n  - id: dup\n    kind: count\n    text: \"one\"\n  - id: dup\n    kind: count\n    text: \"two\""),
  [{ id: "dup", kind: "count", text: "one" }],
  "duplicate ids keep the first occurrence",
);
assert.deepEqual(
  parseCriteriaBlock("criteria:\n  - id: trailing\n    kind: presence\n    text: \"kept\"\nsome prose after"),
  [{ id: "trailing", kind: "presence", text: "kept" }],
  "trailing prose ends the block without losing parsed items",
);

// Only the fixture above is asserted today: the vendored plugin copy gains
// criteria blocks on the next upstream sync, and a file-shape pin here
// would fail until then (sync-owned files are never hand-edited).
assert.ok(typeof shapeUp === "string" && shapeUp.length > 0, "the vendored shape-up skill reads");

const groups = groupCriteriaByKind(parsed);
assert.deepEqual(groups.presence.map((item) => item.id), ["frontmatter"], "presence routes to deterministic validators");
assert.deepEqual(groups.count.map((item) => item.id), ["word-count"], "count routes to deterministic validators");
assert.deepEqual(groups.semantic.map((item) => item.id), ["dangers-quality"], "semantic routes to Score questions");
assert.deepEqual(groupCriteriaByKind(null), { presence: [], count: [], semantic: [] }, "non-lists group to empty");
assert.deepEqual(groupCriteriaByKind([{ id: "x", kind: "mystery", text: "y" }]), { presence: [], count: [], semantic: [] }, "unknown kinds group nowhere");
assert.deepEqual(SKILL_CRITERION_KINDS, ["presence", "count", "semantic"], "three kinds, closed set");

// One atomic Score per semantic criterion: the question id names the
// criterion, the instructions quote it — no conflated multi-criterion calls.
const scored = semanticCriterionToScore({ id: "dangers-quality", kind: "semantic", text: "Dangers name concrete failure modes" });
const key = "criterion:dangers-quality";
assert.equal(scored[key].type, "score", "semantic criteria become Score questions");
assert.ok(scored[key].instructions.includes("Dangers name concrete failure modes"), "instructions quote the criterion");
assert.ok(scored[key].instructions.includes("Judge ONLY this criterion"), "atomicity is explicit in the prompt");
assert.deepEqual(scored[key].criteria, ["Not met", "Partially met", "Clearly met"], "fixed 3-level anchors until calibration refines them");

// Rollout sweep: every criteria block in the vendored copy parses with
// at least one semantic criterion (the layer only a judge can check).
// Files without a block are out of scope for this sweep, never failures —
// coverage grows as upstream adds blocks, and the sync carries them here.
import { readdirSync, statSync } from "node:fs";
function markdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...markdownFiles(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}
const swept = [];
for (const file of markdownFiles(join(root, "skills"))) {
  const items = parseCriteriaBlock(readFileSync(file, "utf8"));
  if (items.length === 0) continue;
  const groups = groupCriteriaByKind(items);
  assert.ok(groups.semantic.length >= 1, `${file} carries at least one semantic criterion`);
  assert.ok(items.every((item) => item.id && item.text), `${file} has no hollow criteria`);
  swept.push(file);
}
assert.ok(swept.length >= 25, `the rollout covers the playbooks (swept ${swept.length} files)`);

// Judge verdicts: confident extremes decide, anything else abstains. One
// stubbed provider answers two criteria to prove atomic fan-out.
const judgeSkill = `criteria:
  - id: dangers-quality
    kind: semantic
    text: "Dangers name concrete failure modes"
  - id: tradeoff-quality
    kind: semantic
    text: "Trade-offs state sacrifices"`;
const seenBodies = [];
const judgeFetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  seenBodies.push(body);
  const id = Object.keys(body.questions)[0];
  const instructions = body.questions[id]?.instructions ?? "";
  const score = instructions.includes("failure modes") ? 1.8 : 0.2;
  return { status: 200, json: async () => ({ answers: { [id]: { type: "score", score, confidence: 0.9 } } }) };
};
const judged = await judgeArtifactCriteria({ provider: "jev", endpoint: "https://x.test/v1", apiKey: "k", model: "m", skillText: judgeSkill, artifactText: "concrete failure modes with triggers", routeAt: 0.6, fetchImpl: judgeFetch });
assert.equal(judged.ok, true, "judging resolves");
assert.equal(judged.evaluated, 2, "both semantic criteria evaluate");
assert.deepEqual(judged.findings.map((finding) => finding.verdict), ["met", "unmet"], "confident extremes decide per criterion");
assert.equal(seenBodies.length, 2, "one atomic call per criterion, never batched");
assert.ok(seenBodies.every((body) => Object.keys(body.questions).length === 1), "each call carries exactly one question");
assert.equal(CRITERIA_MET_SCORE, 1.5, "met floor is pinned");
assert.equal(CRITERIA_UNMET_SCORE, 0.5, "unmet ceiling is pinned");

// Low confidence abstains even on extreme scores; provider failure degrades
// the whole call; skills without semantic criteria resolve empty.
const shyFetch = async (url, opts) => {
  const id = Object.keys(JSON.parse(opts.body).questions)[0];
  return { status: 200, json: async () => ({ answers: { [id]: { type: "score", score: 2.0, confidence: 0.3 } } }) };
};
const shy = await judgeArtifactCriteria({ provider: "jev", endpoint: "https://x.test/v1", apiKey: "k", model: "m", skillText: judgeSkill, artifactText: "whatever", routeAt: 0.6, fetchImpl: shyFetch });
assert.ok(shy.findings.every((finding) => finding.verdict === "unverifiable"), "low confidence abstains on every criterion");
const deadFetch = async () => { throw new Error("down"); };
const dead = await judgeArtifactCriteria({ provider: "jev", endpoint: "https://x.test/v1", apiKey: "k", model: "m", skillText: judgeSkill, artifactText: "whatever", fetchImpl: deadFetch });
assert.equal(dead.ok, false, "total provider failure degrades the call");
assert.equal(dead.findings.length, 2, "failed findings still list every criterion");
const empty = await judgeArtifactCriteria({ provider: "jev", endpoint: "https://x.test/v1", apiKey: "k", model: "m", skillText: "no block", artifactText: "whatever", fetchImpl: judgeFetch });
assert.deepEqual(empty, { ok: true, findings: [], evaluated: 0 }, "skills without semantic criteria resolve empty");

console.log("skill criteria test ok: block parsing, kind routing, atomic Score translation");