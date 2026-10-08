/**
 * The decisions line of the Scope X-ray. A card with decision receipts gets
 * one header sentence — how many decisions are live, how many went stale, and
 * whether any two live ones contradict each other — because a contradiction
 * nobody names is the next agent picking arbitrarily. Per-node receipt badges
 * would be the nine-times problem again, so per-scope detail stays out: the
 * header carries the fact once, and the receipts file carries the rest.
 *
 * Pure: callers pass already-loaded receipts and the card's current Shape
 * version. Null when there is nothing to say (no receipts), so callers stay
 * additive: no decisions, no sentence.
 */
import { freshnessOf } from "./decision-freshness.mjs";
import { resolveLive } from "./decision-lineage.mjs";

/**
 * @param {Array<object>} receipts
 * @param {{ shapeVersion?: unknown }} current
 * @returns {{ live: number, stale: number, unknown: number, conflicts: Array<{ a: string, b: string, scopeIds: string[] }> } | null}
 */
export function summarizeDecisions(receipts, current) {
  const list = Array.isArray(receipts) ? receipts.filter((r) => r && typeof r.id === "string") : [];
  if (list.length === 0) return null;
  const { live, conflicts } = resolveLive(list);
  let stale = 0;
  let unknown = 0;
  for (const receipt of live) {
    const state = freshnessOf(receipt, current ?? {});
    if (state === "stale") stale += 1;
    else if (state === "unknown") unknown += 1;
  }
  return { live: live.length, stale, unknown, conflicts };
}

/** One header sentence, or "" when there is nothing to say. */
export function formatDecisionNote(summary) {
  if (!summary || typeof summary.live !== "number" || summary.live === 0) return "";
  const conflicts = Array.isArray(summary.conflicts) ? summary.conflicts : [];
  const parts = [`${summary.live} decision${summary.live === 1 ? "" : "s"}`];
  if (summary.stale > 0) parts.push(`${summary.stale} stale`);
  if (summary.unknown > 0) parts.push(`${summary.unknown} of unknown freshness`);
  if (conflicts.length > 0) {
    const first = conflicts[0];
    const scopes = Array.isArray(first.scopeIds) ? first.scopeIds.join(", ") : "";
    parts.push(`contradiction: ${first.a} vs ${first.b} (${scopes || "shared scopes"})`);
  }
  return parts.join(" · ");
}
