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

// Output contracts: every strategy declares single/variant/composite;
// composite names its expected substeps for validation.
import { expectedSubsteps, missingSubsteps } from "../lib/research-strategies.mjs";
import { RESEARCH_STRATEGIES as STRATEGIES } from "../lib/research-strategies.mjs";
for (const entry of STRATEGIES) {
  assert.ok(["single", "variant", "composite"].includes(entry.contract), `${entry.id} has a valid contract`);
  if (entry.contract === "composite") {
    assert.ok(Array.isArray(entry.substeps) && entry.substeps.length > 0, `${entry.id} composite names substeps`);
  }
}
assert.deepEqual(expectedSubsteps("pricing"), [], "single needs no validation");
assert.deepEqual(expectedSubsteps("market-analysis"), [], "variant needs no validation");
assert.deepEqual(expectedSubsteps("nope"), [], "unknown needs no validation");
assert.equal(expectedSubsteps("job-to-be-done").length, 10, "JTBD full mapping names ten substeps");
assert.deepEqual(missingSubsteps("job-to-be-done", ["contextual-segmentation", "job-map-steps"]), [
  "thinking-styles", "jtbd-discovery", "competitors", "job-actors",
  "situational-variables", "functional-needs", "financial-needs", "emotional-social-jobs",
], "missing substeps reported explicitly");
assert.deepEqual(missingSubsteps("pricing", []), [], "single never reports missing");
assert.deepEqual(missingSubsteps("job-to-be-done", expectedSubsteps("job-to-be-done")), [], "complete set reports nothing missing");

console.log("research contracts test ok: valid contracts, JTBD ten substeps, explicit missing");

// mergeStrategyContracts: upstream neutral data overlays local presentation.
import { mergeStrategyContracts } from "../lib/research-strategies.mjs";
{
  const local = [
    { id: "jtbd", label: "JTBD", skill: "old-skill", blurb: "b", emoji: "e", keywords: [], contract: "single" },
    { id: "pricing", label: "Pricing", skill: "s", blurb: "b", emoji: "e", keywords: [], contract: "single" },
  ];
  const registry = { strategies: [
    { id: "jtbd", skill: "new-skill", contract: "composite", substeps: ["a", "b"] },
    { id: "unknown-future", skill: "s", contract: "single" },
    { id: "broken", skill: "", contract: "mega" },
  ]};
  const merged = mergeStrategyContracts(local, registry);
  assert.equal(merged.length, 2, "unknown upstream ids are not adopted");
  const jtbd = merged.find((e) => e.id === "jtbd");
  assert.equal(jtbd.skill, "new-skill", "skill comes from upstream");
  assert.equal(jtbd.contract, "composite", "contract comes from upstream");
  assert.deepEqual(jtbd.substeps, ["a", "b"], "substeps come from upstream");
  assert.equal(jtbd.label, "JTBD", "presentation stays local");
  assert.equal(merged.find((e) => e.id === "pricing").contract, "single", "untouched stays");
  assert.equal(local[0].contract, "single", "inputs are not mutated");
}
assert.deepEqual(mergeStrategyContracts([{ id: "x" }], null).length, 1, "null registry keeps local");
assert.deepEqual(mergeStrategyContracts([{ id: "x", contract: "composite", substeps: ["a"] }], { strategies: "nope" }).length, 1, "malformed registry keeps local");

console.log("research merge test ok: upstream overlay, local presentation, safe fallback");
