/**
 * Zoom math for derived diagrams, in pure numbers.
 *
 * The viewer draws the SVG itself (no library), so the zoom is a transform on
 * a canvas div: `translate(x, y) scale(s)` with `transform-origin: 0 0`. These
 * helpers compute the next view; the component reads the DOM rects and owns
 * the state. Same anchor math the upstream static renderer uses: the plain
 * wheel scrolls the page (never seized), Ctrl/Cmd+wheel zooms at the pointer,
 * and the point under the pointer stays fixed because the anchor is measured
 * in the canvas's own layout box — not in a transformed rect, which would
 * drift on the second zoom.
 */

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 8;
export const ZOOM_STEP = 1.2;
export const ZOOMED_SCALE = 1.01;

export function clampScale(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** The pointer in the canvas's own layout coordinates. All inputs are numbers. */
export function pointerInCanvas(rect, scroll, origin, clientX, clientY) {
  return {
    px: clientX - rect.left + scroll.left - origin.left,
    py: clientY - rect.top + scroll.top - origin.top,
  };
}

/**
 * The next view for a scale factor around a canvas-layout point. A factor
 * that changes nothing (already at a bound) returns the same view, so the
 * caller can skip a state update that would only re-render.
 */
export function zoomAtPoint(view, factor, point) {
  const scale = clampScale(view.scale * factor);
  if (scale === view.scale) return view;
  const ratio = scale / view.scale;
  return {
    scale,
    x: point.px - (point.px - view.x) * ratio,
    y: point.py - (point.py - view.y) * ratio,
  };
}

export function isZoomed(view) {
  return view != null && view.scale > ZOOMED_SCALE;
}
