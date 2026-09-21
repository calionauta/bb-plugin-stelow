import assert from "node:assert/strict";
import { hillFraction, hillRegion, hillPoint, hillCurveY, hillCurvePoints, hillDotPercent, hillSvgY, clusterHillDots, hillTally, isOnHill, HILL_CLUSTER_BUCKET } from "../lib/hill-position.mjs";

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

// The peak already reads as execution starting: half is downhill.
assert.equal(hillRegion(0.49), "uphill", "left of the peak is figuring out");
assert.equal(hillRegion(0.5), "downhill", "the peak executes");
assert.equal(hillRegion(0.9), "downhill", "right of the peak executes");

// Archived cards left the board and the workflow, so they must not sit on
// the hill at all: with no rule they fell through the fraction math and
// inherited a position from their old stage, so an archived-at-triage card
// read as "figuring out" and an archived-at-audit card as "executing".
// Blocked cards stay — stuck work is still work, and its color says so.
assert.equal(isOnHill({ status: "archived" }), false, "an archived card is not on the hill");
assert.equal(isOnHill({ status: "completed" }), true, "a done card still lands at the right edge");
assert.equal(isOnHill({ status: "blocked" }), true, "stuck work is still work");
assert.equal(isOnHill({ status: "doing" }), true, "in-flight work is on the hill");
assert.equal(isOnHill(null), false, "junk is never plotted");

// The status line may never claim execution for a card that landed. This is
// the board that reported "21 cards on the hill — 12 figuring out, 9
// executing" with nothing running: 16 archived cards (10 archived at early
// stages, 6 at late ones), 3 done, 2 unstarted drafts.
const reported = [
  ...Array.from({ length: 7 }, () => ({ status: "archived", stage: "triage", scopeSummary: null })),
  ...Array.from({ length: 2 }, () => ({ status: "archived", stage: "context", scopeSummary: null })),
  { status: "archived", stage: "select", scopeSummary: null },
  ...Array.from({ length: 2 }, () => ({ status: "archived", stage: "planning", scopeSummary: null })),
  { status: "archived", stage: "plan-gate", scopeSummary: null },
  ...Array.from({ length: 3 }, () => ({ status: "archived", stage: "audit", scopeSummary: null })),
  ...Array.from({ length: 3 }, () => ({ status: "completed", stage: "audit", scopeSummary: { tasksTotal: 0, tasksDone: 0, scopesTotal: 0, scopesDone: 0 } })),
  ...Array.from({ length: 2 }, () => ({ status: "draft", stage: "triage", scopeSummary: { tasksTotal: 0, tasksDone: 0, scopesTotal: 0, scopesDone: 0 } })),
];
assert.equal(reported.length, 21, "the reported board had 21 cards in the grouping");
assert.deepEqual(hillTally(reported), { onHill: 5, uphill: 2, executing: 0, done: 3, archived: 16 }, "archived cards are off the hill and done cards are never counted as executing");
assert.deepEqual(hillTally(null), { onHill: 0, uphill: 0, executing: 0, done: 0, archived: 0 }, "junk tallies to nothing, never throws");

// One formula for line and dots: the curve is the sine, sampled densely;
// dots use the same y, so nothing floats off the hill.
assert.equal(hillCurveY(0), 0, "the curve starts at the ground");
assert.ok(Math.abs(hillCurveY(1)) < 1e-9, "the curve lands at the ground");
assert.ok(Math.abs(hillCurveY(0.5) - 1) < 1e-9, "the peak is exactly mid-hill");
const curve = hillCurvePoints(5);
assert.deepEqual(curve.map((entry) => entry.x), [0, 0.25, 0.5, 0.75, 1], "samples span the whole hill");
assert.ok(curve[1].y < curve[2].y && curve[3].y < curve[2].y, "the curve rises then falls");
const dot = hillPoint({ id: "card_a", status: "doing", stage: "shape", scopeSummary: { tasksTotal: 4, tasksDone: 1 } });
assert.equal(dot.y, hillCurveY(dot.x), "a dot's height is the curve's height at its x");
assert.equal(dot.region, "uphill", "point names its half");

// Clustering never moves x: dots within one bucket share a pill anchored
// at the leftmost (least complete) member, so a pill never reads ahead.
// Order is stable — same input, same clusters, every render.
const items = [
  { card: { id: "c" }, point: { x: 0.52 } },
  { card: { id: "a" }, point: { x: 0.1 } },
  { card: { id: "b" }, point: { x: 0.12 } },
  { card: { id: "d" }, point: { x: 0.9 } },
];
const clusters = clusterHillDots(items, HILL_CLUSTER_BUCKET);
assert.deepEqual(clusters.map((entry) => entry.cards.map((card) => card.id)), [["a", "b"], ["c"], ["d"]], "nearby dots cluster, distant ones stand alone");
assert.equal(clusters[0].x, 0.1, "a cluster anchors at its leftmost member");
assert.deepEqual(clusterHillDots([{ card: { id: "a" }, point: { x: 0.3 } }]), [{ x: 0.3, cards: [{ id: "a" }] }], "a lone dot is a cluster of one");
assert.deepEqual(clusterHillDots(null), [], "junk clusters to nothing, never throws");

// Plot geometry is one shared math: dots and the SVG path read the same
// base/span/margin, so the line can never drift from the dots.
assert.deepEqual(hillDotPercent({ x: 0, y: 0 }), { left: 2, bottom: 10 }, "origin maps to the margins");
assert.deepEqual(hillDotPercent({ x: 1, y: 1 }), { left: 98, bottom: 72 }, "peak maps inside the frame");
assert.equal(hillSvgY(10, 40), 36, "plot percent converts to viewBox units");
assert.ok(Math.abs(hillSvgY(hillDotPercent({ x: 0.5, y: hillCurveY(0.5) }).bottom, 40) - (36 - hillCurveY(0.5) * 24.8)) < 1e-9, "path height and dot height agree");

console.log("hill position test ok: finest-signal fractions, shared curve, honest clusters");
