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
