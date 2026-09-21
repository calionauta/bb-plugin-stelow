/**
 * Read provider-reported token totals from BB thread events. This deliberately
 * accepts no fallback: an absent provider report is unknown, never zero.
 */
export function tokenUsageFromEvents(events) {
  const latest = events.find((event) => event?.type === "thread/tokenUsage/updated");
  const total = latest?.data?.tokenUsage?.total?.totalTokens;
  return Number.isFinite(total) && total >= 0 ? total : null;
}

export function formatTokenUsage(total) {
  if (total === null) return null;
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(total);
}

// Card total across a worker history: every thread and child with a
// provider report sums in; unknowns stay unknown. All-unknown resolves
// null — a card with no reports shows no total, never a zero.
export function totalTokenUsage(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  let sum = 0;
  let reported = 0;
  const add = (value) => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) { sum += value; reported += 1; }
  };
  for (const entry of history) {
    if (!entry || typeof entry !== "object") continue;
    add(entry.tokenUsage);
    if (Array.isArray(entry.children)) for (const child of entry.children) add(child?.tokenUsage);
  }
  return reported > 0 ? sum : null;
}
