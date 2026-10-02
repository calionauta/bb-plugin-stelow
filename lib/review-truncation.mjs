/**
 * How often the reviewer saw a cut artifact, and which cut.
 *
 * The excerpt is chosen by the artifact's contract, not by offset
 * (`lib/review-excerpt.mjs`), so the two interesting counts are not "did it
 * truncate" but "how did we cut it": a document cut to its contract's sections
 * reached the reviewer intact where it mattered, and a document cut to its
 * opening did not. Those are different reviews, and an operator can only act on
 * the second if it is counted.
 *
 * This is the metric half of §6, and it is derived from the review records that
 * already exist — the durable `reviews/review-<stamp>.md` rows on each card. It
 * adds no table and no column: the excerpt is written into the record when the
 * review is recorded, and this reads it back. One source of truth, counted.
 *
 * Pure by construction: the caller supplies the parsed records, so a fleet of
 * reviews, a single card, and a hand-written array all take the same path and
 * the node test needs no database and no filesystem.
 */

/** How an excerpt was chosen. Mirrors the `selected` of the excerpt report. */
export const EXCERPT_MODES = ["whole", "contract", "head"];

/** The mode each selection means, in words a count can be read against. */
const MODE_MEANING = {
  whole: "sent whole",
  contract: "cut to the contract's sections",
  head: "cut to the document's opening",
};

/**
 * Normalize one raw review record into the fact this module counts. Accepts the
 * durable record's shape — `{ excerpt: { selected, truncated, sentChars,
 * originalChars } }` — and also a bare excerpt report, so a caller holding
 * either does not have to reshape first. Anything unreadable is `null`: a
 * review written before this field existed is uncounted, never counted as a
 * truncation, because the absence of evidence is not evidence of a cut.
 */
export function excerptFact(record) {
  if (!record || typeof record !== "object") return null;
  const excerpt = record.excerpt && typeof record.excerpt === "object" ? record.excerpt : record;
  const selected = typeof excerpt.selected === "string" ? excerpt.selected : null;
  if (!selected || !EXCERPT_MODES.includes(selected)) return null;
  if (typeof excerpt.truncated !== "boolean") return null;
  return {
    selected,
    truncated: excerpt.truncated,
    sentChars: Number.isFinite(excerpt.sentChars) ? excerpt.sentChars : null,
    originalChars: Number.isFinite(excerpt.originalChars) ? excerpt.originalChars : null,
  };
}

/**
 * Count the excerpt outcomes across a set of review records.
 *
 * Returns counts by mode plus the two an operator acts on: `truncated` (any cut
 * at all) and `headCuts` (cut to the opening — the review that may have missed
 * the section its contract named). `counted` is how many records actually
 * carried an excerpt, so a total can be reported against the reviews that are
 * known rather than against every review ever run.
 */
export function summarizeExcerpts(records) {
  const rows = (Array.isArray(records) ? records : []).map(excerptFact).filter(Boolean);
  const byMode = { whole: 0, contract: 0, head: 0 };
  let truncated = 0;
  for (const fact of rows) {
    byMode[fact.selected] += 1;
    if (fact.truncated) truncated += 1;
  }
  return {
    counted: rows.length,
    truncated,
    headCuts: byMode.head,
    byMode,
    // The sentences belong here rather than in the caller so every surface
    // reports the same meaning for the same number.
    meaning: MODE_MEANING,
  };
}

/**
 * One line, or nothing when every counted review saw its whole document. The
 * metric is a signal about the reviewer's coverage, so silence is the correct
 * output for "this has never been a problem" — the same rule the wait breakdown
 * follows for an empty residual.
 */
export function excerptMetricLine(summary) {
  const facts = summary && typeof summary === "object" ? summary : summarizeExcerpts([]);
  if (facts.counted === 0 || facts.truncated === 0) return "";
  const parts = [`${facts.truncated} of ${facts.counted} reviews read a cut artifact`];
  if (facts.headCuts > 0) parts.push(`${facts.headCuts} read only the opening`);
  else if (facts.byMode.contract > 0) parts.push("all cuts kept the contract's sections");
  return `Reviewer coverage: ${parts.join("; ")}.`;
}
