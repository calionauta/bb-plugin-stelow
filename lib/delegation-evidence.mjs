/**
 * Delegation evidence (pure, no DB).
 *
 * The host cannot see inside a worker's provider session — freshness of a
 * worker-spawned subagent is unobservable. What IS observable is whether
 * any delegation happened at all: bb thread timelines carry delegation
 * items. This module counts them with structural key matching (never
 * prose matching), so it survives timeline schema reshapes. Result is a
 * tripwire, not a verdict: zero delegations means "possibly self-review",
 * never "certainly self-reviewed".
 */

// Structural markers only — prose mentioning "delegation" must never count.
const DELEGATION_MARKERS = [
  '"itemKind":"delegation"',
  '"kind":"delegation"',
  "item/delegation/",
];

export function countDelegations(value) {
  if (value === null || value === undefined) return 0;
  let text = null;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      return 0;
    }
  }
  if (typeof text !== "string" || text.length === 0) return 0;
  const compact = text.replace(/\s+/g, "");
  let count = 0;
  for (const marker of DELEGATION_MARKERS) {
    let at = compact.indexOf(marker);
    while (at >= 0) {
      count += 1;
      at = compact.indexOf(marker, at + marker.length);
    }
  }
  return count;
}

export function summarizeDelegationEvidence({ delegations, truncated }) {
  const n = typeof delegations === "number" && delegations >= 0 ? delegations : 0;
  if (n > 0) {
    return {
      observed: true,
      summary: `${n} delegation${n === 1 ? "" : "s"} observed in the worker thread timeline.`,
    };
  }
  return {
    observed: false,
    summary: truncated
      ? "No delegations in the returned timeline segments — older turns were not scanned, so this is inconclusive."
      : "No delegations observed in the worker thread timeline — this audit may be self-review.",
  };
}
