import assert from "node:assert/strict";
import { summarizeCymbalChanged, MAX_SYMBOLS } from "../lib/cymbal-changed.mjs";

// Shape mirrors live `cymbal changed --base HEAD --json` (cymbal 0.14).
const FIXTURE = {
  results: {
    analyzed: 1,
    base: "HEAD",
    changed_symbols: 1,
    results: [
      { symbol: "mul", files: ["src/math.ts"], definition_count: 1, references: { reference_rows: 0 }, impact: { total_callers: 3, test_callers: 1, truncated: false } },
      { symbol: "add", files: ["src/math.ts"], definition_count: 1, impact: { total_callers: 0, test_callers: 0 } },
      { symbol: "", files: [], impact: {} },
    ],
    truncated: false,
  },
  version: "0.1",
};

// Rows pass through; blank symbols drop; missing impact zeroes.
assert.deepEqual(summarizeCymbalChanged(FIXTURE), [
  { symbol: "mul", files: ["src/math.ts"], callers: 3, testCallers: 1 },
  { symbol: "add", files: ["src/math.ts"], callers: 0, testCallers: 0 },
]);

// Cap + garbage yield bounded rows or null, never throw.
{
  const many = { results: { results: Array.from({ length: MAX_SYMBOLS + 5 }, (_, i) => ({ symbol: `f${i}`, impact: {} })) } };
  assert.equal(summarizeCymbalChanged(many)?.length, MAX_SYMBOLS, "row cap");
}
assert.equal(summarizeCymbalChanged(null), null, "null");
assert.equal(summarizeCymbalChanged("x"), null, "string");
assert.equal(summarizeCymbalChanged({}), null, "no results");
assert.equal(summarizeCymbalChanged({ results: { results: [] } }), null, "empty rows");
assert.equal(summarizeCymbalChanged({ results: { results: [{ symbol: 42 }] } }), null, "non-string symbol");

console.log("cymbal changed test ok: rows, cap, off-shape nulls");
