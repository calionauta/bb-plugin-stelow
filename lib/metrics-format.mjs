/**
 * Every number a person reads about a card, counted once.
 *
 * The metrics used to be counted in the modules that happened to need them,
 * which meant the same gap tally was shaped in five places and the escalation
 * rate was derived twice with two different guards. Nothing was wrong with any
 * one of them; the cost was that a fifth resolution type would have needed five
 * edits and could have quietly disagreed with the other four.
 *
 * This is the single owner. It is pure, it has no I/O, and it is the only place
 * that decides what a metric *means* — the rate, the wording, and the rule that
 * a missing measurement is a number nobody learned to read, not a zero.
 *
 * It does not own the counting either. `gap-registry.mjs` parses the registry
 * and `card-metrics.mjs` reads the stage ledger; this module decides what the
 * counts are called, what order they appear in, and what is left unsaid. A
 * metric that arrives here as a number already knows where it came from, and
 * this is the only place that can turn it into a sentence.
 */

/** The gap tally every surface reports. One shape, declared once: a resolution
 * added to the registry is a field added here and nowhere else. */
export function emptyGapTotals() {
  return { total: 0, fixed: 0, documented: 0, escalated: 0 };
}

/** Fold a parsed summary into an accumulator. `found:false` is a document with
 * no parseable registry, which contributes nothing — counting it as a clean
 * review would reward a report that skipped the format entirely. */
export function addGapTotals(target, summary) {
  if (!summary || summary.found !== true) return target;
  target.total += summary.total;
  target.fixed += summary.fixed;
  target.documented += summary.documented;
  target.escalated += summary.escalated;
  return target;
}

/** The share of findings that were escalated, or null when there were none.
 *
 * Null and not `0` on purpose: a card with no gaps has no escalation *rate*,
 * and printing `0%` for it claims a measurement that was never taken. Every
 * caller has to decide what absence means, which is exactly why the decision
 * lives here once.
 */
export function escalationRate(totals) {
  const t = normalizeTotals(totals);
  return t.total > 0 ? t.escalated / t.total : null;
}

/** `"n/a"` vs `"33%"`, decided once so two surfaces cannot disagree about
 * whether a rate is a measurement. */
export function formatRate(rate) {
  return rate === null || !Number.isFinite(rate) ? "n/a" : `${Math.round(rate * 100)}%`;
}

/** The one line every gap readout starts with. Fleet and card used to print
 * their own, which is how a card and a fleet of the same card came to differ in
 * which numbers they mentioned. */
export function formatGapTotals(totals) {
  const t = normalizeTotals(totals);
  return `Gaps: ${t.total} total · ${t.fixed} fixed · ${t.documented} documented · ${t.escalated} escalated (${formatRate(escalationRate(t))} escalated)`;
}

/** Defensive: a caller may hold a partial shape from an older payload. */
function normalizeTotals(totals) {
  return { ...emptyGapTotals(), ...(totals ?? {}) };
}
