import assert from "node:assert/strict";
import {
  CARD_KINDS,
  LIGHTWEIGHT_KINDS,
  LIGHTWEIGHT_COLUMNS,
  LIGHTWEIGHT_COLUMN_LABELS,
  bandForKind,
  isLightweightKind,
  isValidKind,
  normalizeKind,
} from "../lib/tracks.mjs";

// The three concepts exist exactly once: build, research, explore.
assert.deepEqual(CARD_KINDS, ["build", "research", "explore"], "card kinds");
assert.deepEqual(LIGHTWEIGHT_KINDS, ["research", "explore"], "lightweight kinds");
assert.deepEqual(LIGHTWEIGHT_COLUMNS, ["todo", "doing", "done", "archived"], "lightweight columns");
assert.equal(LIGHTWEIGHT_COLUMN_LABELS.done, "Done", "column labels");

// Membership predicates agree with the catalogs.
assert.equal(isValidKind("build"), true, "build is valid");
assert.equal(isValidKind("research"), true, "research is valid");
assert.equal(isValidKind("explore"), true, "explore is valid");
assert.equal(isValidKind("delivery"), false, "delivery is not a kind anymore");
assert.equal(isLightweightKind("research"), true, "research is lightweight");
assert.equal(isLightweightKind("explore"), true, "explore is lightweight");
assert.equal(isLightweightKind("build"), false, "build is not lightweight");

// Legacy rows migrate silently: delivery reads as build.
assert.equal(normalizeKind("delivery"), "build", "legacy delivery normalizes to build");
assert.equal(normalizeKind("build"), "build", "build stays build");
assert.equal(normalizeKind("bogus"), "build", "unknown falls back to build");

// Worker bands: build runs the analysis band, research and explore each
// have their own — one line to change, never scattered ternaries.
assert.equal(bandForKind("build"), "analysis", "build band");
assert.equal(bandForKind("research"), "research", "research band");
assert.equal(bandForKind("explore"), "explore", "explore band");
assert.equal(bandForKind("delivery"), "analysis", "legacy delivery band");

console.log("tracks test ok: kinds, lightweight lifecycle, bands, legacy normalization");
