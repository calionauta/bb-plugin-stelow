// How long the host has been failing to answer one card's state read.
//
// This exists because the two honest channels were both wrong. Writing the
// failure to the card makes a transport fault a verdict about the card, and
// `last_error` feeds `errorNeedsAttention` → `cardCanResume`, so the reader
// gets a "Resume work" button for a fault no resume can fix — the exact class
// of bug v0.58.1 removed by refusing to write an unreadable read. Staying
// completely silent is also wrong: on 2026-09-30 three cards lost reads to a
// stalled daemon event loop, recovered 71s later with no trace, and the next
// occurrence would again be explained by theory instead of a log line.
//
// So the only remaining channel is the operator's log, and the rule that makes
// it usable is that it says *once* per outage. A warn on every 45s tick is not
// a trace, it is noise the reader learns to skip.
//
// Two decisions are not obvious and are stated here because both would be
// "simplifications" somebody makes later:
//
//   In-memory, never persisted. The streak means "the host has not answered
//   this card since the plugin started watching". Persisted, it would outlive
//   that meaning — a host restart would inherit a streak and immediately warn
//   about failures it never saw.
//
//   Log-only, never a card write. See above. This module has no database and
//   no card in its signature beyond an id, which is what makes the property
//   checkable from a unit test with no wiring harness.

/** Consecutive misses before the host is named once. Six ticks is about 4.5
 * minutes at the 45s reconcile — long enough that a single slow read, a
 * restarting worker, or one dropped connection is not a report. */
export const READ_STREAK_WARN_AT = 6;

/**
 * One per-wiring streak table. `warn(cardId, streak)` is the only channel:
 * a caller that wants a different one passes a different callback, and no
 * caller can accidentally write the streak to the card because there is
 * nowhere here to write it.
 */
export function createHostReadStreak(warn) {
  const streaks = new Map();
  return {
    /** Record a miss and return the streak it brings the card to. */
    unreadable(cardId) {
      const next = (streaks.get(cardId) ?? 0) + 1;
      streaks.set(cardId, next);
      // `===` and not `>=`: the warning is per outage, and a host that stays
      // down for an hour must not produce forty copies of one sentence.
      if (next === READ_STREAK_WARN_AT) warn(cardId, next);
      return next;
    },
    /** A read came back — the outage, if any, is over. */
    readable(cardId) {
      streaks.delete(cardId);
    },
    /** The card left the sync's scope; drop its streak rather than keep a
     * counter alive for a card nobody is watching. */
    forget(cardId) {
      streaks.delete(cardId);
    },
    streakOf(cardId) {
      return streaks.get(cardId) ?? 0;
    },
  };
}