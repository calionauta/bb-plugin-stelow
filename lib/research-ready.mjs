/**
 * Research readiness. Single definition of "the research worker is done":
 * research-index.md parses (via the fan-out convention in research-index.mjs) with
 * at least one opportunity. The worker prompt tells the worker to STOP when
 * the index is complete, so thread-idle with a ready index is the expected
 * terminal rest — not a stall. The sync poll and the read-path attention
 * flags must all share this predicate, never re-derive "done" from free
 * text output or invent a second index convention.
 */

import { parseResearchIndex } from "./research-index.mjs";

/**
 * True when the index markdown holds at least one parsed opportunity
 * (checked or not — fan-out checks boxes later; completeness is what
 * matters here). An index that ignores the convention parses as not-found
 * and reads as not-ready, same as the fan-out dialog sees it.
 */
export function isResearchReadyForReview(markdown) {
  if (typeof markdown !== "string" || markdown.trim().length === 0) return false;
  const { found, opportunities } = parseResearchIndex(markdown);
  return found === true && opportunities.length > 0;
}

/**
 * Stable dedupe suffix for the ready event: the opportunity count. A new
 * strategy round appends opportunities, so a grown index earns a fresh
 * completion event while re-polls of the same index stay idempotent.
 */
export function researchReadyFingerprint(markdown) {
  const { found, opportunities } = parseResearchIndex(String(markdown ?? ""));
  if (found !== true || opportunities.length === 0) return null;
  return String(opportunities.length);
}
