import assert from "node:assert/strict";
import { reworkMetricLine, summarizeRework } from "../lib/rework-metrics.mjs";

// Rework is the question the gap tally cannot answer: a second review finds the
// same thing again, so the fix did not hold. It was unmeasurable because the
// round boundary was lost before anything read it. These pin the definition,
// and more importantly pin the three things that must NOT count as rework —
// those are the cases that would turn the number into something a team games.

const gaps = (...rows) => rows.map(([description, resolution]) => ({ description, resolution }));

// --- The signal itself. -----------------------------------------------------
{
  const summary = summarizeRework([
    gaps(["Login retries on 5xx", "fixed"], ["Cache stampede", "documented"]),
    gaps(["Login retries on 5xx", "escalate"]), // re-opened after a fix
  ]);
  assert.equal(summary.rounds, 2, "two critique rounds are two rounds");
  assert.equal(summary.reworked, 1, "the finding that was fixed and returned is rework");
  assert.deepEqual(
    summary.reworkedDescriptions,
    ["Login retries on 5xx"],
    "and it is named, because a rate nobody can trace is a rate nobody trusts",
  );
  assert.equal(summary.rate, 1, "one reworked finding out of one comparable pass");
}

// --- A gap still open is NOT rework. ----------------------------------------
// It was never closed, so nothing was reworked. Counting it would punish a loop
// that is correctly waiting on a human decision.
{
  const summary = summarizeRework([
    gaps(["Waiting on infra ticket", "escalate"]),
    gaps(["Waiting on infra ticket", "escalate"]),
  ]);
  assert.equal(summary.reworked, 0, "an unclosed gap repeated is not rework");
  assert.equal(summary.rate, 0, "it is zero rework, not an absent measurement");
}

// --- A finding new in round 2 is not rework either. -------------------------
// "Known issue" appears in both rounds, so it IS reworked by the definition
// above; this case isolates the new finding, which is counted apart from it.
{
  const summary = summarizeRework([
    gaps(["A", "fixed"]),
    gaps(["A", "fixed"], ["Brand new flaw", "escalate"]),
  ]);
  assert.equal(summary.newAfterFirst, 1, "work discovered later is counted as the different number it is");
  assert.deepEqual(
    summary.reworkedDescriptions,
    ["A"],
    "and it is never mixed into the rework set, which would let new work inflate the rate",
  );
}

// --- Closed in round 2, re-opened in round 4, is rework of that fix. ---------
{
  const summary = summarizeRework([
    gaps(["A", "fixed"]),
    gaps(["B", "fixed"]),
    gaps(["C", "fixed"]),
    gaps(["B", "escalate"]),
  ]);
  assert.equal(summary.reworked, 1, "a fix that held two rounds and then failed is still rework");
  assert.equal(summary.comparable, 3, "every round after the first is comparable");
  assert.equal(summary.rate, 1 / 3, "the rate is per pass, so a longer loop is a smaller share");
}

// --- One round cannot tell you anything. ------------------------------------
{
  const summary = summarizeRework([gaps(["A", "fixed"])]);
  assert.equal(summary.rounds, 1);
  assert.equal(summary.comparable, 0, "the first round is a baseline, not a sample");
  assert.equal(summary.rate, null, "a single review has no convergence to report");
  assert.equal(reworkMetricLine(summary), "", "and says nothing rather than reporting 0%");
}

// --- A clean loop is silent. ------------------------------------------------
{
  const summary = summarizeRework([
    gaps(["A", "fixed"]),
    gaps(["B", "fixed"]),
  ]);
  assert.equal(summary.reworked, 0);
  assert.equal(reworkMetricLine(summary), "", "a metric that is always on screen is noise");
}

// --- The regression that made this measurable at all. ----------------------
// Every finding closed in the round that closed it. An earlier version flagged a
// finding as reworked by the very round that fixed it, so a card that closed
// everything reported rework on the pass where it found nothing again -- the
// number moved the wrong way exactly when the loop was working.
{
  const summary = summarizeRework([
    gaps(["A", "fixed"]),
    gaps(["B", "fixed"]),
    gaps(["C", "documented"]),
  ]);
  assert.equal(summary.reworked, 0, "a finding is not reworked by the round that closed it");
  assert.deepEqual(summary.reworkedDescriptions, [], "and nothing is named that was never re-opened");
  assert.equal(summary.rate, 0, "a converging loop is zero rework, not absent rework");
}

