import assert from "node:assert/strict";
import { excerptFact, excerptMetricLine, summarizeExcerpts } from "../lib/review-truncation.mjs";

// §6 asks the metric to count reviewer truncations. Without this, a contract
// whose sections never fit the cap is a per-review note nobody aggregates, and
// the fleet-level problem stays invisible. These pin the counts and, more
// importantly, the distinction that makes the count actionable: a cut to the
// contract's sections and a cut to the document's opening are different
// failures, and only the second one may have hidden a required section.

const whole = { excerpt: { selected: "whole", truncated: false, sentChars: 800, originalChars: 800 } };
const cut = { excerpt: { selected: "contract", truncated: true, sentChars: 11000, originalChars: 40000 } };
const head = { excerpt: { selected: "head", truncated: true, sentChars: 12000, originalChars: 60000 } };

// --- The counts the operator acts on. ---------------------------------------
const fleet = summarizeExcerpts([whole, cut, head, whole]);
assert.equal(fleet.counted, 4, "every record that carried an excerpt is counted");
assert.equal(fleet.truncated, 2, "two of the four reviews read a cut artifact");
assert.equal(fleet.headCuts, 1, "exactly one fell back to the document's opening");
assert.deepEqual(fleet.byMode, { whole: 2, contract: 1, head: 1 }, "counts break down by how the cut was made");

// A head cut is the one that can have hidden the contract's section, so it is
// counted separately rather than being averaged into `truncated`.
const contractsOnly = summarizeExcerpts([cut, cut]);
assert.equal(contractsOnly.truncated, 2);
assert.equal(contractsOnly.headCuts, 0, "a contract cut is not a head cut");
assert.match(excerptMetricLine(contractsOnly), /all cuts kept the contract's sections/,
  "the reassuring reading must not be conflated with the worrying one");

// --- A bare excerpt report is accepted without reshaping. --------------------
assert.deepEqual(excerptFact(cut.excerpt), excerptFact(cut), "the record wrapper is optional");

// --- Silence is the honest output when nothing was cut. ---------------------
assert.equal(excerptMetricLine(summarizeExcerpts([whole, whole])), "", "a fleet that never truncated says nothing");
assert.equal(excerptMetricLine(summarizeExcerpts([])), "", "no reviews is not a metric");

// --- A review predating the field is uncounted, never counted as a cut. -------
// The absence of evidence is not evidence of a truncation: reporting an old
// review as a cut would invent a problem that never happened.
const legacy = summarizeExcerpts([{ excerpt: null }, {}, null, undefined, "nonsense"]);
assert.equal(legacy.counted, 0, "records with no excerpt are not counted");
assert.equal(legacy.truncated, 0, "and never counted as truncations");
assert.equal(excerptMetricLine(legacy), "", "so the metric stays silent rather than guessing");

// A record whose mode is not one of the three is unreadable, not a head cut.
assert.equal(excerptFact({ excerpt: { selected: "vibes", truncated: true } }), null, "an unknown mode is uncounted");
assert.equal(excerptFact({ excerpt: { selected: "whole" } }), null, "a record with no truncated flag is uncounted");
assert.equal(excerptFact({ excerpt: { selected: "head", truncated: "yes" } }), null, "a non-boolean flag is uncounted");

// --- Degenerate input never throws. -----------------------------------------
for (const value of [null, undefined, 0, "", [], 42, {}]) {
  assert.doesNotThrow(() => summarizeExcerpts(value), `summarizeExcerpts survives ${JSON.stringify(value)}`);
}
assert.equal(summarizeExcerpts(null).counted, 0);

// --- The line names both numbers, so a count cannot be read as a rate. -------
const line = excerptMetricLine(fleet);
assert.match(line, /^Reviewer coverage: /, "the line is labelled, so it cannot be mistaken for a wait number");
assert.match(line, /2 of 4 reviews read a cut artifact/, "both the count and the denominator are present");
assert.match(line, /1 read only the opening/, "the head cuts are named separately");

console.log("review truncation metric ok: a contract cut and an opening cut are counted as the different failures they are");
