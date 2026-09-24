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
