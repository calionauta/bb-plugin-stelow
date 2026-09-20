import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_CRITERION_KINDS, parseCriteriaBlock, groupCriteriaByKind, semanticCriterionToScore } from "../lib/skill-criteria.mjs";

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

console.log("skill criteria test ok: block parsing, kind routing, atomic Score translation");
