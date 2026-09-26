import assert from "node:assert/strict";
import { recordShapeVersion } from "../lib/scope-map-freshness.mjs";
import { parseCurrentShapeVersion } from "../lib/scope-xray.mjs";

const state = [
  "---",
  "workflow_id: card_1",
  "name: A card",
  "intent: feature",
  "current_stage: scope",
  "status: active",
  "stages:",
  "  triage: done",
  "---",
  "",
  "body text",
].join("\n");

// Context: the X-ray read `shape_version` from state.md and nothing ever
// wrote it, so freshness was permanently "unknown" — the honest fallback had
// become structural. Recording it at approval is what makes the signal live.
// Drop the write and parseCurrentShapeVersion still returns null below.
const written = recordShapeVersion(state, "spec-product_v2");
assert.equal(written.changed, true, "the version is recorded when the map is approved");
assert.equal(written.written, true, "an approved map with a version is recorded");
assert.equal(parseCurrentShapeVersion(written.text), "spec-product_v2", "the X-ray can now read a real current version");
assert.match(written.text, /^shape_version: spec-product_v2$/m, "the field is written as its own frontmatter key");
assert.equal(written.text.split("\n").filter((line) => line === "---").length, 2, "both frontmatter fences survive");
assert.match(written.text, /body text/, "the body outside frontmatter is untouched");
assert.ok(
  written.text.indexOf("shape_version") < written.text.lastIndexOf("---"),
  "the field lands inside the frontmatter, above the closing fence",
);

// Idempotent: a second approval must not rewrite a file that already says it.
const again = recordShapeVersion(written.text, "spec-product_v2");
assert.equal(again.changed, false, "recording the same version is a no-op");
assert.equal(again.text, written.text, "a no-op returns the file byte-identical");

// Replacing a stale value is the point: that is what makes a Shape bump
// visible as stale rather than silently ignored.
const bumped = recordShapeVersion(written.text, "spec-product_v3");
assert.equal(bumped.changed, true, "a newer Shape version replaces the recorded one");
assert.equal(parseCurrentShapeVersion(bumped.text), "spec-product_v3", "the X-ray reads the newer version");
assert.equal(bumped.text.match(/^shape_version:/gm).length, 1, "the field is replaced, never duplicated");

// No version means no write: a map that carries none leaves freshness unknown
// on purpose, rather than the host inventing a version.
for (const [label, value] of [["null", null], ["undefined", undefined], ["empty", "  "], ["a number", 3]]) {
  const result = recordShapeVersion(state, value);
  assert.equal(result.written, false, `${label} writes nothing`);
  assert.equal(result.text, state, `${label} leaves the state file byte-identical`);
}

// A state file with no frontmatter is not ours to edit; a stray key at the
// top of a body would corrupt it.
const bodyOnly = "just a body\nwith lines\n";
const untouched = recordShapeVersion(bodyOnly, "v1");
assert.equal(untouched.changed, false, "a state file with no frontmatter is left alone");
assert.equal(untouched.text, bodyOnly, "the body-only file is byte-identical");

for (const [label, value] of [["null", null], ["a number", 7], ["an object", {}]]) {
  const result = recordShapeVersion(value, "v1");
  assert.equal(result.text, "", `${label} state text reads as empty rather than throwing`);
}

console.log("scope map freshness test ok: the version is recorded, replaced, and never invented");
