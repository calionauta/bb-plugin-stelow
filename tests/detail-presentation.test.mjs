import assert from "node:assert/strict";
import { idleDurationLabel, joinStrategyLabels, liveBorderClass, statusTone } from "../lib/detail-presentation.mjs";

const labels = new Map([["jtbd", "JTBD"], ["opportunity", "Opportunity Mapping"]]);
assert.equal(joinStrategyLabels(["jtbd", "opportunity"], labels), "JTBD + Opportunity Mapping", "strategy labels preserve run order");
assert.equal(joinStrategyLabels(["jtbd", "jtbd", null], labels), "JTBD", "duplicate and missing strategies never repeat");
assert.equal(joinStrategyLabels(["unknown"], labels), "unknown", "an unmapped strategy keeps its raw id while the catalog loads");
assert.equal(joinStrategyLabels([], labels), null, "no strategies means no label");

assert.equal(statusTone("done"), statusTone("completed"), "terminal aliases share one tone");
assert.equal(statusTone("failed"), "bg-destructive/15 text-destructive", "failure is destructive");
assert.equal(statusTone("unknown"), "bg-muted text-muted-foreground", "unknown status fails soft to neutral");

assert.equal(liveBorderClass({ activity: "running", needsAttention: false }), "stelow-border-running", "running has live motion");
assert.equal(liveBorderClass({ activity: "idle", needsAttention: true }), "stelow-border-attention", "attention wins over ordinary idle");
assert.equal(liveBorderClass({ activity: "idle", needsAttention: false }), "", "settled cards have no transient border");

// --- how long a card has been waiting ---------------------------------------
// A compact duration, never a locale timestamp: the tile row is one line of a
// 176px content box, and `10/19/2026, 3:01:31 AM` does not fit it, does not
// shrink, and took the project name out of the card with it.
const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const idle = (extra) => ({ activity: "idle", needsAttention: true, updatedAt: NOW - HOUR, ...extra });

assert.equal(idleDurationLabel(idle({ lastIdleAt: NOW - 2 * 24 * HOUR - 4 * HOUR }), NOW), "2d 4h",
  "the wait reads as two units, which is what the row has space for");
assert.equal(idleDurationLabel(idle({ lastIdleAt: NOW - 45_000 }), NOW), "45s", "seconds are a duration too");

// The measurement is the STALL's clock. Reading `updatedAt` reports a two-day
// stall as freshly idle on the next sync poll, because a poll rewrites the row
// without the card having moved — a card that looks like it just stopped is a
// card nobody goes to look at.
assert.equal(
  idleDurationLabel({ activity: "idle", needsAttention: true, lastIdleAt: NOW - 2 * 24 * HOUR, updatedAt: NOW }, NOW),
  "2d",
  "the wait is measured from lastIdleAt, not from the row's write time",
);
assert.equal(
  idleDurationLabel(idle({ lastIdleAt: 0 }), NOW),
  "1h",
  "a zero idle stamp falls back to updatedAt rather than reading as 56 years",
);
assert.equal(
  idleDurationLabel(idle({ lastIdleAt: NOW + HOUR }), NOW),
  "0s",
  "a future stamp clamps to zero instead of printing a negative duration",
);

// Not idle, not waiting: no duration at all. A settled card shows no clock, and
// neither does a stall whose chip is not on the surface.
for (const activity of ["running", "awaiting-answer", "error", "held"]) {
  assert.equal(idleDurationLabel({ activity, needsAttention: true, lastIdleAt: NOW, updatedAt: NOW }, NOW), null,
    `a ${activity} card has no idle wait to report`);
}
assert.equal(idleDurationLabel({ activity: "idle", needsAttention: false, lastIdleAt: NOW - HOUR, updatedAt: NOW }, NOW), "1h",
  "an idle-but-settled card still has a clock; whether the tile renders it is the chip's decision, not this one's");
assert.equal(idleDurationLabel({ activity: "idle" }, NOW), null,
  "a card with no timestamp at all reports nothing rather than NaN");

console.log("detail presentation test ok: strategy labels, status tones, live borders, and the idle clock");
