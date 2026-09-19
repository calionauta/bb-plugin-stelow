/**
 * Claim-terminal card statuses: a card in one of these must hold no workspace
 * file claims. `blocked` is included by convention — it is never written by
 * current code paths (only guarded in reads), but any past or future row in
 * this state must not park files hostage. Keep in sync with the blueprint
 * (§2 "Terminal states release workspace claims").
 */
export const CLAIM_TERMINAL_STATUSES = ["completed", "archived", "blocked"];

export function isClaimTerminal(status) {
  return typeof status === "string" && CLAIM_TERMINAL_STATUSES.includes(status);
}

/**
 * A stale last_error (or an error activity) counts as needs-attention only
 * on live cards. On terminal cards it is residue of finished work — Done
 * never asks for attention because of it. Both card-list and card-detail
 * attention signals share this predicate so the badge cannot disagree with
 * the open card.
 */
export function errorNeedsAttention(status, lastError, activity) {
  return !isClaimTerminal(status) && (Boolean(lastError) || activity === "error");
}
