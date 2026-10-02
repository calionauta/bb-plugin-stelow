import { pendingReview } from "./board-list-presentation.mjs";

export function cardIsTerminal(card) {
  return card.status === "completed" || card.status === "archived" || card.status === "blocked";
}

export function cardCanResume(card) {
  return !cardIsTerminal(card)
    && Boolean(card.workerThreadId)
    && (card.activity === "error" || (card.activity === "idle" && card.needsAttention));
}

/**
 * The amber chip, which means "there is something here for you to do".
 *
 * An ALLOWLIST, not a denylist, and the allowlist is one state wide. Every
 * other activity renders its own pill (ActivityPill), and the pair must never
 * say the same thing twice — so `idle` is the only state left for the chip to
 * carry. The two callers that compute `needsAttention` could each widen it one
 * day, and a denylist would then light a card that needs nothing: the amber
 * chip is the signal people learn to trust, so it may only appear for a stall a
 * person can clear. A held card is exactly the state that must never produce
 * one — it rendered as a pause until this became an allowlist.
 */
export function cardShowsAttention(card) {
  return card.needsAttention && card.activity === "idle";
}

export function cardNeedsReview(card) {
  return pendingReview(card);
}
