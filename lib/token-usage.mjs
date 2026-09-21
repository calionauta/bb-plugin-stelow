/**
 * Read provider-reported token totals from BB thread events. This deliberately
 * accepts no fallback: an absent provider report is unknown, never zero.
 */
export function tokenUsageFromEvents(events) {
  const latest = events.find((event) => event?.type === "thread/tokenUsage/updated");
  const total = latest?.data?.tokenUsage?.total?.totalTokens;
  return Number.isFinite(total) && total >= 0 ? total : null;
}

// Full provider split from one usage event: input, output, cached
// (cached + cache-read inputs), and reasoning outputs, plus the total.
// Fields the provider omits stay null — a partial report never
// fabricates its missing legs.
export function tokenBreakdownFromEvents(events) {
  const latest = Array.isArray(events) ? events.find((event) => event?.type === "thread/tokenUsage/updated") : null;
  const total = latest?.data?.tokenUsage?.total;
  if (!total || typeof total !== "object") return null;
  const num = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
  const cached = [num(total.cachedInputTokens), num(total.cacheReadInputTokens)].reduce(
    (sum, part) => (sum === null || part === null ? sum ?? part : sum + part), null,
  );
  const out = {
    input: num(total.inputTokens),
    output: num(total.outputTokens),
    cached,
    reasoning: num(total.reasoningOutputTokens),
    total: num(total.totalTokens),
  };
  return out.input === null && out.output === null && out.cached === null && out.reasoning === null && out.total === null ? null : out;
}

// Sum breakdowns across threads (a card total): per-leg sums, legs with
// no reports stay null. All-unknown resolves null, never a zero card.
export function sumTokenBreakdowns(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const legs = { input: 0, output: 0, cached: 0, reasoning: 0, total: 0 };
  const seen = { input: false, output: false, cached: false, reasoning: false, total: false };
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    for (const leg of Object.keys(legs)) {
      const value = entry[leg];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) { legs[leg] += value; seen[leg] = true; }
    }
  }
  if (!seen.input && !seen.output && !seen.cached && !seen.reasoning && !seen.total) return null;
  return {
    input: seen.input ? legs.input : null,
    output: seen.output ? legs.output : null,
    cached: seen.cached ? legs.cached : null,
    reasoning: seen.reasoning ? legs.reasoning : null,
    total: seen.total ? legs.total : null,
  };
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
