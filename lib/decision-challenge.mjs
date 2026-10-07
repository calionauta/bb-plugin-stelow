/**
 * Decision challenges. Proposing what a live receipt rejected requires naming
 * that receipt in a challenge — a silent revisit is a gap, not a judgment
 * call. Stale or superseded receipts never trigger this: they route to
 * reconfirmation (freshness) or are already dead (lineage), not to challenge.
 *
 * Fail-closed on legacy receipts: a receipt without `rejectedOptionIds` or
 * `selectedId` still guards its scopes — contradicting inside a covered scope
 * requires a challenge naming it, because an unrecorded rejection is still a
 * recorded decision.
 */

import { freshnessOf } from "./decision-freshness.mjs";

/**
 * @param {object} receipt a decision receipt
 * @param {{ shapeVersion?: unknown, scopeMapVersion?: unknown }} current
 * @returns {boolean} false when superseded or stale — never a challenge target
 */
export function isChallengeable(receipt, current) {
  if (!receipt || typeof receipt.id !== "string" || !receipt.id) return false;
  if (typeof receipt.supersededBy === "string" && receipt.supersededBy) return false;
  return freshnessOf(receipt, current ?? {}) !== "stale";
}

/**
 * @param {{ scopeIds?: unknown, optionIds?: unknown, selectedId?: unknown }} proposal
 * @param {Array<object>} liveReceipts receipts already filtered to live ones
 * @param {{ challengeReceiptIds?: unknown }} challenges ids named by open challenges
 * @returns {{ receiptId: string, reason: string } | null}
 */
export function requiresChallenge(proposal, liveReceipts, challenges) {
  const named = new Set(Array.isArray(challenges?.challengeReceiptIds) ? challenges.challengeReceiptIds : []);
  const list = Array.isArray(liveReceipts) ? liveReceipts : [];
  for (const receipt of list) {
    if (!receipt || typeof receipt.id !== "string" || !receipt.id) continue;
    if (named.has(receipt.id)) continue;
    const reason = contradictionOf(proposal ?? {}, receipt);
    if (reason) return { receiptId: receipt.id, reason };
  }
  return null;
}

function contradictionOf(proposal, receipt) {
  const scopes = Array.isArray(proposal.scopeIds) ? proposal.scopeIds : [];
  const options = Array.isArray(proposal.optionIds) ? proposal.optionIds : [];
  const rejected = Array.isArray(receipt.rejectedOptionIds) ? receipt.rejectedOptionIds : [];
  for (const option of options) {
    if (rejected.includes(option)) return `proposes rejected option ${option}`;
  }
  if (typeof receipt.selectedId === "string" && receipt.selectedId
    && typeof proposal.selectedId === "string" && proposal.selectedId
    && proposal.selectedId !== receipt.selectedId
    && overlaps(scopes, receipt.scopeIds)) {
    return `selects ${proposal.selectedId} where receipt selected ${receipt.selectedId}`;
  }
  if (rejected.length === 0 && typeof receipt.selectedId !== "string" && overlaps(scopes, receipt.scopeIds)) {
    return `revisits decided scopes without naming the receipt`;
  }
  return null;
}

function overlaps(proposalScopes, receiptScopes) {
  if (!Array.isArray(receiptScopes)) return true;
  if (!Array.isArray(proposalScopes) || proposalScopes.length === 0) return true;
  return proposalScopes.some((id) => receiptScopes.includes(id));
}
