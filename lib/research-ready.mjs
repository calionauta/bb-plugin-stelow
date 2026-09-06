/**
 * Research readiness. Single definition of "the research worker is done":
 * brief.md parses (via the fan-out convention in research-brief.mjs) with
 * at least one opportunity. The worker prompt tells the worker to STOP when
 * the brief is complete, so thread-idle with a ready brief is the expected
 * terminal rest — not a stall. The sync poll and the read-path attention
 * flags must all share this predicate, never re-derive "done" from free
 * text output or invent a second brief convention.
 */

import { parseResearchBrief } from "./research-brief.mjs";

/**
 * True when the brief markdown holds at least one parsed opportunity
 * (checked or not — fan-out checks boxes later; completeness is what
 * matters here). A brief that ignores the convention parses as not-found
 * and reads as not-ready, same as the fan-out dialog sees it.
 */
export function isResearchReadyForReview(markdown) {
  if (typeof markdown !== "string" || markdown.trim().length === 0) return false;
  const { found, opportunities } = parseResearchBrief(markdown);
  return found === true && opportunities.length > 0;
}

/**
 * Stable dedupe suffix for the ready event: the opportunity count. A new
 * strategy round appends opportunities, so a grown brief earns a fresh
 * completion event while re-polls of the same brief stay idempotent.
 */
export function researchReadyFingerprint(markdown) {
  const { found, opportunities } = parseResearchBrief(String(markdown ?? ""));
  if (found !== true || opportunities.length === 0) return null;
  return String(opportunities.length);
}
