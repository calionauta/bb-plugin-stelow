/**
 * Lane-collision extraction for ripwire `--plan-lanes` JSON. Pure: parsed
 * JSON in, compact collision verdict out. Anything off-shape yields null.
 * Never throws. Counts stay exact from the numeric fields; only the detail
 * rows are capped.
 *
 * Expected shape (ripwire 0.6.x, JSON-native):
 *   { lanes: [{ id, task, ... }], pairs: [{ a, b, conflicts[],
 *     conflict_count, same_file_risk[], risk_count, contract_touch[],
 *     touch_count }], landing_order[], warnings[] }
 */

export const MAX_LANE_ROWS = 20;
export const MAX_LANE_WARNINGS = 10;

function num(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function str(value) {
  return typeof value === "string" ? value : "";
}

function conflictRow(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = { key: str(raw.key), path: str(raw.p) || str(raw.path), symbol: str(raw.n) || str(raw.symbol) };
  return row.key || row.path || row.symbol ? row : null;
}

function conflictList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    const row = conflictRow(raw);
    if (!row) continue;
    out.push(row);
    if (out.length >= MAX_LANE_ROWS) break;
  }
  return out;
}

function riskRow(raw) {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const parts = [raw.p, raw.path, raw.file, raw.n, raw.symbol, raw.name]
    .filter((part) => typeof part === "string" && part);
  return parts.join("::");
}

function riskList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    const text = riskRow(raw);
    if (!text) continue;
    out.push(text);
    if (out.length >= MAX_LANE_ROWS) break;
  }
  return out;
}

function laneRow(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!str(raw.id)) return null;
  return { id: str(raw.id), task: str(raw.task) };
}

function pairRow(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!str(raw.a) || !str(raw.b)) return null;
  const conflictCount = num(raw.conflict_count);
  const riskCount = num(raw.risk_count);
  const touchCount = num(raw.touch_count);
  return {
    a: str(raw.a),
    b: str(raw.b),
    conflicts: conflictList(raw.conflicts),
    conflictCount,
    sameFileRisk: riskList(raw.same_file_risk),
    riskCount,
    contractTouch: riskList(raw.contract_touch),
    touchCount,
  };
}

function sequentialReason(pair) {
  if (pair.conflictCount > 0) return "shared-claim";
  if (pair.riskCount > 0) return "same-file";
  if (pair.touchCount > 0) return "contract-touch";
  return null;
}

/**
 * @param {unknown} json parsed ripwire `--plan-lanes` output
 * @returns {{ lanes: Array<{ id: string; task: string }>;
 *   pairs: Array<{ a: string; b: string; conflicts: Array<{ key: string;
 *   path: string; symbol: string }>; conflictCount: number;
 *   sameFileRisk: string[]; riskCount: number; contractTouch: string[];
 *   touchCount: number }>; landingOrder: string[];
 *   sequentialize: Array<{ a: string; b: string; reason: string }>;
 *   warnings: string[] } | null}
 */
export function summarizePlanLanes(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  if (!Array.isArray(json.pairs)) return null;
  const lanes = [];
  for (const raw of Array.isArray(json.lanes) ? json.lanes : []) {
    const lane = laneRow(raw);
    if (lane) lanes.push(lane);
  }
  const pairs = [];
  const sequentialize = [];
  for (const raw of json.pairs) {
    const pair = pairRow(raw);
    if (!pair) continue;
    pairs.push(pair);
    const reason = sequentialReason(pair);
    if (reason) sequentialize.push({ a: pair.a, b: pair.b, reason });
  }
  const landingOrder = Array.isArray(json.landing_order)
    ? json.landing_order.filter((entry) => typeof entry === "string")
    : [];
  const warnings = Array.isArray(json.warnings) ? json.warnings : [];
  const codes = [];
  for (const warning of warnings) {
    const code = typeof warning === "string" ? warning : warning?.code;
    if (typeof code === "string" && code && codes.length < MAX_LANE_WARNINGS) codes.push(code);
  }
  return { lanes, pairs, landingOrder, sequentialize, warnings: codes };
}
