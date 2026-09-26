import assert from "node:assert/strict";
import { computeScopePartitions, expandScopeFiles } from "../lib/scope-partition.mjs";

// Two scopes share one transitive import: the whole batch refuses.
const overlapping = computeScopePartitions([
  { scopeId: "scope-a", targetFiles: ["src/a.ts"], transitiveFiles: ["src/shared/util.ts"] },
  { scopeId: "scope-b", targetFiles: ["src/b.ts"], imports: ["src/shared/util.ts"] },
]);
assert.equal(overlapping.admitted, false, "overlapping transitive files refuse the batch");
assert.equal(overlapping.code, "PARTITION_OVERLAP", "refusal names PARTITION_OVERLAP");
assert.equal(overlapping.overlaps.length, 1, "exactly one offending file");
assert.equal(overlapping.overlaps[0].file, "src/shared/util.ts", "refusal names the shared file");
assert.deepEqual([...overlapping.overlaps[0].scopes].sort(), ["scope-a", "scope-b"], "refusal names both scopes");

// Disjoint scopes admit with per-scope partitions.
const disjoint = computeScopePartitions([
  { scopeId: "scope-a", targetFiles: ["src/a.ts"], transitiveFiles: ["src/shared/a.ts"] },
  { scopeId: "scope-b", targetFiles: ["src/b.ts"], imports: ["src/shared/b.ts"] },
]);
assert.equal(disjoint.admitted, true, "disjoint scopes admit");
assert.equal(disjoint.code, "PARTITIONS_DISJOINT", "admission names the disjoint code");
assert.deepEqual(disjoint.partitions["scope-a"], ["src/a.ts", "src/shared/a.ts"], "partition expands transitively");

// Direct target overlap also refuses (not only transitive).
const direct = computeScopePartitions([
  { scopeId: "scope-a", files: ["src/same.ts"] },
  { scopeId: "scope-b", writes: ["src/same.ts"] },
]);
assert.equal(direct.admitted, false, "direct TARGET_FILES overlap refuses before any spawn");

// Mutation guard: flipping the disjointness check to admit overlaps must
// break this pin (duplicate write permitted). This assertion is the pin:
// overlap admission is never allowed.
assert.equal(
  overlapping.admitted && overlapping.overlaps.length > 0,
  false,
  "admitted batches carry zero overlaps (invert disjointness -> this fails)",
);
assert.ok(expandScopeFiles({ scopeId: "x", targetFiles: ["./src/a.ts", "src/a.ts"] }).length === 1, "expansion dedupes");

console.log("scope-partition: ok");
