/**
 * Hill-chart positioning (pure, no SDK).
 *
 * A card's horizontal position answers "where in the work is this" from
 * data the board already carries — never a new fetch. Finest signal wins:
 * task fraction, then scope fraction, then the stage checkpoint index;
 * completed cards sit at the far right, unstarted ones at the far left.
 *
 * Honesty rule: x is exact and never jittered — a card must never read
 * ahead of another it trails. Crowding resolves vertically (stacks) and
 * by clustering (count pills), never by nudging x.
 *
 * The drawn curve and the dots share one formula: hillCurvePoints feeds
 * the SVG path, hillFraction feeds the dots, so dots always sit ON the
 * line — never floating above or below it.
 */
import { STAGE_SEQUENCE } from "./workflow-vocabulary.mjs";

export const HILL_CLUSTER_BUCKET = 0.04;

// Plot geometry shared by the SVG curve and the dots: dot bottom% is
// base + curveY * span, the path maps the same percents into viewBox
// units. One set of numbers — the line and the dots cannot drift apart.
export const HILL_PLOT = { base: 10, span: 62, margin: 2 };

export function hillDotPercent(point) {
  const x = clamp01(point?.x ?? 0);
  const y = clamp01(point?.y ?? 0);
  return {
    left: HILL_PLOT.margin + x * (100 - HILL_PLOT.margin * 2),
    bottom: HILL_PLOT.base + y * HILL_PLOT.span,
  };
}

export function hillSvgY(percentBottom, viewHeight = 40) {
  const height = typeof viewHeight === "number" && viewHeight > 0 ? viewHeight : 40;
  return height - (percentBottom / 100) * height;
}

function clamp01(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function hillFraction(card) {
  if (!card || typeof card !== "object") return 0;
  if (card.status === "completed") return 1;
  const summary = card.scopeSummary && typeof card.scopeSummary === "object" ? card.scopeSummary : {};
  const tasksTotal = Number(summary.tasksTotal) || 0;
  const tasksDone = Number(summary.tasksDone) || 0;
  if (tasksTotal > 0) return clamp01(tasksDone / tasksTotal);
  const scopesTotal = Number(summary.scopesTotal) || 0;
  const scopesDone = Number(summary.scopesDone) || 0;
  if (scopesTotal > 0) return clamp01(scopesDone / scopesTotal);
  const at = STAGE_SEQUENCE.indexOf(card.stage);
  if (at >= 0 && STAGE_SEQUENCE.length > 1) return clamp01(at / (STAGE_SEQUENCE.length - 1));
  return 0;
}

// Shape Up halves: still figuring the work out vs executing known work.
// The peak (exactly half) already reads as execution starting.
export function hillRegion(fraction) {
  return fraction < 0.5 ? "uphill" : "downhill";
}

/**
 * Is this card still work, and therefore on the hill?
 *
 * Archived cards left the board and the workflow. Without an explicit rule
 * they fell through the fraction math and got an invented position from
 * whatever stage they were archived at — so an archived card staged at
 * triage/context/select read as "figuring out" and one archived at
 * planning/plan-gate/audit read as "executing". That is a label with no
 * work behind it. Blocked cards stay: stuck work is still work, and its
 * color already says it needs a human.
 */
export function isOnHill(card) {
  return Boolean(card) && card.status !== "archived";
}

/**
 * Counting rule for the hill's status line (pure).
 *
 * The line answers "where is the work", so it must never claim execution
 * for a card that has landed: Done cards are their own count (position
 * already says they reached the right edge), archived cards are off the
 * hill, and only cards still in the workflow split across the two halves.
 * Counting `completed` inside the halves is what produced "9 executing" on
 * a board where nothing was running.
 */
export function hillTally(cards) {
  const list = Array.isArray(cards) ? cards : [];
  let uphill = 0;
  let executing = 0;
  let done = 0;
  let archived = 0;
  for (const card of list) {
    if (!isOnHill(card)) { archived += 1; continue; }
    if (card.status === "completed") { done += 1; continue; }
    if (hillRegion(hillFraction(card)) === "uphill") uphill += 1;
    else executing += 1;
  }
  return { onHill: uphill + executing + done, uphill, executing, done, archived };
}

export function hillPoint(card) {
  const x = hillFraction(card);
  return {
    x,
    y: hillCurveY(x),
    region: hillRegion(x),
  };
}

// The single source of the curve: the view draws hillCurvePoints as its
// SVG path and places dots with hillFraction through the same y, so line
// and dots cannot drift apart (the classic "dots floating off the hill"
// bug is a second formula, never bad data).
export function hillCurveY(x) {
  return Math.sin(Math.PI * clamp01(x));
}

export function hillCurvePoints(samples = 41) {
  const total = Number.isInteger(samples) && samples > 1 ? samples : 41;
  const points = [];
  for (let index = 0; index < total; index++) {
    const x = index / (total - 1);
    points.push({ x, y: hillCurveY(x) });
  }
  return points;
}

// Cluster dots whose x falls in one bucket (insertion order stable:
// sorted by x, so the pill anchors at the leftmost — least complete —
// card and never reads ahead of its members).
export function clusterHillDots(items, bucket = HILL_CLUSTER_BUCKET) {
  const width = typeof bucket === "number" && bucket > 0 ? bucket : HILL_CLUSTER_BUCKET;
  const sorted = [...(items ?? [])].sort((a, b) => a.point.x - b.point.x);
  const clusters = [];
  for (const item of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && item.point.x - last.x <= width) last.cards.push(item.card);
    else clusters.push({ x: item.point.x, cards: [item.card] });
  }
  return clusters;
}
