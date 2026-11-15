/**
 * Relative clock ("Just now", "5m ago", "Yesterday"). Pure, no I/O —
 * shared by inbox recency, worker-history timestamps, and update checks.
 * Future timestamps clamp to now; the unit flips are exact thresholds.
 */

export function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

/**
 * The same scale, spoken as a duration instead of as a moment: `45m`, `6h`,
 * `3d`.
 *
 * Adjacent to `relativeTime` on purpose -- the unit flips are one vocabulary and
 * a second copy of them is how a surface ends up saying `0d` about a four-hour
 * wait. It is not the same function, though, and the difference is the rounding:
 * recency rounds ("about an hour") because it describes how fresh a row is,
 * while a wait floors ("it has been at least six hours") because rounding a wait
 * up would claim time the card has not spent waiting.
 */
export function elapsedUnits(timestamp, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
