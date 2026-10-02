import assert from "node:assert/strict";
import {
  addGapTotals,
  emptyGapTotals,
  escalationRate,
  formatGapTotals,
  formatRate,
} from "../lib/metrics-format.mjs";

// These numbers were shaped in five files and the escalation rate was derived
// twice, with two different guards. Nothing was individually wrong; the cost was
// that a fifth resolution type needed five edits and could disagree with four of
// them. This pins the one owner so the second copy cannot come back quietly.

const withGaps = { total: 10, fixed: 6, documented: 3, escalated: 1 };

// --- The tally folds, and an unparseable report contributes nothing. --------
// A report with no frontmatter is a report that skipped the format, and folding
// its zeros in would reward that.
{
  const target = emptyGapTotals();
  addGapTotals(target, { found: true, ...withGaps });
  assert.deepEqual(target, withGaps, "a parsed summary folds into the accumulator");
  addGapTotals(target, { found: false, total: 0, fixed: 0, documented: 0, escalated: 0 });
  assert.deepEqual(target, withGaps, "a report with no registry is not a clean review");
  addGapTotals(target, null);
  assert.deepEqual(target, withGaps, "and a missing summary is not either");
}

// --- The rate is null when nothing was found, not zero. ---------------------
// A card with no gaps has no escalation rate. Printing 0% claims a measurement
// that was never taken, and the two surfaces disagreed about it before this.
{
  assert.equal(escalationRate(withGaps), 0.1);
  assert.equal(escalationRate({ total: 0, fixed: 0, documented: 0, escalated: 0 }), null);
  assert.equal(formatRate(escalationRate(withGaps)), "10%");
  assert.equal(formatRate(escalationRate({ total: 0, fixed: 0, documented: 0, escalated: 0 })), "n/a");
}

// --- A partial shape from an older payload must not produce NaN. ------------
{
  assert.equal(escalationRate({ total: 4, escalated: 1 }), 0.25, "missing fields read as zero");
  assert.equal(escalationRate(null), null, "a missing tally has no rate");
  assert.equal(escalationRate(undefined), null);
  assert.equal(formatRate(Number.NaN), "n/a", "a NaN is never printed as a percentage");
  assert.equal(formatRate(undefined), "n/a");
  assert.equal(formatRate(0), "0%", "a real zero is a measurement, and says so");
}

// --- One line, one wording. -------------------------------------------------
{
  const line = formatGapTotals(withGaps);
  assert.equal(
    line,
    "Gaps: 10 total · 6 fixed · 3 documented · 1 escalated (10% escalated)",
    "the fleet and the card print the same sentence for the same numbers",
  );
  assert.match(formatGapTotals({ total: 0, fixed: 0, documented: 0, escalated: 0 }), /\(n\/a escalated\)/,
    "a card with no gaps says n/a rather than 0%");
}

// --- The empty tally is one owner, so a new field is added once. ------------
{
  const empty = emptyGapTotals();
  assert.deepEqual(empty, { total: 0, fixed: 0, documented: 0, escalated: 0 });
  // Two calls must not share a reference: callers fold into this in place.
  const other = emptyGapTotals();
  other.total += 1;
  assert.equal(empty.total, 0, "two accumulators are independent, not one shared literal");
}

console.log("metrics format ok: one owner for the tally, the rate, and the wording");
