import assert from "node:assert/strict";
import {
  PROBE_BASE_MS,
  PROBE_MAX_MS,
  PROBE_PASS_BUDGET_MS,
  PROBE_PASS_LIMIT,
  createProbeBackoff,
  probeDelay,
} from "../lib/publication-probe-backoff.mjs";

// How often the reconcile pass may re-ask about one finished card.
//
// The pass asks the forge and the content proof about every completed card with
// no recorded integration. That is correct while the list is short and an
// outage once it is not: measured live at 59,728 ms in the publications step,
// one card after another, with the host unresponsive while it ran.
//
// So the rule is a schedule, and every case below is a way it can silently stop
// bounding the pass:
//
// - growth that stalls at the base wait turns the schedule into "every tick"
// - a cap that is not reached keeps growing past any sane interval
// - a state keyed by anything but the card makes one card silence the others
// - a success that does not forget the card leaves a card that later regresses
//   waiting hours for a probe it should get at once

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// --- the constants are the contract ----------------------------------------

assert.equal(PROBE_BASE_MS, 5 * MINUTE, "the first wait after a failed probe is five minutes");
assert.equal(PROBE_MAX_MS, 6 * HOUR, "the schedule saturates at six hours");
assert.equal(PROBE_PASS_LIMIT, 5, "one pass probes at most five cards");
assert.equal(PROBE_PASS_BUDGET_MS, 10_000, "one pass spends at most ten seconds probing");

// --- the wait doubles from the base, and stops at the cap -------------------

assert.equal(probeDelay(1), 5 * MINUTE, "one failure waits five minutes");
assert.equal(probeDelay(2), 10 * MINUTE, "two failures wait ten");
assert.equal(probeDelay(3), 20 * MINUTE, "three wait twenty");

{
  let previous = 0;
  for (let attempts = 1; attempts <= 40; attempts += 1) {
    const delay = probeDelay(attempts);
    assert.ok(
      delay <= PROBE_MAX_MS,
      `failure ${attempts} never schedules a wait past the six-hour cap`,
    );
    assert.ok(delay >= previous, `failure ${attempts} never schedules a shorter wait than ${attempts - 1}`);
    if (delay < PROBE_MAX_MS) {
      assert.equal(
        delay,
        attempts === 1 ? PROBE_BASE_MS : previous * 2,
        `failure ${attempts} doubles the previous wait while under the cap`,
      );
    }
    previous = delay;
  }
}

assert.equal(probeDelay(7), 320 * MINUTE, "seven failures are still below the cap at 5h20m");
assert.equal(probeDelay(8), PROBE_MAX_MS, "the eighth failure reaches the cap");
assert.equal(probeDelay(4000), PROBE_MAX_MS, "a saturated schedule stays capped rather than overflowing");

// --- a count that makes no sense is the base wait, never a longer one ------

assert.equal(probeDelay(0), PROBE_BASE_MS, "no recorded failure waits the base interval");
assert.equal(probeDelay(-1), PROBE_BASE_MS, "a negative count is not a reason to wait longer");
assert.equal(probeDelay(-40), PROBE_BASE_MS, "nor is a large negative one");
assert.equal(probeDelay(Number.NaN), PROBE_BASE_MS, "a count that is not a number cannot stretch the wait");

// --- a fresh card is due, and a failure schedules the next ask -------------

{
  const backoff = createProbeBackoff();
  assert.equal(backoff.due("a", 0), true, "a card that was never probed is due at once");

  assert.equal(backoff.failed("a", 0), 5 * MINUTE, "the first failure reports its five-minute wait");
  assert.equal(backoff.due("a", 0), false, "and the card is not due at the instant it failed");
  assert.equal(backoff.due("a", 1 * MINUTE), false, "one minute later it is still waiting");
  assert.equal(backoff.due("a", 5 * MINUTE - 1), false, "not one millisecond before its wait expires");
  assert.equal(backoff.due("a", 5 * MINUTE), true, "exactly five minutes later it is due");

  assert.equal(backoff.failed("a", 5 * MINUTE), 10 * MINUTE, "the second failure doubles the wait");
  assert.equal(backoff.due("a", 14 * MINUTE), false, "the second wait runs to 5+10 minutes");
  assert.equal(backoff.due("a", 15 * MINUTE), true, "and expires at fifteen");

  assert.equal(backoff.failed("a", 15 * MINUTE), 20 * MINUTE, "the third failure doubles it again");
  assert.equal(backoff.due("a", 34 * MINUTE), false, "the third wait runs to 15+20 minutes");
  assert.equal(backoff.due("a", 35 * MINUTE), true, "and expires at thirty-five");
}

// --- a success forgets the card, so a later failure starts over ------------

{
  const backoff = createProbeBackoff();
  backoff.failed("a", 0);
  backoff.failed("a", 5 * MINUTE);
  assert.equal(backoff.due("a", 10 * MINUTE), false, "the card is waiting after two failures");

  backoff.succeeded("a");
  assert.equal(backoff.due("a", 10 * MINUTE), true, "a success makes the card due immediately");
  assert.equal(backoff.due("a", 0), true, "even at a clock that moved backwards");

  assert.equal(
    backoff.failed("a", 10 * MINUTE),
    5 * MINUTE,
    "and its next failure waits the base interval, not the second one",
  );
}

// --- cards are independent: one card's wait never silences another ---------

{
  const backoff = createProbeBackoff();
  backoff.failed("a", 0);
  assert.equal(backoff.due("a", 0), false, "a is waiting");
  assert.equal(backoff.due("b", 0), true, "b was never asked about, so a's wait does not cover it");

  backoff.failed("b", 0);
  backoff.failed("b", 5 * MINUTE);
  assert.equal(backoff.due("b", 5 * MINUTE), false, "b is on its second wait");

  assert.equal(backoff.due("a", 5 * MINUTE), true, "a's first wait still expires on a's own schedule");
  assert.equal(backoff.due("b", 15 * MINUTE), true, "b's second wait expires on b's own schedule");

  // The attempt counter is per card: b is on its third failure, a on its first.
  assert.equal(backoff.failed("b", 15 * MINUTE), 20 * MINUTE, "b's third failure waits twenty minutes");
  backoff.succeeded("a");
  assert.equal(backoff.failed("a", 15 * MINUTE), 5 * MINUTE, "a's restart is not b's attempt count");
  assert.equal(backoff.due("b", 34 * MINUTE), false, "b's twenty-minute wait is untouched by a's success");
  assert.equal(backoff.due("b", 35 * MINUTE), true, "and expires at thirty-five");
}

console.log("publication probe backoff test ok: five to six hours, per card, forgotten on success");
