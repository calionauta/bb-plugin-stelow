// Smoke test for STAGE_BANDS / STAGE_TO_BAND mapping and band resolution.
// Run: node test_bands.mjs   (no deps, no framework)
//
// Validates invariants the server relies on for per-phase preset switching:
//   1. Every stage belongs to exactly one band (no overlap / no duplicates).
//   2. Every band has at least one stage.
//   3. Resolution honors band-override, falls back to card preset, then default.
import assert from "node:assert";

const STAGE_BANDS = {
  analysis: ["triage", "select", "setup", "context", "shape"],
  planning: ["critique", "scope", "interface", "int-gate", "selection", "planning", "plan-gate"],
  execution: ["execution", "verification"],
  review: ["diff-gate", "audit"],
  research: ["research"],
};

const STAGE_TO_BAND = Object.fromEntries(
  Object.entries(STAGE_BANDS).flatMap(([band, stages]) => stages.map((stage) => [stage, band])),
);

// 1. no overlap / no duplicates across bands
const flat = Object.values(STAGE_BANDS).flat();
assert.strictEqual(new Set(flat).size, flat.length, "stages duplicated across bands");
assert.strictEqual(Object.keys(STAGE_TO_BAND).length, flat.length, "stage->band map has unexpected entries");

// 2. every band non-empty and every stage mapped
assert.ok(Object.values(STAGE_BANDS).every((s) => s.length > 0), "some band is empty");
for (const stage of flat) assert.ok(STAGE_TO_BAND[stage], `unmapped stage ${stage}`);

// 2b. research investigations resolve to their own band, never analysis
assert.strictEqual(STAGE_TO_BAND["research"], "research", "research stage must map to the research band");

// 3. resolution: band override beats card preset beats idem
const resolve = (bandDefs, cardPreset, band = "execution") => {
  if (bandDefs[band]) return bandDefs[band];
  return cardPreset ?? "default";
};
assert.strictEqual(resolve({ execution: "band-x" }, "card-y"), "band-x", "band override must win");
assert.strictEqual(resolve({}, "card-y"), "card-y", "falls back to card preset");
assert.strictEqual(resolve({}, null), "default", "falls back to default");

console.log(`test_bands ok: ${flat.length} stages across ${Object.keys(STAGE_BANDS).length} bands; resolution fallback verified`);