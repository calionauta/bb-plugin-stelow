// The streak table is the only trace a persistent host failure leaves, so the
// two properties that make it usable have to hold: it speaks once per outage,
// and it resets the moment the host answers again.
//
// Both are verified by inversion. Ten consecutive misses emitting ten warns is
// the noise failure (`>=` instead of `===`, or no threshold at all). A reset
// that does not reset is the worse one: the second outage of the day would be
// silent, which is the whole defect this module was written to close.
import assert from "node:assert/strict";
import {
  createHostReadStreak,
  readMissHero,
  readMissSummary,
  readMissUpdates,
  readRecoveredUpdates,
  READ_MISS_COLUMN,
  READ_STREAK_WARN_AT,
} from "../lib/host-read-streak.mjs";

const collector = () => {
  const warned = [];
  return { warned, streak: createHostReadStreak((cardId, n) => warned.push([cardId, n])) };
};

// Ten misses are one outage. Every tick records — the card is left alone, and
// it is the *trace* that is once-only, not the counting.
{
  const { warned, streak } = collector();
  for (let tick = 0; tick < 10; tick += 1) streak.unreadable("card_1");
  assert.deepEqual(warned, [["card_1", READ_STREAK_WARN_AT]], "one warn per outage, not one per tick");
  assert.equal(streak.streakOf("card_1"), 10, "the streak keeps counting after the warn");
}

// Below the threshold nothing is said at all: a single slow read is not a
// report, and reporting it teaches the operator to ignore the line.
{
  const { warned, streak } = collector();
  for (let tick = 0; tick < READ_STREAK_WARN_AT - 1; tick += 1) streak.unreadable("card_1");
  assert.deepEqual(warned, []);
  assert.equal(streak.streakOf("card_1"), READ_STREAK_WARN_AT - 1);
}

// A recovered host ends the outage, so a later one is reported again. Without
// the reset this is the silent-outage bug.
{
  const { warned, streak } = collector();
  for (let tick = 0; tick < READ_STREAK_WARN_AT; tick += 1) streak.unreadable("card_1");
  streak.readable("card_1");
  assert.equal(streak.streakOf("card_1"), 0, "a read clears the streak");
  for (let tick = 0; tick < READ_STREAK_WARN_AT; tick += 1) streak.unreadable("card_1");
  assert.deepEqual(warned.length, 2, "the second outage is its own report");
  assert.deepEqual(warned[1], ["card_1", READ_STREAK_WARN_AT]);
}

// A card that left scope must not keep a counter alive: the map is keyed by id
// and would otherwise grow with every card the sync ever stopped watching.
{
  const { warned, streak } = collector();
  streak.unreadable("card_1");
  streak.unreadable("card_1");
  streak.forget("card_1");
  assert.equal(streak.streakOf("card_1"), 0, "forget drops the streak");
  for (let tick = 0; tick < READ_STREAK_WARN_AT; tick += 1) streak.unreadable("card_1");
  assert.deepEqual(warned.length, 1, "a forgotten card starts its next outage from zero");
}

// Streaks are per card. One card's outage must not arm another's warning.
{
  const { warned, streak } = collector();
  for (let tick = 0; tick < READ_STREAK_WARN_AT + 2; tick += 1) streak.unreadable("card_1");
  streak.unreadable("card_2");
  assert.deepEqual(warned, [["card_1", READ_STREAK_WARN_AT]]);
  assert.equal(streak.streakOf("card_2"), 1);
}

assert.equal(READ_STREAK_WARN_AT, 6, "six ticks is about 4.5 minutes at the 45s reconcile");

// The card's half of the same measurement. These are the rules the sync depends
// on, and each is verified by inversion: `>=` on the threshold would put a
// warning on the card for one slow read, and dropping the `alreadySince` guard
// would rewrite the latch on every one of the 45s ticks of an hour-long outage.
{
  assert.deepEqual(
    readMissUpdates(READ_STREAK_WARN_AT - 1, null, 1_000),
    {},
    "one tick short of the threshold the card hears nothing",
  );
  assert.deepEqual(
    readMissUpdates(READ_STREAK_WARN_AT, null, 1_000),
    { read_miss_since: 1_000 },
    "the tick that reaches the threshold latches the time the outage was measured",
  );
  assert.deepEqual(
    readMissUpdates(READ_STREAK_WARN_AT + 40, 1_000, 9_000),
    {},
    "an outage already on the card is not re-latched: a moving timestamp would reshuffle the board every 45s",
  );
  assert.deepEqual(
    readRecoveredUpdates(1_000),
    { read_miss_since: null },
    "a read that comes back takes the latch off",
  );
  assert.deepEqual(readRecoveredUpdates(null), {}, "a card that was never missed has nothing to clear");
  // The column is named here, where the rule is, and the sync's writes are
  // built from that name — a literal in the sync would be a second spelling of
  // the same column, free to drift.
  assert.equal(READ_MISS_COLUMN, "read_miss_since");
  assert.deepEqual(
    Object.keys(readMissUpdates(READ_STREAK_WARN_AT, null, 1)),
    [READ_MISS_COLUMN],
    "the write targets exactly the named column",
  );
}

// The sentence is derived from the measurement, on every read, and it promises
// the recovery instead of asking for a decision. The two failure modes are both
// lies: a sentence that guesses a cause the plugin never measured, and one that
// leaves the reader with a stale card and nothing to press.
{
  const summary = readMissSummary(1_000, 1_000 + 4 * 60_000 + 30_000);
  assert.match(summary, /4m 30s/, "it names how long the host has been not answering — the measurement, not a vibe");
  assert.match(summary, /has not answered this card's state read/, "it names what was measured");
  assert.match(summary, /last verified projection/, "it says the card below is stale rather than implying it is current");
  assert.match(summary, /nothing here needs you/, "it closes with the absence of an action, so the state is not homework");
  assert.doesNotMatch(summary, /resume|retry|restart/i, "no resume affordance: no worker action fixes a host that is not answering");
  assert.equal(readMissSummary(null, 1_000), null, "a card whose host is answering has no sentence, and never an invented one");

  // The hero reading, which is where the sentence is actually shown. Placed
  // above the failure and the stall branch, so a stale projection cannot be
  // re-told as "the worker stopped" (with a Retry) or "stuck" (with a Resume):
  // both are verdicts recorded before the reads stopped, and neither offers an
  // action that reaches a host which is not answering.
  const hero = readMissHero(1_000, 1_000 + 30_000, "Execution");
  assert.equal(hero.kind, "unreadable", "the hero says what was measured, not what the card last concluded");
  assert.equal(hero.title, "Host not answering — Execution", "and it keeps the stage, which is the last verified fact");
  assert.match(hero.sub, /30s/, "carrying the same measurement the summary derives");
  assert.equal(readMissHero(null, 1_000, "Execution"), null, "no latch, no hero branch: a cleared warning falls through to the card's real state");
}

console.log("host-read-streak ok: one warn per outage, reset on recovery, per card, one latch per outage");