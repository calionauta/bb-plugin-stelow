import assert from "node:assert/strict";
import { CLAIM_TERMINAL_STATUSES, isClaimTerminal, errorNeedsAttention } from "../lib/card-terminal.mjs";

// A terminal card must hold no file claims: every past, present, and future
// terminal state belongs here, or the release paths silently leak.
assert.deepEqual([...CLAIM_TERMINAL_STATUSES].sort(), ["archived", "blocked", "completed"]);
for (const status of ["completed", "archived", "blocked"]) {
  assert.equal(isClaimTerminal(status), true, `${status} releases claims`);
}
for (const status of ["draft", "pending", "in-progress", "done", "skipped", "escalated", "failed", null, undefined, 42]) {
  assert.equal(isClaimTerminal(status), false, `${String(status)} keeps claims`);
}

// A stale error on a terminal card is residue, never a request: both card-list
// and card-detail attention share this predicate so the badge and the open
// card cannot disagree about a finished card.
for (const status of ["completed", "archived", "blocked"]) {
  assert.equal(errorNeedsAttention(status, "boom", "idle"), false, `${status} with a stale error asks for nothing`);
  assert.equal(errorNeedsAttention(status, null, "error"), false, `${status} in error activity asks for nothing`);
}
assert.equal(errorNeedsAttention("in-progress", "boom", "idle"), true, "a live card with a last_error needs attention");
assert.equal(errorNeedsAttention("in-progress", null, "error"), true, "a live card in error activity needs attention");
assert.equal(errorNeedsAttention("in-progress", null, "idle"), false, "a clean live card asks for nothing");
assert.equal(errorNeedsAttention("in-progress", "", "idle"), false, "an empty error is not an error");
assert.equal(errorNeedsAttention(null, "boom", "idle"), true, "an unknown status counts as live, never silently muted");

console.log("card-terminal: ok");
