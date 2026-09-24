import type { IconName } from "../ui/icon";

export type StelowTrack = "inbox" | "build" | "research" | "explore" | "about";
export type StelowTrackCounts = Record<StelowTrack, number>;
export type ParsedStelowRoute =
  | { kind: "track"; track: StelowTrack }
  | { kind: "card"; cardId: string; eventId: string | null; executionRunId: string | null; origin: StelowTrack }
  | { kind: "bare-card"; cardId: string; eventId: string | null; executionRunId: string | null };

export type StelowTrackEntry = {
  key: StelowTrack;
  title: string;
  description: string;
  icon: IconName;
  rootSubPath: string;
};

export const STELOW_PANEL_ID: "stelow";
export const STELOW_PANEL_PATH: "stelow";
export const STELOW_TRACKS: readonly StelowTrackEntry[];

export function trackTitle(track: StelowTrack): string;
export function trackRootSubPath(track: StelowTrack): string;
export function trackOfCard(card: { kind: "build" | "research" | "explore" }): StelowTrack;
export function cardSubPath(
  card: { kind: "build" | "research" | "explore" },
  cardId: string,
  eventId?: string | null,
): string;
export function inboxCardSubPath(cardId: string, eventId: string): string;
export function parseStelowSubPath(subPath: string): ParsedStelowRoute;
