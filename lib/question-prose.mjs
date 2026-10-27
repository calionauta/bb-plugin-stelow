/**
 * The card's ONE prose-truncation rule, shared by the card's own description
 * and by an option's glance.
 *
 * It replaced a 240-character limit applied to option descriptions only, while
 * the card's own request rendered in full between the state line and the
 * question it produced. The reasoning — why a first sentence, and what "over
 * the limit" must always do — is in tests/question-presentation.test.mjs, next
 * to the assertions it explains.
 */
export const PROSE_SUMMARY_LIMIT = 140;

/** End of the first sentence within `window`, or -1 when none is complete. */
function firstSentenceEnd(window) {
  const match = window.match(/[.!?](?:["')\]\u201d\u2019]|\s|$)/);
  return match ? match.index + match[0].length : -1;
}

/** The visible head of a long passage, plus the tail a disclosure reveals. */
export function splitProseSummary(text, limit = PROSE_SUMMARY_LIMIT) {
  if (typeof text !== "string" || text.length <= limit) {
    return { head: typeof text === "string" ? text : "", tail: null };
  }
  const window = text.slice(0, limit);
  const sentenceEnd = firstSentenceEnd(window);
  // A sentence boundary wins only when it leaves a real summary behind: a
  // numbered or abbreviated lead ("1. Land the schema…", "e.g. the pin is
  // stale…") puts a terminator 2-4 characters in, and honouring it hands the
  // reader a head of "1." that hides the request for no reason. "At least two
  // words" is exactly what an abbreviation's dot fails and "Do it." passes.
  const candidate = sentenceEnd > 0 ? text.slice(0, sentenceEnd).trim() : "";
  if (/\s/.test(candidate)) {
    return { head: candidate, tail: text.slice(sentenceEnd).trimStart() };
  }
  const breakAt = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
  if (breakAt > limit / 2) {
    return { head: text.slice(0, breakAt).trimEnd(), tail: text.slice(breakAt).trimStart() };
  }
  // No usable break: prefer the next whitespace so the head keeps the whole
  // token. Unbreakable input takes a hard cut, so over-limit always has a door.
  const nextSpace = text.slice(limit).search(/\s/);
  if (nextSpace > 0) {
    const cut = limit + nextSpace;
    return { head: text.slice(0, cut).trimEnd(), tail: text.slice(cut).trimStart() };
  }
  return { head: text.slice(0, limit).trimEnd(), tail: text.slice(limit) };
}
