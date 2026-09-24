import assert from "node:assert/strict";
import { cardCanResume, cardIsTerminal, cardNeedsReview, cardShowsAttention } from "../lib/card-attention.mjs";

const active = {
  status: "in-progress",
  activity: "idle",
  needsAttention: true,
  workerThreadId: "thread-1",
  hasPendingReview: false,
};

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

console.log("card attention test ok: terminal retry, attention parity, and review eligibility");
