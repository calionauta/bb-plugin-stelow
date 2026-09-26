/**
 * The live preview store: one session per CHECKOUT (host + path), never per
 * card. Two cards on one project's source are the same code, so they share one
 * server instead of racing for the same port.
 *
 * Lookup is by path, never by "which card started it": a card whose worktree was
 * recreated must not be handed the server of the directory it used to own.
 */
import { previewKey } from "./preview-session.mjs";

/** `starting` counts as live: a server on its way up still holds its port. */
export function isLive(session) {
  return session.state === "starting" || session.state === "running";
}

export function createSessionStore() {
  /** A stopped preview is gone, not remembered — it is a process, not a record. */
  const sessions = new Map();

  /** The checkout itself, or a subdirectory of it (where `previewAppDirs` allows the app to sit). */
  function under(hostId, checkout) {
    const prefix = previewKey(hostId, checkout);
    return [...sessions.values()].filter(
      (session) => session.key === prefix || session.key.startsWith(`${prefix}/`),
    );
  }

  return {
    all: () => [...sessions.values()],
    live: () => [...sessions.values()].filter(isLive),
    under,
    liveUnder: (hostId, checkout) => under(hostId, checkout).filter(isLive),
    has: (key) => sessions.has(key),
    set: (session) => sessions.set(session.key, session),
    delete: (key) => sessions.delete(key),
    clear: () => sessions.clear(),
  };
}
