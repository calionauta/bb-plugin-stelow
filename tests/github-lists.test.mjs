import assert from "node:assert/strict";
import { sortedUnion } from "../lib/github-lists.mjs";

// Union + alphabetical, duplicates collapsed.
assert.deepEqual(sortedUnion([["bob", "alice"], ["alice", "carol"]]), ["alice", "bob", "carol"]);
// Fail-soft: non-arrays ignored, non-strings dropped, blanks trimmed out.
assert.deepEqual(sortedUnion([null, "junk", [" ok ", "", 42, null, "ok"]]), ["ok"]);
// Single non-array input degrades to empty, never throws.
assert.deepEqual(sortedUnion(null), []);
assert.deepEqual(sortedUnion("bob"), []);

console.log("github lists test ok: sorted union, fail-soft inputs");
