import assert from "node:assert/strict";
import { summarizeSemDiff } from "../lib/sem-summary.mjs";

// Shape mirrors `sem diff --format json` (see sem README example output).
const FIXTURE = {
  summary: { fileCount: 1, added: 0, modified: 1, deleted: 0, moved: 0, renamed: 0, reordered: 0, binary: 0, orphan: 0, total: 1 },
  changes: [
    { entityId: "auth.py::function::authenticate_user", changeType: "modified", entityType: "function", entityName: "authenticate_user", filePath: "auth.py", beforeContent: "def f():\n    pass", afterContent: "def f():\n    return True", structuralChange: true },
  ],
  binaryChanges: [],
};

// Structural change passes buckets through, cosmeticOnly false.
{
  const summary = summarizeSemDiff(FIXTURE);
  assert.deepEqual(summary, { total: 1, fileCount: 1, added: 0, modified: 1, deleted: 0, renamed: 0, moved: 0, cosmeticOnly: false });
}

// All-cosmetic changes flag cosmeticOnly.
{
  const cosmetic = structuredClone(FIXTURE);
  cosmetic.changes[0].structuralChange = false;
  assert.equal(summarizeSemDiff(cosmetic)?.cosmeticOnly, true);
}

// Off-shape and empty inputs yield null, never throw.
assert.equal(summarizeSemDiff(null), null, "null");
assert.equal(summarizeSemDiff("not json"), null, "string");
assert.equal(summarizeSemDiff([]), null, "array");
assert.equal(summarizeSemDiff({}), null, "no summary");
assert.equal(summarizeSemDiff({ summary: { total: 0 } }), null, "zero total");
assert.equal(summarizeSemDiff({ summary: { total: "many" } }), null, "non-numeric total");
assert.equal(summarizeSemDiff({ summary: { total: 2, added: -3, modified: 1.9 } })?.added, 0, "negatives clamp");
assert.equal(summarizeSemDiff({ summary: { total: 2, added: -3, modified: 1.9 } })?.modified, 1, "floats floor");

console.log("sem summary test ok: buckets, cosmetic flag, off-shape nulls");
