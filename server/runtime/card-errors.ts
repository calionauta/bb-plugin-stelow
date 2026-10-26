/**
 * Shared refusal copy.
 *
 * Identical wording everywhere so the same failure reads the same on every
 * surface, and defined in one place so a fix lands on all of them at once.
 */
import { CARD_ERRORS } from "./composition.js";

export const ERRORS = {
  cardNotFound: CARD_ERRORS.cardNotFound,
  cardArchived: "This card is archived. Restore it from Manage to move it again.",
  workspaceUnavailable: "Workspace is unavailable — recover it from the card's Manage section, then retry.",
  presetNotFound: CARD_ERRORS.presetNotFound,
} as const;
