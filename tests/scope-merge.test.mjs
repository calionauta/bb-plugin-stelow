import assert from "node:assert/strict";
import { mergeScopesAtomically } from "../lib/scope-merge.mjs";

const parent = { "src/keep.ts": "keep", "src/a.ts": "old-a" };

// Overlapping scope outputs abort: no last-writer-wins, parent unchanged.
const conflict = mergeScopesAtomically("batch-1", [
  { scopeId: "scope-a", files: { "src/out.ts": "from-a" }, fencingToken: 1 },
  { scopeId: "scope-b", files: { "src/out.ts": "from-b" }, fencingToken: 2 },
], parent);
assert.equal(conflict.ok, false, "overlapping outputs refuse the merge");
assert.equal(conflict.code, "MERGE_CONFLICT", "abort names MERGE_CONFLICT");
assert.equal(conflict.merged, null, "no partial merge is returned");
assert.equal(conflict.parentUnchanged, true, "parent is left unchanged");
assert.deepEqual(parent, { "src/keep.ts": "keep", "src/a.ts": "old-a" }, "input parent is not mutated");
assert.equal(conflict.conflicts[0].file, "src/out.ts", "abort names the colliding file");

// Stale fencing tokens abort before applying.
const stale = mergeScopesAtomically("batch-1", [
  { scopeId: "scope-a", files: { "src/a.ts": "new-a" }, fencingToken: 9 },
], parent, { "scope-a": 1 });
assert.equal(stale.ok, false, "stale fencing token refuses");
assert.equal(stale.code, "FENCING_STALE", "abort names FENCING_STALE");

// Disjoint outputs with current tokens merge atomically.
const merged = mergeScopesAtomically("batch-1", [
  { scopeId: "scope-a", files: { "src/a.ts": "new-a" }, fencingToken: 1 },
  { scopeId: "scope-b", files: { "src/b.ts": "new-b" }, fencingToken: 2 },
], parent, { "scope-a": 1, "scope-b": 2 });
assert.equal(merged.ok, true, "disjoint outputs merge");
assert.deepEqual(merged.merged, { "src/keep.ts": "keep", "src/a.ts": "new-a", "src/b.ts": "new-b" }, "merge applies every scope output");
assert.deepEqual(parent, { "src/keep.ts": "keep", "src/a.ts": "old-a" }, "merge builds a new parent (no in-place partial apply)");

// Mutation guard: deleting the abort/reset path would last-writer-win the
// conflict above. The conflict pin (ok === false, merged === null) fails
// if the abort is removed.
assert.equal(conflict.ok === false && conflict.merged === null, true, "abort path is load-bearing");

console.log("scope-merge: ok");
