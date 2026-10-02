// A worker thread the HOST is holding, read as a fact.
//
// The host queues a message and declines to dispatch it: the concurrency limit
// is full, the host went offline, a permission interaction is open. The message
// is already on its way and nobody has to push it. That is the opposite of a
// card that stopped, and the difference is the whole point of this module.
//
// It matters because the symptom is identical. A held card and a stalled card
// are both "not running", and the plugin used to project both as `idle` with a
// Resume button and a `paused` inbox row. So a reader was told a card needed
// recovery when the host was about to release it unprompted, and pressing
// Resume queued a SECOND copy of the message already in the queue. Ten ticks
// of that turned one held card into ten identical nudges and spent the whole
// auto-continue budget on turns that never ran.
//
// So the record is the truth and the sentence is DERIVED from it, here, every
// time — the same contract lib/lock-blocked.mjs keeps for file contention, for
// the same reason. A writer cannot hold a card and render a different reason,
// because it only has one value to pass. And because every derivation ends in
// "no action needed", a hold can never be phrased as homework: a notification
// that implies work the system will do on its own is what teaches people to
// distrust the badge.

/** Activity value while the host holds the card's next dispatch. */
export const HELD_ACTIVITY = "held";

// One rule, no carve-outs: a queued row IS a hold. The kinds are here to say
// WHICH hold, not to decide whether it counts. An earlier draft excluded the
// in-flight kinds (`thread-busy`, `turn-starting`, …) as too short-lived to
// report, and that was a rule with two authors — the send path needed them
// (a freshly queued row must project as held, or the card claims `running`
// for a turn that has not started) while the poll path did not. The read only
// runs against an idle thread, so an in-flight kind cannot survive to be
// misreported anyway, and a host that adds a kind tomorrow degrades to the
// generic sentence instead of vanishing from the card.
const HOLD_KIND = {
  plugin: "capacity",
  "host-offline": "offline",
  interaction: "permission",
  time: "scheduled",
};

// Each builder ends in the promise that makes the sentence safe to show: what
// releases it, and that the reader is not the one who has to.
const HOLD_SENTENCE = {
  capacity: (hold) => `Waiting on the host: ${hold.reason}. `
    + "The host dispatches it as soon as it can — no action needed.",
  offline: (hold) => `Waiting on host ${hold.holderId} to come back. `
    + "The card continues on its own once it does — no action needed.",
  permission: () => "Waiting on a permission request in the worker thread. "
    + "Answer it there and the card continues on its own — no action needed.",
  scheduled: () => "Waiting for the host's clock to release the queued message. "
    + "The card continues on its own — no action needed.",
  queued: () => "The host is holding this card's next message. "
    + "The card continues on its own — no action needed.",
};

const PILE = (count) => ` ${count} messages are queued behind it.`;

/**
 * The hold on a thread, from the host's own queue rows. Null when nothing is
 * held.
 *
 * @param {unknown} rows the host's `threads.queuedMessages.list` rows
 * @returns {import("./host-hold.d.mts").HostHold | null}
 */
export function hostHold(rows) {
  const held = (Array.isArray(rows) ? rows : []).filter(isHeld);
  const first = held[0];
  if (!first) return null;
  return {
    // An unknown kind reads as the generic hold rather than as no hold: the
    // row exists, so the host has not dispatched it, and that much is true
    // whatever the kind turns out to be.
    kind: HOLD_KIND[first.waitingOn.kind] ?? "queued",
    // The holder's identity, never its sentence: `pluginId` and `hostName` are
    // the two things a reader could look up, and they are the only parts of the
    // record that are not already display text.
    holderId: first.waitingOn.pluginId ?? first.waitingOn.hostName ?? null,
    // The host's own words, kept verbatim. It counts live slots ("4 of 4
    // running on host X") that nothing here can recompute, so a paraphrase
    // would be a second source of truth that rots the moment a slot frees.
    reason: first.waitingOn.reason ?? null,
    queued: held.length,
  };
}

function isHeld(row) {
  return typeof row?.waitingOn?.kind === "string";
}

/** The sentence, from the record. Never a claim that the reader must act. */
export function holdSentence(hold) {
  if (!hold) return null;
  const build = HOLD_SENTENCE[hold.kind] ?? HOLD_SENTENCE.queued;
  // A queue deeper than one is worth naming: it means something enqueued
  // repeatedly while the card was held, which is exactly the pile-up this
  // module exists to make visible rather than hide behind "no action needed".
  return build(hold) + (hold.queued > 1 ? PILE(hold.queued) : "");
}

/**
 * Update fields for "the host is holding this card". Activity and text only —
 * never `status`, so the card stays in its column, for the same reason
 * questionWaitUpdates does not move it: board position is durable progress and
 * a transport wait is not progress.
 */
export function holdUpdates(lastOutput) {
  return { activity: HELD_ACTIVITY, last_assistant_text: lastOutput };
}
