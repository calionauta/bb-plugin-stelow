/**
 * Zoom math for derived diagrams, asked of the numbers rather than the tree.
 *
 * `lib/diagram-zoom.mjs` is pure (zero deps), so every branch is callable
 * here with plain asserts: the clamp bounds, the anchor-fixed zoom, the
 * at-bound identity, the zoomed predicate, and the pointer arithmetic. A
 * component test that only ever sees the pre-render state cannot cover any
 * of this, and a source grep on the formulas would pass on a sign error —
 * only the computed values fail closed.
 */
import assert from "node:assert/strict";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOMED_SCALE,
  clampScale,
  isZoomed,
  pointerInCanvas,
  zoomAtPoint,
} from "../lib/diagram-zoom.mjs";

// The clamp holds both rails and passes the middle through untouched.
assert.equal(clampScale(ZOOM_MIN - 0.1), ZOOM_MIN, "below the minimum clamps up to ZOOM_MIN");
assert.equal(clampScale(0.1), ZOOM_MIN, "a small positive scale still clamps to ZOOM_MIN");
assert.equal(clampScale(ZOOM_MAX + 5), ZOOM_MAX, "above the maximum clamps down to ZOOM_MAX");
assert.equal(clampScale(2.5), 2.5, "an in-range scale passes through untouched");
assert.equal(clampScale(ZOOM_MIN), ZOOM_MIN, "the minimum itself is identity");
assert.equal(clampScale(ZOOM_MAX), ZOOM_MAX, "the maximum itself is identity");

// Junk never escapes as a scale: the transform stays readable, never NaN.
assert.equal(clampScale(NaN), 1, "NaN falls back to 1");
assert.equal(clampScale("2"), 1, "a numeric string is not a number, so it falls back to 1");
assert.equal(clampScale(undefined), 1, "undefined falls back to 1");
assert.equal(clampScale(null), 1, "null falls back to 1");
assert.equal(clampScale(Infinity), ZOOM_MAX, "Infinity clamps to the maximum, not through it");

// Zooming x2 around the point keeps that point fixed: the view moves to it.
// x' = px - (px - x) * (s'/s): 100 - (100 - 0) * 2 = -100, 50 - (50 - 0) * 2 = -50.
const doubled = zoomAtPoint({ scale: 1, x: 0, y: 0 }, 2, { px: 100, py: 50 });
assert.deepEqual(doubled, { scale: 2, x: -100, y: -50 }, "x2 around (100,50) lands the view at (-100,-50)");

// The same anchor rule away from the origin: s'/s = 3/2,
// x' = 40 - (40 - 10) * 1.5 = -5, y' = 60 - (60 + 20) * 1.5 = -60.
const shifted = zoomAtPoint({ scale: 2, x: 10, y: -20 }, 1.5, { px: 40, py: 60 });
assert.deepEqual(shifted, { scale: 3, x: -5, y: -60 }, "the anchor formula holds off-origin too");

// Zooming back out returns to the start: the anchor math is invertible.
const back = zoomAtPoint(doubled, 0.5, { px: 100, py: 50 });
assert.deepEqual(back, { scale: 1, x: 0, y: 0 }, "x0.5 around the same point undoes the x2");

// A factor that changes nothing returns the SAME view: the caller skips a
// state update that would only re-render, so identity (not equality) is the pin.
const atMax = { scale: ZOOM_MAX, x: 5, y: 5 };
assert.ok(zoomAtPoint(atMax, 2, { px: 0, py: 0 }) === atMax, "zooming in at the maximum returns the same object");
const atMin = { scale: ZOOM_MIN, x: 5, y: 5 };
assert.ok(zoomAtPoint(atMin, 0.5, { px: 0, py: 0 }) === atMin, "zooming out at the minimum returns the same object");
const still = { scale: 1, x: 7, y: -3 };
assert.ok(zoomAtPoint(still, 1, { px: 9, py: 9 }) === still, "a factor of 1 returns the same object");

// The zoomed predicate draws the line just above 1: resting state never pans.
assert.equal(isZoomed({ scale: 1, x: 0, y: 0 }), false, "1.0 is not zoomed");
assert.equal(isZoomed({ scale: ZOOMED_SCALE, x: 0, y: 0 }), false, "exactly the threshold is not zoomed");
assert.equal(isZoomed({ scale: 1.5, x: 0, y: 0 }), true, "above the threshold is zoomed");
assert.equal(isZoomed(null), false, "a null view is not zoomed");
assert.equal(isZoomed(undefined), false, "a missing view is not zoomed");
assert.equal(isZoomed({}), false, "a view without a scale is not zoomed");

// Pointer arithmetic, hand-computed: the client point minus the rect, plus
// the scroll, minus the origin — px = 100 - 10 + 5 - 2 = 93, py = 200 - 20 + 7 - 3 = 184.
assert.deepEqual(
  pointerInCanvas({ left: 10, top: 20 }, { left: 5, top: 7 }, { left: 2, top: 3 }, 100, 200),
  { px: 93, py: 184 },
  "the pointer resolves into the canvas layout box",
);

console.log("diagram zoom ok: clamp rails, anchor-fixed zoom, at-bound identity, zoomed predicate, pointer arithmetic");
