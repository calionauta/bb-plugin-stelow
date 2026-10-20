import assert from "node:assert/strict";
import { cardCanResume, cardIsTerminal, cardNeedsReview, cardShowsAttention } from "../lib/card-attention.mjs";
import { cardIsStalled } from "../lib/card-stall.mjs";
import { pausedActivityLabel } from "../lib/detail-presentation.mjs";
import { workerActionPolicy } from "../lib/worker-action-policy.mjs";

const active = {
  status: "in-progress",
  activity: "idle",
  needsAttention: true,
  workerThreadId: "thread-1",
  hasPendingReview: false,
};

// A card the host is holding. `needsAttention` is false by construction — the
// board never derives attention for a non-idle activity — but the assertion is
// made with it true anyway, so this test cannot pass by accident if a future
// change ever starts flagging held cards.
const held = { ...active, activity: "held", needsAttention: true };

assert.equal(cardIsTerminal(active), false, "active work is not terminal");
assert.equal(cardCanResume(active), true, "an attended idle worker can resume in place");
assert.equal(cardCanResume({ ...active, workerThreadId: null }), false, "a parked card has no worker to resume");
assert.equal(cardCanResume({ ...active, status: "completed" }), false, "completed work never offers retry");
assert.equal(cardCanResume({ ...active, status: "blocked" }), false, "blocked work never offers retry");
assert.equal(cardCanResume({ ...active, activity: "error" }), true, "an errored worker is eligible for the recovery path");
// A card whose host has stopped answering its state read.
//
// The warning travels on `readMissSince`, which is not `activity` and never
// becomes it — so the recovery path cannot see it, and the channel cannot
// manufacture an affordance. Asserted against a card whose own verified state
// DOES earn a resume, which is the only way to tell "the warning added a
// button" apart from "the warning changed nothing": the button is still there
// because the card is idle and stalled, not because a host is silent.
//
// Suppressing it instead would be the worse bug: a card that genuinely stopped,
// hidden behind a read fault the reader can do nothing about, and a resume
// suppressed by a fact about the HOST. The dispatch is queued either way, so
// it lands when the host returns — the same promise the hold makes.
assert.equal(
  cardCanResume({ ...active, readMissSince: 1_000 }),
  cardCanResume(active),
  "the read warning is invisible to the resume decision, in both directions: it adds no button and removes none",
);
assert.equal(
  cardCanResume({ ...active, activity: "running", readMissSince: 1_000 }),
  false,
  "a card that never earned a resume does not get one from a read fault",
);
assert.equal(
  cardShowsAttention({ ...active, readMissSince: 1_000 }),
  true,
  "and attention stays the card's own: the warning neither invents an action item nor suppresses one",
);
assert.equal(
  workerActionPolicy({ ...active, readMissSince: 1_000 }, true).showRestartFresh,
  workerActionPolicy(active, true).showRestartFresh,
  "Manage's restart-fresh follows the card's verified activity, not the read fault",
);
assert.equal(cardShowsAttention(active), true, "idle attention has no duplicate activity chip");
assert.equal(cardShowsAttention({ ...active, activity: "awaiting-answer" }), false, "the waiting pill replaces the attention chip");
assert.equal(cardShowsAttention({ ...active, activity: "error" }), false, "the error pill replaces the attention chip");

// --- one predicate, three readers ------------------------------------------
// The pause chip, the Resume button and the amber channel all ask "is this card
// stalled on a person?". They used to each write the predicate out, agree, and
// render the same stall twice. Now they share `cardIsStalled`, and this is the
// guard that keeps them sharing it: a reader that stops agreeing is a reader
// that will one day light a chip with no button behind it.
assert.equal(cardIsStalled(active), true, "an idle, attended card is stalled");
assert.equal(cardShowsAttention(active), cardIsStalled(active),
  "the amber channel reads the shared predicate, not a copy of it");
assert.equal(pausedActivityLabel(active) !== null, cardIsStalled(active),
  "the pause chip reads the shared predicate, not a copy of it");
assert.equal(cardCanResume(active), cardIsStalled(active),
  "the Resume button reads the shared predicate, not a copy of it — a chip without its button is a dead end");
for (const activity of ["held", "error", "awaiting-answer", "running"]) {
  const card = { ...active, activity };
  assert.equal(cardIsStalled(card), false, `a ${activity} card is not stalled on a person`);
  assert.equal(pausedActivityLabel(card), null,
    `a ${activity} card wears no pause chip — the chip and the predicate are the same answer`);
}
assert.equal(cardNeedsReview({ status: "completed", hasPendingReview: true }), true, "a completed card with unread review asks for review");
assert.equal(cardNeedsReview({ status: "in-progress", hasPendingReview: true }), false, "unfinished work never asks for completion review");

// card_e3u00eb4, 2026-09-30: the Resume button on a card whose next message was
// already queued behind the host's concurrency limit. Pressing it queued a
// second copy of a message that was about to be delivered on its own, and the
// card offered it for ten minutes. A wait the host resolves by itself is not
// something a person recovers.
assert.equal(cardCanResume(held), false, "a held card offers no resume: nothing is waiting on a person");
assert.equal(cardShowsAttention(held), false, "a held card raises no attention chip — nothing to act on");
assert.equal(
  workerActionPolicy(held, true).showRestartFresh,
  false,
  "a held card is not a recovery target in Manage either",
);

console.log("card attention test ok: terminal retry, held cards offer no recovery, attention parity, and review eligibility");
