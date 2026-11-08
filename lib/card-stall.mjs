/**
 * The one definition of "this card is paused, and it is paused on you".
 *
 * A card is stalled when its worker stopped producing and the host decided the
 * reader has something to do about it. That single sentence is read from two
 * sides of the product — the Retry button (`cardCanResume`) and the pause chip
 * (`pausedActivityLabel`) — and until this module existed each side wrote the
 * predicate out for itself. They agreed, which is why nobody noticed, and the
 * board then rendered the same state twice: a `Paused` chip beside a
 * `Paused. Resume it.` chip, both asking for the same one action the Resume
 * button below them already offered.
 *
 * Two copies of a condition will eventually disagree, and this is the condition
 * where disagreeing is worst: the chip and the button are the same promise. A
 * card wearing a chip with no button is a dead end; a button with no chip is an
 * action nobody was told about. So the predicate lives here, import-free, and
 * the layers that import it stay free to import each other in either direction
 * (`lib/card-attention.mjs` reaches the UI layer through
 * `lib/board-list-presentation.mjs`, while `lib/detail-presentation.mjs` does
 * not, so a shared dependency has to sit below both).
 *
 * `held` is deliberately outside it. A held card's next message is already on
 * its way and the host dispatches it on its own, so nothing on the card waits
 * for a reader — no chip, no Retry. See `lib/host-hold.mjs`. The allowlist is
 * one state wide for that reason: a denylist would light a card the moment a
 * caller widened `needsAttention`, and this is the signal people learn to trust.
 */
export function cardIsStalled(card) {
  return card.activity === "idle" && Boolean(card.needsAttention);
}
