/**
 * Hill-chart positioning (pure, no SDK).
 *
 * A card's horizontal position answers "where in the work is this" from
 * data the board already carries — never a new fetch. Finest signal wins:
 * task fraction, then scope fraction, then the stage checkpoint index;
 * completed cards sit at the far right, unstarted ones at the far left.
 * The vertical lane is a deterministic hash of the card id, so dots never
 * jump between renders; collisions stack instead of overlapping.
 */
import { STAGE_SEQUENCE } from "./workflow-vocabulary.mjs";

export const HILL_LANES = 4;

function clamp01(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function hashString(text) {
  let hash = 5381;
  const input = typeof text === "string" ? text : "";
  for (let index = 0; index < input.length; index++) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) >>> 0;
  }
  return hash;
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

export function hillLane(key, lanes = HILL_LANES) {
  const total = Number.isInteger(lanes) && lanes > 0 ? lanes : HILL_LANES;
  return hashString(key) % total;
}

export function hillPoint(card) {
  const x = hillFraction(card);
  return {
    x,
    y: Math.sin(Math.PI * x),
    lane: hillLane(card && typeof card === "object" ? card.id : ""),
    region: hillRegion(x),
  };
}
