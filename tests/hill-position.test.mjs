import assert from "node:assert/strict";
import { hillFraction, hillRegion, hillPoint, hillCurveY, hillCurvePoints, hillDotPercent, hillSvgY, clusterHillDots, HILL_CLUSTER_BUCKET } from "../lib/hill-position.mjs";

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
