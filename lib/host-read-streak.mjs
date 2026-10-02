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
//   One counter, two channels. The warn above is the operator's; the timestamp
//   below is the card owner's, and both are decided by the SAME number crossing
//   the SAME threshold on the same tick, so the log and the board can never
//   disagree about when an outage became worth reporting. A second counter for
//   the card would be the drift this repo refuses: two things counting one
//   outage, one of them quietly wrong.
//
//   What the card is told, and what it is not. The card learns THAT its reads
//   are failing and since when — never WHY, because the plugin measured a
//   symptom and a cause it cannot see would be a guess wearing a fact's
//   clothes. It learns it through its own nullable column rather than through
//   `activity`: `activity` is the last VERIFIED projection, and overwriting it
//   would destroy the only true thing the card knows while the host is silent —
//   a card that is probably working would stop saying so. Nor does it touch
//   `last_error` (which feeds errorNeedsAttention → cardCanResume, a Resume
//   button for a fault no resume fixes) or the inbox (every kind there is an
//   action or a review request; this is neither, and a row would hold the badge
//   above zero asking for something that changes nothing).
//
//   This module still has no database and no card in its signature beyond an id
//   and a number, which is what makes every property below checkable from a
//   unit test with no wiring harness.

import { formatDuration } from "./card-metrics.mjs";

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

/** The card column that carries the warning. Named here, where the rule is. */
export const READ_MISS_COLUMN = "read_miss_since";

/**
 * The card update for a streak that has just crossed the threshold.
 *
 * Latched, never rewritten: once the outage is on the card, the time it started
 * is fixed, so a card unreadable for an hour keeps saying "since 14:32" instead
 * of a moving number. The no-op guard in `updateCard` turns the repeated call
 * into no write at all, so a long outage does not bump `updated_at` every 45s
 * and reshuffle the board under the reader.
 *
 * Empty when the outage is already latched — there is nothing new to record.
 */
export function readMissUpdates(streak, alreadySince, at) {
  if (streak < READ_STREAK_WARN_AT) return {};
  if (alreadySince != null) return {};
  return { [READ_MISS_COLUMN]: at };
}

/**
 * The card update for a read that came back, or for a card that left the sync's
 * scope. Clearing is the whole self-clearing contract: a warning that outlives
 * the fault is a second lie, so every door out of the unreadable state writes
 * the column back to null rather than waiting for a tick that may not come.
 */
export function readRecoveredUpdates(alreadySince) {
  return alreadySince == null ? {} : { [READ_MISS_COLUMN]: null };
}

/**
 * The sentence the card shows, derived from the measurement every time.
 *
 * Same contract `lib/host-hold.mjs` keeps for the host's hold: the record is
 * the truth and this is the only wording, so a writer cannot record a fault and
 * render a different reason. It names the measurement — the host is not
 * answering, and for how long — and never a cause, because none was measured.
 *
 * It ends in the promise that makes the state bearable: the card recovers by
 * itself, so the reader is told there is nothing to do rather than left
 * wondering what a stale card wants from them.
 */
export function readMissSummary(since, nowMs) {
  if (since == null) return null;
  return `The host has not answered this card's state read for ${formatDuration(nowMs - since)}. `
    + "What the card shows below is its last verified projection, so read it as stale. "
    + "The plugin log names this card once per outage, and the next successful read clears this on its own — "
    + "nothing here needs you.";
}

/**
 * The hero reading for a card whose reads are failing, or null.
 *
 * The decision lives here, in a module a test can import, rather than inline in
 * the hero: the words on the card and the branch that shows them are one rule,
 * and a rule that can only be checked by reading a `.tsx` is a rule nobody
 * checks. `readMissSummary` is the wording; this is the placement, and the
 * placement is the part with a failure mode — a hero that claimed a healthy
 * card was unreadable, or that buried the warning under a calmer reading.
 */
export function readMissHero(since, nowMs, stageName) {
  const sub = readMissSummary(since, nowMs);
  if (!sub) return null;
  return { kind: "unreadable", title: `Host not answering — ${stageName}`, sub };
}