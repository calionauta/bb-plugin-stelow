import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { STELOW_PANEL_ID, inboxCardSubPath } from "../panel/stelow-route.mjs";

type BbNavigate = ReturnType<typeof useBbNavigate>;

export function goToInboxCard(navigate: BbNavigate, cardId: string, eventId: string): void {
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: inboxCardSubPath(cardId, eventId) });
}

/**
 * Open a card NAMED by another card's notification — the one holding a file.
 *
 * Deliberately without an event id: the reader wants the holder card, not this
 * card's inbox row. Landing on the blocked card again, with its banner focused,
 * would answer a question nobody asked.
 */
export function goToHolderCard(navigate: BbNavigate, holderCardId: string): void {
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: `build/card/${holderCardId}` });
}
