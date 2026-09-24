import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { rememberStelowReturnFocusCardId } from "../panel/stelow-focus.mjs";
import { STELOW_PANEL_ID, cardSubPath, trackRootSubPath, type StelowTrack } from "../panel/stelow-route.mjs";
import type { rpcContract } from "../../server";

type BbNavigate = ReturnType<typeof useBbNavigate>;
type BoardResult = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;
type CardsResponse = Extract<BoardResult, { cards: unknown }>;
export type CardItem = CardsResponse["cards"][number];

export type BbNavigateHandle = BbNavigate;

export function goToTrack(navigate: BbNavigate, track: StelowTrack): void {
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: trackRootSubPath(track) });
}

export function goToCard(
  navigate: BbNavigate,
  card: Pick<CardItem, "kind">,
  cardId: string,
  eventId?: string | null,
): void {
  rememberStelowReturnFocusCardId(cardId);
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: cardSubPath(card, cardId, eventId) });
}
