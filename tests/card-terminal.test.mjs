import assert from "node:assert/strict";
import { CLAIM_TERMINAL_STATUSES, isClaimTerminal } from "../lib/card-terminal.mjs";

// A terminal card must hold no file claims: every past, present, and future
// terminal state belongs here, or the release paths silently leak.
assert.deepEqual([...CLAIM_TERMINAL_STATUSES].sort(), ["archived", "blocked", "completed"]);
for (const status of ["completed", "archived", "blocked"]) {
  assert.equal(isClaimTerminal(status), true, `${status} releases claims`);
}
for (const status of ["draft", "pending", "in-progress", "done", "skipped", "escalated", "failed", null, undefined, 42]) {
  assert.equal(isClaimTerminal(status), false, `${String(status)} keeps claims`);
}

console.log("card-terminal: ok");
