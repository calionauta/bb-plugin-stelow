import assert from "node:assert/strict";
import { RESEARCH_STRATEGIES, researchStrategyById, parseStrategyList } from "../lib/research-strategies.mjs";

// The picker and the worker prompt share this list: shape invariants keep
// them from drifting apart silently.
assert.ok(RESEARCH_STRATEGIES.length >= 10, "covers the product strategy range");
const ids = RESEARCH_STRATEGIES.map((entry) => entry.id);
assert.equal(new Set(ids).size, ids.length, "strategy ids are unique");
for (const entry of RESEARCH_STRATEGIES) {
  assert.match(entry.id, /^[a-z][a-z0-9-]*$/, `${entry.id} is a slug`);
  assert.ok(entry.label && entry.label.length > 0, `${entry.id} has a label`);
  assert.match(entry.skill, /^stelow-product-[a-z-]+$/, `${entry.id} maps to a stelow-product-* skill`);
  assert.ok(entry.blurb && entry.blurb.length > 0, `${entry.id} has a picker blurb`);
  assert.ok(entry.emoji && entry.emoji.length > 0, `${entry.id} has a picker emoji`);
  assert.ok(Array.isArray(entry.keywords) && entry.keywords.length > 0, `${entry.id} has filter keywords`);
  for (const keyword of entry.keywords) {
    assert.equal(keyword, keyword.toLowerCase(), `${entry.id} keyword is lowercase`);
  }
}
const emojis = RESEARCH_STRATEGIES.map((entry) => entry.emoji);
assert.equal(new Set(emojis).size, emojis.length, "strategy emoji are unique");
assert.ok(RESEARCH_STRATEGIES.some((entry) => entry.id === "opportunity-mapping"), "opportunity mapping is offered");
const labels = RESEARCH_STRATEGIES.map((entry) => entry.label);
const sorted = [...labels].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
assert.deepEqual(labels, sorted, "picker order is alphabetical by label");
assert.equal(researchStrategyById("job-to-be-done")?.skill, "stelow-product-job-to-be-done", "lookup by id");
assert.equal(researchStrategyById("nope"), null, "unknown id resolves to null");

// Strategy history: strict {id, at, file} rows project to ids;
// repeats are preserved as separate rounds, garbage degrades honestly.
assert.deepEqual(parseStrategyList('[{"id":"a","at":"t","file":"f"},{"id":"a","at":"t2","file":"f2"}]'), ["a", "a"], "repeats preserved");
assert.deepEqual(parseStrategyList('["a","b"]'), [], "legacy id arrays are dropped");
assert.deepEqual(parseStrategyList(null), [], "nothing yields no history");

console.log("research strategies test ok: unique ids, skill mapping, lookup, history");
