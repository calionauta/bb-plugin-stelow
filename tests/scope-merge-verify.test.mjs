import assert from "node:assert/strict";
import { verifyParentMerge } from "../lib/scope-merge.mjs";

// Missing verification refuses success.
assert.deepEqual(
  verifyParentMerge("batch-1", null, "merge-1").code,
  "VERIFICATION_MISSING",
  "absent parent-verification.json refuses success",
);
assert.equal(verifyParentMerge("batch-1", null, "merge-1").ok, false, "missing verification is not ok");

// Stale batch refuses.
const wrongBatch = verifyParentMerge("batch-1", { batchId: "batch-2", mergeCommit: "merge-1", verifiedAt: 200, mergeAt: 100 }, "merge-1");
assert.equal(wrongBatch.ok, false, "verification for another batch refuses");
assert.equal(wrongBatch.code, "VERIFICATION_STALE", "wrong batch names VERIFICATION_STALE");

// Stale commit refuses.
const staleCommit = verifyParentMerge("batch-1", { batchId: "batch-1", mergeCommit: "merge-0", verifiedAt: 200, mergeAt: 100 }, "merge-1");
assert.equal(staleCommit.ok, false, "verification predating the merge refuses");
assert.equal(staleCommit.code, "VERIFICATION_STALE", "stale commit names VERIFICATION_STALE");

// Stale timestamp refuses.
const staleTime = verifyParentMerge("batch-1", { batchId: "batch-1", mergeCommit: "merge-1", verifiedAt: 50, mergeAt: 100 }, "merge-1");
assert.equal(staleTime.ok, false, "verification older than the merge refuses");

// Fresh verification passes.
const fresh = verifyParentMerge("batch-1", { batchId: "batch-1", mergeCommit: "merge-1", verifiedAt: 200, mergeAt: 100 }, "merge-1");
assert.equal(fresh.ok, true, "fresh verification passes");
assert.equal(fresh.code, "VERIFIED", "fresh verification names VERIFIED");

// Mutation guard: deleting the gate check would let unverified success
// through. Both refusal pins above fail if the gate is removed.
assert.equal(verifyParentMerge("batch-1", null, "merge-1").ok, false, "gate is load-bearing for missing files");
assert.equal(staleCommit.ok, false, "gate is load-bearing for stale commits");

console.log("scope-merge-verify: ok");
