/**
 * Lead/cycle-time math over the append-only card_stage_events ledger.
 * Pure functions — the ledger rows are { stage, entered_at } ascending.
 * Lead time runs creation → done; cycle time runs first real movement
 * (first stage differing from the creation stage) → done. A card that
 * never left its creation stage has no cycle time yet — reported as
 * null, never as zero.
 */

export function summarizeTimeline(events, { createdAt, endAt }) {
  const rows = Array.isArray(events) ? events : [];
  const end = typeof endAt === "number" ? endAt : Date.now();
  const leadMs = Math.max(0, end - createdAt);
  const creationStage = rows.length > 0 ? rows[0].stage : null;
  const firstMove = rows.find((event) => event.stage !== creationStage) ?? null;
  const cycleMs = firstMove ? Math.max(0, end - firstMove.entered_at) : null;
  const byStage = [];
  for (let i = 0; i < rows.length; i++) {
    const next = rows[i + 1];
    byStage.push({ stage: rows[i].stage, ms: Math.max(0, (next ? next.entered_at : end) - rows[i].entered_at) });
  }
  return { leadMs, cycleMs, byStage };
}

/** Compact human duration: 3d 4h, 5h 12m, 8m 30s, 45s. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

// Nearest-rank percentiles over finished durations. Empty sets resolve to
// nulls — a percentile of nothing is not zero. Junk never enters ranking.
export function summarizeDurations(valuesMs) {
  const values = (Array.isArray(valuesMs) ? valuesMs : [])
    .filter((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return { count: 0, p50: null, p90: null, max: null };
  const rank = (p) => values[Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1)];
  return { count: values.length, p50: rank(50), p90: rank(90), max: values[values.length - 1] };
}
