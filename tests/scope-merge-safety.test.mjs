import assert from "node:assert/strict";
import {
  acquireScopeMergeLock,
  isScopeMergeLocked,
  mergeScopesAtomically,
  withScopeMergeLock,
} from "../lib/scope-merge.mjs";

const parent = { "src/keep.ts": "keep" };

// Failed children are filtered before the merge: their output is never
// applied, and the refusal names the failed scopes.
{
  const refused = mergeScopesAtomically("batch-1", [
    { scopeId: "scope-a", files: { "src/a.ts": "new-a" }, fencingToken: 1, status: "succeeded" },
    { scopeId: "scope-b", files: { "src/b.ts": "from-failed" }, fencingToken: 2, status: "failed" },
  ], parent, { "scope-a": 1, "scope-b": 2 });
  assert.equal(refused.ok, false, "a batch with a failed child refuses");
  assert.equal(refused.code, "SCOPE_FAILED", "refusal names SCOPE_FAILED");
  assert.equal(refused.merged, null, "no partial merge is returned");
  assert.equal(refused.parentUnchanged, true, "parent is left unchanged");
  assert.ok(refused.conflicts.some((entry) => entry.scope === "scope-b"), "refusal names the failed scope");
  assert.deepEqual(parent, { "src/keep.ts": "keep" }, "failed output never lands in the parent");
}

// A cancelled child also refuses, and so does an explicit ok:false child.
for (const output of [
  { scopeId: "scope-x", files: { "src/x.ts": "x" }, status: "cancelled" },
  { scopeId: "scope-y", files: { "src/y.ts": "y" }, status: "blocked" },
  { scopeId: "scope-z", files: { "src/z.ts": "z" }, ok: false },
]) {
  const refused = mergeScopesAtomically("batch-1", [output], parent);
  assert.equal(refused.ok, false, `status ${output.status ?? "ok:false"} refuses`);
  assert.equal(refused.code, "SCOPE_FAILED", "child failure names SCOPE_FAILED");
}

// A cancelled batch refuses before touching the parent, even when every
// child succeeded with disjoint files.
{
  const refused = mergeScopesAtomically("batch-1", [
    { scopeId: "scope-a", files: { "src/a.ts": "new-a" }, fencingToken: 1, status: "succeeded" },
  ], parent, { "scope-a": 1 }, { cancelled: true });
  assert.equal(refused.ok, false, "a cancelled batch refuses the merge");
  assert.equal(refused.code, "BATCH_CANCELLED", "refusal names BATCH_CANCELLED");
  assert.equal(refused.merged, null, "cancelled output never merges");
}

// Merge lock serializes the batch: the second acquirer loses fail-soft,
// and a merge attempted under a held lock refuses with MERGE_IN_PROGRESS.
{
  const first = acquireScopeMergeLock("batch-lock");
  assert.ok(first, "first merge acquires the batch lock");
  assert.equal(isScopeMergeLocked("batch-lock"), true, "the batch reads as locked");
  assert.equal(acquireScopeMergeLock("batch-lock"), null, "a concurrent merge loses the lock");
  const busy = mergeScopesAtomically("batch-lock", [
    { scopeId: "scope-a", files: { "src/a.ts": "new-a" }, status: "succeeded" },
  ], parent);
  assert.equal(busy.ok, false, "a merge under a held lock refuses");
  assert.equal(busy.code, "MERGE_IN_PROGRESS", "refusal names MERGE_IN_PROGRESS");
  assert.equal(busy.merged, null, "no torn parent is returned");
  first.release();
  assert.equal(isScopeMergeLocked("batch-lock"), false, "release frees the batch");
  const after = withScopeMergeLock("batch-lock", () => mergeScopesAtomically(
    "batch-lock",
    [{ scopeId: "scope-a", files: { "src/a.ts": "new-a" }, status: "succeeded" }],
    parent,
    {},
    { holdLock: true },
  ));
  assert.equal(after.ok, true, "a serialized merge applies cleanly");
  assert.deepEqual(after.merged, { "src/keep.ts": "keep", "src/a.ts": "new-a" }, "serialized merge applies every file");
  assert.equal(isScopeMergeLocked("batch-lock"), false, "withScopeMergeLock releases even on success");
}

// Mutation guard: removing the failed-child filter would apply failed
// output (merged["src/b.ts"] === "from-failed"). The SCOPE_FAILED pin
// above fails if the filter is dropped.
console.log("scope-merge-safety: ok");
