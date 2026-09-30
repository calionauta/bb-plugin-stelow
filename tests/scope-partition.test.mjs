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

// The gap this closes: a scope with no declared target files expands to an
// EMPTY set, and two empty sets are trivially disjoint. So a batch that
// declared nothing was admitted as PARTITIONS_DISJOINT on the strength of
// knowing nothing — the silent overwrite this module exists to prevent,
// arriving by the other door. An unknown footprint is not a smaller one.
{
  const bothUndeclared = computeScopePartitions([
    { scopeId: "no-files-a", acceptanceCriteria: ["a"] },
    { scopeId: "no-files-b", acceptanceCriteria: ["b"] },
  ]);
  assert.equal(bothUndeclared.admitted, false, "two scopes that declared nothing do not fan out");
  assert.equal(bothUndeclared.code, "PARTITION_UNDECLARED", "the refusal names the reason, not an overlap that did not happen");
  assert.deepEqual(
    bothUndeclared.undeclared,
    ["no-files-a", "no-files-b"],
    "and it names the scopes, so the reader knows which to fix",
  );

  const oneUndeclared = computeScopePartitions([
    { scopeId: "declared", targetFiles: ["src/a.ts"] },
    { scopeId: "silent", acceptanceCriteria: ["b"] },
  ]);
  assert.equal(oneUndeclared.admitted, false, "one undeclared scope is enough to refuse the batch");
  assert.deepEqual(oneUndeclared.undeclared, ["silent"], "the declared scope is not the problem");
}

// Single-scope work is exempt: there is nothing to be disjoint FROM, and the
// declaration only matters for parallelism. Refusing it would block ordinary
// sequential execution that never needed a file list.
{
  const alone = computeScopePartitions([{ scopeId: "only", acceptanceCriteria: ["a"] }]);
  assert.equal(alone.admitted, true, "a single undeclared scope still runs — nothing can collide with it");
  assert.equal(alone.code, "PARTITIONS_DISJOINT");
}

console.log("scope-partition: ok");
