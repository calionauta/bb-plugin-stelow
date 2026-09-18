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
