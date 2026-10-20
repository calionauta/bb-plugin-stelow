import { pendingReview } from "./board-list-presentation.mjs";
import { cardIsStalled } from "./card-stall.mjs";

export function cardIsTerminal(card) {
  return card.status === "completed" || card.status === "archived" || card.status === "blocked";
}

export function cardCanResume(card) {
  return !cardIsTerminal(card)
    && Boolean(card.workerThreadId)
    && (card.activity === "error" || cardIsStalled(card));
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
 *
 * The predicate is `cardIsStalled`, shared with the pause chip and the Resume
 * button rather than written out here a third time. What this function adds is
 * the READ of that predicate by the amber channel; what it must not add is a
 * second copy of the condition, because a copy is how the board ended up
 * rendering one pause as two chips.
 */
export function cardShowsAttention(card) {
  return cardIsStalled(card);
}

export function cardNeedsReview(card) {
  return pendingReview(card);
}
