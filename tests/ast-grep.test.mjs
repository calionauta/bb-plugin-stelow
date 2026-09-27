import assert from "node:assert/strict";
import { summarizeAstGrepMatches } from "../lib/ast-grep.mjs";

// Single match maps file/range/text to flat row.
{
  const out = summarizeAstGrepMatches([
    { file: "a.ts", text: "x", range: { start: { line: 2 }, end: { line: 3 } } },
  ]);
  assert.deepEqual(out, [{ file: "a.ts", startLine: 2, endLine: 3, text: "x" }]);
}

// Line numbers pass through verbatim (guards against off-by-one normalization).
{
  const out = summarizeAstGrepMatches([
    { file: "b.ts", text: "y", range: { start: { line: 10 }, end: { line: 12 } } },
  ]);
  assert.equal(out[0].startLine, 10);
  assert.equal(out[0].endLine, 12);
}

// Non-array and empty inputs yield null, never throw.
assert.equal(summarizeAstGrepMatches(null), null, "null");
assert.equal(summarizeAstGrepMatches("not json"), null, "string");
assert.equal(summarizeAstGrepMatches({}), null, "object");
assert.equal(summarizeAstGrepMatches([]), null, "empty array");

// Cap respected: 61 valid rows with default max 50 yields 50 rows.
{
  const rows = Array.from({ length: 61 }, (_, i) => ({
    file: `f${i}.ts`,
    text: `t${i}`,
    range: { start: { line: i + 1 }, end: { line: i + 2 } },
  }));
  const out = summarizeAstGrepMatches(rows);
  assert.equal(out.length, 50);
  assert.equal(out[0].file, "f0.ts");
  assert.equal(out[49].file, "f49.ts");
}

// Explicit max overrides the default cap.
{
  const rows = Array.from({ length: 61 }, (_, i) => ({
    file: `f${i}.ts`,
    text: `t${i}`,
    range: { start: { line: i + 1 }, end: { line: i + 2 } },
  }));
  assert.equal(summarizeAstGrepMatches(rows, 5).length, 5);
}

console.log("ast-grep test ok: flat rows, off-shape nulls, cap respected");
