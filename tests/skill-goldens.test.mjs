import assert from "node:assert/strict";
import { parseGoldenFile, cohenKappa, goldenVerdict, GOLDEN_KEEP_KAPPA, GOLDEN_MIN_N } from "../lib/skill-goldens.mjs";

// Golden sets: humans label artifacts met/unmet per criterion, the judge
// scores the same files, kappa decides keep/repair/drop. Malformed labels
// skip with reasons; abstentions never enter kappa.

const golden = `# Golden: checkout dangers
skill: stelow-workflow-shape-up
judgments:
  dangers-quality: met
  tradeoff-quality: unmet
---
The checkout fails when the card expires. DANGER: ...`;
const parsed = parseGoldenFile(golden);
assert.equal(parsed.ok, true, "well-formed goldens parse");
assert.equal(parsed.name, "checkout dangers", "names carry through");
assert.equal(parsed.skill, "stelow-workflow-shape-up", "skill headers carry through");
assert.deepEqual(parsed.judgments, { "dangers-quality": "met", "tradeoff-quality": "unmet" }, "judgments map criterion to verdict");
assert.ok(parsed.artifact.includes("DANGER"), "artifact bodies carry through");

assert.deepEqual(parseGoldenFile("").ok, false, "empty files fail soft");
assert.deepEqual(parseGoldenFile("no separator here").ok, false, "missing --- fails soft");
assert.deepEqual(parseGoldenFile("# Golden: x\nskill: s\njudgments:\n  a: maybe\n---\nbody").ok, false, "non-binary judgments fail soft");
assert.deepEqual(parseGoldenFile("# Golden: x\njudgments:\n  a: met\n---\nbody").ok, false, "missing skill fails soft");
assert.ok(parseGoldenFile("# Golden: x\nskill: s\njudgments:\n  a: met\n  junk line\n  b: unmet\n---\nbody").judgments !== undefined, "parse continues past the block only on blank lines");

// Kappa: perfect agreement is 1, chance-level is ~0, empty is null.
assert.deepEqual(cohenKappa([]), { n: 0, agreement: null, kappa: null }, "empty pairs report null, never NaN");
const perfect = cohenKappa([{ human: "met", model: "met" }, { human: "unmet", model: "unmet" }]);
assert.equal(perfect.agreement, 1, "unanimous agreement is 1");
assert.equal(perfect.kappa, 1, "unanimous kappa is 1");
const chance = cohenKappa([{ human: "met", model: "met" }, { human: "met", model: "unmet" }, { human: "unmet", model: "met" }, { human: "unmet", model: "unmet" }]);
assert.ok(Math.abs(chance.kappa) < 0.01, "balanced disagreement is chance-level");
const crossed = cohenKappa([{ human: "met", model: "unmet" }, { human: "met", model: "unmet" }, { human: "unmet", model: "met" }, { human: "unmet", model: "met" }]);
assert.equal(crossed.kappa, -1, "perfectly crossed judgments go fully negative");
// Abstentions never enter kappa (they report as rates, not labels).
const withAbstain = cohenKappa([{ human: "met", model: "met" }, { human: "met", model: "other" }]);
assert.equal(withAbstain.n, 1, "non-binary verdicts exclude from pairs");

// Verdicts: small samples repair (more labels first), κ gates the rest.
assert.equal(goldenVerdict({ n: 2, agreement: 1, kappa: 1 }), "repair", `n < ${GOLDEN_MIN_N} repairs even when perfect`);
assert.equal(goldenVerdict({ n: 30, agreement: 0.9, kappa: 0.8 }), "keep", "high kappa keeps");
assert.equal(goldenVerdict({ n: 30, agreement: 0.5, kappa: 0.1 }), "drop", "near-chance kappa drops");
assert.equal(goldenVerdict({ n: 30, agreement: 0.7, kappa: 0.45 }), "repair", "mid kappa repairs");
assert.equal(goldenVerdict(null), "repair", "missing reports repair");
assert.equal(GOLDEN_KEEP_KAPPA, 0.6, "keep bar is pinned (provisional, JudgmentBench mid-bands)");
assert.equal(GOLDEN_MIN_N, 5, "minimum sample is pinned");

console.log("skill goldens test ok: golden parsing, kappa math, keep/repair/drop verdicts");
