// Should a scheduled visit spend a model turn on this card, right now?
//
// Backstory, because the name needs one. A `bb automation` in `agent` mode
// cannot decide anything for free: the host spawns a thread and the model
// thinks, whether or not there was work. Measured on the loop that filed this
// (bb-plugin-stelow#385), a visit that concluded "nothing changed" cost ~70k
// tokens and 30-54 tool calls, and repeated that every 20 minutes for as long
// as the card sat waiting on a person. Nothing cheap could stop it, because the
// only cheap signal available was `bb automation` in `script` mode, and a
// script can reach the host but knows nothing about a card.
//
// So this module is the cheap half. It reads the card's own record — no host
// round trip beyond what the caller already has, no model, no network — and
// answers "is this tick worth spending". The CLI verb `bb stelow wake` is the
// thin shell that turns the answer into the host's documented silent-skip
// contract (`{"wakeAgent": false}` as the last line of stdout), so a script-mode
// sentinel can gate an agent-mode worker for nothing.
//
// The gate needs one memory the card cannot give it: whether the last visit
// already saw this exact state. `wakeFingerprint` names what a visit can change
// and `shouldWake` refuses a repeat on an unchanged card, so "idle" is worth one
// visit per state rather than one visit per tick. The memory itself lives in the
// command that runs the gate, not here — the decision stays pure.
//
// NOT the retired supervision knob. That knob asked the worker to re-check its
// own work on a cadence (`supervisor: 1|2|3`), was quoted in prose nobody
// enforced, and was removed in 0.83.0 as pure cost. This asks the opposite
// question about a different actor: not "should the worker re-read its work"
// (never — the acceptance contract proves that at scope close) but "should
// anyone visit this card at all". Naming it `supervision` would resurrect a word
// this repo spent a release deleting, so it is `wake`.
//
// Every refusal names its reason, because the reader of a skipped tick is a
// person watching a loop that appears to have stopped: a skip with no reason
// sends someone looking for a state problem that does not exist.

import { MAX_AUTO_CONTINUES } from "./auto-continue.mjs";
import { CLAIM_TERMINAL_STATUSES, errorNeedsAttention } from "./card-terminal.mjs";
import { QUESTION_ACTIVITY } from "./question-store.mjs";

/**
 * The plugin's own resume budget, reused as the gate's ceiling.
 *
 * Not a count of wasted visits — the plugin owns `auto_continue_count`, and a
 * scheduled visit never increments it. It is the point past which the plugin
 * itself stopped resuming an idle worker without a stage advance, and "the
 * plugin already gave up ten times" is the closest thing to evidence the gate
 * can read that another turn would be the loop rather than a rescue.
 */
export const MAX_RESUME_ATTEMPTS = MAX_AUTO_CONTINUES;

/**
 * What would make a second visit worth it.
 *
 * Deliberately small and deliberately NOT the idle timestamp: a visit that
 * finds nothing still ends by parking the card again, so `last_idle_at` moves
 * on every visit and could never distinguish "nothing happened" from "something
 * happened". The fields here are the ones a visit could actually change —
 * where the card is (status, stage), what it is doing (activity), and whether
 * it is carrying a failure — so the same fingerprint on two ticks means the
 * last turn changed none of them.
 *
 * `auto_continue_count` is left out on purpose: the plugin nudging its own idle
 * worker is not news a scheduled visit should pay 70k tokens to re-read.
 */
export function wakeFingerprint({ status, activity, stage, lastError = null }) {
  return [status ?? "", activity ?? "", stage ?? "", lastError ?? ""].join("\u0001");
}

/**
 * Is this card's next scheduled visit worth a model turn?
 *
 * Order is the whole design. The cheap, unambiguous refusals come first, so the
 * reason a reader sees is the most specific one that applies rather than
 * whichever branch happened to be first in the file. `awaiting-answer` sits
 * above everything about activity and idle timestamps because a card parked on
 * a human is the case the issue measured, and it is also the case where every
 * other signal looks like "idle and ready" — the trap that made the loop run.
 *
 * `unchangedSinceVisit` is the changed-since guard, and it is applied LAST: it
 * may only turn a would-be wake into a refusal, never replace a more specific
 * reason. A card that is waiting on a human is still described as waiting on a
 * human whether or not anyone visited it before.
 *
 * @param {object} options
 * @param {string} options.status             card status row value
 * @param {string} [options.activity]         persisted activity projection
 * @param {string} [options.stage]            current workflow stage
 * @param {string} [options.lastError]        last_error column
 * @param {number|null} [options.lastIdleAt]  when the card last parked idle
 * @param {number} [options.now]              clock, injected for tests
 * @param {number|null} [options.autoCount]   consecutive resumes without a stage advance
 * @param {boolean} [options.readUnreachable] the host has stopped answering this card
 * @param {boolean} [options.unchangedSinceVisit] a visit already ran on this exact state
 * @returns {{ wake: boolean, reason: string }}
 */