// --- The registry spells a resolution two ways, and both mean one thing. -----
{
  const summary = summarizeRework([
    gaps(["A", "escalated"]), // worker wrote the past tense
    gaps(["A", "escalate"]),
  ]);
  assert.equal(summary.reworked, 0, "the spelling difference is not a resolution difference");
  const reopened = summarizeRework([
    gaps(["A", "fixed"]),
    gaps(["A", "escalated"]),
  ]);
  assert.equal(reopened.reworked, 1, "and a fixed-then-escalated pair is still rework");
}

// --- Matching is on the whole description, not a prefix. -------------------
// A near-match would make the rate unfalsifiable, so "the cache is stale" and
// "the cache is stale on cold start" are two findings.
{
  const summary = summarizeRework([
    gaps(["The cache is stale", "fixed"]),
    gaps(["The cache is stale on cold start", "escalate"]),
  ]);
  assert.equal(summary.reworked, 0, "a different sentence is a different finding");
}

// --- Whitespace is not a new finding: the registry is hand-written. ---------
{
  const summary = summarizeRework([
    gaps(["Login retries\n  on 5xx", "fixed"]),
    gaps(["Login retries on 5xx", "escalate"]),
  ]);
  assert.equal(summary.reworked, 1, "a re-wrapped line is the same finding");
}

// --- The line names the number and the denominator. -------------------------
{
  const line = reworkMetricLine(summarizeRework([
    gaps(["A", "fixed"]),
    gaps(["A", "escalate"]),
    gaps(["B", "fixed"]),
  ]));
  assert.match(line, /^Rework: /, "the line is labelled, so it cannot be read as a gap count");
  assert.match(line, /1 finding\(s\) re-opened after 3 reviews/, "both the count and the passes are present");
}

// --- Degenerate input never throws, and never invents. ----------------------
for (const value of [null, undefined, 0, "", {}, []]) {
  assert.doesNotThrow(() => summarizeRework(value), `survives ${JSON.stringify(value)}`);
}
const empty = summarizeRework(null);
assert.equal(empty.rounds, 0, "no rounds is a real answer");
assert.equal(empty.reworked, 0);
assert.equal(empty.rate, null, "and it is an absent rate, not a zero rate");

// A round with no gaps at all is a real round: it is how a fix looks when the
// critique stops finding anything.
{
  const summary = summarizeRework([gaps(["A", "fixed"]), []]);
  assert.equal(summary.rounds, 2, "an empty later round is still a pass");
  assert.equal(summary.reworked, 0, "and finding nothing is the loop converging");
}

// --- Oscillation: rework that will not converge. ------------------------------
// A finding closed and re-opened across 3+ rounds means the bar and the
// artifact disagree — another unsupervised round re-runs the disagreement,
// so the signal names a human, not a round budget.
{
  const summary = summarizeRework([
    gaps(["Flaky window", "fixed"]),
    gaps(["Flaky window", "escalate"]),
    gaps(["Flaky window", "fixed"]),
    gaps(["Flaky window", "escalate"]),
  ]);
  assert.deepEqual(summary.oscillatingDescriptions, ["Flaky window"], "closed and re-opened across 3+ rounds is oscillation");
  const line = reworkMetricLine(summary);
  assert.match(line, /Oscillation: /, "the line carries the oscillation sentence");
  assert.match(line, /Flaky window/, "naming the finding, so a reader can go look");
  assert.match(line, /needs a human/, "and naming the exit, which is not another round");
}

// --- Persistence is not oscillation. ------------------------------------------
// A never-closed escalation repeated across rounds waits on rework —
// correctly. Only reworked keys qualify.
{
  const summary = summarizeRework([
    gaps(["Waiting on infra ticket", "escalate"]),
    gaps(["Waiting on infra ticket", "escalate"]),
    gaps(["Waiting on infra ticket", "escalate"]),
  ]);
  assert.equal(summary.reworked, 0, "never closed, never rework");
  assert.deepEqual(summary.oscillatingDescriptions, [], "and never oscillation either");
  assert.doesNotMatch(reworkMetricLine(summary), /Oscillation/, "a waiting loop says nothing about oscillation");
}

// --- Two rounds cannot oscillate. ----------------------------------------------
{
  const summary = summarizeRework([
    gaps(["A", "fixed"]),
    gaps(["A", "escalate"]),
  ]);
  assert.equal(summary.reworked, 1, "one return is rework");
  assert.deepEqual(summary.oscillatingDescriptions, [], "but oscillation needs a third sighting");
}

console.log("rework metric ok: a fix that held is not rework, a fix that came back is");
