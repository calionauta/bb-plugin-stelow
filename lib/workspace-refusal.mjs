/**
 * The sentence a command says when it cannot find a checkout to work in.
 *
 * Ten copies of one sentence had grown across the server, and every one stopped
 * at what was missing. This repository refuses the other way — "a gate that
 * refuses without saying what would let it through is a gate the reader learns
 * to work around" — so the sentence names the fix, and the caller supplies only
 * the part that genuinely differs: its own usage line.
 *
 * Two forms, because the reader's position differs. A command run outside a card
 * thread has to be told how to name a project. A card that has no checkout is
 * already in the reader's hands, and the fix is to look at its environment.
 */
export function workspaceUnavailable(usage) {
  return `Workspace path is unavailable. Run this from the card's thread, or name the project: ${usage}`;
}

export const CARD_WORKSPACE_UNAVAILABLE =
  "Workspace path is unavailable. This card's checkout is not on this host — "
  + "open the card to see its environment.";
