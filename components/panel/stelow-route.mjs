import { parseExecutionRunSubPath } from "../../lib/execution-deep-link.mjs";

export const STELOW_PANEL_ID = "stelow";
export const STELOW_PANEL_PATH = "stelow";

export const STELOW_TRACKS = [
  {
    key: "inbox",
    title: "Inbox",
    description: "Things that need you, plus recent completions",
    icon: "Mail",
    rootSubPath: "inbox",
  },
  {
    key: "research",
    title: "Research",
    description: "Research board",
    icon: "Idea",
    rootSubPath: "research",
  },
  {
    key: "explore",
    title: "Explore",
    description: "Single-technique runs",
    icon: "Target",
    rootSubPath: "explore",
  },
  {
    key: "build",
    title: "Build",
    description: "Build board",
    icon: "Columns2",
    rootSubPath: "build",
  },
  {
    key: "about",
    title: "About",
    description: "What Stelow is",
    icon: "Info",
    rootSubPath: "about",
  },
];

export function trackTitle(track) {
  return STELOW_TRACKS.find((entry) => entry.key === track)?.title ?? track;
}

export function trackRootSubPath(track) {
  return STELOW_TRACKS.find((entry) => entry.key === track)?.rootSubPath ?? "";
}

export function trackOfCard(card) {
  return card.kind === "research" ? "research" : card.kind === "explore" ? "explore" : "build";
}

export function cardSubPath(card, cardId, eventId) {
  const track = trackOfCard(card);
  return `${track}/card/${cardId}${eventId ? `/event/${eventId}` : ""}`;
}

export function inboxCardSubPath(cardId, eventId) {
  return `inbox/card/${cardId}/event/${eventId}`;
}

// One panel, five tracks. Grammar (routes are panel-relative):
//   "" | "build"                 -> Build board ("" reopens the last tab)
//   "inbox"                      -> Inbox list
//   "research"                   -> Research board
//   "explore"                    -> Explore board
//   "about"                      -> About Stelow (no cards live here)
//   "<track>/card/<id>[/event/]" -> card detail, back returns to <track>
//   "card/<id>[/event/]"         -> trackless link resolved live
export function parseStelowSubPath(subPath) {
  const normalized = subPath.replace(/^\/+|\/+$/g, "");
  if (normalized === "" || normalized === "build") return { kind: "track", track: "build" };
  if (normalized === "inbox") return { kind: "track", track: "inbox" };
  if (normalized === "research") return { kind: "track", track: "research" };
  if (normalized === "explore") return { kind: "track", track: "explore" };
  if (normalized === "about") return { kind: "track", track: "about" };
  const executionRoute = parseExecutionRunSubPath(normalized);
  if (executionRoute?.track) {
    return {
      kind: "card",
      cardId: executionRoute.cardId,
      eventId: executionRoute.eventId,
      executionRunId: executionRoute.localRunId,
      origin: executionRoute.track,
    };
  }
  if (executionRoute) {
    return {
      kind: "bare-card",
      cardId: executionRoute.cardId,
      eventId: executionRoute.eventId,
      executionRunId: executionRoute.localRunId,
    };
  }
  let match = normalized.match(/^(inbox|build|research|explore)\/card\/(card_[A-Za-z0-9]+)(?:\/event\/(evt_[A-Za-z0-9]+))?$/);
  if (match) {
    return {
      kind: "card",
      cardId: match[2],
      eventId: match[3] ?? null,
      executionRunId: null,
      origin: match[1],
    };
  }
  match = normalized.match(/^card\/(card_[A-Za-z0-9]+)(?:\/event\/(evt_[A-Za-z0-9]+))?$/);
  if (match) return { kind: "bare-card", cardId: match[1], eventId: match[2] ?? null, executionRunId: null };
  return { kind: "track", track: "build" };
}
