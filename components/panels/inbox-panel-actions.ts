import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { STELOW_PANEL_ID, inboxCardSubPath } from "../panel/stelow-route.mjs";

type BbNavigate = ReturnType<typeof useBbNavigate>;

export function goToInboxCard(navigate: BbNavigate, cardId: string, eventId: string): void {
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: inboxCardSubPath(cardId, eventId) });
}
