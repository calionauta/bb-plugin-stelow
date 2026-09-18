import assert from "node:assert/strict";
import {
  parseSemverParts,
  versionAtLeast,
  stelowRangeCoversCurrentLine,
  highestSatisfyingTag,
} from "../lib/migration-readiness.mjs";

// parseSemverParts must handle plain versions, leading operators from
// engines ranges (">=0.38"), carets, and multiline/garbage input.
assert.deepEqual(parseSemverParts("0.43.0"), [0, 43, 0]);
assert.deepEqual(parseSemverParts("v0.24.0"), [0, 24, 0]);
assert.deepEqual(parseSemverParts(">=0.38"), [0, 38, 0], "floor strings with operators must parse");
assert.deepEqual(parseSemverParts(">=0.38.2"), [0, 38, 2]);
assert.deepEqual(parseSemverParts("^1.2"), [1, 2, 0]);
assert.equal(parseSemverParts("nope"), null);
assert.equal(parseSemverParts(""), null);

// versionAtLeast: the regression this file exists for — 0.43.0 satisfies
// the engines.bb floor ">=0.38" that v0.24.0 declares.
assert.equal(versionAtLeast("0.43.0", ">=0.38"), true);
assert.equal(versionAtLeast("0.37.9", ">=0.38"), false);
assert.equal(versionAtLeast("0.43.0", ">=0.46"), false);
assert.equal(versionAtLeast("0.43.0", "0.43.0"), true);
assert.equal(versionAtLeast("0.44.0-beta", ">=0.38"), true);

// stelowRangeCoversCurrentLine: modern-line floors accepted, preview-line
// ranges rejected, anything ambiguous rejected.
assert.equal(stelowRangeCoversCurrentLine(">=0.23.0"), true);
assert.equal(stelowRangeCoversCurrentLine(">=0.18.0"), true);
assert.equal(stelowRangeCoversCurrentLine("^0.3.14"), false);
assert.equal(stelowRangeCoversCurrentLine(">=0.17.0"), false);
assert.equal(stelowRangeCoversCurrentLine("latest"), false);

// highestSatisfyingTag: picks the newest tag satisfying the floor, ignores
// peeled refs and non-semver lines.
const tags = [
  "a1b2c3d4\trefs/tags/v0.3.80",
  "b2c3d4e5\trefs/tags/v0.24.0",
  "c3d4e5f6\trefs/tags/v0.24.0^{}",
  "d4e5f6a7\trefs/tags/v0.18.49",
  "e5f6a7b8\trefs/tags/v0.22.0",
].join("\n");
assert.equal(highestSatisfyingTag(tags, "0.23.0"), "v0.24.0");
assert.equal(highestSatisfyingTag(tags, "0.25.0"), null);
assert.equal(highestSatisfyingTag("", "0.23.0"), null);
assert.equal(highestSatisfyingTag("badline", "0.23.0"), null);

console.log("migration readiness test ok: parsers, floors, range, tag pick");