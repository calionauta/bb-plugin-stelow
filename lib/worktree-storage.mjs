/**
 * Worktree storage attribution (pure, no I/O).
 *
 * At factory scale (hundreds of auto-imported issues) worktrees are the
 * dominant disk cost — each carries its own node_modules. The registry
 * lesson from 2026 tooling (Codex's 202 GB of invisible copies): list
 * EVERYTHING the host reports, attribute what resolves, and never hide
 * unattributed rows. Bytes come from `du` at the caller; this module only
 * formats, extracts thread links, and classifies staleness.
 */

/** Extract the owning thread id from a BB worktree path (`.../thr_<id>-N/...`). */
export function threadIdFromWorktreePath(path) {
  if (typeof path !== "string" || !path) return null;
  const match = path.match(/thr_[A-Za-z0-9]+/);
  return match ? match[0] : null;
}

/** Human bytes: 258M, 1.2G — null stays null (unreadable, not zero). */
export function formatBytes(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (const next of units) {
    unit = next;
    if (value < 1024 || next === "TB") break;
    value /= 1024;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

/**
 * Staleness for display only (never a delete decision): destroyed and
 * teardown phases, or a past retireAt. Live and future-retire rows read
 * active whatever their age.
 */
export function isStaleEnvironment(environment, nowMs = Date.now()) {
  if (!environment || typeof environment !== "object") return false;
  const phase = environment.lifecycle && typeof environment.lifecycle === "object"
    ? environment.lifecycle.phase
    : environment.status;
  if (phase === "destroyed" || phase === "teardown") return true;
  const retireAt = environment.lifecycle && typeof environment.lifecycle === "object"
    ? environment.lifecycle.retireAt
    : null;
  return typeof retireAt === "number" && Number.isFinite(retireAt) && retireAt <= nowMs;
}
