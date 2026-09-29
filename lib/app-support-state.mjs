/**
 * Cards a track tab promises to find: the ones actually on its board.
 *
 * Terminal outcomes are out — a finished card is history. So is the Bucket: it
 * is not a rendered column, it carries its own count on its own header button,
 * and a card parked there is captured work with nothing running yet. Counting
 * it here made the tab read "5" while the board beside it held one card, and
 * made the same card visible in two places at once.
 */
import { BUILD_BOARD_INBOX, buildBoardColumnFor } from "./workflow-vocabulary.mjs";
import { isLightweightKind, lightweightColumnForStatus } from "./tracks.mjs";

export function activeCardCount(cards) {
  return cards.filter((card) => !TERMINAL_STATUSES.has(card.status) && !isBucketCard(card)).length;
}

const TERMINAL_STATUSES = new Set(["completed", "archived"]);

/**
 * Which board owns this card. The lightweight lifecycle projects on status
 * alone, so a build card mid-work would read as Bucket under that rule — the
 * two projections have to be chosen by kind, never tried in turn.
 */
function isBucketCard(card) {
  const column = isLightweightKind(card.kind)
    ? lightweightColumnForStatus(card.status)
    : buildBoardColumnFor(card);
  return column === BUILD_BOARD_INBOX;
}

export function accessoryTone(count, activeTone) {
  return count > 0 ? activeTone : "bg-muted text-muted-foreground";
}
