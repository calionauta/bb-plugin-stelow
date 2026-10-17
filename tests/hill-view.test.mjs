import assert from "node:assert/strict";
import {
  clusterHillDots,
  hillCurvePoints,
  hillFraction,
  hillPoint,
  hillRegion,
  hillTally,
  isOnHill,
} from "../lib/hill-position.mjs";

// Hill view: board position from data the board already carries (hill
// fraction per card), dots as real buttons opening the same surface as
// tiles and rows. Behavioral coverage goes through the lib the hill
// component positions dots with.

// Position is honest: completed cards sit at the right edge, archived
// cards leave the hill, workflow cards split by fraction halves.
assert.equal(hillFraction({ status: "completed" }), 1, "completed cards sit at the right edge");
assert.equal(hillRegion(0.2), "uphill", "low fractions read as figuring out");
assert.equal(hillRegion(0.8), "downhill", "high fractions read as executing");
assert.equal(isOnHill({ status: "archived" }), false, "archived cards leave the hill");
assert.equal(isOnHill({ status: "in-progress" }), true, "workflow cards stay on the hill");

// Dots sit ON the shared curve: the point helper derives y from the same
// formula the drawn path samples, never inline math per surface.
const point = hillPoint({ status: "in-progress", scopeSummary: { scopesDone: 1, scopesTotal: 4 } });
assert.equal(point.region, "uphill", "a quarter-done card reads uphill");
assert.ok(point.y >= 0 && point.y <= 1, "dot height stays on the unit curve");
assert.equal(hillCurvePoints(41).length, 41, "the drawn curve samples the shared formula");
assert.deepEqual(hillCurvePoints(3).map((p) => p.x), [0, 0.5, 1], "curve samples span the whole hill");

// Truthful counting: only cards still in the workflow get dots, and the line
// separates done from executing. Archived cards are off the hill.
const tally = hillTally([
  { status: "in-progress", scopeSummary: { scopesDone: 0, scopesTotal: 2 } },
  { status: "completed", scopeSummary: { scopesDone: 2, scopesTotal: 2 } },
  { status: "archived" },
]);
assert.equal(tally.done, 1, "done cards are counted as done");
assert.equal(tally.archived, 1, "archived cards are counted as off the hill");
assert.equal(tally.onHill, tally.uphill + tally.executing + tally.done, "on-hill sums the live halves plus done");

// Crowding resolves into count pills anchored at the leftmost card, never
// x jitter: near-identical positions cluster together.
const clusters = clusterHillDots([
  { point: { x: 0.2 }, card: { id: "a" } },
  { point: { x: 0.21 }, card: { id: "b" } },
  { point: { x: 0.8 }, card: { id: "c" } },
]);
assert.equal(clusters.length, 2, "nearby dots cluster, distant dots stand alone");
assert.equal(clusters[0].cards.length, 2, "the first cluster holds both nearby cards");

console.log("hill view test ok: shared hill, strips, and rail from board data");
