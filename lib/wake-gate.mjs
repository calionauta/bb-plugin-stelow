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
// NOT the retired supervision knob. That knob asked the worker to re-check its
// own work on a cadence (`supervisor: 1|2|3`), was quoted in prose nobody
// enforced, and was removed in 0.83.0 as pure cost. This asks the opposite
// question about a different actor: not "should the worker re-read its work"
// (never — the acceptance contract proves that at scope close) but "should
// anyone visit this card at all". Naming it `supervision` would resurrect a word
// this repo spent a release deleting, so it is `wake`.
//
// Every refusal names its reason, because the reader of a skipped tick is a
// person watching a loop that appears to have stopped. "No reason recorded" is
// the failure this repo's `docs/github-issues.md` calls out by name: an
// unactionable refusal sends someone looking for a state problem that does not
// exist.

import { MAX_AUTO_CONTINUES } from "./auto-continue.mjs";
import { CLAIM_TERMINAL_STATUSES, errorNeedsAttention } from "./card-terminal.mjs";
import { QUESTION_ACTIVITY } from "./question-store.mjs";

/** HOW many consecutive wasted visits before the gate stops trusting a card. */
export const MAX_WASTED_VISITS = MAX_AUTO_CONTINUES;

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
 * @param {object} options
 * @param {string} options.status             card status row value
 * @param {string} [options.activity]         persisted activity projection
 * @param {string} [options.lastError]        last_error column
 * @param {number|null} [options.lastIdleAt]  when the card last parked idle
 * @param {number} [options.now]              clock, injected for tests
 * @param {number|null} [options.autoCount]   consecutive resumes without a stage advance
 * @param {boolean} [options.readUnreachable] the host has stopped answering this card
 * @returns {{ wake: boolean, reason: string }}
 */
export function shouldWake({
  status,
  activity,
  lastError = null,
  lastIdleAt = null,
  now = Date.now(),
  autoCount = null,
  readUnreachable = false,
}) {
  // Cheap, unambiguous refusals first, so the reason a reader sees is the most
  // specific one that applies rather than whichever branch came first in the
  // file.
  const blocked = refusedWithoutLookingDeeper({ status, activity, readUnreachable });
  if (blocked) return blocked;
  // Then the states that CAN be work, each with its own budget rule.
  return workVerdict({ status, activity, lastError, lastIdleAt, now, autoCount });
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
  return (autoCount ?? 0) >= MAX_WASTED_VISITS;
}

function refuse(reason) {
  return { wake: false, reason };
}

function wakeReason(reason) {
  return { wake: true, reason };
}