export function shouldWake({
  status,
  activity,
  stage = null,
  lastError = null,
  lastIdleAt = null,
  now = Date.now(),
  autoCount = null,
  readUnreachable = false,
  unchangedSinceVisit = false,
}) {
  // Cheap, unambiguous refusals first, so the reason a reader sees is the most
  // specific one that applies rather than whichever branch came first in the
  // file.
  const blocked = refusedWithoutLookingDeeper({ status, activity, readUnreachable });
  if (blocked) return blocked;
  // Then the states that CAN be work, each with its own budget rule.
  const verdict = workVerdict({ status, activity, lastError, lastIdleAt, now, autoCount });
  // Last, because it is the only refusal derived from the gate's own memory
  // rather than from the card: it suppresses a repeat, never an explanation.
  if (verdict.wake && unchangedSinceVisit) {
    return refuse(
      `card has not moved since the last visit (${activity ?? "unknown"} at ${stage ?? "no stage"}): another turn would re-derive the same conclusion`,
    );
  }
  return verdict;
}

/**
 * The refusals that need no budget arithmetic: a finished card, a card parked on
 * a person, and a card whose host has stopped answering.
 *
 * Split out because the ordering IS the design — `awaiting-answer` must outrank
 * the stale error and idle-ish projection the same card carries, or the reader is
 * told a symptom instead of the cause.
 */
function refusedWithoutLookingDeeper({ status, activity, readUnreachable }) {
  // A finished card is not work, and this refusal is never wrong.
  if (CLAIM_TERMINAL_STATUSES.includes(status)) {
    return refuse(`card is ${status}: no visit can move it`);
  }
  // The measured case from bb-plugin-stelow#385: a card in `awaiting-answer` has
  // a live question, and a visit cannot answer it — only a person can.
  if (activity === QUESTION_ACTIVITY) {
    return refuse("card is waiting on a human answer: a visit cannot answer it for them");
  }
  // Waking a thread against a host that is not answering spends a turn to learn
  // nothing, and the read channel already owns its own bounded recovery.
  if (readUnreachable) {
    return refuse("host is not answering this card's state read: the turn would be spent blind");
  }
  return null;
}

/**
 * The states that can carry work, each with its own budget rule.
 *
 * An error is checked before the plain idle park because it is the more specific
 * diagnosis: a card can be both idle and carrying a `last_error`, and reporting
 * the park would send the reader to look at the wrong thing. Both share the same
 * attempt budget — past it, another visit is the loop this module exists to
 * stop, and the refusal names the actor who can move it.
 */
function workVerdict({ status, activity, lastError, lastIdleAt, now, autoCount }) {
  const hasError = errorNeedsAttention(status, lastError, activity);
  if (attemptsExhausted(autoCount) && (hasError || activity === "idle")) {
    return refuse(
      hasError
        ? `card has an error and its automatic attempts are exhausted (${autoCount ?? 0}): this needs a person`
        : "card parked idle and its resume budget is spent: the worker is stuck, not chatty",
    );
  }
  if (hasError) return wakeReason("card has an error and automatic attempts remain");
  if (activity === "idle") {
    return wakeReason(
      lastIdleAt == null
        ? "card parked idle with an unfinished stage"
        : `card parked idle for ${Math.round(Math.max(0, now - lastIdleAt) / 1000)}s with an unfinished stage`,
    );
  }
  // Running, starting or stopping: the card is doing something already. A visit
  // adds a turn beside live work, which is how one held card became ten nudges.
  if (activity === "running") {
    return refuse("card is already running: the scheduled visit would race the live turn");
  }
  // Anything else is an activity this gate does not model. Refusing to wake is
  // the safe default for a cost gate, and the reason names the unknown value so
  // it can be modelled deliberately instead of silently costing turns.
  return refuse(`card activity "${activity ?? "unknown"}" is not one this gate models`);
}

function attemptsExhausted(autoCount) {
  return (autoCount ?? 0) >= MAX_RESUME_ATTEMPTS;
}

function refuse(reason) {
  return { wake: false, reason };
}

function wakeReason(reason) {
  return { wake: true, reason };
}
