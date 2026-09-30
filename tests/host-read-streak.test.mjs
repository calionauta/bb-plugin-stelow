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

console.log("host-read-streak ok: one warn per outage, reset on recovery, per card");