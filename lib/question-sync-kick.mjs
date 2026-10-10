import { QUESTION_WAITING_SUMMARY, syncQuestionInboxEvents } from "./inbox-events.mjs";

/**
 * The inbox row for a fresh question, minted early.
 *
 * `bb stelow ask` blocks inside the host's requestInput, so the open path
 * cannot mint synchronously: the pending interaction exists host-side only
 * once that call runs. Without a kick, the row waits for the 45s reconcile
 * tick (or a thread event, or a card open) while the card already shows the
 * question — the Build counter and the Inbox badge both read zero behind a
 * visible wait. This schedules one early sync that observes the interaction
 * a moment after the ask starts; the tick stays the backstop.
 *
 * Fail-safe by construction: an empty observation skips instead of
 * resolving everything open as superseded, a failed interaction read keeps
 * the previous state, and every write underneath is idempotent — a kick
 * that races the tick (or a second kick) mints nothing twice.
 */

/** Delay between the ask call and the early sync: long enough for the host
 * to register the interaction, short enough to feel instant. */
export const QUESTION_SYNC_KICK_MS = 1500;

export async function syncFreshQuestionInbox(deps) {
  const { db, bb, pendingAsks, openExpiredQuestionIds, now, randomId, threadId, cardId } = deps;
  try {
    const asks = await pendingAsks(threadId);
    if (!asks) return null;
    const ids = [...asks.map((ask) => ask.id), ...openExpiredQuestionIds(cardId)];
    if (ids.length === 0) return null;
    const result = syncQuestionInboxEvents(db, {
      cardId,
      interactionIds: ids,
      occurredAt: now(),
      createId: () => randomId("evt"),
      summary: QUESTION_WAITING_SUMMARY,
    });
    const changed = result.inserted + result.resolved + result.reopened + result.pausedSuperseded;
    if (changed > 0) bb.realtime.publish("inbox-changed", { cardId });
    return result;
  } catch {
    // A failed read or write keeps the previous state: the reconcile tick
    // is the backstop, and a kick must never crash the host loop.
    return null;
  }
}

/** Returns a cancel function; the timer never holds the loop open. */
export function kickQuestionSync(deps, { threadId, cardId, delayMs = QUESTION_SYNC_KICK_MS } = {}) {
  const timer = setTimeout(() => {
    void syncFreshQuestionInbox({ ...deps, threadId, cardId });
  }, delayMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearTimeout(timer);
}
