import assert from "node:assert/strict";
import { cardCanResume, cardIsTerminal, cardNeedsReview, cardShowsAttention } from "../lib/card-attention.mjs";
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
assert.equal(cardShowsAttention(active), true, "idle attention has no duplicate activity chip");
assert.equal(cardShowsAttention({ ...active, activity: "awaiting-answer" }), false, "the waiting pill replaces the attention chip");
assert.equal(cardShowsAttention({ ...active, activity: "error" }), false, "the error pill replaces the attention chip");
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
