// Shared source-slice helper for the regex-pin tests.
//
// Several contract tests need "just the body of this handler" so an assertion
// cannot be satisfied by a match somewhere else in the file. Each test used
// to carry its own private copy, and the copies drifted (one bound to a local
// variable, one not). One helper, parameterized by its source text, keeps
// every pin honest about WHERE it matched.
import assert from "node:assert/strict";

/**
 * Slice `source` between two needles.
 *
 * `end` is searched from just after `start`, so a repeated needle cannot end
 * the slice at an earlier occurrence than the one intended.
 */
export function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `source contains ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `source contains ${end} after ${start}`);
  return source.slice(startIndex, endIndex);
}
