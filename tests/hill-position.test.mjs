import assert from "node:assert/strict";
import { hillFraction, hillLane, hillPoint, hillRegion, HILL_LANES } from "../lib/hill-position.mjs";

// Finest signal wins: tasks over scopes over stage checkpoint. A card that
// reports nothing sits at the far left; a completed one at the far right.
assert.equal(hillFraction({ status: "doing", scopeSummary: { tasksTotal: 10, tasksDone: 3, scopesTotal: 4, scopesDone: 4 } }), 0.3, "tasks outrank scopes");
assert.equal(hillFraction({ status: "doing", scopeSummary: { tasksTotal: 0, tasksDone: 0, scopesTotal: 4, scopesDone: 1 } }), 0.25, "scopes cover taskless cards");
assert.equal(hillFraction({ status: "completed", scopeSummary: { tasksTotal: 10, tasksDone: 2 } }), 1, "completed pins the right edge");
assert.equal(hillFraction({ status: "doing", stage: "triage", scopeSummary: { tasksTotal: 0, tasksDone: 0, scopesTotal: 0, scopesDone: 0 } }), 0, "the first checkpoint sits at the left edge");
assert.equal(hillFraction({ status: "doing", stage: "audit", scopeSummary: null }), 1, "the last checkpoint sits at the right edge");
assert.equal(hillFraction({ status: "doing", stage: "nope", scopeSummary: null }), 0, "unknown stages degrade to the left, never NaN");
assert.equal(hillFraction(null), 0, "junk degrades to the left, never throws");
assert.equal(hillFraction({ status: "doing", scopeSummary: { tasksTotal: 10, tasksDone: 99 } }), 1, "overcomplete clamps instead of leaving the hill");

// Lanes are deterministic per card: same id, same lane, every render —
// dots never jump, collisions stack.
assert.equal(hillLane("card_a"), hillLane("card_a"), "lanes are stable across calls");
assert.ok(hillLane("card_a", HILL_LANES) >= 0 && hillLane("card_a", HILL_LANES) < HILL_LANES, "lanes stay inside the lane count");
assert.notDeepEqual(
  [hillLane("card_a"), hillLane("card_b"), hillLane("card_c"), hillLane("card_d"), hillLane("card_e")],
  [0, 0, 0, 0, 0],
  "distinct cards spread across lanes instead of piling on one",
);

// The peak already reads as execution starting: half is downhill.
assert.equal(hillRegion(0.49), "uphill", "left of the peak is figuring out");
assert.equal(hillRegion(0.5), "downhill", "the peak executes");
assert.equal(hillRegion(0.9), "downhill", "right of the peak executes");

// One call carries the whole dot: position, curve height, lane, region.
const point = hillPoint({ id: "card_a", status: "doing", stage: "shape", scopeSummary: { tasksTotal: 4, tasksDone: 1 } });
assert.equal(point.x, 0.25, "point reuses the finest fraction");
assert.ok(point.y > 0 && point.y <= 1, "curve height stays on the hill");
assert.equal(point.lane, hillLane("card_a"), "point lane matches the lane function");
assert.equal(point.region, "uphill", "point names its half");

console.log("hill position test ok: finest-signal fractions, stable lanes, peak halves");
