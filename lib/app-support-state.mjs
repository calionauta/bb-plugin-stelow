/**
 * Cards a track tab promises to find: the ones actually on its board.
 *
 * Terminal outcomes are out — a finished card is history. So is the Bucket: it
 * is not a rendered column, it carries its own count on its own header button,
 * and a card parked there is captured work with nothing running yet. Counting
 * it here made the tab read "5" while the board beside it held one card, and
 * made the same card visible in two places at once.
 */
import { BUILD_BOARD_INBOX, BUILD_BOARD_TERMINALS, buildBoardColumnFor } from "./workflow-vocabulary.mjs";
import { isLightweightKind, lightweightColumnForStatus } from "./tracks.mjs";

export function activeCardCount(cards) {
  return cards.filter((card) => isOnBoard(card)).length;
}

/**
 * Which board owns this card, and whether a column is drawn for it.
 *
 * The lightweight lifecycle projects on status alone, so a build card mid-work
 * would read as Bucket under that rule — the two projections have to be chosen
 * by kind, never tried in turn.
 *
 * The terminal test is the projection's, not a second copy of the status list.
 * `buildBoardColumnFor` returns the status first and `lightweightColumnForStatus`
 * maps done/archived to their own columns, so a terminal card already resolves
 * to a terminal column and the Bucket test below is false for it. A separate
 * `TERMINAL_STATUSES` set was a second representation of a fact the projection
 * already owns, and it filtered nothing: both projections handle terminals
 * before the Bucket branch is ever reached.
 */
function isOnBoard(card) {
  return !isBucketCard(card) && !isTerminalColumn(columnFor(card));
}

function columnFor(card) {
  return isLightweightKind(card.kind)
    ? lightweightColumnForStatus(card.status)
    : buildBoardColumnFor(card);
}

function isBucketCard(card) {
  return columnFor(card) === BUILD_BOARD_INBOX;
}

/**
 * Terminality read off the COLUMN, not off a copy of the status list.
 * `BUILD_BOARD_TERMINALS` is the catalog's own pair of terminal column ids, and
 * both projections already map a terminal status onto one of them — so this is
 * the same fact, asked of the owner. The removed `TERMINAL_STATUSES` set was a
 * second representation that could drift from the catalog on the day a terminal
 * outcome is added.
 */
function isTerminalColumn(column) {
  return BUILD_BOARD_TERMINALS.includes(column);
}

export function accessoryTone(count, activeTone) {
  return count > 0 ? activeTone : "bg-muted text-muted-foreground";
}
