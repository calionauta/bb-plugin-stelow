import { excerptMetricLine, summarizeExcerpts } from "../../lib/review-truncation.mjs";
import { reworkMetricLine, summarizeRework } from "../../lib/rework-metrics.mjs";

/**
 * The card's one metric line, rendered from the owner the CLI calls.
 *
 * The CLI is the source of truth for what a number means, and this exists for
 * the same reason the shared formatter does: a card and a terminal must not be
 * able to say two different things about the same review. The string below is
 * produced by `reworkMetricLine` — the very function `bb stelow metrics` calls —
 * so there is one sentence for "a finding came back", and the card either prints
 * it or has nothing to print.
 *
 * It is deliberately a hint and not a section. The card's shape is one hero
 * then sections, and rework is a fact about the section that already sits below
 * it: "Gaps and rework" lists the findings, and this says whether they are the
 * *same* findings again. A second always-open panel would both break that shape
 * and restate a number the section already owns.
 *
 * Metadata, not prose: `text-xs` is the card's own secondary-fact step, and
 * this renders at the surface that decides it, not one invented here.
 */
export type MetricFacts = {
  /** One critique round's findings per registered critique artifact, oldest
   * first. The round boundary is what makes rework measurable: the section's
   * gap list dedupes across rounds on purpose, so a finding fixed in one round
   * and re-opened in a later one is one row there and a rework event here. */
  rounds?: Array<Array<{ description: string; resolution: string }>> | null;
  /** The card's parsed review records, for the reviewer-coverage line. Absent or
   * empty means "not measured" — never a claim that every review read whole. */
  reviews?: Array<{ excerpt: { selected?: string; truncated?: boolean; sentChars?: number | null; originalChars?: number | null } }> | null;
};

/** The hint: the reworked count and nothing else.
 *
 * The owner's sentence ("Rework: 1 finding(s) re-opened after a second review
 * (100% of passes).") is a full report and belongs in the body or the CLI. A
 * hint is a collapsed row already carrying five numbers, and a 65-character
 * sentence among them reads as noise rather than as a fact. So the hint takes
 * the count — "1 re-worked" — and the same owner produces the full sentence
 * wherever there is room for it. The two are the same number, derived once.
 */
export function metricHint(facts: MetricFacts): string | null {
  const summary = summarizeRework(facts?.rounds ?? []);
  if (summary.comparable === 0 || summary.reworked === 0) return null;
  return `${summary.reworked} re-worked`;
}

/** The body lines: the full report for each metric, in the order a reader meets
 * them. Rework first, because it is the fact about this section.
 *
 * Same owners as the CLI and the strip, so all three print the same sentence —
 * the hint is the short form of the rework line, not a different number.
 */
export function metricBodyLines(facts: MetricFacts): string[] {
  const lines: string[] = [];
  const rework = reworkMetricLine(summarizeRework(facts?.rounds ?? []));
  if (rework) lines.push(rework);
  const coverage = excerptMetricLine(summarizeExcerpts(facts?.reviews ?? []));
  if (coverage) lines.push(coverage);
  return lines;
}
