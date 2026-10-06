/**
 * Provider-reported token totals from BB thread events. This deliberately accepts
 * no fallback: an absent report is unknown, never zero.
 */
export function tokenUsageFromEvents(events) {
  const latest = events.find((event) => event?.type === "thread/tokenUsage/updated");
  const total = latest?.data?.tokenUsage?.total?.totalTokens;
  return Number.isFinite(total) && total >= 0 ? total : null;
}

/**
 * A provider's own context-window reading, which is a DIFFERENT measurement from a
 * token total and is never conflated with one.
 *
 * This exists because the two families are not interchangeable and the gap between
 * them was the entire reason this plugin reported `0` for most workers. Measured on
 * the live database: 837 threads emit `thread/contextWindowUsage/updated` against
 * 148 that emit `thread/tokenUsage/updated`, and every one of this plugin's ten
 * worker threads emits a context reading while exactly one emits a token total. So
 * for eight of ten workers the reported figure was absent and rendered as nothing,
 * and the providers that only send a context reading are exactly the ones an ACP
 * agent runs on.
 *
 * `estimated: true` is carried through rather than dropped, because the number the
 * provider sends IS an estimate and every surface that shows it has to be able to
 * say so. Returning it under a name that promises a measurement would launder an
 * estimate into a fact, which is the same failure as printing 0 for unknown.
 */
export function contextUsageFromEvents(events) {
  const latest = events.find((event) => event?.type === "thread/contextWindowUsage/updated");
  const usage = latest?.data?.contextWindowUsage;
  if (!usage || typeof usage !== "object") return null;
  const used = usage.usedTokens;
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return null;
  const window = usage.modelContextWindow;
  return {
    usedTokens: used,
    modelContextWindow: typeof window === "number" && Number.isFinite(window) && window > 0 ? window : null,
    estimated: usage.estimated === true,
  };
}

/**
 * Where a token figure came from, so no surface can print an estimate as a
 * measurement. `provider` is a reported total, `context-estimate` is the context
 * window reading an ACP agent sends instead of one, and `null` is nothing
 * reported at all.
 * @typedef {"provider" | "context-estimate" | null} UsageSource
 */

/**
 * The best token figure the events support, and what kind of figure it is.
 *
 * `source` is the field that keeps the distinction honest: `provider` means the
 * provider reported a token total, `context-estimate` means the provider only
 * reported how full its context window is, and `total: null` with `source: null`
 * means nothing was reported at all. A caller that prints `total` without reading
 * `source` will show an estimate and a measurement identically, so the name is
 * deliberately awkward to ignore.
 */
export function usageFromEvents(events) {
  const total = tokenUsageFromEvents(events);
  if (total !== null) return { total, source: "provider", context: contextUsageFromEvents(events) };
  const context = contextUsageFromEvents(events);
  if (context !== null) return { total: context.usedTokens, source: "context-estimate", context };
  return { total: null, source: null, context: null };
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

/**
 * What kind of figures a summed total is made of.
 *
 * A sum is provenance-blind by construction: it cannot tell a reported total from a
 * context-window estimate, and after this plugin started reading the estimate family
 * the difference became material. On the ten real workers the collapsed summary
 * printed 2,490,239 and called it "provider-reported tokens across all workers", of
 * which 2,012,555 — 81% — was estimated, and a child's figure is even less
 * attributable because the child payload does not carry which kind it was.
 *
 * Returned as a fact so a surface can label the number it is about to show. A sum
 * that silently loses this is how an estimate becomes a measurement in the reading.
 */
export function totalUsageProvenance(history) {
  let provider = 0;
  let other = 0;
  for (const entry of history ?? []) {
    if (!entry || typeof entry !== "object") continue;
    const rows = [entry, ...(Array.isArray(entry.children) ? entry.children : [])];
    for (const row of rows) {
      if (!row || typeof row.tokenUsage !== "number" || !Number.isFinite(row.tokenUsage)) continue;
      // A parent carries its source; a child does not, so an unattributed figure
      // counts as other rather than being assumed reported.
      if (row.tokenUsageSource === "provider") provider += 1;
      else other += 1;
    }
  }
  if (provider === 0 && other === 0) return null;
  if (other === 0) return "provider";
  return provider === 0 ? "estimate" : "mixed";
}
